"""Keep local request metadata warm without blocking archive exports."""

from __future__ import annotations

import gzip
import json
import sys
import time
from contextlib import redirect_stdout
from typing import Any

from scripts.chart_details import ChartDetails, search_records
from scripts.chart_view import prepare, visual_timeline
from scripts.companion import ROOT, resolve_proxy
from scripts.music import MusicCatalog


class PreviewRequests:
    def __init__(self) -> None:
        music = MusicCatalog(resolve_proxy().parent / "data/others/music_db.xml")
        self.details = ChartDetails(music, ROOT / ".local/chart-details-cache.json")
        self.audio: Any = None
        self.scanned_at = 0.0

    def request(self, command: dict[str, Any]) -> Any:
        # Rescan new chart files periodically, existing files are checked per lookup.
        if time.monotonic() - self.scanned_at > 60:
            self.details.signatures = None
            self.scanned_at = time.monotonic()
        before = self.details.signatures
        self.details.refresh()
        if self.audio is not None and before != self.details.signatures:
            self.audio = None
        operation = command["operation"]
        if operation == "search":
            return search_records(self.details)
        mid, diff = int(command["music"]), int(command["diff"])
        if operation == "chart":
            key = f"{mid}:{diff}"
            # Recompute the small summary so parser edits need no schema bump.
            self.details.cache.pop(key, None)
            record = self.details.get(key)
            return record["record"] if record else None
        if operation == "chart-view":
            if command.get("check"):
                path = self.details.files.get(f"{mid}:{diff}")
                return {"available": path is not None and path.is_file()}
            if command.get("effects"):
                prepared = prepare(self.details, mid, diff)
                result = prepared[1].read_bytes() if prepared else None
            else:
                result = visual_timeline(self.details, mid, diff)
            return json.loads(gzip.decompress(result)) if result else None
        if operation == "audio":
            from scripts.audio import AudioLibrary

            if self.audio is None:
                self.audio = AudioLibrary(self.details)
            record = self.audio.get(mid, diff)
            if record:
                record["url"] = (
                    f"/api/audio-file?id={record['id']}&format={record['format']}"
                )
                if record["variant"] == "full":
                    record["chart_url"] = (
                        f"/api/chart-view?music={mid}&diff={diff}&effects=1"
                    )
            return record
        raise ValueError("Unknown preview operation")


def main() -> None:
    requests = None
    for line in sys.stdin:
        try:
            with redirect_stdout(sys.stderr):
                if requests is None:
                    requests = PreviewRequests()
                result = requests.request(json.loads(line))
            response = {"ok": True, "result": result}
        except Exception as error:  # noqa: BLE001
            print(f"Preview request failed: {error}", file=sys.stderr, flush=True)
            response = {"ok": False, "error": str(error)}
            requests = None
        print(
            json.dumps(response, ensure_ascii=True, separators=(",", ":")), flush=True
        )


if __name__ == "__main__":
    main()
