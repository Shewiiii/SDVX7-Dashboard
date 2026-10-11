"""Save the game's original score grade sprites as aligned transparent PNGs."""

from io import BytesIO
from pathlib import Path

from ifstools import IFS
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT.parent.parent
DESTINATION = ROOT / "public/assets/grades"
GRADES = ("s", "aaa_plus", "aaa", "aa_plus", "aa", "a_plus", "a", "b", "c", "d")

archive = IFS(str(GAME / "data/graphics/ver07/result.ifs"), super_disable=True)
try:
    textures = {texture.name: texture for texture in archive.tree.all_files}
    icons = {}
    for grade in GRADES:
        texture = textures[f"grade_{grade}.png"]
        with Image.open(BytesIO(texture.load(crop_to_uvrect=True))) as source:
            icon = source.convert("RGBA")
        bounds = icon.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError(f"Empty grade sprite: {grade}")
        icons[grade] = icon.crop(bounds)
    size = (
        max(icon.width for icon in icons.values()) + 8,
        max(icon.height for icon in icons.values()) + 8,
    )
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for grade, icon in icons.items():
        canvas = Image.new("RGBA", size)
        canvas.paste(icon, ((size[0] - icon.width) // 2, (size[1] - icon.height) // 2))
        canvas.save(DESTINATION / f"{grade.replace('_', '-')}.png", optimize=True)
finally:
    archive.close()
print(
    f"Saved all {len(GRADES)} original grade icons, aligned on {size[0]}×{size[1]} transparent canvases."
)
