"""Configure optional original jackets without deploying the dashboard"""

from __future__ import annotations

from typing import Any

from scripts.audio import read_json, write_json
from scripts.audio_setup import configure_r2, origin, prompt, reuse_r2
from scripts.companion import ROOT
from scripts.jackets import CONFIG, configuration


def apply_hosted_settings(config: dict[str, Any]) -> None:
    env = ROOT / ".env.local"
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [line for line in lines if not line.startswith("JACKET_ASSET_URL=")]
    if config["mode"] == "r2":
        lines.append(f"JACKET_ASSET_URL={config['public_url'].rstrip('/')}/jackets/")
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
                    and tokens[0] in ("img-src", "connect-src")
                    and public_origin not in tokens
                ):
                    tokens.append(public_origin)
                directives.append(" ".join(tokens))
            header["value"] = "; ".join(directives)
    write_json(policy, document)


def main() -> None:
    config = configuration()
    print(
        "1. Local preview only\n2. Local + Cloudflare R2\n3. Disable high quality jackets"
    )
    choice = prompt("Mode", {"local": "1", "r2": "2", "off": "3"}[config["mode"]])
    if choice not in ("1", "2", "3"):
        raise ValueError("Choose 1, 2, or 3.")
    config["mode"] = {"1": "local", "2": "r2", "3": "off"}[choice]
    if choice == "2" and not reuse_r2(config):
        configure_r2(config)
    apply_hosted_settings(config)
    write_json(CONFIG, config)
    print("Saved locally. Restart the dashboard or preview to apply.")
    if choice == "2":
        print(
            "Deploy the updated dashboard with update-dashboard.bat. Progress appears in the console and .local/do-not-delete/sync/sync.log."
        )
