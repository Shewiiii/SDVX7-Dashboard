"""Prepare registered crew voice banks and browser audio locally."""

from __future__ import annotations

import hashlib
import re
import struct
import sys
import tempfile
from array import array
from pathlib import Path
from typing import Any

from scripts.audio import (
    command,
    configuration,
    encoding_args,
    read_json,
    tools,
    write_json,
)
from scripts.companion import ROOT, resolve_proxy

CACHE = ROOT / ".local/crews/voices"
MAPPING = ROOT / "public/game-data/crew-voices.json"


def voices_enabled() -> bool:
    return (
        read_json(ROOT / ".local/crew-config.json", {}).get("voices_enabled", True)
        is True
    )


CATEGORIES = {
    "01_title": "Title",
    "02_entry": "Entry",
    "03_modeselect": "Mode selection",
    "04_customize": "Customization",
    "05_valgene": "Valkyrie Generator",
    "06_tutorial": "Tutorial",
    "07_musicselect": "Music selection",
    "08_matching": "Matching",
    "09_comp": "Completion",
    "10_result": "Results",
    "11_totalresult": "Total results",
    "12_end": "Ending",
    "13_system": "System",
    "14_megamix": "Megamix",
    "15_arena": "Arena",
}


def registrations() -> list[dict[str, Any]]:
    return read_json(MAPPING, {})["registrations"]


def voice_for(entry: dict[str, Any]) -> str | None:
    rows = [row for row in registrations() if row["crew_id"] == entry["id"]]
    variant = int(entry["key"].split("-")[1])
    match = next((row for row in rows if row["variant"] == variant), None)
    if match:
        return match["folder"]
    folders = {row["folder"] for row in rows}
    return next(iter(folders)) if len(folders) == 1 else None


def bank_path(folder: str, bank: str) -> Path:
    row = next((row for row in registrations() if row["folder"] == folder), None)
    if not row or not re.fullmatch(re.escape(row["prefix"]) + r"_\d{2}_[a-z]+", bank):
        raise ValueError("Unknown crew voice bank")
    return resolve_proxy().parent / "data/sound/voice" / folder / (bank + ".s3p")


def sample_at(raw: bytes, index: int) -> bytes:
    if len(raw) < 8 or raw[:4] != b"S3P0":
        raise ValueError("Invalid crew voice bank")
    count = struct.unpack_from("<I", raw, 4)[0]
    if not 0 <= index < count or len(raw) < 8 + count * 8:
        raise ValueError("Invalid voice index")
    offset, length = struct.unpack_from("<II", raw, 8 + index * 8)
    sample = raw[offset : offset + length]
    if len(sample) != length or len(sample) < 24 or sample[:4] != b"S3V0":
        raise ValueError("Invalid crew voice sample")
    header = struct.unpack_from("<I", sample, 4)[0]
    if not 24 <= header < length:
        raise ValueError("Invalid crew voice header")
    return sample[header:]


def audio_fingerprint(sample: bytes) -> str | None:
    # Standard ASF Data Object identifier, marking the encoded WMA audio packets.
    data_guid = bytes.fromhex("3626b2758e66cf11a6d900aa0062ce6c")
    offset = sample.find(data_guid)
    if offset < 0 or offset + 50 > len(sample):
        return None
    size = struct.unpack_from("<Q", sample, offset + 16)[0]
    if size < 50 or offset + size > len(sample):
        return None
    # Skip the 50-byte object header and exclude trailing objects such as indexes.
    # File IDs can differ even when the encoded audio packets are identical.
    return hashlib.sha256(sample[offset + 50 : offset + size]).hexdigest()


def prepare_manifest(folder: str) -> dict[str, Any]:
    row = next(row for row in registrations() if row["folder"] == folder)
    directory = resolve_proxy().parent / "data/sound/voice" / folder
    banks = []
    # These packet fingerprints were verified by decoding to all-zero PCM samples.
    # Matching them avoids decoding every clip again, unknown silence stays enabled.
    silent_packets = set(read_json(MAPPING, {}).get("silent_packets", []))
    silent_count = 0
    for source in sorted(directory.glob(row["prefix"] + "_*.s3p")):
        labels = re.findall(
            r"^#define\s+(\w+)\s+(\d+)\s*$",
            source.with_suffix(".def").read_text(encoding="ascii"),
            re.MULTILINE,
        )
        raw = source.read_bytes()
        count = struct.unpack_from("<I", raw, 4)[0]
        clips = []
        for label, index in labels:
            if not 0 <= int(index) < count:
                continue
            silent = audio_fingerprint(sample_at(raw, int(index))) in silent_packets
            if silent:
                silent_count += 1
            clips.append(
                {
                    "label": label,
                    "silent": silent,
                    "metadata": f"voices/{folder}/{source.stem}-{int(index)}.json",
                }
            )
        category = source.stem[len(row["prefix"]) + 1 :]
        if clips:
            banks.append({"label": CATEGORIES.get(category, category), "clips": clips})
    result = {"banks": banks, "silent_samples": silent_count}
    target = CACHE / (folder + ".json")
    if read_json(target, {}) != result:
        write_json(target, result)
    return result


def prepare_clip(folder: str, bank: str, index: int) -> dict[str, Any]:
    if not voices_enabled():
        raise ValueError("Crew voice bank is disabled")
    source = bank_path(folder, bank)
    info = source.stat()
    config = configuration()
    codec = config["format"]
    bitrate = int(config["bitrate"]) if codec == "opus" else None
    signature = [info.st_size, info.st_mtime_ns, 3, codec, bitrate]
    manifest = CACHE / folder / f"{bank}-{index}.json"
    saved = read_json(manifest, {})
    if saved.get("signature") == signature and (CACHE.parent / saved["url"]).is_file():
        return saved
    sample = sample_at(source.read_bytes(), index)
    ffmpeg, _ = tools(config)
    directory = CACHE / folder
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        input_file = Path(temporary) / "voice.asf"
        output = Path(temporary) / ("voice." + codec)
        input_file.write_bytes(sample)
        command(
            [
                ffmpeg,
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(input_file),
                "-map",
                "0:a:0",
                "-vn",
                "-map_metadata",
                "-1",
            ]
            + encoding_args(config)
            + [str(output)]
        )
        pcm = array(
            "h",
            command(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-nostdin",
                    "-i",
                    str(output),
                    "-ac",
                    "1",
                    "-ar",
                    "8000",
                    "-f",
                    "s16le",
                    "pipe:1",
                ]
            ),
        )
        if sys.byteorder != "little":
            pcm.byteswap()
        if not pcm:
            raise ValueError("Empty crew voice")
        peaks = [
            max(
                (abs(v) for v in pcm[i * len(pcm) // 128 : (i + 1) * len(pcm) // 128]),
                default=0,
            )
            for i in range(128)
        ]
        maximum = max(1, *peaks)
        name = hashlib.sha256(output.read_bytes()).hexdigest() + "." + codec
        target = directory / name
        if not target.exists():
            output.replace(target)
    result = {
        "signature": signature,
        "url": f"voices/{folder}/{name}",
        "format": codec,
        "bitrate": bitrate,
        "duration": len(pcm) / 8000,
        "start": 0,
        "chart_offset": 0,
        "variant": "full",
        "peaks": [round(value / maximum * 255) for value in peaks],
    }
    write_json(manifest, result)
    return result


def prepare_all(folder: str) -> None:
    manifest = prepare_manifest(folder)
    for bank in manifest["banks"]:
        for clip in bank["clips"]:
            if clip.get("silent"):
                continue
            name = Path(clip["metadata"]).stem
            bank_name, index = name.rsplit("-", 1)
            prepare_clip(folder, bank_name, int(index))
