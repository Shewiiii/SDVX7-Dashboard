"""Resume optional crew and voice uploads alongside normal dashboard sync."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import time
from concurrent.futures import ThreadPoolExecutor
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


def entry_signature(entry: dict[str, Any], config: dict[str, Any]) -> str:
    """Invalidate a prepared crew only when its own inputs change."""
    source = graphics()
    files = [source / "chara/chara_icon.ifs"]
    if entry.get("archive"):
        files.append(source / entry["archive"])
    if entry.get("model"):
        files.extend((source / entry["model"]).parent.rglob("*"))
    image = entry.get("image")
    if image:
        files.append(
            source
            / (
                "crew_icon/" + Path(image).name
                if image.startswith("portraits/")
                else image
            )
        )
    audio = configuration()
    voice = entry.get("voice")
    if voice:
        files.extend((source.parent / "sound/voice" / Path(voice).stem).glob("*"))
        files.append(ROOT / "public/game-data/crew-voices.json")
    stats = []
    for file in sorted(set(files)):
        if file.is_file():
            info = file.stat()
            stats.append((str(file), info.st_size, info.st_mtime_ns))
    scripts = [ROOT / "scripts/crews.py"]
    if entry.get("type") == "afp":
        scripts.append(ROOT / "scripts/crew_afp.py")
    if voice:
        scripts.append(ROOT / "scripts/crew_voices.py")
    code = [
        hashlib.sha256(file.read_bytes()).hexdigest()
        for file in scripts
        if file.is_file()
    ]
    settings = [
        entry,
        config.get("voices_enabled", True) if voice else None,
        audio["format"] if voice else None,
        audio["bitrate"] if voice and audio["format"] == "opus" else None,
    ]
    return hashlib.sha256(json.dumps([settings, stats, code]).encode()).hexdigest()


def prepared_assets(
    entry: dict[str, Any], config: dict[str, Any], state: dict[str, Any]
) -> dict[str, Path]:
    signature = entry_signature(entry, config)
    prepared = state.setdefault("prepared", {})
    previous = prepared.get(entry["key"], {})
    files = previous.get("files", {})
    if previous.get("signature") == signature and files:
        for path, size, modified in files.values():
            file = Path(path)
            if not file.is_file():
                break
            info = file.stat()
            if (info.st_size, info.st_mtime_ns) != (size, modified):
                break
        else:
            return {name: Path(record[0]) for name, record in files.items()}
    objects = crew_assets(entry)
    prepared[entry["key"]] = {
        "signature": signature,
        "files": {
            name: [str(file), file.stat().st_size, file.stat().st_mtime_ns]
            for name, file in objects.items()
        },
    }
    return objects


def sync_crews(catalog: Any) -> None:
    config = read_json(CONFIG, {})
    catalog.crew_pending = False
    if config.get("mode") != "r2":
        return
    # Scan the game folders once per short batch instead of once per crew.
    audio = configuration()
    settings = [config.get("voices_enabled", True), audio["format"], audio["bitrate"]]
    if (
        getattr(catalog, "crew_source_settings", None) != settings
        or time.monotonic() - getattr(catalog, "crew_source_checked_at", 0) >= 2
    ):
        catalog.crew_source_signature = source_signature(config)
        catalog.crew_source_settings = settings
        catalog.crew_source_checked_at = time.monotonic()
    signature = catalog.crew_source_signature
    checkpoint = ROOT / ".local/crew-sync.json"
    state = read_json(checkpoint, {})
    destination = [config["endpoint"], config["bucket"], config["public_url"]]
    if state.get("destination") != destination:
        state = {"destination": destination, "objects": {}}
    changed = state.get("signature") != signature
    ready = set(state.get("ready", []))
    if changed:
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
    if changed:
        # Retain completed crews whose own inputs are unchanged.
        prepared = state.get("prepared", {})
        state["ready"] = [
            entry["key"]
            for entry in entries
            if prepared.get(entry["key"], {}).get("signature")
            == entry_signature(entry, config)
            and entry["key"] in ready
        ]
    if not state.get("order"):
        current = selected_crew()
        state["order"] = [
            entry["key"]
            for entry in sorted(entries, key=lambda entry: entry["id"] != current)
        ]
    positions = {key: index for index, key in enumerate(state["order"])}
    entries = sorted(entries, key=lambda entry: positions[entry["key"]])
    cursor = state.get("cursor", 0)
    if cursor >= len(entries):
        state.update(cursor=0, failed=[])
        cursor = 0
    while cursor < len(entries) and entries[cursor]["key"] in state["ready"]:
        cursor += 1
    if getattr(catalog, "crew_client_config", None) != config:
        catalog.crew_client = r2_client(config)
        catalog.crew_client_config = dict(config)
    client = catalog.crew_client
    inventory = getattr(catalog, "crew_inventory", None)
    if (
        getattr(catalog, "crew_inventory_destination", None) != destination
        or time.monotonic() - getattr(catalog, "crew_inventory_at", 0) >= 30
    ):
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
        catalog.crew_inventory_at = time.monotonic()
    used = sum(inventory.values())
    limit = int(
        (9 if audio["format"] == "opus" else float(audio.get("storage_limit_gb", 9)))
        * 1e9
    )

    uploaded = 0

    def check_settings() -> None:
        current_config = read_json(CONFIG, {})
        if current_config.get("mode") != "r2" or any(
            current_config.get(field) != config.get(field)
            for field in ("endpoint", "bucket", "public_url", "voices_enabled")
        ):
            raise RuntimeError(
                "Crew sync settings changed, restarting on the next pass"
            )

    def send(item: tuple[str, Path, str, int]) -> tuple[str, Path, str, int]:
        name, file, _, _ = item
        check_settings()
        client.upload_file(
            str(file),
            config["bucket"],
            "crews/" + name,
            ExtraArgs={
                "ContentType": mimetypes.guess_type(name)[0]
                or "application/octet-stream",
                "CacheControl": "public, max-age=60"
                if name.endswith(".json")
                else "public, max-age=3600",
            },
        )
        return item

    def upload(objects: dict[str, Path]) -> None:
        nonlocal used, uploaded
        check_settings()
        pending = []
        fingerprints = state.setdefault("fingerprints", {})
        for name, file in objects.items():
            key = "crews/" + name
            info = file.stat()
            stamp = [str(file), info.st_size, info.st_mtime_ns]
            previous = fingerprints.get(name, {})
            if previous.get("stamp") == stamp:
                digest = previous["digest"]
            else:
                hasher = hashlib.sha256()
                with file.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        hasher.update(chunk)
                digest = hasher.hexdigest()
                fingerprints[name] = {"stamp": stamp, "digest": digest}
            if (
                state["objects"].get(name) == digest
                and inventory.get(key) == info.st_size
            ):
                continue
            projected = used - inventory.get(key, 0) + info.st_size
            if limit and projected > limit:
                raise RuntimeError(
                    "Crew assets exceed the audio setup's bucket storage limit"
                )
            used = projected
            pending.append((name, file, digest, info.st_size))
        if not pending:
            return
        # Save at most once a second, and always save successful files on failure.
        saved_at = time.monotonic()
        try:
            with ThreadPoolExecutor(max_workers=4) as workers:
                # Upload media before JSON files that can reference the new media.
                phases = [
                    [item for item in pending if not item[0].endswith(".json")],
                    [item for item in pending if item[0].endswith(".json")],
                ]
                for phase in phases:
                    for offset in range(0, len(phase), 4):
                        futures = [
                            workers.submit(send, item)
                            for item in phase[offset : offset + 4]
                        ]
                        errors = []
                        for future in futures:
                            try:
                                name, _, digest, size = future.result()
                            except Exception as error:  # noqa: BLE001
                                errors.append(error)
                            else:
                                inventory["crews/" + name] = size
                                state["objects"][name] = digest
                                uploaded += 1
                        if errors:
                            raise errors[0]
                        if time.monotonic() - saved_at >= 1:
                            write_json(checkpoint, state)
                            saved_at = time.monotonic()
        finally:
            write_json(checkpoint, state)

    def publish(ready: set[str]) -> None:
        published = {
            **assets,
            "crews": [row for row in entries if row["key"] in ready],
        }
        path = CACHE / "published-catalog.json"
        write_json(path, published)
        upload({"catalog.json": path})
        state["ready"] = [row["key"] for row in entries if row["key"] in ready]

    from scripts.crew_setup import RUNTIMES, download

    runtime_dir = ROOT / ".local/crew-tools"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    runtimes = {}
    for name, url in RUNTIMES.items():
        target = runtime_dir / name
        if not target.is_file():
            print(f"Downloading missing crew runtime {name}...", flush=True)
            download(url, target)
        runtimes["runtime/" + name] = target
    upload(runtimes)
    if cursor == len(entries):
        publish(set(state["ready"]))
        state.update(cursor=cursor, complete=True)
        write_json(checkpoint, state)
        return
    entry = entries[cursor]
    try:
        objects = prepared_assets(entry, config, state)
    except (OSError, ValueError, RuntimeError) as error:
        state.setdefault("failed", []).append(entry["key"])
        print(
            f"Crew {entry['id']} preparation pending ({type(error).__name__}), continuing with other crews.",
            flush=True,
        )
    else:
        upload(objects)
        publish(set(state["ready"]) | {entry["key"]})
    state["cursor"] = cursor + 1
    if state["cursor"] >= len(entries) and len(state["ready"]) == len(entries):
        state["complete"] = True
    elif state["cursor"] >= len(entries):
        catalog.crew_next_sync = time.monotonic() + 30
    write_json(checkpoint, state)
    catalog.crew_pending = not state.get("complete", False)
    print(
        f"Crew sync {len(state['ready'])}/{len(entries)} ready ({uploaded} files uploaded)",
        flush=True,
    )


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
            while True:
                sync_crews(catalog)
                if not catalog.crew_pending or time.monotonic() < getattr(
                    catalog, "crew_next_sync", 0
                ):
                    break
            if not catalog.crew_pending:
                catalog.crew_next_sync = time.monotonic() + 300
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
