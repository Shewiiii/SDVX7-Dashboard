from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from .paths import LOCAL_DATA
from .wiki_tables import normalize

CACHE = LOCAL_DATA / "sources/wiki_batches"


def candidates(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.splitlines()
        if re.search(r"unlock|\bPCB\b|\bBLC\b|purchased|解禁", line, re.IGNORECASE)
    ]


def get_batch(titles: list[str]) -> dict[str, Any]:
    params = {
        "action": "query",
        "titles": "|".join(titles),
        "redirects": "1",
        "prop": "revisions|pageprops",
        "rvprop": "ids|timestamp|content",
        "rvslots": "main",
        "format": "json",
        "formatversion": "2",
    }
    url = "https://remywiki.com/api.php?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SDVXUnlockResearch/0.1 (personal metadata research)"},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(8_000_001)
    if len(body) > 8_000_000:
        raise ValueError("Wiki batch exceeds the research size limit")
    data = json.loads(body)
    if "query" not in data or "pages" not in data["query"]:
        raise ValueError(f"Unrecognized wiki response: {str(data)[:160]}")
    return {
        "url": url,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "response": data,
    }


def match_pages(titles: list[str], response: dict[str, Any]) -> list[dict[str, Any]]:
    query = response["query"]
    aliases = {
        item["from"]: item["to"]
        for kind in ("normalized", "redirects")
        for item in query.get(kind, [])
    }
    pages = {page["title"]: page for page in query["pages"]}
    result = []
    for title in titles:
        resolved = title
        seen = set()
        while resolved in aliases and resolved not in seen:
            seen.add(resolved)
            resolved = aliases[resolved]
        page = pages.get(resolved)
        if page is None:
            matches = [
                page
                for name, page in pages.items()
                if normalize(name) == normalize(resolved)
            ]
            page = matches[0] if len(matches) == 1 else {}
        revisions = page.get("revisions", [{}])
        revision = revisions[0]
        text = revision.get("slots", {}).get("main", {}).get("content", "")
        lines = candidates(text)
        status = (
            "missing_page" if page.get("missing") or not text else "candidate_evidence"
        )
        if "disambiguation" in page.get("pageprops", {}):
            status = "ambiguous_page"
        elif text and "SOUND VOLTEX" not in text:
            status = "wrong_game_or_unverified_identity"
        result.append(
            {
                "requested_title": title,
                "page_title": page.get("title"),
                "page_id": page.get("pageid"),
                "revision_id": revision.get("revid"),
                "revision_timestamp": revision.get("timestamp"),
                "status": status,
                "candidate_lines": lines,
                "automatically_accepted": False,
                "reason": "Song pages mix games, editions, historical unlocks, and current unlocks",
            }
        )
    return result


def probe(audit: dict[str, Any], limit: int, refresh: bool = False) -> dict[str, Any]:
    unresolved_ids = {chart["id"] for chart in audit["unresolved_charts"]}
    titles = sorted(
        {song["title"] for song in audit["songs"] if song["id"] in unresolved_ids}
    )[:limit]
    CACHE.mkdir(parents=True, exist_ok=True)
    results = []
    batches = []
    for start in range(0, len(titles), 15):
        batch = titles[start : start + 15]
        key = hashlib.sha256(
            json.dumps(batch, ensure_ascii=False).encode()
        ).hexdigest()[:20]
        path = CACHE / (key + ".json")
        if refresh or not path.exists():
            data = get_batch(batch)
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            time.sleep(1)
        else:
            data = json.loads(path.read_text(encoding="utf-8"))
        matches = match_pages(batch, data["response"])
        results.extend(matches)
        batches.append(
            {
                "cache": str(path.relative_to(LOCAL_DATA)),
                "url": data["url"],
                "fetched_at": data["fetched_at"],
            }
        )
        print(
            f"Wiki evidence: {min(start + 15, len(titles))}/{len(titles)} songs",
            flush=True,
        )
    return {"requested_songs": len(titles), "batches": batches, "results": results}
