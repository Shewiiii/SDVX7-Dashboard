from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scripts.companion import (
    ROOT,
    display_name,
    load_config,
    resolve_tracker,
    save_config,
    shared_settings,
    tracker_python,
)

VERCEL_VERSION = "63.1.2"


def origin(value: str) -> str:
    parsed = urlparse(value.strip().rstrip("/"))
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path
    ):
        raise ValueError("Enter the HTTPS dashboard address without a path.")
    return parsed.geturl()


def prompt(label: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    return input(f"{label}{suffix}: ").strip() or default


def prompt_origin(label: str, default: str = "") -> str:
    while True:
        try:
            return origin(prompt(label, default))
        except ValueError as error:
            print(
                f"{error} Example: https://your-dashboard.vercel.app. Please try again."
            )


def run(command: list[str], *, capture: bool = False, **kwargs: Any) -> str:
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        **kwargs,
    )
    return result.stdout.strip() if capture else ""


def node_tools() -> tuple[str, str]:
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm:
        raise ValueError("Node.js is missing. Install Node.js 22.5+ before setup.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if tuple(map(int, version.lstrip("v").split("."))) < (22, 5, 0):
        raise ValueError("Node.js 22.5 or newer is required.")
    return node, npm


def check_tracker(tracker: Path) -> Path:
    python = tracker_python(tracker)
    if not (tracker.parent / "data/others/music_db.xml").is_file():
        raise ValueError(
            "Game music database missing. Put the tracker folder inside your SDVX game folder."
        )
    subprocess.run(
        [
            str(python),
            "-c",
            (
                "import dotenv, PIL, pykakasi; "
                "from tracker.music import MusicCatalog; "
                "from tracker.playtime import load_playtime_summary"
            ),
        ],
        cwd=tracker,
        check=True,
    )
    shared = shared_settings(tracker)
    print(f"Tracker: {tracker}")
    print(f"Display name: {display_name(load_config(), tracker)}")
    print(f"Spending currency: {shared['currency']}")
    print(f"Python: {python}")
    print("Existing tracker configuration and history will be reused.")
    return python


def vercel(npm: str, *args: str, capture: bool = False, **kwargs: Any) -> str:
    # A ZIP inside the tracker must not inherit the tracker's Git repository.
    kwargs.setdefault(
        "env", {**os.environ, "GIT_CEILING_DIRECTORIES": str(ROOT.parent)}
    )
    return run(
        [
            npm,
            "exec",
            "--yes",
            f"--package=vercel@{VERCEL_VERSION}",
            "--",
            "vercel",
            *args,
        ],
        capture=capture,
        **kwargs,
    )


def configure_connection(config: dict[str, Any]) -> None:
    config["url"] = prompt_origin(
        "Existing dashboard HTTPS address", config.get("url", "")
    )
    secret = getpass.getpass(
        "Existing website SYNC_TOKEN (Enter to keep saved secret): "
    ).strip()
    if secret:
        config["token"] = secret
    if len(config.get("token", "")) < 32:
        raise ValueError(
            "Paste the website's SYNC_TOKEN. It must have at least 32 characters."
        )
    bypass = getpass.getpass("Deployment Protection bypass secret (optional): ").strip()
    if bypass:
        config["bypass"] = bypass
    save_config(config)
    print("Existing website connected.")


def deploy(
    config: dict[str, Any], tracker: Path, node: str, npm: str, update: bool = False
) -> dict[str, Any]:
    try:
        vercel(npm, "whoami", capture=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        vercel(npm, "login")
    project_path = ROOT / ".vercel/project.json"
    if not project_path.exists():
        default = re.sub(
            r"[^a-z0-9-]+", "-", display_name(config, tracker).lower()
        ).strip("-")
        project = prompt("Vercel project name", f"{default or 'sdvx'}-dashboard")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", project):
            raise ValueError(
                "Use lowercase letters, numbers, and hyphens for the project name."
            )
        vercel(npm, "link", "--yes", "--project", project)
    project = json.loads(project_path.read_text(encoding="utf-8"))
    stages_path = ROOT / ".local/setup-state.json"
    try:
        stages = (
            json.loads(stages_path.read_text(encoding="utf-8"))
            if stages_path.exists()
            else {}
        )
        if not isinstance(stages, dict):
            stages = {}
    except ValueError:
        stages = {}
    if stages.get("project_id") != project["projectId"]:
        stages = {"project_id": project["projectId"]}
    if not update and not stages.get("database_connected"):
        # Existing projects may already have a database from an earlier setup.
        env_names = vercel(
            npm, "env", "ls", "production", capture=True, stderr=subprocess.STDOUT
        )
        if not re.search(r"\bDATABASE_URL\b", env_names):
            print(
                "Connect Neon to this project. Choose the plan and approve its terms when prompted."
            )
            vercel(
                npm,
                "integration",
                "add",
                "neon",
                "--name",
                project.get("projectName") or f"sdvx-{project['projectId'][-10:]}",
                "--no-env-pull",
                "-e",
                "production",
                "-e",
                "preview",
            )
        stages["database_connected"] = True
        stages_path.parent.mkdir(parents=True, exist_ok=True)
        stages_path.write_text(json.dumps(stages, indent=2), encoding="utf-8")
    # Keep the saved token, including on reruns. Never rotate an existing connection.
    config["token"] = config.get("token") or secrets.token_urlsafe(48)
    save_config(config)
    run([node, "scripts/connect.mjs"])
    vercel(npm, "deploy", "--prod", "--yes")
    config = load_config()
    print(
        "Copy the and paste the ALIASED URL you see above (it should be https://[what you typed before].vercel.app), OR your custom domain put in Vercel."
    )
    config["url"] = prompt_origin("Aliased URL", config.get("url", ""))
    save_config(config)
    print(
        "For a public dashboard, production Deployment Protection must allow public access."
    )
    return config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args(argv)
    config = load_config()
    tracker = resolve_tracker()
    python = check_tracker(tracker)
    node, npm = node_tools()
    run([npm, "ci", "--no-audit", "--no-fund"])
    if args.update:
        if not (ROOT / ".vercel/project.json").exists():
            raise ValueError("No linked deployment. Run Setup-dashboard.bat first.")
        choice = "1"
    else:
        print("1. Create or resume a Vercel dashboard\n2. Connect an existing website")
        choice = prompt("Setup mode", "1")
    if choice == "1":
        deploy(config, tracker, node, npm, args.update)
    elif choice == "2":
        configure_connection(config)
    else:
        raise ValueError("Choose 1 or 2.")
    run([str(python), "-c", "from scripts.sync import run; run(once=True)"])
    print("Ready. Use Start-tracker-with-dashboard.bat for future sessions.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        print(f"Dashboard setup did not finish: {error}", file=sys.stderr)
        print(
            "Run setup again to resume. Existing tracker files were not changed.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except (EOFError, KeyboardInterrupt):
        print("Dashboard setup cancelled. Run it again to resume.")
        raise SystemExit(1) from None
