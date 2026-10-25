from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from .paths import GAME_ROOT

ROOT = GAME_ROOT


def read_mdb(path: Path) -> ET.Element:
    raw = path.read_bytes()
    declaration = re.search(rb"encoding=['\"]([^'\"]+)", raw[:200], re.IGNORECASE)
    encoding = declaration[1].decode("ascii") if declaration else "utf-8-sig"
    if encoding.lower().replace("_", "-") in {"shift-jis", "sjis", "windows-31j"}:
        encoding = "cp932"
    text = raw.decode(encoding)
    root = ET.fromstring(re.sub(r"<\?xml[^>]*\?>", "", text, count=1))
    if root.tag != "mdb":
        raise ValueError("Expected an mdb music database")
    return root
