from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from datetime import UTC, datetime

from .paths import LOCAL_DATA

CACHE = LOCAL_DATA / "sources"
OFFICIAL = "https://p.eagate.573.jp/game/sdvx/vii/"


def fetch(name: str, url: str) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SDVXUnlockResearch/0.1 (personal metadata research)"},
    )
    metadata: dict[str, object] = {
        "url": url,
        "fetched_at": datetime.now(UTC).isoformat(),
    }
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(8_000_001)
            if len(body) > 8_000_000:
                raise ValueError("Source exceeds the research size limit")
            metadata.update(
                status=response.status,
                final_url=response.url,
                content_type=response.headers.get("Content-Type"),
                size=len(body),
                sha256=hashlib.sha256(body).hexdigest(),
            )
            CACHE.joinpath(name + ".html").write_bytes(body)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        metadata["error"] = str(error)
    return metadata
