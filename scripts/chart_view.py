"""Full chart timelines, stored independently of the compact Neon summaries."""

import gzip
import hashlib
import json
import tempfile
from pathlib import Path

from scripts.chart_details import parse_chart
from scripts.companion import ROOT, resolve_tracker

SCHEMA = 4  # Full audio effect schedules and shared samples, including legacy timing.


def prepare(details, mid, diff):
    path = getattr(details, "files", {}).get(f"{mid}:{diff}")
    if path is None:
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    from scripts.chart_effects import prepare_bank

    bank = prepare_bank(details.music.base_root)
    signature = json.dumps(
        [SCHEMA, str(path), stat.st_size, stat.st_mtime_ns, mid, diff, bank]
    )
    digest = hashlib.sha256(signature.encode()).hexdigest()
    target = ROOT / ".local/chart-view" / (digest + ".json.gz")
    if not target.exists():
        try:
            record = {**parse_chart(path, full=True), "music_id": mid, "diff_idx": diff}
            if bank:
                record["effects"]["sample_bank"] = bank
        except (OSError, ValueError, IndexError, KeyError, OverflowError):
            return None
        raw = json.dumps(record, separators=(",", ":")).encode()
        target.parent.mkdir(parents=True, exist_ok=True)
        # Preview and the background uploader can request the same chart together.
        with tempfile.NamedTemporaryFile(
            dir=target.parent, suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(gzip.compress(raw, mtime=0))
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return digest, target


def preview(mid, diff):
    from scripts.sync import Catalog

    catalog = Catalog(resolve_tracker())
    catalog.details.refresh()
    result = prepare(catalog.details, mid, diff)
    print(gzip.decompress(result[1].read_bytes()).decode() if result else "null")
