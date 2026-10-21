from __future__ import annotations

import hashlib
import json
import re
import tempfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import Any


def prepare_appeal_cards(game: Path, cache: Path) -> list[dict[str, Any]]:
    """Match the game's public card IDs/titles to cached web artwork."""
    try:
        from PIL import Image

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

    manifest_path = cache / "appeal-cards-cache.json"
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
                and (cache / "covers" / f"{image_id}.webp").is_file()
            ):
                with Image.open(source) as image:
                    image = image.convert("RGBA")
                    image.thumbnail((256, 256))
                    buffer = BytesIO()
                    image.save(buffer, "WEBP", lossless=True, method=4)
                content = buffer.getvalue()
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
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=cache,
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
