"""Match and delete selected dashboard assets from the saved R2 bucket"""

from __future__ import annotations

import re

from scripts.audio import r2_client
from scripts.audio_setup import prompt, saved_r2

CATEGORIES = (
    ("Opus files", "Delete Opus files", re.compile(r"audio/[a-f0-9]{64}\.opus")),
    ("FLAC files", "Delete FLAC files", re.compile(r"audio/[a-f0-9]{64}\.flac")),
    ("NemSys Crew files", "Delete crew files", re.compile(r"crews/.+")),
    (
        "jacket PNGs",
        "Delete jacket PNG files",
        re.compile(r"jackets/[a-f0-9]{64}\.png"),
    ),
    (
        "jacket JPGs",
        "Delete jacket JPG files",
        re.compile(r"jackets/[a-f0-9]{64}\.jpg"),
    ),
)


def main() -> None:
    config = saved_r2()
    if config is None:
        raise ValueError("Configure Cloudflare R2 through an optional feature first.")
    print("Make sure to close the companion so deleted data not re-uploaded.")
    print("Creating R2 client...")
    client = r2_client(config)
    print("Indexing data...")
    matches: list[list[tuple[str, int]]] = [[] for _ in CATEGORIES]
    for i, page in enumerate(
        client.get_paginator("list_objects_v2").paginate(Bucket=config["bucket"]),
        start=1,
    ):
        print(f"\rRead page: {i}", end="", flush=True)
        for item in page.get("Contents", []):
            key = item["Key"]
            for index, (_, _, pattern) in enumerate(CATEGORIES):
                if pattern.fullmatch(key):
                    matches[index].append((key, item["Size"]))
                    break
    print()

    print(f"Bucket: {config['bucket']}")
    for (label, _, _), objects in zip(CATEGORIES, matches, strict=True):
        size = sum(size for _, size in objects)
        print(f"Matched {len(objects)} {label} ({size / 1e9:.3f} GB)")
    for index, (_, action, _) in enumerate(CATEGORIES, 1):
        print(f"{index}. {action}")
    choice = prompt("Data", "1")
    if choice not in ("1", "2", "3", "4", "5"):
        raise ValueError("Choose 1, 2, 3, 4, or 5.")
    index = int(choice) - 1
    selected = matches[index]
    label = CATEGORIES[index][0]
    if not selected:
        print(f"No {label} to delete.")
        return
    confirm = prompt("Confirm ? [Y/n]").lower()
    if confirm in ("n", "no"):
        print("Deletion cancelled.")
        return
    if confirm not in ("", "y", "yes"):
        raise ValueError("Choose Y or n.")

    deleted = 0
    for start in range(0, len(selected), 1000):
        batch = selected[start : start + 1000]
        result = client.delete_objects(
            Bucket=config["bucket"],
            Delete={"Objects": [{"Key": key} for key, _ in batch], "Quiet": True},
        )
        errors = result.get("Errors", [])
        deleted += len(batch) - len(errors)
        if errors:
            raise RuntimeError(
                f"Deleted {deleted} {label}, but {len(errors)} files could not be deleted."
            )
    print(f"Deleted {deleted} {label}.")
