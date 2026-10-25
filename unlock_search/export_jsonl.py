from __future__ import annotations

import hashlib
import json
import re
import tempfile
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .client_data import ROOT, read_mdb
from .paths import LOCAL_DATA, PUBLIC_CATALOG, UNLOCK_OVERRIDES

CUSTOM_MDB = ROOT / "data_mods/ryunet_custom/others/music_db.merged.xml"
EXTRA_LABELS = {2: "INF", 3: "GRV", 4: "HVN", 5: "VVD", 6: "XCD", 7: "NBL"}
DIFFICULTIES = ("NOV", "ADV", "EXH", "INF", "MXM", "ULT")


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

    if method == "default_available":
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
        april_fools = any(
            "期間限定配信曲" in rule.get("headings", [])
            and "エイプリルフール" in rule.get("section_context_ja", "")
            for rule in evidence
        )
        if april_fools:
            return "April Fools' chart. Returns for a limited time around April 1."
        return "This chart has been removed from arcade cabinets."
    if method == "conditional_input":
        return "Requires prerequisite song clears. Verify the exact conditions."
    if method == "conflict":
        return "Uncertain, verify the exact conditions"
    return "Unknown, may be unlocked by default"


def status(method: str, *, cost_conflict: bool = False) -> str:
    if method == "conflict" or cost_conflict:
        return "conflict"
    return "unresolved" if method == "unknown" else "candidate"


def table_evidence(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_id": rule["source"],
        "url": rule["url"],
        "table_index": rule["table_index"],
        "section": rule["headings"],
        "matched_title": rule["title"],
        "match_kind": rule["match_kind"],
        "fields": rule["source_fields"],
    }


def review_evidence(page: dict[str, Any]) -> dict[str, Any]:
    title = page.get("page_title")
    return {
        "source": "remywiki",
        "url": "https://remywiki.com/" + quote(title.replace(" ", "_"), safe="")
        if title
        else None,
        "lookup_status": page["status"],
        "page_title": title,
        "revision_id": page.get("revision_id"),
        "revision_timestamp": page.get("revision_timestamp"),
        "candidate_lines": page["candidate_lines"],
        "automatically_accepted": False,
    }


def records(
    audit: dict[str, Any],
    wiki: dict[str, Any] | None = None,
    custom_ids: set[int] | None = None,
) -> Iterator[dict[str, Any]]:
    if audit.get("schema_version") != 1:
        raise ValueError("Unsupported audit schema")
    pages = {page["requested_title"]: page for page in (wiki or {}).get("results", [])}
    seen: set[tuple[int, int]] = set()
    for song in sorted(audit["songs"], key=lambda item: item["id"]):
        mid = song["id"]
        if song.get("is_custom") or mid in (custom_ids or set()):
            continue
        for chart in sorted(song["charts"], key=lambda item: item["index"]):
            diff = chart["index"]
            key = mid, diff
            if key in seen:
                raise ValueError(f"Duplicate chart: {mid}:{diff}")
            if not 0 <= diff < len(DIFFICULTIES):
                raise ValueError(f"Unsupported difficulty index: {diff}")
            seen.add(key)
            arcade = chart["arcade"]
            if arcade["method"] == "blc":
                arcade = {
                    **arcade,
                    "lower_blc_cost": lower_blc_cost(song["charts"], diff),
                }
            local = chart["local"]
            cost_conflict = arcade.get("cost_conflict", False)
            method = arcade["method"]
            evidence = [table_evidence(rule) for rule in arcade["evidence"]]
            if not evidence:
                evidence = [{"source_id": "client_mdb", "kind": "client_database"}]
            reasons = []
            if method in {"unknown", "conflict"}:
                reasons.append("arcade_method_" + status(method))
            if cost_conflict:
                reasons.append("blc_price_conflict")
            if not arcade["full_instructions_verified"]:
                reasons.append("full_instructions_unverified")
            record = {
                "schema_version": 1,
                "game_version": 7,
                "as_of": audit["as_of"],
                "chart_id": f"{mid}:{diff}",
                "music_id": mid,
                "diff_idx": diff,
                "title": song["title"],
                "artist": song["artist"],
                "song_version": song["version"],
                "difficulty": EXTRA_LABELS.get(song["inf_ver"], "INF")
                if diff == 3
                else DIFFICULTIES[diff],
                "level": chart["level"],
                "arcade": {
                    "method": method,
                    "description": unlock_description(arcade),
                    "status": status(method, cost_conflict=cost_conflict),
                    "confidence": arcade["confidence"],
                    "availability": "removed"
                    if method == "removed"
                    else arcade["availability"],
                    "full_instructions_verified": arcade["full_instructions_verified"],
                    "blc": {
                        "individual_cost": arcade.get("individual_blc_cost"),
                        "lower_difficulties_cost": arcade.get("lower_blc_cost"),
                        "candidates": arcade.get("cost_candidates", {}),
                        "conflict": cost_conflict,
                        "includes_lower_difficulties": False,
                    }
                    if method == "blc"
                    else None,
                    "evidence": evidence,
                },
                "asphyxia": {
                    "method": local["method"],
                    "status": status(local["method"]),
                    "scope": local["scope"],
                    "requires_server_settings": local["requires_server_settings"],
                    "profile_state_checked": local["profile_state_checked"],
                    "effective_price": local["effective_price"],
                    "effective_limited": local["effective_limited"],
                    "evidence": local["evidence"],
                },
                "client": {"price": chart["price"], "limited": chart["limited"]},
                "review": {
                    "reasons": reasons,
                    "song_page": review_evidence(pages[song["title"]])
                    if song["title"] in pages
                    else None,
                },
            }
            yield record


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


def load_overrides(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    overrides = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(overrides, dict):
        raise ValueError(f"{path.name} must contain an object keyed by chart ID")  # noqa: TRY004
    overrides.pop("comment", None)
    overrides.pop("templates", None)
    for chart_id, override in overrides.items():
        if not re.fullmatch(r"[1-9]\d{0,7}:(?:[0-5]|\*)", chart_id):
            raise ValueError(f"Invalid chart ID in {path.name}: {chart_id}")
        if not isinstance(override, dict) or set(override) != {"description"}:
            raise ValueError(f"Override {chart_id} must contain only description")
        description = override["description"]
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"Override {chart_id} needs a nonempty description")
    return overrides


def export_catalog(
    audit: dict[str, Any],
    wiki: dict[str, Any] | None = None,
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
    rows = list(records(audit, wiki, custom_ids))
    applied_overrides = []
    for row in rows:
        override = overrides.get(row["chart_id"]) or overrides.get(
            f"{row['music_id']}:*"
        )
        if override:
            row["arcade"]["description"] = override["description"]
            applied_overrides.append(row["chart_id"])
    write_jsonl(output_path, rows)
    manifest = {
        "schema_version": 1,
        "status": "draft_for_review",
        "game_version": 7,
        "as_of": audit["as_of"],
        "audit_generated_at": audit["generated_at"],
        "jsonl_sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "charts": len(rows),
        "songs": len({row["music_id"] for row in rows}),
        "description_overrides": applied_overrides,
        "known_custom_ids_excluded": len(custom_ids),
        "custom_charts_removed_from_audit": sum(
            len(song["charts"])
            for song in audit["songs"]
            if song.get("is_custom") or song["id"] in custom_ids
        ),
        "arcade_methods": dict(Counter(row["arcade"]["method"] for row in rows)),
        "arcade_statuses": dict(Counter(row["arcade"]["status"] for row in rows)),
        "sources": {
            "client_mdb": {"sha256": audit["input_sha256"]},
            **audit["sources"],
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(rows)} charts for {manifest['songs']} songs: {output_path}")
    return manifest
