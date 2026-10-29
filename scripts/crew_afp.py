"""Compatibility for the newer crew portrait AFP exports."""

from __future__ import annotations

import struct
from typing import Any

from sdvx_afp.swf import SWF
from sdvx_afp.types import AP2Tag


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
