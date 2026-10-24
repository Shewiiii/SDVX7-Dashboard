from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

from scripts.layout import proxy_root, validate_proxy

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / ".local/sync-config.json"


def with_https(value: str) -> str:
    """Accept pasted hostnames while preserving an explicitly supplied scheme."""
    value = value.strip()
    if value.startswith("//"):
        return "https:" + value
    return "https://" + value if value and "://" not in value else value


def load_config(path: Path | None = None) -> dict[str, Any]:
    path = path or CONFIG_PATH
    if not path.exists():
        return {}
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict):
        raise TypeError("Dashboard settings must be a JSON object.")
    for key in ("url", "token", "bypass", "name", "currency"):
        if key in config and not isinstance(config[key], str):
            raise TypeError(f"Dashboard setting '{key}' must be text.")
    return config


def save_config(config: dict[str, Any], path: Path | None = None) -> None:
    path = path or CONFIG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, indent=2), encoding="utf-8")
    temporary.replace(path)


def normalize_currency(value: str) -> str:
    value = value.strip().upper()
    if not (value.isascii() and value.isalpha() and len(value) == 3):
        raise ValueError("Enter a three-letter currency code.")
    return value


def dashboard_settings(config: dict[str, Any] | None = None) -> dict[str, str]:
    if config is None:
        config = load_config()
    name = (config.get("name") or "Player").strip() or "Player"
    try:
        currency = normalize_currency(config.get("currency") or "USD")
    except ValueError:
        currency = "USD"
    return {"name": name[:40], "currency": currency}


def resolve_proxy() -> Path:
    proxy = proxy_root(ROOT)
    validate_proxy(proxy)
    return proxy


def proxy_python(proxy: Path) -> Path:
    executable = (
        proxy / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    if not executable.is_file():
        raise ValueError(
            "Proxy Python environment missing. Run the proxy's setup.bat first."
        )
    return executable


def proxy_module(proxy: Path, name: str) -> ModuleType:
    # Import shared helpers without starting another proxy.
    location = str(proxy)
    if location not in sys.path:
        sys.path.insert(0, location)
    return importlib.import_module(f"proxy.{name}")


def shared_settings(proxy: Path) -> dict[str, Any]:
    from dotenv import dotenv_values

    values = dotenv_values(proxy / ".env", interpolate=False)

    def setting(key: str, default: str = "") -> str:
        return os.getenv(key) or values.get(key) or default

    return {
        "initial_playtime": setting("INITIAL_PLAYTIME", "0"),
        "baseline_seconds": int(setting("PLAYTIME_BASELINE_SECONDS", "0")),
        "baseline_plays": int(setting("PLAYTIME_BASELINE_PLAYS", "0")),
    }


def display_name(config: dict[str, Any] | None = None) -> str:
    return dashboard_settings(config)["name"]
