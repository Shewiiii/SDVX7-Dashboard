"""Cache JPEG jackets and optionally publish them to R2"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import time
from io import BytesIO
from pathlib import Path
from threading import Thread
from typing import Any

from scripts.audio import configuration as audio_configuration
from scripts.audio import r2_client, read_json, write_json
from scripts.companion import ROOT
from scripts.music import JACKET_INDICES

CONFIG = ROOT / ".local/jacket-config.json"
CACHE = ROOT / ".local/jackets"
JPEG_ENCODING = {"quality": 90, "subsampling": 0, "optimize": True}


def encode_jacket(source: Path) -> bytes:
    from PIL import Image

    with Image.open(source) as image:
        output = BytesIO()
        image.convert("RGB").save(output, "JPEG", **JPEG_ENCODING)
        return output.getvalue()


def configuration() -> dict[str, Any]:
    config = read_json(CONFIG, {"mode": "off"})
    if config.get("mode") not in ("off", "local", "r2"):
        raise ValueError("Invalid jacket configuration. Run optional-setup.bat")
    return config


class JacketLibrary:
    def __init__(self, game: Path) -> None:
        self.game = game
        self.index: dict[tuple[int, int], list[Path]] = {}
        self.scanned_at = 0.0
        self.fingerprints = read_json(ROOT / ".local/jacket-map.json", {})

    def refresh(self) -> None:
        if time.monotonic() - self.scanned_at < 60:
            return
        index: dict[tuple[int, int], list[Path]] = {}
        for root in (self.game / "data_mods/ryunet_custom", self.game / "data"):
            for kind in ("music", "graphics"):
                for path in sorted((root / kind).rglob("jk_*_b.png")):
                    if kind == "graphics" and not any(
                        "jacket" in part and part.endswith("_ifs")
                        for part in path.parts
                    ):
                        continue
                    match = re.fullmatch(r"jk_(\d+)_(\d+)_b\.png", path.name)
                    if match:
                        key = int(match[1]), int(match[2])
                        index.setdefault(key, []).append(path)
        self.index = index
        self.scanned_at = time.monotonic()

    def get(self, mid: int, diff: int) -> dict[str, Any] | None:
        self.refresh()
        candidates = [
            path
            for index in JACKET_INDICES[diff]
            for path in self.index.get((mid, index), [])
        ]
        if not candidates:
            candidates = [
                path
                for (song_id, _), paths in sorted(self.index.items())
                if song_id == mid
                for path in paths
            ]
        for source in candidates:
            try:
                info = source.stat()
                stamp = [info.st_size, info.st_mtime_ns]
                previous = self.fingerprints.get(str(source), {})
                unchanged = previous.get("stamp", [])[:2] == stamp
                digest = previous.get("id") if unchanged else None
                target = CACHE / f"{digest}.jpg"
                if not digest or not target.is_file():
                    data = encode_jacket(source)
                    # Base new keys on the source so encoding changes keep the same URL
                    digest = digest or hashlib.sha256(source.read_bytes()).hexdigest()
                    target = CACHE / f"{digest}.jpg"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.is_file():
                        with tempfile.NamedTemporaryFile(
                            dir=target.parent, suffix=".tmp", delete=False
                        ) as stream:
                            temporary = Path(stream.name)
                            stream.write(data)
                        try:
                            temporary.replace(target)
                        finally:
                            temporary.unlink(missing_ok=True)
                    self.fingerprints[str(source)] = {"stamp": stamp, "id": digest}
                return {"id": digest, "path": target, "size": target.stat().st_size}
            except FileNotFoundError:
                continue
        return None

    def save(self) -> None:
        write_json(ROOT / ".local/jacket-map.json", self.fingerprints)


def sync_jackets(catalog: Any) -> None:
    config = configuration()
    if config["mode"] != "r2":
        return
    library = JacketLibrary(catalog.game)
    records = {}
    objects = {}
    for mid, song in list(catalog.songs.items()):
        for chart in song["difficulties"]:
            diff = chart["diff_idx"]
            record = library.get(mid, diff)
            if record:
                records[f"{mid}:{diff}"] = record["id"]
                objects[record["id"]] = record
    library.save()
    client = r2_client(config)
    inventory = {}
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=config["bucket"]
    ):
        inventory.update(
            {item["Key"]: item["Size"] for item in page.get("Contents", [])}
        )
    audio = audio_configuration()
    limit = int(float(audio.get("storage_limit_gb", 9.5)) * 1e9)
    used = sum(inventory.values())
    ready = {
        digest
        for digest, record in objects.items()
        if f"jackets/{digest}.jpg" in inventory
    }

    def check_settings() -> None:
        if configuration() != config:
            raise RuntimeError("Jacket settings changed, retrying on the next sync")

    def publish() -> None:
        check_settings()
        document = {
            "jackets": {key: value for key, value in records.items() if value in ready}
        }
        client.put_object(
            Bucket=config["bucket"],
            Key="jackets/catalog.json",
            Body=json.dumps(document, separators=(",", ":")).encode(),
            ContentType="application/json",
            CacheControl="public, max-age=60",
        )

    publish()
    uploaded = 0
    try:
        for digest, record in objects.items():
            if digest in ready:
                continue
            check_settings()
            projected = (
                used - inventory.get(f"jackets/{digest}.jpg", 0) + record["size"]
            )
            if limit and projected > limit:
                raise RuntimeError(
                    "High quality jackets exceed the audio setup's bucket storage limit"
                )
            client.upload_file(
                str(record["path"]),
                config["bucket"],
                f"jackets/{digest}.jpg",
                ExtraArgs={
                    "ContentType": "image/jpeg",
                    "CacheControl": "public, max-age=31536000, immutable",
                },
            )
            used = projected
            ready.add(digest)
            uploaded += 1
            if uploaded % 32 == 0:
                publish()
                print(
                    f"High quality jackets: {len(ready)}/{len(objects)} ready",
                    flush=True,
                )
    finally:
        publish()
    print(
        f"High quality jackets: {len(ready)}/{len(objects)} ready ({uploaded} uploaded)",
        flush=True,
    )


def start_jacket_sync(catalog: Any) -> None:
    thread = getattr(catalog, "jacket_thread", None)
    if thread and thread.is_alive():
        return
    if configuration()["mode"] != "r2":
        return
    if time.monotonic() < getattr(catalog, "jacket_next_sync", 0):
        return

    def work() -> None:
        try:
            sync_jackets(catalog)
            catalog.jacket_next_sync = time.monotonic() + 300
        except Exception as error:  # noqa: BLE001
            catalog.jacket_next_sync = time.monotonic() + 30
            print(
                f"High quality jacket sync pending ({type(error).__name__}). Check optional-setup.bat, other syncing continues",
                flush=True,
            )

    catalog.jacket_thread = Thread(target=work, name="dashboard-jackets", daemon=True)
    catalog.jacket_thread.start()
