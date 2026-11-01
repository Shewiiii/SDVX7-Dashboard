from __future__ import annotations

import hashlib
import json
import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from scripts.local_config import metadata_path
from scripts.media_cache import PreparationBudget, asset_available, encode_cover


def prepare_appeal_cards(
    game: Path,
    cache: Path,
    *,
    uploaded: set[str] | None = None,
    budget: PreparationBudget | None = None,
) -> list[dict[str, Any]]:
    """Match the game's public card IDs/titles to cached web artwork."""
    try:
        mapping = game / "data/others/appeal_card.xml"
        text = re.sub(
            r"<\?xml[^>]*\?>",
            "",
            mapping.read_text(encoding="cp932", errors="replace"),
            count=1,
        )
        cards = ET.fromstring(text).findall("card")
    except (OSError, ET.ParseError, ImportError):
        return []

    manifest_path = metadata_path("appeal-cards-cache.json", cache.parent)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            manifest = {}
    except (OSError, ValueError):
        manifest = {}

    result = {}
    updated = {}
    for card in cards:
        number = card.get("id", "")
        texture = card.findtext("info/texture", "").strip()
        if not number.isdecimal() or not re.fullmatch(r"[A-Za-z0-9_]+", texture):
            continue
        card_id = int(number)
        if not 0 <= card_id <= 10000000:
            continue
        source = game / "data/graphics/ap_card" / f"{texture}.png"
        try:
            stat = source.stat()
            signature = [texture, stat.st_mtime_ns, stat.st_size]
            known = manifest.get(str(card_id), {})
            if not isinstance(known, dict):
                known = {}
            image_id = known.get("image", "")
            if not (
                known.get("signature") == signature
                and isinstance(image_id, str)
                and re.fullmatch(r"[a-f0-9]{64}", image_id)
                and asset_available(
                    cache / "covers" / f"{image_id}.webp", image_id, uploaded
                )
            ):
                if budget is not None and not budget.take():
                    continue
                content = encode_cover(source, lossless=True)
                image_id = hashlib.sha256(content).hexdigest()
                target = cache / "covers" / f"{image_id}.webp"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            updated[str(card_id)] = {"signature": signature, "image": image_id}
            result[card_id] = {
                "id": card_id,
                "title": card.findtext("info/title", "").strip()[:200]
                or f"Card {card_id}",
                "image": image_id,
            }
        except (OSError, ValueError):
            # An unavailable image must not stop score synchronization.
            continue

    if updated != manifest:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=manifest_path.parent,
            suffix=".tmp",
            delete=False,
        ) as output:
            json.dump(updated, output, ensure_ascii=False)
            temporary = Path(output.name)
        try:
            temporary.replace(manifest_path)
        finally:
            temporary.unlink(missing_ok=True)
    return [result[number] for number in sorted(result)]
