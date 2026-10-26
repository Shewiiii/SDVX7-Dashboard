import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scripts.audio import CONFIG, configuration, r2_client, tools, write_json
from scripts.companion import ROOT, load_config, with_https


def prompt(label: str, default: str = "") -> str:
    value = input(f"{label}{' [' + str(default) + ']' if default else ''}: ").strip()
    return value or str(default)


def origin(value: str) -> str:
    parsed = urlparse(with_https(value))
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or re.search(r"[\s;'\"\\]", parsed.netloc)
    ):
        raise ValueError("Use a complete http:// or https:// website URL.")
    return f"{parsed.scheme}://{parsed.netloc}"


def apply_media_policy(config: dict[str, Any]) -> None:
    """Allow local rendered audio and the configured bucket across setup/update runs."""
    allowed = "'self' blob:"
    if config.get("mode") == "r2":
        public = config.get("public_url", "")
        if not public.startswith("https://"):
            raise ValueError("The public audio URL must use HTTPS.")
        allowed += " " + origin(public)
    path = ROOT / "vercel.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    for group in value.get("headers", []):
        for header in group.get("headers", []):
            if header["key"].lower() != "content-security-policy":
                continue
            directives = [
                part.strip() for part in header["value"].split(";") if part.strip()
            ]
            old_audio = {
                source
                for part in directives
                if part.startswith("media-src ")
                for source in part.split()[1:]
                if source not in ("'self'", "blob:")
            }
            connections = next(
                (
                    part.split()[1:]
                    for part in directives
                    if part.startswith("connect-src ")
                ),
                ["'self'"],
            )
            connections = [source for source in connections if source not in old_audio]
            if config.get("mode") == "r2":
                connections.append(origin(config["public_url"]))
            directives = [
                part
                for part in directives
                if not part.startswith(("media-src ", "connect-src "))
            ]
            directives.append("media-src " + allowed)
            directives.append("connect-src " + " ".join(dict.fromkeys(connections)))
            header["value"] = "; ".join(directives)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def configure_r2(config: dict[str, Any]) -> None:
    try:
        import boto3  # noqa: F401
    except ImportError:
        print("Installing the optional R2 uploader into the proxy's venv...")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "-r",
                str(ROOT / "requirements-audio.txt"),
            ],
            check=True,
        )
    account = prompt(
        "Cloudflare account ID",
        config.get("endpoint", "")
        .removeprefix("https://")
        .removesuffix(".r2.cloudflarestorage.com"),
    )
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account):
        raise ValueError(
            "The Cloudflare account ID must have 32 hexadecimal characters."
        )
    config["endpoint"] = f"https://{account}.r2.cloudflarestorage.com"
    config["bucket"] = prompt("Audio bucket name", config.get("bucket", "sdvx-audio"))
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", config["bucket"]):
        raise ValueError("Invalid bucket name.")
    for field, label in [
        ("access_key", "Access Key ID"),
        ("secret_key", "Secret Access Key"),
    ]:
        value = prompt(
            f"{label}{' (Enter to keep saved value)' if config.get(field) else ''}"
        ).strip()
        config[field] = value or config.get(field, "")
        if not config[field]:
            raise ValueError("Both R2 access keys are required.")
    print(
        "Enable Public Access for this bucket in Cloudflare, using a custom domain or r2.dev URL."
    )
    print(
        "A custom domain is preferable for normal use; r2.dev has development rate limits."
    )
    public = with_https(
        prompt("Public bucket URL (not the S3 endpoint)", config.get("public_url", ""))
    ).rstrip("/")
    parsed = urlparse(public)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
        or parsed.hostname.endswith("r2.cloudflarestorage.com")
    ):
        raise ValueError("Use the public HTTPS bucket domain, without a path or query.")
    config["public_url"] = public
    website = origin(prompt("Dashboard website URL", load_config().get("url", "")))
    client = r2_client(config)
    try:
        client.head_bucket(Bucket=config["bucket"])
    except client.exceptions.ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) not in (
            "404",
            "NoSuchBucket",
            "NotFound",
        ):
            raise
        raise ValueError(
            "Create this bucket in Cloudflare, then rerun audio setup."
        ) from None
    rule = {
        "ID": "sdvx-audio",
        "AllowedOrigins": sorted(
            {website, "http://localhost:3000", "http://127.0.0.1:3000"}
        ),
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["Range", "Content-Type"],
        "ExposeHeaders": [
            "Accept-Ranges",
            "Content-Range",
            "Content-Length",
            "ETag",
        ],
        "MaxAgeSeconds": 86400,
    }
    try:
        try:
            rules = client.get_bucket_cors(Bucket=config["bucket"]).get("CORSRules", [])
        except client.exceptions.ClientError as error:
            if error.response.get("Error", {}).get("Code") not in (
                "NoSuchCORSConfiguration",
                "NoSuchCORS",
            ):
                raise
            rules = []
        rules = [existing for existing in rules if existing.get("ID") != "sdvx-audio"]
        client.put_bucket_cors(
            Bucket=config["bucket"], CORSConfiguration={"CORSRules": [*rules, rule]}
        )
    except client.exceptions.ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) not in (
            "AccessDenied",
            "403",
            "Unauthorized",
        ):
            raise
        policy = json.dumps(
            [{key: value for key, value in rule.items() if key != "ID"}], indent=2
        )
        print(policy)
        print("Copy the JSON above into your bucket's Settings > CORS policy.")
        print("Keep any unrelated existing CORS rules alongside this rule.\n")
        input("Press Enter once the CORS policy is saved: ")
    client.list_objects_v2(Bucket=config["bucket"], Prefix="audio/", MaxKeys=1)


def main() -> None:
    config = configuration()
    print("Audio is optional. Local preview needs no cloud account.")
    print(
        "1. Local playback only\n2. Local + hosted audio with Cloudflare R2\n3. Disable audio"
    )
    mode = prompt("Mode", {"local": "1", "r2": "2", "off": "3"}[config["mode"]])
    if mode not in ("1", "2", "3"):
        raise ValueError("Choose 1, 2, or 3.")
    config["mode"] = {"1": "local", "2": "r2", "3": "off"}[mode]
    if mode != "3":
        try:
            ffmpeg, ffprobe = tools(config)
        except RuntimeError:
            print(
                "Download FFmpeg (including ffprobe): https://ffmpeg.org/download.html"
            )
            folder = Path(prompt("Folder containing ffmpeg and ffprobe").strip('"'))
            suffix = ".exe" if sys.platform == "win32" else ""
            config.update(
                ffmpeg=str(folder / ("ffmpeg" + suffix)),
                ffprobe=str(folder / ("ffprobe" + suffix)),
            )
            ffmpeg, ffprobe = tools(config)
        config.update(ffmpeg=str(ffmpeg), ffprobe=str(ffprobe))
        variant = prompt(
            "Audio: full or preview",
            config.get("variant", "full"),
        ).lower()
        if variant not in ("full", "preview"):
            raise ValueError("Choose full or preview.")
        config.update(variant=variant)
        from scripts.audio import AudioLibrary, plan_audio
        from scripts.companion import resolve_proxy
        from scripts.sync import Catalog

        codec = prompt(
            "File format: opus or flac", config.get("format", "opus")
        ).lower()
        if codec not in ("opus", "flac"):
            raise ValueError("Choose opus or flac.")
        config["format"] = codec
        if codec == "flac":
            print(
                "WARNING: FLAC files are much larger and WILL EXCEED R2's free storage allowance and incur charges."
            )
            print(
                "Existing uploads also consume storage. Download/read-operation charges remain possible with either format."
            )
            keep_limit = prompt("Keep the 9 GB upload limit? (Y/n)", "n").lower()
            if keep_limit not in ("y", "yes", "n", "no"):
                raise ValueError("Choose Y or n.")
            config["storage_limit_gb"] = 9 if keep_limit in ("y", "yes") else 0
            if not config["storage_limit_gb"]:
                print("Storage limit disabled.")
        else:
            config["storage_limit_gb"] = 9
            print("Measuring unique tracks for the 9 GB Opus budget...")
            config["bitrate"] = plan_audio(
                AudioLibrary(Catalog(resolve_proxy()).details, config)
            )["bitrate"]

    if mode == "2":
        configure_r2(config)
    apply_media_policy(config)
    write_json(CONFIG, config)
    print("Saved locally. Restart preview / the proxy companion to apply.")
    if mode == "2":
        print(
            "The companion converts and uploads a few tracks per pass, then syncs player metadata."
        )
        print(
            "Deploy the updated dashboard once with update-dashboard.bat. Upload progress appears in the proxy console and .local/sync.log."
        )


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("Audio setup cancelled. Saved settings are unchanged.")
        raise SystemExit(1) from None
    except Exception as error:  # noqa: BLE001 - never print raw SDK exceptions containing credentials
        # SDK exception strings can include request credentials. Do not echo them.
        message = (
            str(error)
            if isinstance(error, (ValueError, RuntimeError))
            else type(error).__name__
        )
        print(
            f"Audio setup did not finish: {message}. Saved settings are unchanged.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
