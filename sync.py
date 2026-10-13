"""Personal, read-only tracker companion with optional cover and reading helpers."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

from playtime import playtime_snapshot

try:
    from pykakasi import kakasi

    _kana = kakasi()
except ImportError:
    _kana = None


def normalize(text):
    text = unicodedata.normalize("NFKC", text).casefold()
    text = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text)
    return "".join(
        c
        for c in unicodedata.normalize("NFKD", text)
        if c.isalnum() or c in "\u3099\u309a"
    )


def search_forms(text):
    forms = {normalize(text)}
    if _kana:
        for scheme in ("hepburn", "kunrei", "passport"):
            roman = re.sub(
                r"[\u3040-\u30ff]+",
                lambda m, scheme=scheme: "".join(
                    p[scheme] for p in _kana.convert(m[0])
                ),
                text,
            )
            roman = normalize(roman)
            forms.add(roman)
            forms.add(re.sub(r"aa|ii|uu|ee|oo|ou", lambda m: m[0][0], roman))
    return sorted(f for f in forms if f)


ROOT = Path(__file__).resolve().parent
TRACKER = ROOT.parent
TAGS = (
    ("novice",),
    ("advanced",),
    ("exhaust",),
    ("infinite", "gravity", "heaven", "vivid", "exceed", "nabla"),
    ("maximum",),
    ("ultimate",),
)
CLEARS = {1: 50, 2: 100, 3: 102, 4: 106, 5: 110, 6: 104}
GRADES = (
    (9900000, 105),
    (9800000, 102),
    (9700000, 100),
    (9500000, 97),
    (9300000, 94),
    (9000000, 91),
    (8700000, 88),
    (7500000, 85),
    (6500000, 82),
    (0, 80),
)


def stamp(value):
    date = datetime.fromisoformat(str(value))
    if date.tzinfo is None:
        date = date.replace(tzinfo=UTC)
    return (
        date.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


class Catalog:
    def __init__(self, tracker):
        game = tracker.parent
        self.paths = [
            game / "data/others/music_db.xml",
            game / "data_mods/ryunet_custom/others/music_db.merged.xml",
        ]
        self.signature = None
        self.charts = {}
        self.songs = {}
        self.game = game
        self.tracker = tracker
        self.cover_ids = {}
        self.cover_index = None
        self.cover_signature = None
        self.appeal_card = None
        self.appeal_signature = None
        self.appeal_textures = {}
        self.appeal_mapping_signature = None

    def refresh(self):
        signature = tuple(
            (p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None
            for p in self.paths
        )
        if signature == self.signature:
            return
        charts, songs = {}, {}
        for path in self.paths:
            if not path.exists():
                continue
            try:
                raw = path.read_bytes()
                match = re.search(
                    rb"encoding=[\'\"]([^\'\"]+)", raw[:200], re.IGNORECASE
                )
                encoding = match[1].decode("ascii").lower() if match else "utf-8-sig"
                if encoding in ("shift-jis", "shift_jis", "sjis", "windows-31j"):
                    encoding = "cp932"
                text = re.sub(r"<\?xml[^>]*\?>", "", raw.decode(encoding), count=1)
                for music in ET.fromstring(text).findall("music"):
                    mid = int(music.get("id", "0"))
                    title = music.findtext("info/title_name", "").strip()[:200]
                    artist = music.findtext("info/artist_name", "").strip()[:200]
                    song = songs.setdefault(
                        mid,
                        {
                            "music_id": mid,
                            "title": title,
                            "artist": artist,
                            "forms": [],
                            "difficulties": [],
                        },
                    )
                    song.update(
                        title=title,
                        artist=artist,
                        forms=[
                            search_forms(value)
                            for value in (
                                title,
                                music.findtext("info/title_yomigana", ""),
                                artist,
                                music.findtext("info/artist_yomigana", ""),
                            )
                        ],
                    )
                    for diff, tags in enumerate(TAGS):
                        element = next(
                            (
                                e
                                for tag in tags
                                if (e := music.find(f"difficulty/{tag}")) is not None
                            ),
                            None,
                        )
                        if element is None:
                            continue
                        level = float(element.findtext("difnum", "0"))
                        level = level / 10 if level > 20 else level
                        if not math.isfinite(level) or not 0 < level <= 20:
                            continue
                        charts[f"{mid}:{diff}"] = {
                            "title": title,
                            "artist": artist,
                            "level": level,
                        }
                        song["difficulties"] = [
                            d for d in song["difficulties"] if d["diff_idx"] != diff
                        ] + [{"diff_idx": diff, "level": level}]
            except (OSError, ValueError, ET.ParseError, UnicodeError) as error:
                print(
                    f"Music metadata unavailable ({type(error).__name__}); using chart IDs."
                )
        self.charts, self.songs, self.signature = charts, songs, signature

    def get(self, mid, diff):
        return self.charts.get(
            f"{mid}:{diff}", {"title": f"Chart {mid}", "artist": "", "level": None}
        )

    def prepare_appeal_card(self):
        """Read only the selected artwork, never publish the player record."""
        try:
            raw = json.loads(
                (self.tracker / "cache/total_volforce.json").read_text(encoding="utf-8")
            )
            appeal_id = (raw.get("player") or {}).get("appeal_id")
            if type(appeal_id) is not int or appeal_id < 0:
                self.appeal_card = None
                self.appeal_signature = None
                return
            mapping = self.game / "data/others/appeal_card.xml"
            stat = mapping.stat()
            mapping_signature = (stat.st_mtime_ns, stat.st_size)
            if mapping_signature != self.appeal_mapping_signature:
                text = re.sub(
                    r"<\?xml[^>]*\?>",
                    "",
                    mapping.read_text(encoding="cp932", errors="replace"),
                    count=1,
                )
                self.appeal_textures = {
                    int(card.get("id")): texture
                    for card in ET.fromstring(text).findall("card")
                    if card.get("id", "").isdecimal()
                    and re.fullmatch(
                        r"[A-Za-z0-9_]+",
                        texture := card.findtext("info/texture", "").strip(),
                    )
                }
                self.appeal_mapping_signature = mapping_signature
            texture = self.appeal_textures.get(appeal_id)
            if not texture:
                self.appeal_card = None
                self.appeal_signature = None
                return
            source = self.game / "data/graphics/ap_card" / f"{texture}.png"
            stat = source.stat()
            signature = (appeal_id, str(source), stat.st_mtime_ns, stat.st_size)
            if signature == self.appeal_signature:
                return
            cache_path = ROOT / ".local/appeal-card-cache.json"
            cached = (
                json.loads(cache_path.read_text(encoding="utf-8"))
                if cache_path.exists()
                else {}
            )
            cached_id = cached.get("id", "")
            if (
                cached.get("signature") == list(signature)
                and isinstance(cached_id, str)
                and re.fullmatch(r"[a-f0-9]{64}", cached_id)
                and (ROOT / ".local/covers" / f"{cached_id}.webp").exists()
            ):
                self.appeal_card, self.appeal_signature = cached_id, signature
                return
            from io import BytesIO

            from PIL import Image

            with Image.open(source) as image:
                image = image.convert("RGBA")
                image.thumbnail((256, 256))
                buffer = BytesIO()
                image.save(buffer, "WEBP", lossless=True, method=4)
            content = buffer.getvalue()
            image_id = hashlib.sha256(content).hexdigest()
            target = ROOT / ".local/covers" / f"{image_id}.webp"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            write_json(cache_path, {"signature": list(signature), "id": image_id})
            self.appeal_card, self.appeal_signature = image_id, signature
        except (OSError, ValueError, TypeError, ET.ParseError, ImportError):
            self.appeal_card = None
            self.appeal_signature = None

    def prepare_covers(self):
        """Prepare small web covers for songs with local plays or saved records."""
        self.prepare_appeal_card()
        music_ids = set()
        cache_path = self.tracker / "cache/total_volforce.json"
        if cache_path.exists():
            try:
                music_ids.update(
                    int(k.split(":")[0])
                    for k in json.loads(cache_path.read_text(encoding="utf-8"))[
                        "chart_volforce"
                    ]
                )
            except (ValueError, KeyError):
                pass
        log_path = self.tracker / "score_log.txt"
        if log_path.exists():
            decoder = json.JSONDecoder()
            for line in log_path.read_text(encoding="utf-8").splitlines():
                pos = 0
                while pos < len(line):
                    try:
                        record, pos = decoder.raw_decode(line, pos)
                        music_ids.add(int(record["music_id"]))
                        while pos < len(line) and line[pos].isspace():
                            pos += 1
                    except (ValueError, KeyError, TypeError):
                        break
        signature = (tuple(sorted(music_ids)), self.signature)
        if signature == self.cover_signature:
            return
        if self.cover_index is None:
            self.cover_index = {}
            for priority, root in enumerate(
                (self.game / "data_mods/ryunet_custom", self.game / "data")
            ):
                for folder_kind in ("music", "graphics"):
                    for path in (root / folder_kind).rglob("jk_*.png"):
                        if folder_kind == "graphics" and not any(
                            "jacket" in part and part.endswith("_ifs")
                            for part in path.parts
                        ):
                            continue
                        match = re.fullmatch(
                            r"jk_(\d+)_(\d+)(?:_(b|s|t))?\.png", path.name
                        )
                        if not match:
                            continue
                        key = int(match[1]), int(match[2])
                        order = (
                            priority,
                            0 if folder_kind == "music" else 1,
                            str(path.parent),
                            {None: 0, "b": 1, "s": 2, "t": 3}[match[3]],
                        )
                        self.cover_index.setdefault(key, []).append((order, path))
            for values in self.cover_index.values():
                values.sort(key=lambda p: p[0])
        map_path = ROOT / ".local/cover-map.json"
        cached = (
            json.loads(map_path.read_text(encoding="utf-8"))
            if map_path.exists()
            else {}
        )
        indices = ((1,), (2, 1), (3, 2, 1), (4, 3, 1), (5, 4, 3, 1), (5, 4, 3, 1))
        for mid in sorted(music_ids):
            for d in self.songs.get(mid, {}).get("difficulties", []):
                diff = d["diff_idx"]
                paths = [
                    path
                    for index in indices[diff]
                    for _, path in self.cover_index.get((mid, index), [])
                ]
                if not paths:
                    paths = [
                        p
                        for (song_id, _), choices in self.cover_index.items()
                        if song_id == mid
                        for _, p in choices
                    ]
                if not paths:
                    continue
                source = paths[0]
                stat = source.stat()
                source_key = str(source)
                signature_key = [stat.st_mtime_ns, stat.st_size]
                known = cached.get(source_key, {})
                target = ROOT / ".local/covers" / (known.get("id", "missing") + ".webp")
                if known.get("signature") != signature_key or not target.exists():
                    try:
                        from io import BytesIO

                        from PIL import Image

                        with Image.open(source) as image:
                            image = image.convert("RGB")
                            image.thumbnail((256, 256))
                            buffer = BytesIO()
                            image.save(buffer, "WEBP", quality=85, method=4)
                        content = buffer.getvalue()
                    except ImportError:
                        continue
                    cover_id = hashlib.sha256(content).hexdigest()
                    target = ROOT / ".local/covers" / (cover_id + ".webp")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                    known = {"id": cover_id, "signature": signature_key}
                    cached[source_key] = known
                self.cover_ids[f"{mid}:{diff}"] = known["id"]
        write_json(map_path, cached)
        self.cover_signature = signature

    def public_catalog(self):
        return [
            {
                **song,
                "difficulties": [
                    {**d, "cover": self.cover_ids.get(f"{mid}:{d['diff_idx']}")}
                    for d in sorted(song["difficulties"], key=lambda d: d["diff_idx"])
                ],
            }
            for mid, song in sorted(self.songs.items())
            if song["difficulties"]
        ]


def play_record(record, catalog):
    mid, diff, score, clear = (
        int(record[k]) for k in ("music_id", "diff_idx", "score", "clear_type")
    )
    if not (mid > 0 and 0 <= diff <= 5 and 0 <= score <= 10000000 and 0 <= clear <= 6):
        raise ValueError("Invalid play")
    metadata = catalog.get(mid, diff)
    level = record.get("level") or metadata.get("level")
    if clear == 0:
        vf = 0.0  # Failed plays do not contribute to performance.
    elif record.get("volforce_source") == "updated":
        vf = int(record["volforce"]) / 1000
    elif level and clear in CLEARS:
        grade = next(factor for threshold, factor in GRADES if score >= threshold)
        vf = (
            round(float(level) * 10)
            * score
            * grade
            * CLEARS[clear]
            * 20
            // 1000000000000
        ) / 1000
    else:
        raise ValueError("No level for legacy play; cannot use stale best-play VF")
    if not math.isfinite(vf) or not 0 <= vf <= 2:
        raise ValueError("Invalid VolForce")
    timing = None
    timing_histogram = None
    histogram = record.get("timing_histogram")
    counts = record.get("judgments") or {}
    if (
        isinstance(histogram, list)
        and len(histogram) == 7
        and all(type(v) is int and v >= 0 for v in histogram)
        and counts.get("near") == histogram[0] + histogram[6]
    ):
        try:
            h = histogram
            total = sum(h)
            raw = record.get("raw_judgments") or {}
            just, critical_total = (
                raw.get("btfx_s_critical"),
                raw.get("critical_including_s_critical"),
            )
            critical, s_critical = counts.get("critical"), counts.get("s_critical")
            if (
                record.get("s_critical_enabled") is True
                and all(
                    type(v) is int and v >= 0
                    for v in (just, critical_total, critical, s_critical)
                )
                and critical_total == s_critical + critical
                and just <= s_critical
                and critical_total >= sum(h[1:6])
            ):
                center = just + critical - sum(h[i] for i in (1, 2, 4, 5))
                if 0 <= center <= h[3]:
                    total = total - h[3] + center
                    if total > 0:
                        timing_histogram = h.copy()
                        timing_histogram[3] = center
            if total > 0:
                timing = (
                    87.5 * (h[0] - h[6]) + 37.5 * (h[1] - h[5]) + 25 * (h[2] - h[4])
                ) / total
        except (ValueError, TypeError):
            pass
    judgement_keys = (
        "s_critical",
        "critical",
        "near",
        "error",
        "early_near",
        "late_near",
    )
    judgments = {
        key: value
        for key in judgement_keys
        if type(value := counts.get(key)) is int and 0 <= value <= 10000000
    }
    return {
        "music_id": mid,
        "diff_idx": diff,
        "score": score,
        "clear_type": clear,
        "received_at": stamp(record["received_at"]),
        "play_vf": vf,
        **metadata,
        "level": float(level) if level else None,
        "timing": timing,
        "timing_histogram": timing_histogram,
        "timing_eligible": timing_histogram is not None,
        "judgments": judgments or None,
    }


def observation_record(record, profile_id):
    if profile_id and record.get("profile_id") != profile_id:
        raise ValueError("Different profile")
    total, count, minimum = (
        record["total_volforce"],
        record["top_count"],
        record.get("minimum_volforce"),
    )
    if (
        type(total) is not int
        or total < 0
        or type(count) is not int
        or not 0 <= count <= 50
    ):
        raise ValueError("Invalid observation")
    if minimum is not None and (type(minimum) is not int or minimum < 0):
        raise ValueError("Invalid threshold")
    return {
        "timestamp": stamp(record["timestamp"]),
        "total_vf": total / 1000,
        "minimum_vf": minimum / 1000 if minimum is not None else None,
        "top_count": count,
    }


def snapshot(tracker, catalog, name):
    playtime = playtime_snapshot(tracker)
    path = tracker / "cache/total_volforce.json"
    if not path.exists():
        state = {
            "name": name,
            "updated_at": None,
            "charts": [],
            "appeal_card": getattr(catalog, "appeal_card", None),
            "playtime": playtime,
            "skill_level": None,
        }
        if hasattr(catalog, "public_catalog"):
            state["catalog"] = catalog.public_catalog()
        return state, None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("source") != "sv7_load_m":
        raise ValueError("Unsupported snapshot")
    records = raw.get("chart_records") or {}
    skill_level = (raw.get("player") or {}).get("skill_level")
    if type(skill_level) is not int or not 1 <= skill_level <= 12:
        skill_level = None
    charts = []
    for key, vf in raw["chart_volforce"].items():
        mid, diff = map(int, key.split(":"))
        if type(vf) is not int or not 0 <= vf <= 2000:
            continue
        saved = records.get(key) or {}
        charts.append(
            {
                "music_id": mid,
                "diff_idx": diff,
                "vf": vf / 1000,
                **catalog.get(mid, diff),
                "score": saved.get("score"),
                "clear_type": saved.get("clear_type"),
            }
        )
    charts.sort(key=lambda c: (-c["vf"], c["music_id"], c["diff_idx"]))
    state = {
        "name": name,
        "updated_at": stamp(raw["updated_at"]),
        "charts": charts,
        "appeal_card": getattr(catalog, "appeal_card", None),
        "playtime": playtime,
        "skill_level": skill_level,
    }
    if hasattr(catalog, "public_catalog"):
        state["catalog"] = catalog.public_catalog()
    return state, raw.get("profile_id")


def signature(path):
    if not path.exists():
        return "missing"
    with path.open("rb") as stream:
        return hashlib.sha256(stream.read(128)).hexdigest()


def read_batch(path, cursor, convert, limit=150):
    if not path.exists():
        return [], cursor
    # Cursor updates are acknowledged only after a successful cloud transaction.
    identity = signature(path)
    offset = cursor.get("offset", 0) if cursor.get("signature") == identity else 0
    index = cursor.get("index", 0) if cursor.get("signature") == identity else 0
    if offset > path.stat().st_size:
        offset = 0
        index = 0
    records, skipped = [], 0
    with path.open("rb") as stream:
        stream.seek(offset)
        while len(records) < limit:
            start = stream.tell()
            line = stream.readline()
            if not line or not line.endswith(b"\n"):
                stream.seek(start)  # The proxy may still be writing this line.
                break
            # Some historical log lines have two JSON objects joined together.
            # Decode each object without modifying the source, and preserve a
            # position within a line if a batch fills before that line ends.
            text = line.decode("utf-8", errors="replace")
            position, item_index = 0, 0
            decoder = json.JSONDecoder()
            while position < len(text):
                while position < len(text) and text[position].isspace():
                    position += 1
                if position == len(text):
                    break
                try:
                    raw, position = decoder.raw_decode(text, position)
                except ValueError:
                    skipped += 1
                    break
                if item_index < index:
                    item_index += 1
                    continue
                try:
                    records.append(convert(raw))
                except (ValueError, TypeError, KeyError, OverflowError):
                    skipped += 1
                item_index += 1
                if len(records) >= limit and text[position:].strip():
                    return records, {
                        "offset": start,
                        "signature": identity,
                        "index": item_index,
                    }
            index = 0
        offset = stream.tell()
    if skipped:
        print(
            f"Skipped {skipped} incomplete or unsupported historical records in {path.name}."
        )
    return records, {"offset": offset, "signature": identity, "index": 0}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8"
    )
    temporary.replace(path)


def settings():
    path = ROOT / ".local/sync-config.json"
    config = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {
        **config,
        "url": os.getenv("SDVX_DASHBOARD_URL", config.get("url", "")),
        "token": os.getenv("SDVX_SYNC_TOKEN", config.get("token", "")),
    }


def upload(url, token, payload, bypass=None):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass
    request = urllib.request.Request(
        url.rstrip("/") + "/api/sync",
        json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
            if result.get("ok") is not True:
                raise ValueError("Upload was not acknowledged")
            if payload.get("plays") and result.get("play_schema", 0) < 4:
                raise RuntimeError(
                    "Deploy the updated dashboard API before syncing timing histograms"
                )
    except urllib.error.HTTPError as error:
        # Do not expose secrets, request headers, response contents, or connection URLs.
        raise RuntimeError(f"Upload returned HTTP {error.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("Cannot reach dashboard") from None


def sync_once(config, tracker, catalog, reset=False):
    state_path = ROOT / ".local/sync-state.json"
    saved = (
        json.loads(state_path.read_text(encoding="utf-8"))
        if state_path.exists() and not reset
        else {}
    )
    endpoint_id = hashlib.sha256(config["url"].encode()).hexdigest()
    if saved.get("endpoint") != endpoint_id:
        saved = {}
    # Replay old captures once to enrich existing plays without changing their IDs.
    if saved.get("play_schema") != 4:
        saved.pop("plays", None)
    catalog.refresh()
    if hasattr(catalog, "prepare_covers"):
        catalog.prepare_covers()
        cover_state_path = ROOT / ".local/cover-sync-state.json"
        acknowledged = (
            json.loads(cover_state_path.read_text(encoding="utf-8"))
            if cover_state_path.exists()
            else {}
        )
        if acknowledged.get("endpoint") != endpoint_id or reset:
            acknowledged = {"endpoint": endpoint_id, "ids": []}
        known_ids = set(acknowledged["ids"])
        image_ids = set(catalog.cover_ids.values())
        if catalog.appeal_card:
            image_ids.add(catalog.appeal_card)
        pending_ids = sorted(image_ids - known_ids)
        for start in range(0, len(pending_ids), 30):
            batch = pending_ids[start : start + 30]
            covers = [
                {
                    "id": cover_id,
                    "type": "image/webp",
                    "data": base64.b64encode(
                        (ROOT / ".local/covers" / (cover_id + ".webp")).read_bytes()
                    ).decode("ascii"),
                }
                for cover_id in batch
            ]
            upload(
                config["url"],
                config["token"],
                {"plays": [], "observations": [], "covers": covers},
                config.get("bypass"),
            )
            known_ids.update(batch)
            acknowledged["ids"] = sorted(known_ids)
            write_json(cover_state_path, acknowledged)
        if pending_ids:
            print(f"Synced {len(pending_ids)} artwork images.")
    current, profile = snapshot(tracker, catalog, config.get("name", "Shewi"))
    current_hash = hashlib.sha256(
        json.dumps(current, sort_keys=True).encode()
    ).hexdigest()
    uploaded = 0
    while True:
        plays, pc = read_batch(
            tracker / "score_log.txt",
            saved.get("plays", {}),
            lambda p: play_record(p, catalog),
        )
        observations, oc = read_batch(
            tracker / "volforce_history.jsonl",
            saved.get("observations", {}),
            lambda o: observation_record(o, profile),
        )
        changed = saved.get("snapshot") != current_hash
        if plays or observations or changed:
            payload = {"plays": plays, "observations": observations}
            if changed:
                payload["state"] = current
            upload(config["url"], config["token"], payload, config.get("bypass"))
            uploaded += len(plays) + len(observations)
        saved.update(
            endpoint=endpoint_id,
            plays=pc,
            observations=oc,
            snapshot=current_hash,
            play_schema=4,
        )
        write_json(state_path, saved)
        if len(plays) < 150 and len(observations) < 150:
            break
    if uploaded:
        print(f"Synced {uploaded} records at {datetime.now().strftime('%H:%M:%S')}.")


def export(tracker, catalog, name):
    catalog.refresh()
    catalog.prepare_covers()
    state, profile = snapshot(tracker, catalog, name)

    def all_records(path, convert):
        records, cursor = [], {}
        while True:
            batch, cursor = read_batch(path, cursor, convert, limit=10000)
            records.extend(batch)
            if len(batch) < 10000:
                return records

    plays = all_records(tracker / "score_log.txt", lambda p: play_record(p, catalog))
    observations = all_records(
        tracker / "volforce_history.jsonl", lambda o: observation_record(o, profile)
    )
    # Mirror the server's identity keys so local and cloud previews agree even
    # when the original proxy log includes retries of the same capture.
    plays = list(
        {
            (
                p["received_at"],
                p["music_id"],
                p["diff_idx"],
                p["score"],
                p["clear_type"],
            ): p
            for p in plays
        }.values()
    )
    observations = list(
        {
            (o["timestamp"], o["total_vf"], o["minimum_vf"], o["top_count"]): o
            for o in observations
        }.values()
    )
    output = ROOT / ".local/preview-data.json"
    write_json(
        output,
        {
            "plays": plays,
            "observations": observations,
            "state": state,
            "synced_at": datetime.now(UTC).isoformat(),
            "source": "local",
        },
    )
    print(
        f"Local preview ready: {len(plays)} plays, {len(observations)} observations, {len(state['charts'])} charts."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument(
        "--export",
        action="store_true",
        help="Prepare local preview data; no cloud upload",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Re-import history; duplicate records are ignored",
    )
    parser.add_argument("--tracker", type=Path, default=TRACKER)
    parser.add_argument("--interval", type=int, default=30)
    args = parser.parse_args()
    config = settings()
    catalog = Catalog(args.tracker)
    if args.export:
        export(args.tracker, catalog, config.get("name", "Shewi"))
        return
    if (
        not config.get("url", "").startswith("https://")
        or len(config.get("token", "")) < 32
    ):
        parser.exit(1, "Run configure.py first to connect the dashboard.\n")
    lock_path = ROOT / ".local/sync.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = lock_path.open("a+b")
    lock.seek(0)
    if lock_path.stat().st_size == 0:
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        parser.exit(1, "A personal sync process is already running.\n")
    print("Personal SDVX sync running. Tracker files are read only.")
    delay = max(5, args.interval)
    while True:
        try:
            sync_once(config, args.tracker, catalog, reset=args.reset)
            args.reset = False
            delay = max(5, args.interval)
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            print(
                f"Sync pending ({type(error).__name__}). Will retry; local history is safe."
            )
            if args.once:
                raise SystemExit(1) from None
            delay = min(300, delay * 2)
        if args.once:
            return
        time.sleep(delay)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Sync stopped.")
