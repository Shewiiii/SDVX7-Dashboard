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
    dashboard_settings,
    display_name,
    load_config,
    normalize_currency,
    proxy_python,
    resolve_proxy,
    save_config,
    with_https,
)

VERCEL_VERSION = "63.1.2"


def origin(value: str) -> str:
    parsed = urlparse(with_https(value).rstrip("/"))
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
    if not capture:
        subprocess.run(command, cwd=ROOT, check=True, text=True, **kwargs)
        return ""
    timeout = kwargs.pop("timeout", 45)
    with subprocess.Popen(
        command, cwd=ROOT, text=True, stdout=subprocess.PIPE, **kwargs
    ) as process:
        try:
            output, _ = process.communicate(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            # npm.cmd starts other processes. Stop its whole tree on cancellation.
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            if process.poll() is None:
                process.kill()
            process.communicate()
            raise
        if process.returncode:
            raise subprocess.CalledProcessError(
                process.returncode, command, output=output
            )
        return output.strip()


def node_tools() -> tuple[str, str]:
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm:
        raise ValueError("Node.js is missing. Install Node.js 22.5+ before setup.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if tuple(map(int, version.lstrip("v").split("."))) < (22, 5, 0):
        raise ValueError("Node.js 22.5 or newer is required.")
    return node, npm


def check_proxy(proxy: Path) -> Path:
    python = proxy_python(proxy)
    if not (proxy.parent / "data/others/music_db.xml").is_file():
        raise ValueError(
            "Game music database missing. Put the proxy folder inside your SDVX game folder."
        )
    run([str(python), "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])
    subprocess.run(
        [
            str(python),
            "-c",
            (
                "import dotenv, PIL, pykakasi; "
                "from scripts.music import MusicCatalog; "
                "from proxy.playtime import load_playtime_summary"
            ),
        ],
        cwd=ROOT,
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                filter(None, (str(proxy), os.getenv("PYTHONPATH")))
            ),
        },
        check=True,
    )
    print(f"Proxy: {proxy}")
    print(f"Python: {python}")
    print("Existing proxy configuration and history will be reused.")
    return python


def vercel(npm: str, *args: str, capture: bool = False, **kwargs: Any) -> str:
    # Keep Git discovery within the dashboard folder.
    kwargs.setdefault(
        "env", {**os.environ, "GIT_CEILING_DIRECTORIES": str(ROOT.parent)}
    )
    if capture:
        labels = {
            "whoami": "Checking Vercel login...",
            "project": "Checking the saved Vercel project...",
            "env": "Checking dashboard environment variables...",
        }
        print(labels.get(args[0], "Checking Vercel..."), flush=True)
        args = (*args, "--non-interactive")
        kwargs.setdefault("stdin", subprocess.DEVNULL)
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


def configure_preferences(config: dict[str, Any]) -> None:
    current = dashboard_settings(config)
    while True:
        username = prompt("Display name for stats", current["name"])
        if 1 <= len(username) <= 40:
            break
        print("Enter a display name of 1 to 40 characters.")
    currency = current["currency"]
    while True:
        try:
            currency = normalize_currency(
                prompt(
                    "Currency for spending estimates, in ISO format, for example EUR, USD, AUD, CNY, KRW.",
                    currency,
                )
            )
            break
        except ValueError as error:
            print(error)
            currency = ""
    config.update(name=username, currency=currency)
    save_config(config)


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


def linked_project(npm: str, config: dict[str, Any], proxy: Path) -> dict[str, Any]:
    project_path = ROOT / ".vercel/project.json"
    if project_path.exists():
        try:
            vercel(npm, "project", "inspect", capture=True, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError as error:
            details = (error.output or "").lower()
            if (
                '"link_required"' not in details
                and "project was either deleted" not in details
            ):
                raise
            print(
                "The saved Vercel project link is no longer accessible. "
                "Select the correct account or team and your dashboard project."
            )
            previous = project_path.read_bytes()
            project_path.unlink()
            try:
                vercel(npm, "link")
                if not project_path.exists():
                    raise ValueError(
                        "Vercel did not save a project link. Run setup again."
                    )
                vercel(
                    npm, "project", "inspect", capture=True, stderr=subprocess.STDOUT
                )
            except BaseException:
                project_path.write_bytes(previous)
                raise
    if not project_path.exists():
        default = re.sub(r"[^a-z0-9-]+", "-", display_name(config).lower()).strip("-")
        project = prompt("Vercel project name", f"{default or 'sdvx'}-dashboard")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", project):
            raise ValueError(
                "Use lowercase letters, numbers, and hyphens for the project name."
            )
        vercel(npm, "link", "--yes", "--project", project)
    return json.loads(project_path.read_text(encoding="utf-8"))


def deploy(
    config: dict[str, Any], proxy: Path, node: str, npm: str, update: bool = False
) -> dict[str, Any]:
    try:
        vercel(npm, "whoami", capture=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        vercel(npm, "login")
    project = linked_project(npm, config, proxy)
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
    from scripts.migration import migrate_legacy

    proxy = resolve_proxy()
    migration = migrate_legacy(ROOT, proxy)
    from dotenv import dotenv_values

    # Reuse an already configured proxy; a new install prompts for the EA server.
    if not dotenv_values(proxy / ".env", interpolate=False).get("UPSTREAM"):
        subprocess.run(
            [
                str(proxy_python(proxy)),
                "-c",
                "from proxy.setup import configure; configure()",
            ],
            cwd=proxy,
            check=True,
        )
    python = check_proxy(proxy)
    config = load_config()
    if not args.update or not config.get("name") or not config.get("currency"):
        configure_preferences(config)
    if migration is not None:
        migration.finish()
    from scripts.audio import configuration
    from scripts.audio_setup import apply_media_policy

    apply_media_policy(configuration())
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
        deploy(config, proxy, node, npm, args.update)
    elif choice == "2":
        configure_connection(config)
    else:
        raise ValueError("Choose 1 or 2.")
    run([str(python), "-c", "from scripts.sync import run; run(once=True)"])
    print("Ready. Use run-proxy-with-dashboard.bat for future sessions.")
    print("Optional song playback: See README.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError) and error.output:
            print(error.output, file=sys.stderr)
        print(f"Dashboard setup did not finish: {error}", file=sys.stderr)
        print(
            "Local data is preserved. Run setup again to resume.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except subprocess.TimeoutExpired:
        print(
            "A setup command timed out. Setup stopped. "
            "Check your connection and rerun setup.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except (EOFError, KeyboardInterrupt):
        print("Dashboard setup cancelled. Run it again to resume.")
        raise SystemExit(1) from None
