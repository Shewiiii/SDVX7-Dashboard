"""Build small Dan nameplates from original game panels and its Mincho font."""

from io import BytesIO
from pathlib import Path

from ifstools import IFS
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT.parent.parent
TITLES = (
    "岳翔",
    "流星",
    "月衝",
    "瞬光",
    "天極",
    "烈風",
    "雷電",
    "麗華",
    "魔騎士",
    "剛力羅",
    "或帝滅斗",
    "暴龍天",
)
INK = (
    (85, 54, 30),
    (47, 52, 106),
    (108, 82, 23),
    (100, 100, 108),
    (17, 88, 103),
    (13, 101, 78),
    (116, 26, 57),
    (122, 45, 97),
    (75, 75, 87),
    (113, 93, 34),
    (255, 231, 128),
    (255, 231, 128),
)


def main():
    destination = ROOT / "public/assets/dan"
    destination.mkdir(parents=True, exist_ok=True)
    archive = IFS(str(GAME / "data/graphics/ver06/psd_skill.ifs"), super_disable=True)
    try:
        textures = {texture.name: texture for texture in archive.tree.all_files}
        for level, title in enumerate(TITLES, 1):
            texture = textures[f"skill_back_panel_{level:02d}.png"]
            with Image.open(BytesIO(texture.load(crop_to_uvrect=True))) as source:
                banner = source.convert("RGBA")
            font_path = str(GAME / "data/graphics/font/0004")
            font = ImageFont.truetype(font_path, 40)
            bounds = font.getbbox(title)
            ink_width, ink_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
            if ink_width > 168:
                font = ImageFont.truetype(font_path, int(40 * 168 / ink_width))
                bounds = font.getbbox(title)
                ink_width, ink_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
            mask = Image.new("L", banner.size)
            ImageDraw.Draw(mask).text(
                (
                    50 + (172 - ink_width) / 2 - bounds[0],
                    (banner.height - ink_height) / 2 - bounds[1],
                ),
                title,
                font=font,
                fill=255,
            )
            lettering = Image.new("RGBA", banner.size, INK[level - 1] + (255,))
            lettering.putalpha(mask)
            banner.alpha_composite(lettering)
            banner.save(destination / f"{level}.png", optimize=True)
    finally:
        archive.close()
    print("Prepared 12 Dan banners from original game panels and font.")


if __name__ == "__main__":
    main()
