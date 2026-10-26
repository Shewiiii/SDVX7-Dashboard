from pathlib import Path

DASHBOARD = Path(__file__).resolve().parent.parent
GAME_ROOT = DASHBOARD.parent
LOCAL_DATA = DASHBOARD / ".local/unlocks"
PUBLIC_CATALOG = DASHBOARD / "public/game-data/unlocks.jsonl"
UNLOCK_OVERRIDES = PUBLIC_CATALOG.with_name("unlock_overrides.json")
