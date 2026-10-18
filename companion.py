from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / ".local/sync-config.json"


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict):
        raise TypeError("Dashboard connection settings must be a JSON object.")
    for key in ("url", "token", "bypass", "name"):
        if key in config and not isinstance(config[key], str):
            raise TypeError(f"Dashboard setting '{key}' must be text.")
    return config


def save_config(config: dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, indent=2), encoding="utf-8")
    temporary.replace(CONFIG_PATH)


def resolve_tracker() -> Path:
    tracker = ROOT.parent
    if not all(
        (tracker / name).is_file()
        for name in ("config.py", "tracker/launcher.py", "tracker/music.py")
    ):
        raise ValueError("Put the dashboard folder inside your VF tracker folder.")
    return tracker


def tracker_python(tracker: Path) -> Path:
    executable = (
        tracker / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    if not executable.is_file():
        raise ValueError(
            "Tracker Python environment missing. Run the tracker's setup.bat first."
        )
    return executable


def tracker_module(tracker: Path, name: str) -> ModuleType:
    # Reuse installed helpers. Never import the bot or start another proxy.
    location = str(tracker)
    if location not in sys.path:
        sys.path.insert(0, location)
    return importlib.import_module(f"tracker.{name}")


def shared_settings(tracker: Path) -> dict[str, Any]:
    from dotenv import dotenv_values

    values = dotenv_values(tracker / ".env", interpolate=False)

    def setting(key: str, default: str = "") -> str:
        return os.getenv(key) or values.get(key) or default

    # Only these public preferences leave this adapter. BOT_TOKEN is never exported.
    currency = setting("TRACKER_CURRENCY", "USD").strip().upper()
    if not (currency.isascii() and currency.isalpha() and len(currency) == 3):
        currency = "USD"
    return {
        "name": setting("TRACKER_USERNAME"),
        "currency": currency,
        "initial_playtime": setting("TRACKER_INITIAL_PLAYTIME", "0"),
        "baseline_seconds": int(setting("TRACKER_PLAYTIME_BASELINE_SECONDS", "0")),
        "baseline_plays": int(setting("TRACKER_PLAYTIME_BASELINE_PLAYS", "0")),
    }


def display_name(config: dict[str, Any], tracker: Path) -> str:
    return (shared_settings(tracker)["name"] or config.get("name") or "Player")[:40]
