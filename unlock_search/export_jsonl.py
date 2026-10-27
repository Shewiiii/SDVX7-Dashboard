from __future__ import annotations

import hashlib
import json
import re
import tempfile
from collections import Counter, defaultdict
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from .client_data import ROOT, read_mdb
from .paths import LOCAL_DATA, PUBLIC_CATALOG, UNLOCK_OVERRIDES

CUSTOM_MDB = ROOT / "data_mods/ryunet_custom/others/music_db.merged.xml"
BLC_SOURCE = "https://bemaniwiki.com/index.php?" + quote("SOUND VOLTEX ∇/解禁要素")
DIFFICULTIES = ("NOV", "ADV", "EXH", "INF", "MXM", "ULT")
METHODS = frozenset(
    {
        "default_unlocked",
        "blc",
        "blaster_gate",
        "variant_gate",
        "arena_station",
        "stamp",
        "extrack_challenge",
        "conditional_input",
        "event_mission",
        "crossover_event",
        "limited_time",
        "removed",
        "unknown",
    }
)


def april_fools_chart(arcade: dict[str, Any]) -> bool:
    return any(
        "期間限定配信曲" in rule.get("headings", [])
        and "エイプリルフール" in rule.get("section_context_ja", "")
        for rule in arcade["evidence"]
    )


def lower_blc_cost(charts: list[dict[str, Any]], diff: int) -> int | None:
    total = 0
    for chart in charts:
        if chart["index"] >= diff:
            continue
        arcade = chart["arcade"]
        if arcade["method"] in {"unknown", "conflict"}:
            return None
        if arcade["method"] != "blc":
            continue
        cost = arcade.get("individual_blc_cost")
        if arcade.get("cost_conflict") or cost is None:
            return None
        total += cost
    return total


def unlock_description(arcade: dict[str, Any]) -> str:
    method = arcade["method"]
    evidence = arcade["evidence"]
    fields = evidence[0].get("source_fields", {}) if evidence else {}
    sections = evidence[0].get("headings", []) if evidence else []
    event = sections[-1] if sections else "the event"
    event = event.replace("スペシャルスタンプ", "Special Stamp")

    if method == "default_unlocked":
        return "Unlocked by default."
    if method == "blc":
        cost = arcade.get("individual_blc_cost")
        if arcade.get("cost_conflict"):
            return "Purchase with BLC."
        if cost is not None:
            lower_cost = arcade.get("lower_blc_cost")
            total_text = (
                f" ({cost + lower_cost:,} BLC total)" if lower_cost is not None else ""
            )
            return (
                f"Purchase this chart for {cost:,} BLC "
                f"+ cost of lower locked difficulties{total_text}."
            )
        return "Purchase this chart with BLC in song select."
    if method == "blaster_gate":
        return "Clear this chart in BLASTER GATE."
    if method == "variant_gate":
        gate = event.removeprefix("VARIANT GATE").strip()
        folder = f"VARIANT GATE {gate}" if gate else "VARIANT GATE"
        attributes = fields.get("VARIANT POWER属性", "")
        if attributes and attributes != "-":
            return (
                f"Earn VARIANT POWER using {attributes} charts, "
                f"then clear this chart in {folder}."
            )
        return f"Collect the required seals, then clear this chart in {folder}."
    if method == "arena_station":
        return "Purchase this chart with AP in ARENA STATION during an eligible season."
    if method == "stamp":
        stamp_value = next(
            (value for key, value in fields.items() if "スタンプ数" in key), ""
        )
        stamps = int(stamp_value) if str(stamp_value).isdigit() else None
        if arcade["availability"] == "ended":
            cost_text = f" ({stamps} stamps)" if stamps is not None else ""
            return (
                f"Previously unlocked through {event}{cost_text}. That event has ended."
            )
        if stamps is not None:
            return f"Collect {stamps} stamps on this song's sheet in {event}."
        return f"Complete this song's stamp sheet in {event}."
    if method == "extrack_challenge":
        condition = next(
            (value for key, value in fields.items() if "出現条件" in key), ""
        )
        if condition.endswith("を解禁する"):
            prerequisite = condition.removesuffix("を解禁する")
            return f"Unlock {prerequisite} first, then clear this chart in EXTRACK CHALLENGE."
        return "Clear this chart in the EXTRACK CHALLENGE folder on a EX-TRACK."
    if method == "removed":
        if april_fools_chart(arcade):
            return "April Fools' chart. Returns for a limited time around April 1."
        return "This chart has been removed from arcade cabinets."
    if method == "conditional_input":
        return "Requires prerequisite song clears. Verify the exact conditions."
    return "Unknown, may be unlocked by default"


def records(
    audit: dict[str, Any], custom_ids: set[int] | None = None
) -> Iterator[dict[str, Any]]:
    if audit.get("schema_version") != 1:
        raise ValueError("Unsupported audit schema")
    seen: set[tuple[int, int]] = set()
    for song in sorted(audit["songs"], key=lambda item: item["id"]):
        mid = song["id"]
        if song.get("is_custom") or mid in (custom_ids or set()):
            continue
        for chart in sorted(song["charts"], key=lambda item: item["index"]):
            diff = chart["index"]
            if (mid, diff) in seen:
                raise ValueError(f"Duplicate chart: {mid}:{diff}")
            if not 0 <= diff < len(DIFFICULTIES):
                raise ValueError(f"Unsupported difficulty index: {diff}")
            seen.add((mid, diff))
            arcade = chart["arcade"]
            if arcade["method"] == "blc":
                arcade = {
                    **arcade,
                    "lower_blc_cost": lower_blc_cost(song["charts"], diff),
                }
            sources = list(dict.fromkeys(rule["url"] for rule in arcade["evidence"]))
            if arcade["method"] == "blc" and not sources:
                sources = [BLC_SOURCE]
            yield {
                "chart_id": f"{mid}:{diff}",
                "method": "limited_time"
                if arcade["method"] == "removed" and april_fools_chart(arcade)
                else arcade["method"]
                if arcade["method"] in METHODS
                else "unknown",
                "description": unlock_description(arcade),
                "as_of": audit["as_of"],
                "source": sources,
            }


def compact_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    songs: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        songs[int(row["chart_id"].split(":")[0])].append(row)
    result = []
    for mid, charts in sorted(songs.items()):
        charts = sorted(charts, key=lambda row: int(row["chart_id"].split(":")[1]))
        groups = Counter(
            (row["method"], row["description"], row["as_of"], tuple(row["source"]))
            for row in charts
        )
        common, count = groups.most_common(1)[0]
        if count < 2:
            result.extend(charts)
            continue
        method, description, as_of, sources = common
        result.append(
            {
                "chart_id": f"{mid}:*",
                "method": method,
                "description": description,
                "as_of": as_of,
                "source": list(sources),
            }
        )
        result.extend(
            row
            for row in charts
            if (row["method"], row["description"], row["as_of"], tuple(row["source"]))
            != common
        )
    return result


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent, delete=False
        ) as output:
            temporary = Path(output.name)
            for row in rows:
                output.write(
                    json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n"
                )
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def valid_source(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
    except ValueError:
        return False
    return url.scheme in {"http", "https"} and bool(url.netloc)


def load_overrides(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    overrides = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(overrides, dict):
        raise ValueError(f"{path.name} must contain an object keyed by chart ID")
    overrides.pop("comment", None)
    overrides.pop("templates", None)
    for chart_id, override in overrides.items():
        if not re.fullmatch(r"[1-9]\d{0,7}:(?:[0-5]|\*)", chart_id):
            raise ValueError(f"Invalid chart ID in {path.name}: {chart_id}")
        if (
            not isinstance(override, dict)
            or not {"method", "description"} <= set(override)
            or set(override) - {"method", "description", "source", "as_of"}
        ):
            raise ValueError(
                f"Override {chart_id} needs method, description and optional source/as_of"
            )
        if not isinstance(override["method"], str) or override["method"] not in METHODS:
            raise ValueError(f"Override {chart_id} has an unsupported method")
        description = override["description"]
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"Override {chart_id} needs a nonempty description")
        if "as_of" in override:
            value = override["as_of"]
            if not isinstance(value, str) or not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}", value
            ):
                raise ValueError(f"Override {chart_id} needs an ISO date")
            date.fromisoformat(value)
        if "source" in override and (
            not isinstance(override["source"], list)
            or not all(valid_source(url) for url in override["source"])
        ):
            raise ValueError(f"Override {chart_id} needs a list of HTTP(S) source URLs")
    return overrides


def apply_overrides(
    rows: list[dict[str, Any]], overrides: dict[str, dict[str, Any]]
) -> list[str]:
    applied = []
    for row in rows:
        mid = row["chart_id"].split(":")[0]
        override = overrides.get(row["chart_id"]) or overrides.get(f"{mid}:*")
        if override:
            row["method"] = override["method"]
            row["description"] = override["description"]
            row["as_of"] = override.get("as_of", row["as_of"])
            row["source"] = list(dict.fromkeys(override.get("source", [])))
            applied.append(row["chart_id"])
    return applied


def export_catalog(
    audit: dict[str, Any],
    custom_mdb: Path = CUSTOM_MDB,
    output_path: Path = PUBLIC_CATALOG,
    manifest_path: Path = LOCAL_DATA / "manifest.json",
    overrides_path: Path = UNLOCK_OVERRIDES,
) -> dict[str, Any]:
    if output_path.suffix != ".jsonl":
        raise ValueError("Output must end in .jsonl")
    overrides = load_overrides(overrides_path)
    custom_ids = (
        {int(song.attrib["id"]) for song in read_mdb(custom_mdb).findall("music")}
        if custom_mdb.exists()
        else set()
    )
    rows = list(records(audit, custom_ids))
    applied_overrides = apply_overrides(rows, overrides)
    compact = compact_records(rows)
    write_jsonl(output_path, compact)
    manifest = {
        "schema_version": 2,
        "as_of": audit["as_of"],
        "audit_generated_at": audit["generated_at"],
        "jsonl_sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "charts": len(rows),
        "songs": len({row["chart_id"].split(":")[0] for row in rows}),
        "entries": len(compact),
        "description_overrides": applied_overrides,
        "known_custom_ids_excluded": len(custom_ids),
        "sources": {
            "client_mdb": {"sha256": audit["input_sha256"]},
            **audit["sources"],
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(rows)} charts in {len(compact)} entries: {output_path}")
    return manifest
