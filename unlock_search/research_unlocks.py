from __future__ import annotations

import collections
import hashlib
import json
import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .client_data import ROOT, read_mdb
from .fetch_sources import CACHE, OFFICIAL, fetch
from .ts_literals import LiteralReader
from .wiki_tables import SongIndex, cell_text, expand_table, named_rules

PLUGIN = ROOT / "asphyxia-core-win-x64/plugins/sdvx@asphyxia"
TAGS = ("novice", "advanced", "exhaust", "infinite", "maximum", "ultimate")
WIKI_PAGES = {
    "bemani_unlocks_current": "SOUND VOLTEX ∇/解禁要素",
    "bemani_blaster": "SOUND VOLTEX ∇/BLASTER GATE",
    "bemani_variant": "SOUND VOLTEX ∇/VARIANT GATE",
    "bemani_arena": "SOUND VOLTEX ∇/ランクマッチ",
    "bemani_removed": "SOUND VOLTEX ∇/削除曲リスト",
}
SOURCE_URLS = {
    name: "https://bemaniwiki.com/index.php?" + quote(page)
    for name, page in WIKI_PAGES.items()
}
SOURCE_URLS.update(
    official_news=OFFICIAL + "news/index.html",
    official_variant=OFFICIAL + "event/variant_gate.html",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_songs(
    mdb: Path, custom_mdb: Path | None, glyphs: dict[str, str] | None = None
) -> tuple[list[dict[str, Any]], int]:
    custom_ids = set()
    if custom_mdb is not None and custom_mdb.exists():
        custom_ids = {
            int(song.get("id", "0")) for song in read_mdb(custom_mdb).findall("music")
        }
    songs = []
    seen = set()
    excluded = 0
    for music in read_mdb(mdb).findall("music"):
        music_id = int(music.get("id", "0"))
        if music_id in seen:
            raise ValueError(f"Duplicate song ID: {music_id}")
        seen.add(music_id)
        if music_id in custom_ids:
            excluded += 1
            continue
        charts = []
        for index, tag in enumerate(TAGS):
            chart = music.find("difficulty/" + tag)
            if chart is None or float(chart.findtext("difnum", "0")) <= 0:
                continue
            charts.append(
                {
                    "index": index,
                    "tag": tag,
                    "level": float(chart.findtext("difnum", "0")) / 10,
                    "price": int(chart.findtext("price", "-999")),
                    "limited": int(chart.findtext("limited", "-999")),
                }
            )
        raw_title = music.findtext("info/title_name", "")
        display_title = "".join((glyphs or {}).get(char, char) for char in raw_title)
        songs.append(
            {
                "id": music_id,
                "title": display_title,
                "raw_title": raw_title,
                "artist": music.findtext("info/artist_name", ""),
                "version": int(music.findtext("info/version", "0")),
                "inf_ver": int(music.findtext("info/inf_ver", "0")),
                "distribution_date": int(music.findtext("info/distribution_date", "0")),
                "charts": charts,
            }
        )
    return songs, excluded


def decode_reward(encoded: int) -> tuple[int, list[int]]:
    music_id, mask = divmod(encoded, 100)
    if music_id <= 0 or not 1 <= mask <= 63:
        raise ValueError(f"Unexpected encoded chart reward: {encoded}")
    return music_id, [index for index in range(6) if mask & (1 << index)]


def signed_price(price: int) -> int:
    return price - 2**32 if price >= 2**31 else price


def local_rules(plugin: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reader = LiteralReader(plugin / "data")
    rules: list[dict[str, Any]] = []
    catalog = json.loads(
        (plugin / "webui/asset/json/events.json").read_text(encoding="utf-8")
    )["events7"]
    events = {event["id"]: event for event in catalog}
    for group_index, group in enumerate(reader.constant("BLASTER_GATE7")):
        for encoded in group:
            music_id, diffs = decode_reward(encoded)
            rules.append(
                {
                    "id": music_id,
                    "diffs": diffs,
                    "method": "blaster_gate",
                    "group": group_index,
                    "constant": "BLASTER_GATE7",
                }
            )
    for event_id, event in reader.constant("UNLOCK_EVENTS7").items():
        for sheet in event.get("info", {}).get("data", []):
            reward_text = sheet.get("stprwrd", "")
            prerequisites = [
                int(value) for value in re.findall(r"(?:^|\s)0:r:x(\d+)", reward_text)
            ]
            for stamps, encoded in re.findall(r"(?:^|\s)(\d+):e:(\d+)", reward_text):
                music_id, diffs = decode_reward(int(encoded))
                rules.append(
                    {
                        "id": music_id,
                        "diffs": diffs,
                        "method": "stamp",
                        "event_id": event_id,
                        "event": events.get(event_id, {}).get("name", event_id),
                        "stamps": int(stamps),
                        "sheet_id": sheet["stmpid"],
                        "prerequisite_sheet_ids": prerequisites,
                        "raw_reward": reward_text,
                        "constant": "UNLOCK_EVENTS7",
                    }
                )
    for set_name, arena_set in reader.constant("ARENA_STATION_ITEMS7").items():
        for item in arena_set.get("items", []):
            if item[3] != 0:
                continue
            music_id, diffs = decode_reward(item[4] * 100 + item[5])
            rules.append(
                {
                    "id": music_id,
                    "diffs": diffs,
                    "method": "arena_station",
                    "ap": item[2],
                    "set": set_name,
                    "constant": "ARENA_STATION_ITEMS7",
                }
            )
    for key, item_ids in reader.constant("EVENT_ITEMS7").items():
        event_id, _, ordinal = key.rpartition("_")
        event = events.get(event_id, {})
        if event.get("type") != "cross_online":
            continue
        for item_id in item_ids:
            rules.append(
                {
                    "id": int(item_id),
                    "diffs": [0, 1, 2, 4],
                    "method": "server_event_toggle",
                    "event_id": event_id,
                    "event": event.get("name"),
                    "ordinal": ordinal,
                    "constant": "EVENT_ITEMS7",
                }
            )
    return rules, {
        "overrides": reader.constant("MUSIC_OVERRIDE7"),
        "licensed": set(reader.constant("LICENSED_SONGS7")),
        "old_locked": set(reader.constant("EGSONGS_LOCKED")["crossresonance"]),
    }


def baseline(price: int, limited: int) -> str:
    if limited == 3:
        return "default_unlocked"
    if limited == 2 and (price == -2 or price >= 0):
        return "blc"
    return "unknown"


def resolve_local(
    song: dict[str, Any],
    chart: dict[str, Any],
    data: dict[str, Any],
    rules: list[dict[str, Any]],
    as_of: int,
) -> dict[str, Any]:
    price, limited = chart["price"], chart["limited"]
    if song["version"] == 7 or song["id"] in data["old_locked"]:
        limited = 2
    if song["id"] in data["licensed"]:
        limited = 3
    elif chart["index"] == 3 and song["inf_ver"] == 7:
        limited = 2
    for override in data["overrides"]:
        if override["music_id"] == song["id"] and override.get("start", 0) <= as_of:
            key = ("nov", "adv", "exh", "inf", "mxm", "ult")[chart["index"]]
            price = signed_price(
                override.get("charts", {}).get(key, {}).get("price", price)
            )
    method = baseline(price, limited)
    if method == "unknown" and rules:
        methods = {rule["method"] for rule in rules}
        method = next(iter(methods)) if len(methods) == 1 else "conflict"
    return {
        "method": method,
        "effective_price": price,
        "effective_limited": limited,
        "evidence": rules,
        "scope": "local_plugin_definitions_only",
        "requires_server_settings": bool(rules),
        "profile_state_checked": False,
    }


def prepare_sources(refresh: bool) -> dict[str, Any]:
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest_path = CACHE / "audit_manifest.json"
    manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else {}
    )
    for name, url in SOURCE_URLS.items():
        path = CACHE / (name + ".html")
        if refresh or not path.exists():
            result = fetch(name, url)
            if "error" in result:
                raise RuntimeError(
                    f"Refresh failed, refusing to label stale data as current: {name}: {result['error']}"
                )
            manifest[name] = result
        elif name not in manifest:
            manifest[name] = {
                "url": url,
                "sha256": digest(path),
                "fetched_at": None,
                "note": "Cached source has no recorded retrieval time",
            }
        if manifest[name]["sha256"] != digest(path):
            raise ValueError(f"Snapshot hash differs from manifest: {name}")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def blc_costs() -> dict[tuple[int, int], int]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(
        (CACHE / "bemani_unlocks_current.html").read_text(encoding="utf-8"),
        "html.parser",
    )
    result = {}
    for table in soup.select("#body table"):
        if "Lv 整数部" not in table.get_text(" ", strip=True):
            continue
        for row in expand_table(table)[2:]:
            values = [cell_text(cell) for cell in row]
            if not values[0].isdigit():
                continue
            for version, value in enumerate(values[1:8], 1):
                if re.fullmatch(r"[\d,]+", value):
                    result[version, int(values[0])] = int(value.replace(",", ""))
    if not result:
        raise ValueError("BLC cost table was not recognized")
    return result


def build_audit(
    mdb: Path, custom: Path | None, plugin: Path, as_of: date, manifest: dict[str, Any]
) -> dict[str, Any]:
    reader = LiteralReader(plugin / "data")
    reader.sources["handler_webui"] = (plugin / "handlers/webui.ts").read_text(
        encoding="utf-8"
    )
    glyphs = reader.constant("translate_table")
    songs, excluded = read_songs(mdb, custom, glyphs)
    index = SongIndex(songs)
    rules = [
        rule
        for name in WIKI_PAGES
        for rule in named_rules(CACHE / (name + ".html"), name, SOURCE_URLS[name])
    ]
    matches: dict[tuple[int, int], list[dict[str, Any]]] = collections.defaultdict(list)
    unmatched = []
    for rule in rules:
        music_id, match_kind = index.match(rule["title"], rule["artist"])
        rule["match_kind"] = match_kind
        if music_id is None:
            unmatched.append(rule)
            continue
        for diff in rule["difficulty_indices"]:
            matches[music_id, diff].append(rule)
    local, local_data = local_rules(plugin)
    local_matches: dict[tuple[int, int], list[dict[str, Any]]] = (
        collections.defaultdict(list)
    )
    for rule in local:
        for diff in rule["diffs"]:
            local_matches[rule["id"], diff].append(rule)
    as_of_int = int(as_of.strftime("%Y%m%d"))
    costs = blc_costs()
    counts: collections.Counter[str] = collections.Counter()
    local_counts: collections.Counter[str] = collections.Counter()
    unknown = []
    conflicts = []
    for song in songs:
        for chart in song["charts"]:
            key = song["id"], chart["index"]
            chart["local"] = resolve_local(
                song, chart, local_data, local_matches[key], as_of_int
            )
            evidence = matches[key]
            methods = {rule["method"] for rule in evidence}
            method = (
                next(iter(methods))
                if len(methods) == 1
                else "conflict"
                if methods
                else baseline(chart["price"], chart["limited"])
            )
            if "removed" in methods:
                method = "removed"
            # A documented later BLC migration supersedes the old stamp route.
            for rule in evidence:
                migrations = re.findall(
                    r"(\d{4})/(\d{2})/(\d{2})よりBLC解禁に移行",
                    rule["section_context_ja"],
                )
                if any(int("".join(parts)) <= as_of_int for parts in migrations):
                    method = "blc"
            confidence = (
                "matched_current_version_table"
                if evidence
                else "client_database_inference"
            )
            chart["arcade"] = {
                "method": method,
                "confidence": confidence,
                "availability": "ended"
                if evidence
                and all(r["availability"] == "ended" for r in evidence)
                and method != "blc"
                else "needs_live_verification",
                "evidence": evidence,
                "full_instructions_verified": False,
            }
            if method == "blc":
                table_cost = costs.get((song["version"], int(chart["level"])))
                explicit_cost = chart["price"] if chart["price"] >= 0 else None
                cost_conflict = (
                    explicit_cost is not None
                    and table_cost is not None
                    and explicit_cost != table_cost
                )
                chart["arcade"].update(
                    individual_blc_cost=None
                    if cost_conflict
                    else explicit_cost
                    if explicit_cost is not None
                    else table_cost,
                    cost_candidates={
                        "client_explicit": explicit_cost,
                        "wiki_table": table_cost,
                    },
                    cost_conflict=cost_conflict,
                )
                chart["arcade"]["cost_note"] = (
                    "Individual chart price, lower locked difficulties may add to the purchase total"
                )
            if method in {"unknown", "conflict"}:
                unknown.append(
                    {
                        "id": song["id"],
                        "title": song["title"],
                        "diff": chart["index"],
                        "price": chart["price"],
                        "limited": chart["limited"],
                        "local_method": chart["local"]["method"],
                    }
                )
            if method == "conflict":
                conflicts.append(
                    {
                        "id": song["id"],
                        "diff": chart["index"],
                        "methods": sorted(methods),
                    }
                )
            counts[method] += 1
            local_counts[chart["local"]["method"]] += 1
    return {
        "schema_version": 1,
        "as_of": as_of.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(),
        "input_sha256": digest(mdb),
        "sources": manifest,
        "summary": {
            "songs": len(songs),
            "charts": sum(counts.values()),
            "customs_excluded_from_input": excluded,
            "source_rows": len(rules),
            "unmatched_source_rows": len(unmatched),
            "arcade_method_counts": dict(counts),
            "local_method_counts": dict(local_counts),
            "fully_verified_arcade_instructions": 0,
        },
        "conflicts": conflicts,
        "unmatched_source_rows": unmatched,
        "unresolved_charts": unknown,
        "songs": songs,
    }
