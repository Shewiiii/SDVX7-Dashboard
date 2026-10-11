import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync

catalog = sync.Catalog(sync.TRACKER)
catalog.refresh()
state, profile = sync.snapshot(sync.TRACKER, catalog, "Shewi")
for name, convert in (("score_log.txt", lambda p: sync.play_record(p, catalog)),
                      ("volforce_history.jsonl", lambda o: sync.observation_record(o, profile))):
    for index, line in enumerate((sync.TRACKER / name).read_text(encoding="utf-8").splitlines()):
        try:
            convert(json.loads(line))
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            print(name, "line", index + 1, type(error).__name__, str(error))
