"""Shared media encoding, availability checks, and upload staging"""

from __future__ import annotations

import tempfile
from collections.abc import Collection
from io import BytesIO
from pathlib import Path


class PreparationBudget:
    def __init__(self, limit: int | None = None) -> None:
        self.remaining = limit

    def take(self) -> bool:
        if self.remaining is None:
            return True
        if self.remaining <= 0:
            return False
        self.remaining -= 1
        return True


def asset_available(
    path: Path, key: str, remote: Collection[str] | None = None
) -> bool:
    return (remote is not None and key in remote) or path.is_file()


def remove_staged(path: Path, directory: Path) -> None:
    if path.resolve().is_relative_to(directory.resolve()):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def write_media(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=path.parent, suffix=".tmp", delete=False
    ) as stream:
        temporary = Path(stream.name)
        stream.write(content)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def encode_cover(source: Path, *, lossless: bool = False) -> bytes:
    from PIL import Image

    with Image.open(source) as image:
        image = image.convert("RGBA" if lossless else "RGB")
        image.thumbnail((256, 256))
        output = BytesIO()
        image.save(output, "WEBP", quality=85, lossless=lossless, method=4)
        return output.getvalue()
