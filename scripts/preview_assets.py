"""Index local artwork without converting it until the browser requests an image"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path
from typing import Any

from scripts.audio import read_json, write_json
from scripts.companion import ROOT, resolve_proxy
from scripts.media_cache import encode_cover
from scripts.sync import Catalog

INDEX = ROOT / ".local/preview-cover-index.json"


@lru_cache(maxsize=1)
def read_index(path: Path, _modified: int, _size: int) -> dict[str, Any]:
    return read_json(path, {})


class PreviewCatalog(Catalog):
    def prepare_covers(self) -> None:
        self.cover_index = None
        self.index_covers()
        images: dict[str, dict[str, Any]] = {}

        def register(source: Path, *, lossless: bool = False) -> str | None:
            try:
                info = source.stat()
            except FileNotFoundError:
                return None
            relative = source.relative_to(self.game).as_posix()
            identity = [relative, info.st_size, info.st_mtime_ns, lossless]
            digest = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
            images[digest] = {"path": relative, "lossless": lossless}
            return digest

        self.cover_ids = {}
        for mid, song in self.songs.items():
            for difficulty in song["difficulties"]:
                diff = difficulty["diff_idx"]
                paths = self.jacket_paths(mid, diff)
                for source in paths:
                    digest = register(source)
                    if digest:
                        self.cover_ids[f"{mid}:{diff}"] = digest
                        break

        self.appeal_cards = []
        try:
            mapping = self.game / "data/others/appeal_card.xml"
            text = re.sub(
                r"<\?xml[^>]*\?>",
                "",
                mapping.read_text(encoding="cp932", errors="replace"),
                count=1,
            )
            cards = {}
            for card in ET.fromstring(text).findall("card"):
                number = card.get("id", "")
                texture = card.findtext("info/texture", "").strip()
                if not number.isdecimal() or not re.fullmatch(
                    r"[A-Za-z0-9_]+", texture
                ):
                    continue
                card_id = int(number)
                if not 0 <= card_id <= 10000000:
                    continue
                digest = register(
                    self.game / "data/graphics/ap_card" / f"{texture}.png",
                    lossless=True,
                )
                if digest:
                    cards[card_id] = {
                        "id": card_id,
                        "title": card.findtext("info/title", "").strip()[:200]
                        or f"Card {card_id}",
                        "image": digest,
                    }
            self.appeal_cards = [cards[key] for key in sorted(cards)]
        except (OSError, ET.ParseError):
            pass
        raw = read_json(self.proxy / "player-data/server_data.json", {})
        selected = (raw.get("player") or {}).get("appeal_id")
        self.appeal_card = next(
            (card["image"] for card in self.appeal_cards if card["id"] == selected),
            None,
        )
        write_json(INDEX, images)


def read_cover(game: Path, digest: str) -> bytes | None:
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        return None
    try:
        info = INDEX.stat()
    except FileNotFoundError:
        return None
    entry = read_index(INDEX, info.st_mtime_ns, info.st_size).get(digest)
    if not entry:
        return None
    source = (game / entry["path"]).resolve()
    if not source.is_relative_to(game.resolve()) or source.suffix.lower() != ".png":
        return None
    try:
        return encode_cover(source, lossless=entry["lossless"])
    except (OSError, ValueError):
        return None


def main() -> None:
    game = resolve_proxy().parent
    for line in sys.stdin:
        try:
            command = json.loads(line)
            content = read_cover(game, command.get("id", ""))
            result = {
                "ok": True,
                "result": base64.b64encode(content).decode() if content else None,
            }
        except Exception as error:  # noqa: BLE001
            print(
                f"Preview image failed ({type(error).__name__})",
                file=sys.stderr,
                flush=True,
            )
            result = {"ok": False, "error": "Preview image unavailable"}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
