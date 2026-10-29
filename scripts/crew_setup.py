"""Install the optional crew tools and configure R2 without deploying the dashboard."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from scripts.audio import CONFIG as AUDIO_CONFIG
from scripts.audio import configuration, read_json, tools, write_json
from scripts.audio_setup import configure_r2, origin, prompt
from scripts.companion import ROOT
from scripts.crew_voices import voices_enabled
from scripts.crews import CONFIG, prepare_catalog

RUNTIMES = {
    "pixi.min.js": "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
    "cubism4.min.js": "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js",
    "live2dcubismcore.min.js": "https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js",
}


def download(url: str, target: Path) -> None:
    if target.is_file():
        return
    request = urllib.request.Request(url, headers={"User-Agent": "SDVX-Dashboard"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(target)


def install_tools() -> None:
    audio_config = configuration()
    if voices_enabled():
        try:
            tools(audio_config)
        except RuntimeError:
            print("Crew voices need FFmpeg and ffprobe, also used by song audio.")
            audio_config["ffmpeg"] = prompt(
                "Path to ffmpeg.exe", audio_config.get("ffmpeg", "")
            )
            tools(audio_config)
            write_json(AUDIO_CONFIG, audio_config)
    directory = ROOT / ".local/crew-tools"
    directory.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(directory))
    if any(importlib.util.find_spec(name) is None for name in ("ifstools", "PIL")):
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--target",
                str(directory),
                "-r",
                str(ROOT / "requirements/requirements-crew.txt"),
            ],
            check=True,
        )
    for name, url in RUNTIMES.items():
        download(url, directory / name)
    package = directory / "sdvx_afp"
    if not (package / "swf.py").is_file():
        source = directory / "bemaniutils.zip"
        download(
            "https://codeload.github.com/DragonMinded/bemaniutils/zip/refs/heads/trunk",
            source,
        )
        with zipfile.ZipFile(source) as archive:
            for member in archive.infolist():
                parts = Path(member.filename).parts
                if len(parts) < 5 or parts[1:4] != ("bemani", "format", "afp"):
                    continue
                relative = Path(*parts[4:])
                if relative.parts[0] not in (
                    "swf.py",
                    "geo.py",
                    "decompile.py",
                    "util.py",
                    "types",
                ):
                    continue
                target = (package / relative).resolve()
                if not target.is_relative_to(package.resolve()):
                    raise ValueError("Invalid parser archive path")
                if member.external_attr >> 16 & 0o170000 == 0o120000:
                    raise ValueError("Parser archive contains a symbolic link")
                if not member.is_dir():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(member))
            package.mkdir(parents=True, exist_ok=True)
            (package / "__init__.py").write_text("", encoding="utf-8")
        (directory / "afp-source.sha256").write_text(
            hashlib.sha256(source.read_bytes()).hexdigest(), encoding="ascii"
        )
    prepare_catalog()


def apply_hosted_settings(config: dict[str, Any]) -> None:
    value = config.get("public_url", "").rstrip("/") + "/crews/"
    env = ROOT / ".env.local"
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [line for line in lines if not line.startswith("CREW_ASSET_URL=")]
    if config["mode"] == "r2":
        lines.append(f"CREW_ASSET_URL={value}")
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if config["mode"] != "r2":
        return
    policy = ROOT / "vercel.json"
    document = read_json(policy, {})
    public_origin = origin(config["public_url"])
    for group in document.get("headers", []):
        for header in group.get("headers", []):
            if header["key"].lower() != "content-security-policy":
                continue
            directives = []
            for directive in header["value"].split(";"):
                tokens = directive.strip().split()
                if (
                    tokens
                    and tokens[0]
                    in ("script-src", "img-src", "connect-src", "media-src")
                    and public_origin not in tokens
                ):
                    tokens.append(public_origin)
                directives.append(" ".join(tokens))
            if not any(directive.startswith("media-src ") for directive in directives):
                directives.append(f"media-src 'self' blob: {public_origin}")
            header["value"] = "; ".join(directives)
    write_json(policy, document)


def main() -> None:
    config = read_json(CONFIG, {"mode": "local"})
    print("Nemsys Crew is optional. Local preview needs no cloud account.")
    print(
        "1. Local preview only\n2. Local + hosted crews with Cloudflare R2\n3. Disable crews"
    )
    choice = prompt(
        "Mode", {"local": "1", "r2": "2", "off": "3"}.get(config.get("mode"), "1")
    )
    if choice not in ("1", "2", "3"):
        raise ValueError("Choose 1, 2, or 3.")
    config["mode"] = {"1": "local", "2": "r2", "3": "off"}[choice]
    if choice != "3":
        value = prompt(
            "Enable voice bank? (Y/n)",
            "Y" if config.get("voices_enabled", True) else "n",
        ).lower()
        if value not in ("yes", "no", "y", "n"):
            raise ValueError("Choose yes or no.")
        config["voices_enabled"] = value in ("yes", "y")
        if config["voices_enabled"]:
            print(
                "Voice encoding follows your audio playback setup's format and bitrate."
            )
    if choice == "2":
        audio = configuration()
        fields = ("endpoint", "bucket", "access_key", "secret_key", "public_url")
        if all(audio.get(field) for field in fields):
            config.update({field: audio[field] for field in fields})
            print("Using the saved R2 bucket from audio playback setup.")
        elif not all(config.get(field) for field in fields):
            configure_r2(config)
    write_json(CONFIG, config)
    if choice != "3":
        install_tools()
    apply_hosted_settings(config)
    print("Saved locally. Restart preview / the proxy companion to apply.")
    if choice == "2":
        print(
            "Deploy the updated dashboard once with update-dashboard.bat. Progress appears in the proxy console and .local/sync.log."
        )


if __name__ == "__main__":
    main()
