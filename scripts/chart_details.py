from __future__ import annotations

import bisect
import hashlib
import json
import logging
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

BINS = 64
SCHEMA = 2
logger = logging.getLogger(__name__)


def read_xml(path):
    raw = path.read_bytes()
    match = re.search(rb'encoding=[\'"]([^\'"]+)', raw[:200], re.IGNORECASE)
    encoding = match[1].decode() if match else "utf-8-sig"
    if encoding.lower() in ("shift-jis", "shift_jis", "sjis"):
        encoding = "cp932"
    return ET.fromstring(re.sub(r"<\?xml[^>]*\?>", "", raw.decode(encoding), count=1))


def number(node, tag, divisor=1):
    try:
        value = float(node.findtext(tag, "")) / divisor
        return value if math.isfinite(value) and value >= 0 else None
    except (ValueError, TypeError):
        return None


def parse_chart(path):
    sections, section = {}, None
    for raw in path.read_text(encoding="cp932", errors="replace").splitlines():
        line = raw.split("//", 1)[0].strip()
        if line.startswith("#"):
            section = None if line == "#END" else line[1:]
            if section:
                sections.setdefault(section, [])
        elif section and line:
            sections[section].append(line.split())
    if not sections.get("BPM INFO") or not sections.get("END POSITION"):
        raise ValueError("Missing chart timing")
    positions = re.compile(r"^(\d+),(\d+),(\d+)$")
    beat_info = {}
    for row in sections.get("BEAT INFO", []):
        if positions.match(row[0]) and len(row) >= 3:
            measure = int(row[0].split(",")[0])
            top, bottom = int(row[1]), int(row[2])
            if 0 < top <= 64 and 0 < bottom <= 64:
                beat_info[measure] = top * 4 / bottom
    last_measure = max(
        int(row[0].split(",")[0])
        for rows in sections.values()
        for row in rows
        if positions.match(row[0])
    )
    if not 1 <= last_measure <= 10000:
        raise ValueError("Invalid chart length")
    bar_beats, cursor, beats = {}, 0, 4
    for measure in range(1, last_measure + 2):
        bar_beats[measure] = cursor
        beats = beat_info.get(measure, beats)
        cursor += beats

    def beat(position):
        measure, pulse, tick = map(int, position.split(","))
        return bar_beats[measure] + pulse - 1 + tick / 48

    tempos = sorted(
        {beat(row[0]): float(row[1]) for row in sections["BPM INFO"]}.items()
    )
    if any(not math.isfinite(bpm) or not 0 < bpm <= 100000 for _, bpm in tempos):
        raise ValueError("Invalid tempo")
    if tempos[0][0] > 0:
        tempos.insert(0, (0, tempos[0][1]))
    tempo_beats = [entry[0] for entry in tempos]
    elapsed = [0.0]
    for i in range(1, len(tempos)):
        elapsed.append(
            elapsed[-1] + (tempos[i][0] - tempos[i - 1][0]) * 60 / tempos[i - 1][1]
        )

    def seconds(value):
        i = max(0, bisect.bisect_right(tempo_beats, value) - 1)
        return elapsed[i] + (value - tempo_beats[i]) * 60 / tempos[i][1]

    duration = seconds(beat(sections["END POSITION"][0][0]))
    if not 0 < duration <= 7200:
        raise ValueError("Invalid chart duration")
    lanes = [[0] * BINS for _ in range(8)]
    density = [0] * BINS
    laser_density = [0] * BINS
    counts = {
        "bt_taps": 0,
        "bt_holds": 0,
        "fx_taps": 0,
        "fx_holds": 0,
        "laser_sections": 0,
    }

    def bin_at(time):
        return max(0, min(BINS - 1, int(time / duration * BINS)))

    for lane in range(8):
        active, previous_time = False, None
        for row in sections.get(f"TRACK{lane + 1}", []):
            if len(row) < 3 or not positions.match(row[0]):
                continue
            time = seconds(beat(row[0]))
            index = bin_at(time)
            if lane in (0, 7):
                flag = int(row[2])
                if not active or flag == 1:
                    counts["laser_sections"] += 1
                    laser_density[index] += 1
                    active = True
                elif previous_time is not None:
                    for j in range(bin_at(previous_time), index + 1):
                        lanes[lane][j] = 1
                lanes[lane][index] = 1
                previous_time = time
                if flag == 2:
                    active = False
            else:
                hold_ticks = max(0, int(row[1]))
                kind = "fx" if lane in (1, 6) else "bt"
                counts[f"{kind}_{'holds' if hold_ticks else 'taps'}"] += 1
                density[index] += 1
                end = seconds(beat(row[0]) + hold_ticks / 48)
                for j in range(index, bin_at(end) + 1):
                    lanes[lane][j] += 1
    changes = [[round(seconds(position), 3), bpm] for position, bpm in tempos]
    # Bound even pathological custom charts; retain first and last tempo points.
    if len(changes) > 128:
        changes = [changes[round(i * (len(changes) - 1) / 127)] for i in range(128)]
    return {
        "duration": round(duration, 3),
        "counts": counts,
        "density": density,
        "laser_density": laser_density,
        "lanes": lanes,
        "bpm_changes": changes,
        "bpm_change_count": max(0, len(tempos) - 1),
    }


class ChartDetails:
    def __init__(self, music, cache_path):
        self.music, self.cache_path = music, Path(cache_path)
        self.metadata, self.files, self.signatures = {}, {}, None
        try:
            self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.cache = {}

    def refresh(self):
        signatures = [
            (str(p), p.stat().st_mtime_ns, p.stat().st_size)
            for p in self.music.paths
            if p.is_file()
        ]
        if signatures == self.signatures:
            return
        metadata = {}
        tags = [
            ("novice",),
            ("advanced",),
            ("exhaust",),
            ("infinite", "gravity", "heaven", "vivid", "exceed", "nabla"),
            ("maximum",),
            ("ultimate",),
        ]
        for path in self.music.paths:
            if not path.is_file():
                continue
            try:
                root = read_xml(path)
            except (OSError, UnicodeError, LookupError, ET.ParseError):
                logger.warning("Cannot load chart metadata from %s", path)
                continue
            for song in root.findall("music"):
                mid = int(song.get("id", "0"))
                info = song.find("info")
                if not mid or info is None:
                    continue
                date = info.findtext("distribution_date", "")
                base = {
                    "music_id": mid,
                    "title": info.findtext("title_name", "")[:200],
                    "artist": info.findtext("artist_name", "")[:200],
                    "bpm_min": number(info, "bpm_min", 100),
                    "bpm_max": number(info, "bpm_max", 100),
                    "version": number(info, "version"),
                    "genre": number(info, "genre"),
                    "is_custom": path.is_relative_to(self.music.custom_root),
                    "distribution_date": f"{date[:4]}-{date[4:6]}-{date[6:]}"
                    if re.fullmatch(r"\d{8}", date)
                    else None,
                }
                for diff, choices in enumerate(tags):
                    node = next(
                        (
                            song.find(f"difficulty/{tag}")
                            for tag in choices
                            if song.find(f"difficulty/{tag}") is not None
                        ),
                        None,
                    )
                    if node is None or not (number(node, "difnum") or 0) > 0:
                        continue
                    metadata[f"{mid}:{diff}"] = {
                        **base,
                        "diff_idx": diff,
                        "level": number(node, "difnum", 10),
                        "effector": node.findtext("effected_by", "")[:200],
                        "illustrator": node.findtext("illustrator", "")[:200],
                        "max_exscore": number(node, "max_exscore"),
                    }
        files = {}
        for root in (self.music.base_root, self.music.custom_root):
            for folder in (root / "music").glob("*"):
                match = re.match(r"^(\d+)(?:_|$)", folder.name)
                if not match or not folder.is_dir():
                    continue
                for path in folder.glob("*.vox"):
                    chart = re.search(
                        r"_([1-6])([a-z])\.vox$", path.name, re.IGNORECASE
                    )
                    if chart:
                        diff = 4 if chart[2].lower() == "m" else int(chart[1]) - 1
                        files[f"{int(match[1])}:{diff}"] = path
                        key = f"{int(match[1])}:{diff}"
                        if root == self.music.custom_root and key in metadata:
                            metadata[key]["is_custom"] = True
        self.metadata, self.files, self.signatures = metadata, files, signatures

    def get(self, key):
        self.refresh()
        if key not in self.metadata:
            return None
        path = self.files.get(key)
        stat = None
        if path:
            try:
                stat = path.stat()
            except OSError:
                path = None
        signature = [
            SCHEMA,
            self.metadata[key],
            str(path),
            (stat.st_mtime_ns, stat.st_size) if stat else None,
        ]
        digest = hashlib.sha256(
            json.dumps(signature, sort_keys=True).encode()
        ).hexdigest()
        cached = self.cache.get(key, {})
        if cached.get("hash") != digest:
            chart = None
            if path:
                try:
                    chart = parse_chart(path)
                except (OSError, ValueError, IndexError, KeyError, OverflowError):
                    pass
            cached = {"hash": digest, "record": {**self.metadata[key], "chart": chart}}
            self.cache[key] = cached
        return cached

    def save(self):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(self.cache, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(self.cache_path)


def preview(mid, diff):
    from scripts.companion import resolve_tracker
    from scripts.sync import Catalog

    catalog = Catalog(resolve_tracker())
    catalog.music.refresh()
    details = ChartDetails(
        catalog.music, Path(__file__).parent.parent / ".local/chart-details-cache.json"
    )
    record = details.get(f"{mid}:{diff}")
    print(json.dumps(record["record"] if record else None, ensure_ascii=True))


def search_preview():
    """Project cached chart summaries into search metadata; omit graph arrays."""
    from scripts.companion import resolve_tracker
    from scripts.sync import Catalog

    catalog = Catalog(resolve_tracker())
    catalog.details.refresh()
    records = []
    for key in catalog.details.metadata:
        record = catalog.details.get(key)["record"]
        chart = record.get("chart") or {}
        records.append(
            {
                **{k: v for k, v in record.items() if k != "chart"},
                "length": chart.get("duration"),
                "counts": chart.get("counts"),
                "tempo_changes": chart.get("bpm_change_count"),
            }
        )
    print(json.dumps(records, ensure_ascii=True, separators=(",", ":")))
