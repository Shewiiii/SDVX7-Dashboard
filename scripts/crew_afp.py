"""Compatibility for the newer crew portrait AFP exports."""

from __future__ import annotations

import struct
from typing import Any

from sdvx_afp.geo import Shape
from sdvx_afp.swf import SWF
from sdvx_afp.types import AP2Tag


class CrewShape(Shape):
    def __init__(self, name: str, data: bytes) -> None:
        super().__init__(name, data)
        self.unicode_labels: dict[str, str] = {}

    def get_until_null(self, offset: int) -> bytes:
        raw = super().get_until_null(offset)
        try:
            label = raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw
        if label.isascii():
            return raw
        # The parser expects ASCII, but some crews use plain UTF-8 labels.
        token = "utf8_" + raw.hex()
        self.unicode_labels[token] = label
        return token.encode("ascii")

    def as_dict(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        result = super().as_dict(*args, **kwargs)
        for parameters in result["draw_params"]:
            region = parameters["region"]
            parameters["region"] = self.unicode_labels.get(region, region)
        return result


class CrewMovie(SWF):
    def _SWF__parse_tag(
        self,
        ap2_version: int,
        afp_version: int,
        ap2data: bytes,
        tagid: int,
        size: int,
        dataoffset: int,
        tag_parent_sprite: int | None,
        tag_frame: str,
        prefix: str = "",
    ) -> Any:
        if tagid == AP2Tag.AP2_SHAPE and size == 8:
            # Portrait exports append four bytes to the original shape reference.
            self.add_coverage(dataoffset + 4, 4)
            size = 4
        return super()._SWF__parse_tag(
            ap2_version,
            afp_version,
            ap2data,
            tagid,
            size,
            dataoffset,
            tag_parent_sprite,
            tag_frame,
            prefix,
        )


def geometry_data(data: bytes) -> bytes:
    if len(data) < 68 or data[:4] not in (b"D2EG", b"GE2D"):
        return data
    endian = "<" if data[:4] == b"D2EG" else ">"
    flags = struct.unpack_from(endian + "I", data, 16)[0]
    if flags not in (0x24, 0x2C):
        return data
    # These portrait files retain the original vertex, UV and triangle layout.
    normalized = bytearray(data)
    struct.pack_into(endian + "I", normalized, 16, flags & ~0x20)
    return bytes(normalized)
