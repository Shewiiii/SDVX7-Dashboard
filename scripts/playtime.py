import json
from pathlib import Path

from scripts.companion import proxy_module, resolve_proxy, shared_settings


def playtime_snapshot(proxy: Path) -> dict[str, int] | None:
    try:
        helpers = proxy_module(proxy, "playtime")
        config = shared_settings(proxy)
        initial = config["initial_playtime"]
        path = proxy / "player-data/playtime.json"
        if not path.exists() and not helpers.parse_playtime(initial):
            return None
        return helpers.load_playtime_summary(
            path,
            initial,
            config["baseline_seconds"],
            config["baseline_plays"],
        )
    except (ImportError, OSError, ValueError, TypeError):
        return None


if __name__ == "__main__":
    print(json.dumps(playtime_snapshot(resolve_proxy())))
