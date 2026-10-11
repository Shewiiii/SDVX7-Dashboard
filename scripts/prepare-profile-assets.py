"""Extract the game's VF class logos for this standalone dashboard."""
from io import BytesIO
from pathlib import Path

from ifstools import IFS
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT.parent.parent
destination = ROOT / "public/assets/vf-classes"
destination.mkdir(parents=True, exist_ok=True)
remaining = set(range(1, 11))

for folder in sorted((GAME / "data/graphics").glob("ver[0-9][0-9]"), reverse=True):
    path = folder / "force.ifs"
    if not path.exists():
        continue
    archive = IFS(str(path), super_disable=True)
    try:
        textures = {texture.name: texture for texture in archive.tree.all_files}
        for number in sorted(remaining):
            names = (f"em6_s{number:02d}_i_eab.png", f"em6_{number:02d}_i_eab.png",
                     f"emblem_{number:02d}w_i_eab.png", f"emblem_{number:02d}_i_eab.png")
            texture = next((textures[name] for name in names if name in textures), None)
            if texture is None:
                continue
            with Image.open(BytesIO(texture.load(crop_to_uvrect=True))) as source:
                icon = source.convert("RGBA")
            bounds = icon.getchannel("A").getbbox()
            if bounds:
                icon = icon.crop(bounds)
            padding = max(1, round(max(icon.size) * .05))
            side = max(icon.size) + 2 * padding
            canvas = Image.new("RGBA", (side, side))
            canvas.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
            canvas.thumbnail((96, 96), Image.Resampling.LANCZOS)
            canvas.save(destination / f"{number}.png", optimize=True)
            remaining.remove(number)
    finally:
        archive.close()
    if not remaining:
        break

if remaining:
    raise SystemExit(f"Missing VF class logos: {sorted(remaining)}")
print("Prepared all 10 original VF class logos.")
