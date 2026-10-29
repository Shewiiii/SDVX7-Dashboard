"""Prepare crew assets locally and publish them only through an explicit R2 upload."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from scripts.audio import read_json, write_json
from scripts.companion import ROOT, resolve_proxy

CACHE = ROOT / ".local/crews"
CONFIG = ROOT / ".local/crew-config.json"
CATALOG = ROOT / "public/game-data/crew-catalog.json"
sys.path.insert(0, str(ROOT / ".local/crew-tools"))


def graphics() -> Path:
    return resolve_proxy().parent / "data/graphics"


def selected_crew() -> int | None:
    raw = read_json(resolve_proxy() / "player-data/server_data.json", {})
    for entry in raw.get("profile_parameters", []):
        if entry.get("type") == 2 and entry.get("id") == 1:
            values = entry.get("param", [])
            if len(values) > 24 and type(values[24]) is int:
                return values[24]
    return None


def prepare_catalog() -> dict[str, Any]:
    from ifstools import IFS

    from scripts.crew_voices import prepare_manifest, voice_for, voices_enabled

    source = graphics()
    catalog = read_json(CATALOG, {})
    enable_voices = voices_enabled()
    icon_root = CACHE / "icons"
    icon_root.mkdir(parents=True, exist_ok=True)
    archive = IFS(str(source / "chara/chara_icon.ifs"))
    try:
        images = {file.name: file for file in archive.tree.all_files}
        crews = []
        for original in catalog.get("crews", []):
            entry = dict(original)
            icon = entry["icon"] + ".png"
            if icon not in images:
                continue
            target = icon_root / icon
            if not target.exists():
                target.write_bytes(images[icon].load())  # Writes to .local/crews/icons/
            entry["icon"] = f"icons/{icon}"
            voice = voice_for(entry) if enable_voices else None
            entry["voice"] = f"voices/{voice}.json" if voice else None
            portrait = source / "crew_icon" / f"{entry.get('portrait', '')}.png"
            artwork = source / "crew_portrait" / f"crew_{entry['id']}_main.png"
            entry["image"] = (
                f"crew_portrait/{artwork.name}" if artwork.is_file() else None
            )
            if entry["type"] != "image" and portrait.is_file():
                entry["image"] = f"portraits/{portrait.name}"
            if entry.get("model") and not (source / entry["model"]).is_file():
                continue
            crews.append(entry)
    finally:
        archive.close()
    result = {"version": 1, "crews": crews, "voices_enabled": enable_voices}
    for voice in (
        ({voice_for(entry) for entry in crews} - {None}) if enable_voices else []
    ):
        prepare_manifest(voice)
    write_json(CACHE / "catalog.json", result)
    return result


def prepare_afp(key: str) -> dict[str, Any]:
    from ifstools import IFS

    catalog = read_json(CATALOG, {})
    entry = next((row for row in catalog["crews"] if row["key"] == key), None)
    if not entry or entry["type"] != "afp":
        raise ValueError("Unknown animated crew")
    cached = CACHE / "afp" / f"{key}.json"
    source = graphics() / entry["archive"]
    signature = [source.stat().st_mtime_ns, source.stat().st_size, 2]
    previous = read_json(cached, {})
    if previous.get("signature") == signature:
        return previous
    tools = ROOT / ".local/crew-tools"
    sys.path.insert(0, str(tools))
    try:
        from sdvx_afp.geo import Shape

        from scripts.crew_afp import CrewMovie, geometry_data
    except ImportError:
        raise RuntimeError(
            "Run optional-setup.bat to install the crew renderer tools."
        ) from None

    archive = IFS(str(source))
    try:
        files = {
            file.full_path.replace("\\", "/"): file for file in archive.tree.all_files
        }
        movies = {}
        shapes = {}
        textures = {}
        texture_root = CACHE / "afp" / key
        texture_root.mkdir(parents=True, exist_ok=True)
        for name, file in files.items():
            if (
                name.startswith("afp/")
                and "/bsi/" not in name
                and not name.endswith(".xml")
            ):
                sidecar = files.get(f"afp/bsi/{file.name}")
                movie = CrewMovie(
                    file.name, file.load(), sidecar.load() if sidecar else b""
                )
                movie.parse()
                movies[movie.exported_name] = movie.as_dict()
            elif name.startswith("geo/"):
                shape = Shape(file.name, geometry_data(file.load()))
                shape.parse()
                shapes[file.name] = shape.as_dict()
            elif name.startswith("tex/") and name.endswith(".png"):
                target = texture_root / file.name
                if not target.exists():
                    target.write_bytes(file.load())
                textures[file.name.removesuffix(".png")] = {
                    "file": f"afp/{key}/{file.name}",
                    "rect": getattr(file, "imgrect", [0, 1, 0, 1]),
                }
        main = next(
            (name for name in ("chara_anime", "crew_pattern_main") if name in movies),
            next(iter(movies)),
        )
        result = {
            "version": 1,
            "signature": signature,
            "main": main,
            "movies": movies,
            "shapes": shapes,
            "textures": textures,
        }
        write_json(cached, result)
        return result
    finally:
        archive.close()


def crew_assets(entry: dict[str, Any]) -> dict[str, Path]:
    from scripts.crew_voices import prepare_all

    source = graphics()
    objects: dict[str, Path] = {entry["icon"]: CACHE / entry["icon"]}
    if entry["type"] == "afp":
        prepare_afp(entry["key"])
        folder = CACHE / "afp" / entry["key"]
        objects[f"afp/{entry['key']}.json"] = folder.with_suffix(".json")
        objects.update(
            (file.relative_to(CACHE).as_posix(), file) for file in folder.rglob("*.png")
        )
    if entry.get("model"):
        model = source / entry["model"]
        refs = read_json(model, {})["FileReferences"]
        paths = [model]
        paths.extend(model.parent / name for name in refs.get("Textures", []))
        paths.extend(
            model.parent / refs[kind]
            for kind in ("Moc", "Physics", "Pose", "DisplayInfo")
            if refs.get(kind)
        )
        paths.extend(
            model.parent / motion["File"]
            for motions in refs.get("Motions", {}).values()
            for motion in motions
        )
        for file in paths:
            if not file.is_file():
                raise ValueError("A required crew model asset is missing")
            objects[file.relative_to(source).as_posix()] = file
    image = entry.get("image")
    if image:
        objects[image] = source / (
            "crew_icon/" + Path(image).name if image.startswith("portraits/") else image
        )
    if entry.get("voice"):
        folder = Path(entry["voice"]).stem
        prepare_all(folder)
        manifest = read_json(CACHE / entry["voice"], {})
        for bank in manifest["banks"]:
            for clip in bank["clips"]:
                if clip.get("silent"):
                    continue
                metadata = CACHE / clip["metadata"]
                record = read_json(metadata, {})
                objects[record["url"]] = CACHE / record["url"]
                objects[clip["metadata"]] = metadata
        objects[entry["voice"]] = CACHE / entry["voice"]
    return objects


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--afp")
    parser.add_argument("--voice", nargs=3, metavar=("FOLDER", "BANK", "INDEX"))
    args = parser.parse_args()
    if args.voice:
        from scripts.crew_voices import prepare_clip

        prepare_clip(args.voice[0], args.voice[1], int(args.voice[2]))
    elif args.afp:
        prepare_afp(args.afp)
    else:
        prepare_catalog()


if __name__ == "__main__":
    main()
