"""Extract original clear-mark emblems for the dashboard"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from PIL import Image

from scripts.local_config import protected_path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(protected_path("crew-tools", ROOT)))
MARKS = {
    "no-clear": "mark_no.png",
    "crash": "mark_crash.png",
    "effective": "mark_comp.png",
    "excessive": "mark_comp_ex.png",
    "maxxive": "mark_comp_ultra.png",
    "uc": "mark_uc.png",
    "puc": "mark_puc.png",
}


def extract(game: Path, output: Path) -> None:
    from ifstools import IFS

    archive = IFS(str(game / "data/graphics/ver07/ms_sel.ifs"))
    try:
        files = {file.name: file for file in archive.tree.all_files}
        images = {
            name: Image.open(io.BytesIO(files[source].load())).convert("RGBA")
            for name, source in MARKS.items()
        }
        bounds = [image.getbbox() for image in images.values()]
        crop = (
            min(box[0] for box in bounds),
            min(box[1] for box in bounds),
            max(box[2] for box in bounds),
            max(box[3] for box in bounds),
        )
        output.mkdir(parents=True, exist_ok=True)
        for name, image in images.items():
            image.crop(crop).save(output / f"{name}.png", optimize=True)
    finally:
        archive.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, default=ROOT.parent)
    args = parser.parse_args()
    extract(args.game, ROOT / "public/assets/clear-marks")


if __name__ == "__main__":
    main()
