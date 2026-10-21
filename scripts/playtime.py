import json
from pathlib import Path

from scripts.companion import resolve_tracker, shared_settings, tracker_module


def playtime_snapshot(tracker: Path) -> dict[str, int] | None:
    try:
        helpers = tracker_module(tracker, "playtime")
        config = shared_settings(tracker)
        initial = config["initial_playtime"]
        path = tracker / "cache/playtime.json"
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
    print(json.dumps(playtime_snapshot(resolve_tracker())))
