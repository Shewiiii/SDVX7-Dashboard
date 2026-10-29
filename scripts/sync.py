from __future__ import annotations

import base64
import errno
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from threading import Event
from typing import Any

from scripts.appeal_cards import prepare_appeal_cards
from scripts.chart_details import ChartDetails
from scripts.companion import (
    ROOT,
    dashboard_settings,
    load_config,
    resolve_proxy,
)
from scripts.music import MusicCatalog
from scripts.playtime import playtime_snapshot
from scripts.profile_radar import calculate_profile_radar

try:
    from pykakasi import kakasi

    _kana = kakasi()
except ImportError:
    _kana = None


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text)
    return "".join(
        c
        for c in unicodedata.normalize("NFKD", text)
        if c.isalnum() or c in "\u3099\u309a"
    )


def search_forms(text: str, *, reading: bool = False) -> list[str]:
    text = unicodedata.normalize("NFKC", text)
    normalized = normalize(text)
    # Placeholder pronunciation hints must not become searchable aliases.
    if reading and normalized in {normalize("ダミー"), "dummy"}:
        return []
    forms = {normalized}
    if _kana:
        parts = _kana.convert(text)
        forms.add(normalize("".join(part["hira"] for part in parts)))
        for scheme in ("hepburn", "kunrei", "passport"):
            roman = normalize("".join(part[scheme] for part in parts))
            forms.add(roman)
            forms.add(re.sub(r"aa|ii|uu|ee|oo|ou", lambda m: m[0][0], roman))
    return sorted(f for f in forms if f)


PLAY_SCHEMA = 5
DETAILS_SCHEMA = 8
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


def stamp(value: str | datetime) -> str:
    date = datetime.fromisoformat(str(value))
    if date.tzinfo is None:
        date = date.replace(tzinfo=UTC)
    return (
        date.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


class Catalog:
    def __init__(self, proxy: Path) -> None:
        game = proxy.parent
        self.music = MusicCatalog(game / "data/others/music_db.xml")
        self.details = ChartDetails(
            self.music, ROOT / ".local/chart-details-cache.json"
        )
        self.paths = self.music.paths
        self.signature = None
        self.charts = {}
        self.songs = {}
        self.game = game
        self.proxy = proxy
        self.cover_ids = {}
        self.cover_index = None
        self.cover_signature = None
        self.appeal_card = None
        self.appeal_cards: list[dict[str, Any]] = []
        self.appeal_signature = None
        self.appeal_textures = {}
        self.appeal_mapping_signature = None

    def refresh(self) -> None:
        self.music.refresh()
        signature = tuple(
            id(mapping)
            for mapping in (
                self.music.titles,
                self.music.artists,
                self.music.levels,
                self.music.title_readings,
                self.music.artist_readings,
                self.music.title_ascii,
                self.music.radars,
            )
        )
        if signature == self.signature:
            return
        charts, songs = {}, {}
        self.details.refresh()
        for mid, levels in self.music.levels.items():
            metadata = [
                self.details.metadata.get(f"{mid}:{diff}", {}) for diff in levels
            ]
            info = next((item for item in metadata if item), {})
            date = info.get("distribution_date") or ""
            title = self.music.titles.get(mid, f"Chart {mid}")[:200]
            artist = self.music.artists.get(mid, "")[:200]
            difficulties = [
                {
                    "diff_idx": diff,
                    "level": level,
                    "radar": self.music.radars.get(mid, {}).get(diff),
                }
                for diff, level in sorted(levels.items())
                if math.isfinite(level) and level > 0
            ]
            songs[mid] = {
                "music_id": mid,
                "title": title,
                "title_ascii": self.music.title_ascii.get(mid, "")[:200],
                "artist": artist,
                "genre": info.get("genre"),
                "is_custom": any(item.get("is_custom", False) for item in metadata),
                "release_year": int(date[:4]) if date[:4].isdigit() else None,
                "release_date": date or None,
                "forms": [
                    search_forms(title),
                    search_forms(self.music.title_readings.get(mid, ""), reading=True),
                    search_forms(artist),
                    search_forms(self.music.artist_readings.get(mid, ""), reading=True),
                ],
                "difficulties": difficulties,
            }
            for difficulty in difficulties:
                charts[f"{mid}:{difficulty['diff_idx']}"] = {
                    "title": title,
                    "artist": artist,
                    "level": difficulty["level"],
                }
        self.charts, self.songs, self.signature = charts, songs, signature

    def get(self, mid: int, diff: int) -> dict[str, Any]:
        return self.charts.get(
            f"{mid}:{diff}", {"title": f"Chart {mid}", "artist": "", "level": None}
        )

    def prepare_appeal_card(self) -> None:
        """Read only the selected artwork, never publish the player record."""
        try:
            raw = json.loads(
                (self.proxy / "player-data/server_data.json").read_text(
                    encoding="utf-8"
                )
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

    def prepare_covers(self) -> None:
        """Prepare cached web covers for every song in the library."""
        self.prepare_appeal_card()
        self.appeal_cards = prepare_appeal_cards(self.game, ROOT / ".local")
        music_ids = set(self.songs)
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

    def public_catalog(self) -> list[dict[str, Any]]:
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


def play_record(record: dict[str, Any], catalog: Catalog) -> dict[str, Any]:
    mid, diff, score, clear = (
        int(record[k]) for k in ("music_id", "diff_idx", "score", "clear_type")
    )
    if not (mid > 0 and 0 <= diff <= 5 and 0 <= score <= 10000000 and 0 <= clear <= 6):
        raise ValueError("Invalid play")
    metadata = catalog.get(mid, diff)
    # Prefer decoded XML metadata over levels captured by the old scaling heuristic.
    level = metadata.get("level") or record.get("level")
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
        raise ValueError("No level for legacy play. Cannot use stale best-play VF")
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


def observation_record(
    record: dict[str, Any], profile_id: str | None
) -> dict[str, Any]:
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


def snapshot(proxy: Path, catalog: Catalog) -> tuple[dict[str, Any], str | None]:
    preferences = dashboard_settings()
    playtime = playtime_snapshot(proxy)
    path = proxy / "player-data/server_data.json"
    if not path.exists():
        state = {
            "name": preferences["name"],
            "currency": preferences["currency"],
            "updated_at": None,
            "charts": [],
            "appeal_card": getattr(catalog, "appeal_card", None),
            "appeal_cards": getattr(catalog, "appeal_cards", []),
            "playtime": playtime,
            "skill_level": None,
            "crew_id": None,
            "profile_radar": None,
        }
        if hasattr(catalog, "public_catalog"):
            state["catalog"] = catalog.public_catalog()
        return state, None
    raw = json.loads(path.read_text(encoding="utf-8"))
    crew_id = next(
        (
            entry["param"][24]
            for entry in raw.get("profile_parameters", [])
            if entry.get("type") == 2
            and entry.get("id") == 1
            and len(entry.get("param", [])) > 24
            and type(entry["param"][24]) is int
        ),
        None,
    )
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
        "name": preferences["name"],
        "currency": preferences["currency"],
        "updated_at": stamp(raw["updated_at"]),
        "charts": charts,
        "appeal_card": getattr(catalog, "appeal_card", None),
        "appeal_cards": getattr(catalog, "appeal_cards", []),
        "playtime": playtime,
        "skill_level": skill_level,
        "crew_id": crew_id,
        "profile_radar": calculate_profile_radar(
            records,
            getattr(getattr(catalog, "music", None), "radars", {}),
            getattr(getattr(catalog, "music", None), "levels", {}),
            getattr(getattr(catalog, "details", None), "metadata", {}),
        ),
    }
    if hasattr(catalog, "public_catalog"):
        state["catalog"] = catalog.public_catalog()
    return state, raw.get("profile_id")


def signature(path: Path) -> str:
    if not path.exists():
        return "missing"
    with path.open("rb") as stream:
        return hashlib.sha256(stream.read(128)).hexdigest()


def read_batch(
    path: Path,
    cursor: dict[str, Any],
    convert: Callable[[dict[str, Any]], dict[str, Any]],
    limit: int = 150,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
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


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8"
    )
    temporary.replace(path)


def read_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        saved = json.loads(path.read_text(encoding="utf-8-sig"))
        if isinstance(saved, dict):
            return saved
    except (ValueError, UnicodeError):
        pass
    # Checkpoints are disposable: replaying uses the same cloud record IDs.
    print(f"Invalid {path.name}. Rebuilding sync checkpoint from local history.")
    return {}


def settings() -> dict[str, Any]:
    try:
        config = load_config()
    except (OSError, ValueError, TypeError) as error:
        raise SystemExit(
            f"Cannot load dashboard connection settings: {error}"
        ) from None
    return {
        **config,
        "url": os.getenv("SDVX_DASHBOARD_URL", config.get("url", "")),
        "token": os.getenv("SDVX_SYNC_TOKEN", config.get("token", "")),
    }


class DatabaseQuotaError(RuntimeError):
    pass


def http_failure(error: urllib.error.HTTPError, operation: str) -> RuntimeError:
    # Inspect only a known diagnostic code, never echo raw server responses.
    try:
        failure = json.loads(error.read(8192))
        if (
            isinstance(failure, dict)
            and failure.get("code") == "DATABASE_QUOTA_EXCEEDED"
        ):
            return DatabaseQuotaError(
                "Neon database quota exceeded. Check the project's Usage page. local records are preserved"
            )
    except (ValueError, OSError):
        pass
    return RuntimeError(f"{operation} returned HTTP {error.code}")


def upload(
    url: str, token: str, payload: dict[str, Any], bypass: str | None = None
) -> None:
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
            if payload.get("audio") and result.get("audio_schema", 0) < (
                2 if any(a.get("chart_url") for a in payload["audio"]) else 1
            ):
                raise RuntimeError(
                    "Deploy the updated dashboard API before syncing audio"
                )
            if payload.get("details"):
                required_schema = 4
                if any("timeline" in d for d in payload["details"]):
                    required_schema = 5
                if any(
                    "max_chain" in (d.get("chart") or {})
                    or "max_chain_estimated" in (d.get("chart") or {})
                    for d in payload["details"]
                ):
                    required_schema = 6
                if any(
                    "visual_gimmicks" in (d.get("chart") or {})
                    for d in payload["details"]
                ):
                    required_schema = 7
                if any(
                    "visual_gimmicks_version" in (d.get("chart") or {})
                    for d in payload["details"]
                ):
                    required_schema = DETAILS_SCHEMA
                if result.get("details_schema", 0) < required_schema:
                    raise RuntimeError(
                        "Deploy the updated dashboard API before syncing chart details"
                    )
            if (
                payload.get("state", {}).get("catalog")
                and result.get("catalog_schema") != 3
            ):
                raise RuntimeError(
                    "Deploy the updated dashboard API before syncing radar metadata"
                )
            if (
                "profile_radar" in (payload.get("state") or {})
                and result.get("profile_radar_schema", 0) < 1
            ):
                raise RuntimeError(
                    "Deploy the updated dashboard API before syncing the profile radar"
                )
    except urllib.error.HTTPError as error:
        # Do not expose secrets, request headers, response contents, or connection URLs.
        raise http_failure(error, "Upload") from None
    except urllib.error.URLError:
        raise RuntimeError("Cannot reach dashboard") from None


def refresh_request(config: dict[str, Any]) -> int | None:
    headers = {"Authorization": f"Bearer {config['token']}"}
    if config.get("bypass"):
        headers["x-vercel-protection-bypass"] = config["bypass"]
    request = urllib.request.Request(
        config["url"].rstrip("/") + "/api/sync", headers=headers, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 405:
            return None
        raise http_failure(error, "Sync check") from None
    except urllib.error.URLError:
        raise RuntimeError("Cannot reach dashboard") from None
    requested, completed = result.get("requested_id"), result.get("completed_id")
    if (
        result.get("ok") is not True
        or type(requested) is not int
        or type(completed) is not int
        or not 0 <= completed <= requested <= 2**53 - 1
    ):
        raise ValueError("Invalid dashboard sync status")
    database_id = result.get("database_id")
    if database_id is not None:
        if not isinstance(database_id, str):
            raise TypeError("Dashboard database identity must be text")
        if not re.fullmatch(r"[a-f0-9]{32}", database_id):
            raise ValueError("Invalid dashboard database identity")
        config["database_id"] = database_id
    return requested if requested > completed else 0


def source_paths(proxy: Path) -> tuple[Path, ...]:
    return (
        proxy / "player-data/score_log.jsonl",
        proxy / "player-data/volforce_history.jsonl",
        proxy / "player-data/server_data.json",
        proxy / "player-data/playtime.json",
        proxy / ".env",
        ROOT / ".local/sync-config.json",
    )


def source_state(proxy: Path) -> tuple[tuple[int, int] | None, ...]:
    sources = source_paths(proxy)
    result = []
    for path in sources:
        try:
            stat = path.stat()
            result.append((stat.st_mtime_ns, stat.st_size))
        except FileNotFoundError:
            result.append(None)
    return tuple(result)


def sync_once(
    config: dict[str, Any],
    proxy: Path,
    catalog: Catalog,
    *,
    force: bool = False,
    background_audio: bool = False,
    source_changed: Callable[[], bool] | None = None,
) -> None:
    print(
        f"Sync cycle started (background assets: {'yes' if background_audio else 'no'}).",
        flush=True,
    )
    state_path = ROOT / ".local/sync-state.json"
    saved = read_checkpoint(state_path)
    # The public URL can stay unchanged when Vercel/Neon is replaced. Bind all
    # database acknowledgements to the persistent identity returned by /api/sync.
    destination = config["url"]
    if config.get("database_id"):
        destination += "\n" + config["database_id"]
    endpoint_id = hashlib.sha256(destination.encode()).hexdigest()
    if saved.get("endpoint") != endpoint_id:
        if saved:
            print(
                "Sync destination changed, replaying local history and metadata.",
                flush=True,
            )
        saved = {}
    # Replay old captures once to enrich existing plays without changing their IDs.
    if saved.get("play_schema") != PLAY_SCHEMA:
        saved.pop("plays", None)
    catalog.refresh()
    print(
        f"Catalog ready: {len(catalog.songs)} songs, {len(catalog.charts)} charts.",
        flush=True,
    )
    if hasattr(catalog, "prepare_covers"):
        catalog.prepare_covers()
        cover_state_path = ROOT / ".local/cover-sync-state.json"
        acknowledged = read_checkpoint(cover_state_path)
        if acknowledged.get("endpoint") != endpoint_id:
            acknowledged = {"endpoint": endpoint_id, "ids": []}
        known_ids = set(acknowledged["ids"])
        image_ids = set(catalog.cover_ids.values())
        image_ids.update(card["image"] for card in getattr(catalog, "appeal_cards", []))
        if catalog.appeal_card:
            image_ids.add(catalog.appeal_card)
        pending_ids = sorted(image_ids - known_ids)
    current, profile = snapshot(proxy, catalog)
    # Do not advertise a new jacket before its image upload is acknowledged.
    # The next pass publishes it, changing the snapshot and updating open clients.
    if hasattr(catalog, "prepare_covers"):
        for song in current.get("catalog", []):
            for difficulty in song["difficulties"]:
                if difficulty.get("cover") not in known_ids:
                    difficulty["cover"] = None
    current_hash = hashlib.sha256(
        json.dumps(current, sort_keys=True).encode()
    ).hexdigest()
    uploaded = 0
    while True:
        plays, pc = read_batch(
            proxy / "player-data/score_log.jsonl",
            saved.get("plays", {}),
            lambda p: play_record(p, catalog),
        )
        observations, oc = read_batch(
            proxy / "player-data/volforce_history.jsonl",
            saved.get("observations", {}),
            lambda o: observation_record(o, profile),
        )
        changed = (
            force
            or saved.get("catalog_schema") != 3
            or saved.get("snapshot") != current_hash
        )
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
            play_schema=PLAY_SCHEMA,
            catalog_schema=3,
        )
        write_json(state_path, saved)
        force = False
        if len(plays) < 150 and len(observations) < 150:
            break
    if uploaded:
        print(f"Synced {uploaded} records at {datetime.now().strftime('%H:%M:%S')}.")
    else:
        print("No new play or VolForce records to upload.", flush=True)
    if source_changed and source_changed():
        return
    sync_details(
        config,
        catalog,
        endpoint_id,
        current.get("charts", []),
        source_changed=source_changed,
    )
    print("Chart detail sync complete.", flush=True)
    if source_changed and source_changed():
        return
    if hasattr(catalog, "prepare_covers"):
        catalog.covers_pending = len(pending_ids) > 240
        for start in range(0, min(len(pending_ids), 240), 30):
            if source_changed and source_changed():
                return
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
            print(
                f"Synced {min(len(pending_ids), 240)} artwork images "
                f"({max(0, len(pending_ids) - 240)} remaining)."
            )
            catalog.covers_pending = True

    # Optional audio failures must never stop scores, jackets, or details syncing.
    try:
        from scripts.audio import start_audio_sync, sync_audio

        audio_sync = start_audio_sync if background_audio else sync_audio
        audio_sync(config, proxy, catalog, endpoint_id)
    except Exception as error:  # noqa: BLE001
        catalog.audio_pending = False
        print(
            f"Audio sync pending ({type(error).__name__}). Check optional-setup.bat configuration. other syncing continues.",
            flush=True,
        )

    try:
        from scripts.crew_sync import start_crew_sync, sync_crews

        if background_audio:
            start_crew_sync(catalog)
        else:
            sync_crews(catalog)
    except Exception as error:  # noqa: BLE001
        catalog.crew_pending = False
        print(
            f"Crew sync pending ({type(error).__name__}). Check optional-setup.bat, other syncing continues.",
            flush=True,
        )
    print(
        "Sync cycle finished "
        f"(details_pending={getattr(catalog, 'details_pending', False)}, "
        f"covers_pending={getattr(catalog, 'covers_pending', False)}, "
        f"audio_pending={getattr(catalog, 'audio_pending', False)}, "
        f"crew_pending={getattr(catalog, 'crew_pending', False)}).",
        flush=True,
    )


def sync_details(
    config: dict[str, Any],
    catalog: Catalog,
    endpoint_id: str,
    priority: Sequence[dict[str, Any]] = (),
    *,
    source_changed: Callable[[], bool] | None = None,
) -> None:
    if not hasattr(catalog, "details"):
        return
    checkpoint = ROOT / ".local/chart-details-sync.json"
    saved = read_checkpoint(checkpoint)
    if saved.get("endpoint") != endpoint_id:
        saved = {"endpoint": endpoint_id, "hashes": {}}
    if saved.get("timeline_schema") != 1:
        saved["hashes"] = {}
        saved["timeline_schema"] = 1
    # Replay summaries when new chart statistics need to be backfilled.
    if saved.get("details_schema") != DETAILS_SCHEMA:
        saved["hashes"] = {}
        saved["details_schema"] = DETAILS_SCHEMA
    hashes = saved.setdefault("hashes", {})
    catalog.details.refresh()
    batch, batch_keys, total = [], [], 0

    def flush() -> None:
        nonlocal total
        if not batch:
            return
        # Summaries and compressed visual timelines are batched below 600 KB.
        upload(
            config["url"],
            config["token"],
            {"plays": [], "observations": [], "details": batch},
            config.get("bypass"),
        )
        hashes.update(batch_keys)
        write_json(checkpoint, saved)
        total += len(batch)
        batch.clear()
        batch_keys.clear()

    priority_keys = [f"{c['music_id']}:{c['diff_idx']}" for c in priority]
    keys = dict.fromkeys([*priority_keys, *catalog.details.metadata])
    catalog.details_pending = False
    for key in keys:
        if source_changed and source_changed():
            catalog.details_pending = True
            return
        entry = catalog.details.get(key)
        if entry is None:
            continue
        if hashes.get(key) == entry["hash"]:
            continue
        if not total and not batch:
            print("Syncing chart details...", flush=True)
        from scripts.chart_view import visual_timeline

        mid, diff = map(int, key.split(":"))
        timeline = visual_timeline(catalog.details, mid, diff)
        record = {
            **entry["record"],
            "timeline": base64.b64encode(timeline).decode() if timeline else None,
        }
        if (
            batch
            and sum(
                len(json.dumps(row, ensure_ascii=False).encode())
                for row in [*batch, record]
            )
            > 600_000
        ):
            flush()
            if total >= 192:
                catalog.details_pending = True
                break
        batch.append(record)
        batch_keys.append((key, entry["hash"]))
        if len(batch) == 24:
            flush()
            # Keep checking for fresh plays/refresh requests during first-time backfill.
            if total >= 192:
                catalog.details_pending = True
                break
    flush()
    catalog.details.save()
    if total:
        print(f"Synced {total} compact chart summaries.")


def export_preview(catalog: Catalog | None = None) -> None:
    proxy = resolve_proxy()
    if catalog is None:
        catalog = Catalog(proxy)
    catalog.refresh()
    catalog.prepare_covers()
    state, profile = snapshot(proxy, catalog)

    def all_records(
        path: Path, convert: Callable[[dict[str, Any]], dict[str, Any]]
    ) -> list[dict[str, Any]]:
        records, cursor = [], {}
        while True:
            batch, cursor = read_batch(path, cursor, convert, limit=10000)
            records.extend(batch)
            if len(batch) < 10000:
                return records

    plays = all_records(
        proxy / "player-data/score_log.jsonl", lambda p: play_record(p, catalog)
    )
    observations = all_records(
        proxy / "player-data/volforce_history.jsonl",
        lambda o: observation_record(o, profile),
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


def sync_loop(
    config: dict[str, Any], proxy: Path, catalog: Catalog, once: bool = False
) -> None:
    from scripts.source_events import SourceEvents

    with SourceEvents(source_paths(proxy)) as changed:
        _sync_loop(config, proxy, catalog, changed, once=once)


def _sync_loop(
    config: dict[str, Any],
    proxy: Path,
    catalog: Catalog,
    changed: Event,
    *,
    once: bool = False,
) -> None:
    delay = 5
    next_sync = next_check = 0
    previous_source = None
    while True:
        try:
            changed.clear()
            now = time.monotonic()
            current_source = source_state(proxy)
            requested = 0
            previous_database = config.get("database_id")
            if now >= next_check and (
                previous_source is None or current_source == previous_source
            ):
                status = refresh_request(config)
                requested = status or 0
                next_check = time.monotonic() + (30 if status is None else 2)
            destination_changed = config.get("database_id") != previous_database
            if (
                once
                or requested
                or destination_changed
                or current_source != previous_source
                or time.monotonic() >= next_sync
            ):
                sync_once(
                    config,
                    proxy,
                    catalog,
                    force=previous_source is None,
                    background_audio=not once,
                    source_changed=changed.is_set,
                )
                if requested:
                    upload(
                        config["url"],
                        config["token"],
                        {"plays": [], "observations": [], "refresh_id": requested},
                        config.get("bypass"),
                    )
                previous_source = current_source
                next_sync = time.monotonic() + (
                    2
                    if (
                        getattr(catalog, "details_pending", False)
                        or getattr(catalog, "covers_pending", False)
                        or getattr(catalog, "audio_pending", False)
                        or getattr(catalog, "crew_pending", False)
                    )
                    else 30
                )
                delay = 5
        except (OSError, ValueError, TypeError, RuntimeError, KeyError) as error:
            detail = f": {error}" if isinstance(error, RuntimeError) else ""
            print(f"Sync pending ({type(error).__name__}){detail}. Retrying.")
            if once:
                raise SystemExit(1) from None
            delay = 300 if isinstance(error, DatabaseQuotaError) else min(30, delay * 2)
            time.sleep(delay)
            next_check = 0
            continue
        if once:
            return
        changed.wait(max(0, min(next_sync, next_check) - time.monotonic()))


def run(once: bool = False) -> None:
    config = settings()
    proxy = resolve_proxy()
    catalog = Catalog(proxy)
    if (
        not config.get("url", "").startswith("https://")
        or len(config.get("token", "")) < 32
    ):
        raise SystemExit("Run Setup-dashboard.bat first to connect the dashboard.")
    lock_path = ROOT / ".local/sync.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
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
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN):
                raise
            if once:
                print("Dashboard sync is already running. Keeping the existing worker.")
                return
            raise SystemExit("Dashboard sync is already running.") from None
        print("Dashboard sync running.")
        sync_loop(config, proxy, catalog, once=once)


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1:
            raise SystemExit("Sync does not accept command-line options.")
        run()
    except KeyboardInterrupt:
        print("Sync stopped.")
