"""Resume optional crew and voice uploads alongside normal dashboard sync."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import time
from pathlib import Path
from threading import Thread
from typing import Any

from scripts.audio import configuration, r2_client, read_json, write_json
from scripts.companion import ROOT
from scripts.crews import (
    CACHE,
    CONFIG,
    crew_assets,
    graphics,
    prepare_catalog,
    selected_crew,
)


def source_signature(config: dict[str, Any]) -> str:
    audio = configuration()
    source = graphics()
    files = [
        ROOT / "public/game-data/crew-catalog.json",
        ROOT / "public/game-data/crew-voices.json",
        ROOT / "scripts/crews.py",
        ROOT / "scripts/crew_voices.py",
    ]
    for folder in ["live2d", "chara", "crew_icon", "crew_portrait"]:
        files.extend(file for file in (source / folder).rglob("*") if file.is_file())
    if config.get("voices_enabled", True):
        files.extend(
            file
            for file in (source.parent / "sound/voice").rglob("*")
            if file.is_file()
        )
    files.extend(file for file in (ROOT / ".local/crew-tools").glob("*.js"))
    stats = [
        (str(file), file.stat().st_size, file.stat().st_mtime_ns)
        for file in sorted(files)
    ]
    settings = [
        3,
        config.get("voices_enabled", True),
        audio["format"],
        audio["bitrate"],
    ]
    return hashlib.sha256(json.dumps([settings, stats]).encode()).hexdigest()


def sync_crews(catalog: Any) -> None:
    config = read_json(CONFIG, {})
    catalog.crew_pending = False
    if config.get("mode") != "r2":
        return
    signature = source_signature(config)
    checkpoint = ROOT / ".local/crew-sync.json"
    state = read_json(checkpoint, {})
    destination = [config["endpoint"], config["bucket"], config["public_url"]]
    if state.get("destination") != destination:
        state = {"destination": destination, "objects": {}}
    if state.get("signature") != signature:
        state.update(
            signature=signature,
            cursor=0,
            ready=[],
            failed=[],
            order=None,
            complete=False,
        )
    if (
        not hasattr(catalog, "crew_assets_catalog")
        or getattr(catalog, "crew_signature", None) != signature
    ):
        catalog.crew_assets_catalog = prepare_catalog()
        catalog.crew_signature = signature
    assets = catalog.crew_assets_catalog
    entries = assets["crews"]
    if not entries:
        return
    if state.get("complete"):
        catalog.crew_pending = False
        return
    if not state.get("order"):
        current = selected_crew()
        state["order"] = [
            entry["key"]
            for entry in sorted(entries, key=lambda entry: entry["id"] != current)
        ]
    positions = {key: index for index, key in enumerate(state["order"])}
    entries.sort(key=lambda entry: positions[entry["key"]])
    cursor = state.get("cursor", 0)
    if cursor >= len(entries):
        state.update(cursor=0, failed=[])
        cursor = 0
    client = r2_client(config)
    inventory = getattr(catalog, "crew_inventory", None)
    if getattr(catalog, "crew_inventory_destination", None) != destination:
        inventory = None
    if inventory is None:
        inventory = {}
        for page in client.get_paginator("list_objects_v2").paginate(
            Bucket=config["bucket"]
        ):
            inventory.update(
                {item["Key"]: item["Size"] for item in page.get("Contents", [])}
            )
        catalog.crew_inventory = inventory
        catalog.crew_inventory_destination = destination
    used = sum(inventory.values())
    audio = configuration()
    limit = int(
        (9 if audio["format"] == "opus" else float(audio.get("storage_limit_gb", 9)))
        * 1e9
    )

    def upload(name: str, file: Path) -> None:
        nonlocal used
        current_config = read_json(CONFIG, {})
        if current_config.get("mode") != "r2" or any(
            current_config.get(field) != config.get(field)
            for field in ("endpoint", "bucket", "public_url", "voices_enabled")
        ):
            raise RuntimeError(
                "Crew sync settings changed, restarting on the next pass"
            )
        key = "crews/" + name
        data = file.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if state["objects"].get(name) == digest and inventory.get(key) == len(data):
            return
        projected = used - inventory.get(key, 0) + len(data)
        if limit and projected > limit:
            raise RuntimeError(
                "Crew assets exceed the audio setup's bucket storage limit"
            )
        client.upload_file(
            str(file),
            config["bucket"],
            key,
            ExtraArgs={
                "ContentType": mimetypes.guess_type(name)[0]
                or "application/octet-stream",
                "CacheControl": "public, max-age=60"
                if name.endswith(".json")
                else "public, max-age=3600",
            },
        )
        inventory[key] = len(data)
        used = projected
        state["objects"][name] = digest
        write_json(checkpoint, state)

    for name in ("pixi.min.js", "cubism4.min.js", "live2dcubismcore.min.js"):
        upload("runtime/" + name, ROOT / ".local/crew-tools" / name)
    entry = entries[cursor]
    try:
        objects = crew_assets(entry)
    except (OSError, ValueError, RuntimeError) as error:
        state.setdefault("failed", []).append(entry["key"])
        print(
            f"Crew {entry['id']} preparation pending ({type(error).__name__}), continuing with other crews.",
            flush=True,
        )
    else:
        for name, file in objects.items():
            upload(name, file)
        if entry["key"] not in state["ready"]:
            state["ready"].append(entry["key"])
        published = {
            **assets,
            "crews": [row for row in entries if row["key"] in state["ready"]],
        }
        path = CACHE / "published-catalog.json"
        write_json(path, published)
        upload("catalog.json", path)
    state["cursor"] = cursor + 1
    if state["cursor"] >= len(entries) and len(state["ready"]) == len(entries):
        state["complete"] = True
    write_json(checkpoint, state)
    catalog.crew_pending = not state.get("complete", False)
    print(f"Crew sync {state['cursor']}/{len(entries)}", flush=True)


def start_crew_sync(catalog: Any) -> None:
    if getattr(catalog, "crew_thread", None) and catalog.crew_thread.is_alive():
        return
    if read_json(CONFIG, {}).get("mode") != "r2":
        catalog.crew_pending = False
        return
    if time.monotonic() < getattr(catalog, "crew_next_sync", 0):
        return

    def work() -> None:
        try:
            for _ in range(4):
                sync_crews(catalog)
                if not catalog.crew_pending:
                    break
            catalog.crew_next_sync = (
                0 if catalog.crew_pending else time.monotonic() + 300
            )
        except Exception as error:  # noqa: BLE001
            catalog.crew_pending = False
            catalog.crew_next_sync = time.monotonic() + 30
            print(
                f"Crew sync pending ({type(error).__name__}). Check optional-setup.bat, other syncing continues.",
                flush=True,
            )

    catalog.crew_pending = True
    catalog.crew_thread = Thread(target=work, name="dashboard-crews", daemon=True)
    catalog.crew_thread.start()
