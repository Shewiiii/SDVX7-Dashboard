"""Full chart timelines, stored independently of the compact Neon summaries."""

import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scripts.chart_details import ChartDetails

from scripts.chart_details import parse_chart
from scripts.companion import ROOT, resolve_proxy

SCHEMA = 5  # Preserve extended laser ranges.


def prepare(details: "ChartDetails", mid: int, diff: int) -> tuple[str, Path] | None:
    path = getattr(details, "files", {}).get(f"{mid}:{diff}")
    if path is None:
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    from scripts.chart_effects import prepare_bank

    bank = prepare_bank(details.music.base_root)
    inputs = [SCHEMA, str(path), stat.st_size, stat.st_mtime_ns, mid, diff, bank]
    if "SDVX_PREVIEW_REVISION" in os.environ:
        inputs.append(os.environ["SDVX_PREVIEW_REVISION"])
    signature = json.dumps(inputs)
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


def visual_timeline(details: "ChartDetails", mid: int, diff: int) -> bytes | None:
    """Compress visual geometry independently of audio hosting and sound banks."""
    path = getattr(details, "files", {}).get(f"{mid}:{diff}")
    if path is None:
        return None
    try:
        stat = path.stat()
        signature = [1, str(path), stat.st_size, stat.st_mtime_ns, mid, diff]
        if "SDVX_PREVIEW_REVISION" in os.environ:
            signature.append(os.environ["SDVX_PREVIEW_REVISION"])
        digest = hashlib.sha256(json.dumps(signature).encode()).hexdigest()
        target = ROOT / ".local/chart-view-visual" / (digest + ".json.gz")
        if not target.exists():
            parsed = parse_chart(path, full=True)
            visual = {
                key: parsed[key]
                for key in (
                    "schema",
                    "duration",
                    "buttons",
                    "lasers",
                    "measures",
                    "tempos",
                )
            }
            visual.update(music_id=mid, diff_idx=diff)

            raw = json.dumps(visual, separators=(",", ":")).encode()
            compressed = gzip.compress(raw, mtime=0)
            if len(raw) > 8_000_000 or len(compressed) > 250_000:
                return None
            target.parent.mkdir(parents=True, exist_ok=True)

            with tempfile.NamedTemporaryFile(
                dir=target.parent, suffix=".tmp", delete=False
            ) as stream:
                temporary = Path(stream.name)
                stream.write(compressed)
            try:
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)

        return target.read_bytes()
    except (OSError, ValueError, IndexError, KeyError, OverflowError):
        return None


def preview(mid: int, diff: int, check: bool = False, effects: bool = False) -> None:
    from scripts.sync import Catalog

    catalog = Catalog(resolve_proxy())
    catalog.details.refresh()
    if check:
        path = catalog.details.files.get(f"{mid}:{diff}")
        print(json.dumps({"available": path is not None and path.is_file()}))
        return
    if effects:
        prepared = prepare(catalog.details, mid, diff)
        result = prepared[1].read_bytes() if prepared else None
    else:
        result = visual_timeline(catalog.details, mid, diff)

    print(gzip.decompress(result).decode() if result else "null")
