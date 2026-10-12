"""Read aggregate tracker playtime for the local dashboard preview."""

import json
import os
import sys
from pathlib import Path

TRACKER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TRACKER))


def playtime_snapshot(tracker):
    try:
        from dotenv import dotenv_values
        from tracker.playtime import load_playtime_summary, parse_playtime

        # Export only the summary below, never the settings or the log cursor.
        config = dotenv_values(tracker / ".env", interpolate=False)

        def setting(key, default):
            return os.getenv(key, config.get(key) or default)

        initial = setting("TRACKER_INITIAL_PLAYTIME", "0")
        path = tracker / "cache/playtime.json"
        if not path.exists() and not parse_playtime(initial):
            return None
        return load_playtime_summary(
            path,
            initial,
            int(setting("TRACKER_PLAYTIME_BASELINE_SECONDS", "0")),
            int(setting("TRACKER_PLAYTIME_BASELINE_PLAYS", "0")),
        )
    except (ImportError, OSError, ValueError, TypeError):
        return None


if __name__ == "__main__":
    print(json.dumps(playtime_snapshot(TRACKER)))
