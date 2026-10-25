from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from array import array
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Thread
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlparse

from scripts.companion import ROOT, resolve_proxy

if TYPE_CHECKING:
    from scripts.chart_details import ChartDetails
    from scripts.sync import Catalog

SCHEMA = 5
PEAKS = 128
BUDGET_BYTES = 9_000_000_000
CONFIG = ROOT / ".local/audio-config.json"


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def configuration() -> dict[str, Any]:
    config = read_json(CONFIG, {"mode": "local", "variant": "full"})
    if config.get("mode") not in ("off", "local", "r2") or config.get(
        "variant", "full"
    ) not in ("full", "preview"):
        raise ValueError("Invalid audio configuration. Run setup-audio.bat.")
    config.setdefault("format", "opus")
    if config["format"] not in ("opus", "flac"):
        raise ValueError("Audio format must be opus or flac")
    config.setdefault("bitrate", 256)
    return config


def tools(config: dict[str, Any]) -> tuple[str, str]:
    ffmpeg = config.get("ffmpeg") or shutil.which("ffmpeg")
    ffprobe = config.get("ffprobe") or (
        str(
            Path(ffmpeg).with_name(
                "ffprobe.exe" if sys.platform == "win32" else "ffprobe"
            )
        )
        if ffmpeg
        else None
    )
    if (
        not ffmpeg
        or not ffprobe
        or not Path(ffmpeg).is_file()
        or not Path(ffprobe).is_file()
    ):
        raise RuntimeError(
            "Audio needs FFmpeg and ffprobe. Run setup-audio.bat to select them."
        )
    return ffmpeg, ffprobe


def command(args: Sequence[str | Path]) -> bytes:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            timeout=180,
            **(
                {"creationflags": subprocess.CREATE_NO_WINDOW}
                if sys.platform == "win32"
                else {}
            ),
        ).stdout
    except subprocess.CalledProcessError:
        raise RuntimeError(
            "Audio conversion failed; the source format may be unsupported."
        ) from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("Audio conversion timed out.") from None


def extract_2dx(raw: bytes) -> bytes:
    """Read standard 2DX9 entries, retaining the first complete RIFF/WAVE stream."""
    if len(raw) < 76:
        raise ValueError("Truncated 2DX audio")
    count = struct.unpack_from("<I", raw, 20)[0]
    if not 1 <= count <= 1024 or 72 + count * 4 > len(raw):
        raise ValueError("Unsupported 2DX header")
    for i in range(count):
        offset = struct.unpack_from("<I", raw, 72 + i * 4)[0]
        if offset + 24 > len(raw) or raw[offset : offset + 4] != b"2DX9":
            continue
        header, length = struct.unpack_from("<II", raw, offset + 4)
        start = offset + header
        if (
            header >= 24
            and start + length <= len(raw)
            and raw[start : start + 4] == b"RIFF"
            and raw[start + 8 : start + 12] == b"WAVE"
        ):
            return raw[start : start + length]
    raise ValueError("No supported WAV stream in 2DX audio")


class AudioLibrary:
    def __init__(
        self, details: ChartDetails, config: dict[str, Any] | None = None
    ) -> None:
        self.details = details
        self.config = config if config is not None else configuration()
        self.directory = ROOT / ".local/audio"
        self.cache_path = ROOT / ".local/audio-cache.json"
        self.cache = read_json(self.cache_path, {})
        self.sources = {}
        self.folders = None
        self.folder_files = {}
        self.failures = {}
        self.details.refresh()
        self.signatures = self.details.signatures
        if config is None and self.config.get("format", "opus") == "opus":
            self.config["bitrate"] = plan_audio(self)["bitrate"]

    def source(self, mid: int, diff: int) -> Path | None:
        chart = self.details.files.get(f"{mid}:{diff}")
        prefix = (
            re.sub(r"_[1-6][a-z]$", "", chart.stem, flags=re.IGNORECASE)
            if chart
            else ""
        )
        key = (mid, prefix, str(chart.parent) if chart else "")
        if key in self.sources:
            return self.sources[key]
        if self.folders is None:
            self.folders = {}
            for root in (self.details.music.custom_root, self.details.music.base_root):
                for folder in sorted((root / "music").glob("*")):
                    match = re.match(r"^(\d+)(?:_|$)", folder.name)
                    if match and folder.is_dir():
                        self.folders.setdefault(int(match[1]), []).append(folder)
        folders = list(self.folders.get(mid, []))
        # Prefer the directory of this chart, including charts using an older
        # original track when another difficulty has a custom replacement.
        if chart:
            folders = [chart.parent] + [p for p in folders if p != chart.parent]
        for folder in folders:
            if folder not in self.folder_files:
                self.folder_files[folder] = [
                    p
                    for p in folder.iterdir()
                    if p.suffix.lower() in (".s3v", ".2dx", ".flac")
                    and not p.stem.lower().endswith("_pre")
                ]
            candidates = sorted(
                self.folder_files[folder],
                key=lambda p: (p.stem != prefix, len(p.stem), p.name),
            )
            if candidates:
                self.sources[key] = candidates[0]
                return candidates[0]
        self.sources[key] = None
        return None

    def get(self, mid: int, diff: int, prepare: bool = True) -> dict[str, Any] | None:
        if self.config.get("mode") == "off":
            return None
        source = self.source(mid, diff)
        if source is None:
            return None
        stat = source.stat()
        signature = [
            SCHEMA,
            str(source),
            stat.st_size,
            stat.st_mtime_ns,
            self.config.get("variant", "full"),
            self.config.get("format", "opus"),
            int(self.config.get("bitrate", 256))
            if self.config.get("format", "opus") == "opus"
            else None,
        ]
        key = hashlib.sha256(json.dumps(signature).encode()).hexdigest()
        # Individual atomic sidecars avoid losing cache entries when preview
        # requests and the background uploader prepare different tracks together.
        entry_path = self.directory / (key + ".json")
        saved = self.cache.get(key) or read_json(entry_path, None)
        if (
            not saved
            or not (
                self.directory / (saved["id"] + "." + self.config.get("format", "opus"))
            ).is_file()
        ):
            if not prepare:
                return None
            saved = self.convert(source)
            write_json(entry_path, saved)
        self.cache[key] = saved
        offset = float(
            self.config.get("offsets", {}).get(
                f"{mid}:{diff}", self.config.get("chart_offset", 0)
            )
        )
        if not math.isfinite(offset) or abs(offset) > 600:
            raise ValueError("Audio chart offset must be between -600 and 600 seconds")
        return {**saved, "music_id": mid, "diff_idx": diff, "chart_offset": offset}

    def convert(self, source: Path) -> dict[str, Any]:
        ffmpeg, ffprobe = tools(self.config)
        self.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            dir=self.directory, prefix="convert-"
        ) as temporary:
            temporary = Path(temporary)
            input_file = source
            if source.suffix.lower() == ".2dx":
                input_file = temporary / "source.wav"
                input_file.write_bytes(extract_2dx(source.read_bytes()))
            duration = float(
                command(
                    [
                        ffprobe,
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                        str(input_file),
                    ]
                )
            )
            if not math.isfinite(duration) or not 0 < duration <= 7200:
                raise ValueError("Invalid audio duration")
            variant = self.config.get("variant", "full")
            start = (
                max(0, min(duration - 20, duration * 0.4))
                if variant == "preview"
                else 0
            )
            codec = self.config.get("format", "opus")
            output = temporary / ("track." + codec)
            args = [
                ffmpeg,
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(input_file),
                "-ss",
                str(start),
            ]
            if variant == "preview":
                args += ["-t", "20"]
            encoder = (
                ["-c:a", "flac", "-compression_level", "5"]
                if codec == "flac"
                else [
                    "-c:a",
                    "libopus",
                    "-b:a",
                    f"{int(self.config.get('bitrate', 256))}k",
                    "-vbr",
                    "constrained",
                    "-compression_level",
                    "10",
                    "-application",
                    "audio",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                ]
            )
            command(
                args
                + ["-map", "0:a:0", "-vn", "-map_metadata", "-1"]
                + encoder
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
                raise ValueError("Empty audio")
            duration = len(pcm) / 8000
            peaks = [
                max(
                    (
                        abs(v)
                        for v in pcm[
                            i * len(pcm) // PEAKS : (i + 1) * len(pcm) // PEAKS
                        ]
                    ),
                    default=0,
                )
                for i in range(PEAKS)
            ]
            maximum = max(1, *peaks)
            peaks = [round(value / maximum * 255) for value in peaks]
            digest = hashlib.sha256(output.read_bytes()).hexdigest()
            target = self.directory / (digest + "." + codec)
            if not target.exists():
                output.replace(target)
            print(
                f"Prepared {variant} audio: {source.stem} ({duration:.1f}s, {target.stat().st_size // 1024} KB)",
                file=sys.stderr,
                flush=True,
            )
            return {
                "id": digest,
                "format": codec,
                "bitrate": int(self.config.get("bitrate", 256))
                if codec == "opus"
                else None,
                "duration": round(duration, 3),
                "start": round(start, 3),
                "variant": variant,
                "peaks": peaks,
            }


def preview(mid: int, diff: int) -> None:
    from scripts.sync import Catalog

    library = AudioLibrary(Catalog(resolve_proxy()).details)
    record = library.get(mid, diff)
    if record:
        record["url"] = (
            "/api/audio-file?id=" + record["id"] + "&format=" + record["format"]
        )
        record["chart_url"] = f"/api/chart-view?music={mid}&diff={diff}&effects=1"
    print(json.dumps(record))


def plan_audio(library: AudioLibrary) -> dict[str, Any]:
    """Budget unique tracks, caching probes by source size and modification time."""
    sources = {
        library.source(*map(int, key.split(":"))) for key in library.details.metadata
    }
    sources.discard(None)
    path = ROOT / ".local/audio-plan.json"
    saved = read_json(path, {})
    previous = {row["path"]: row for row in saved.get("sources", [])}
    probe = tools(library.config)[1]

    def measure(source: Path) -> dict[str, Any]:
        info = source.stat()
        old = previous.get(str(source))
        if old and old["size"] == info.st_size and old["mtime"] == info.st_mtime_ns:
            return old
        try:
            with tempfile.TemporaryDirectory() as folder:
                target = source
                if source.suffix.lower() == ".2dx":
                    target = Path(folder) / "source.wav"
                    target.write_bytes(extract_2dx(source.read_bytes()))
                seconds = float(
                    command(
                        [
                            probe,
                            "-v",
                            "error",
                            "-show_entries",
                            "format=duration",
                            "-of",
                            "default=noprint_wrappers=1:nokey=1",
                            str(target),
                        ]
                    )
                )
                if not math.isfinite(seconds) or not 0 < seconds <= 7200:
                    raise ValueError("Invalid duration")
        except (OSError, ValueError, RuntimeError):
            # Reserve the maximum supported duration for sources we cannot probe.
            # This keeps planning conservative and lets conversion report errors.
            seconds = 7200
        return {
            "path": str(source),
            "size": info.st_size,
            "mtime": info.st_mtime_ns,
            "duration": seconds,
        }

    with ThreadPoolExecutor(max_workers=8) as workers:
        rows = list(workers.map(measure, sorted(sources)))
    seconds = sum(
        min(20, row["duration"])
        if library.config.get("variant") == "preview"
        else row["duration"]
        for row in rows
    )
    # Opus supports up to 510 kbps, reserve 3% for container overhead/variation.
    bitrate = min(510, int(BUDGET_BYTES * 0.97 * 8 / max(1, seconds) / 1000))
    if bitrate < 6:
        raise ValueError("The audio library is too large for the 9 GB budget")
    plan = {
        "sources": rows,
        "seconds": seconds,
        "bitrate": bitrate,
        "budget_bytes": BUDGET_BYTES,
    }
    if plan != saved:
        write_json(path, plan)
        print(
            f"Audio plan: {len(rows)} tracks, {bitrate} kbps Opus, estimated {seconds * bitrate * 1000 / 8 / 1e9:.2f} GB before overhead.",
            file=sys.stderr,
            flush=True,
        )
    return plan


def r2_client(config: dict[str, Any]) -> Any:
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        raise RuntimeError(
            "Run setup-audio.bat to install the optional R2 tools."
        ) from None
    return boto3.client(
        "s3",
        endpoint_url=config["endpoint"],
        region_name="auto",
        aws_access_key_id=config["access_key"],
        aws_secret_access_key=config["secret_key"],
        config=Config(
            signature_version="s3v4",
            connect_timeout=10,
            read_timeout=45,
            retries={"max_attempts": 2},
        ),
    )


def start_audio_sync(
    config: dict[str, Any], proxy: Path, catalog: Catalog, endpoint_id: str
) -> None:
    """Keep conversion and object-storage latency off the score-sync loop."""
    if getattr(catalog, "audio_thread", None) and catalog.audio_thread.is_alive():
        return
    if configuration().get("mode") != "r2":
        catalog.audio_pending = False
        return

    def work() -> None:
        try:
            from scripts.sync import Catalog

            # Give this thread its own metadata/cache objects; the main sync
            # thread may refresh its catalog while a track is being converted.
            if not hasattr(catalog, "audio_catalog"):
                catalog.audio_catalog = Catalog(proxy)
            sync_audio(config, proxy, catalog.audio_catalog, endpoint_id)
            catalog.audio_pending = catalog.audio_catalog.audio_pending
        except Exception as error:  # noqa: BLE001 - isolate optional SDK failures from score sync
            catalog.audio_pending = False
            print(
                f"Audio sync pending ({type(error).__name__}). Check setup-audio.bat; other syncing continues.",
                flush=True,
            )

    catalog.audio_pending = True
    catalog.audio_thread = Thread(target=work, name="dashboard-audio", daemon=True)
    catalog.audio_thread.start()


def sync_audio(
    config: dict[str, Any], proxy: Path, catalog: Catalog, endpoint_id: str
) -> None:
    """A small, resumable audio backfill, normal dashboard sync stays independent."""
    from scripts.sync import upload

    audio = configuration()
    catalog.audio_pending = False
    if audio.get("mode") != "r2":
        return
    public = audio.get("public_url", "").rstrip("/")
    parsed = urlparse(public)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Set a public HTTPS audio URL in setup-audio.bat")
    library = getattr(catalog, "audio_library", None)
    if library is None or library.config != audio:
        library = catalog.audio_library = AudioLibrary(catalog.details, audio)
    library.details.refresh()
    if audio.get("format", "opus") == "opus":
        plan = plan_audio(library)
        if audio.get("bitrate") != plan["bitrate"]:
            audio["bitrate"] = plan["bitrate"]
            library.config = dict(audio)
            write_json(CONFIG, audio)
    codec = audio.get("format", "opus")
    limit_gb = 9 if codec == "opus" else float(audio.get("storage_limit_gb", 9))
    if not math.isfinite(limit_gb) or limit_gb < 0:
        raise ValueError("Invalid audio storage limit")
    limit_bytes = int(limit_gb * 1e9)
    client = getattr(catalog, "audio_client", None)
    if client is None or getattr(catalog, "audio_client_config", None) != audio:
        client = catalog.audio_client = r2_client(audio)
        catalog.audio_client_config = dict(audio)
    checkpoint = ROOT / ".local/audio-sync.json"
    state = read_json(checkpoint, {})
    destination = hashlib.sha256(
        json.dumps([endpoint_id, audio["endpoint"], audio["bucket"], public]).encode()
    ).hexdigest()
    if state.get("destination") != destination:
        state = {"destination": destination, "objects": [], "charts": {}}
    # Count every committed object, including obsolete encodings and other files.
    inventory = {}
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=audio["bucket"]
    ):
        inventory.update(
            {item["Key"]: item["Size"] for item in page.get("Contents", [])}
        )
    used_bytes = sum(inventory.values())
    # One small bank serves every chart. Effects are rendered by the viewer;
    # never upload a second full-song mix for each difficulty.
    if audio.get("variant", "full") == "full":
        from scripts.chart_effects import prepare_bank

        bank = prepare_bank(catalog.details.music.base_root)
        if bank:
            bank_key = f"effects/{bank['id']}.wav"
            bank_file = ROOT / ".local" / bank_key
            if bank_key not in inventory:
                size = bank_file.stat().st_size
                if limit_bytes and used_bytes + size > limit_bytes:
                    print(
                        "Chart effect samples exceed the configured bucket budget.",
                        flush=True,
                    )
                    return
                client.upload_file(
                    str(bank_file),
                    audio["bucket"],
                    bank_key,
                    ExtraArgs={
                        "ContentType": "audio/wav",
                        "CacheControl": "public, max-age=31536000, immutable",
                    },
                )
                inventory[bank_key] = size
                used_bytes += size
    # Audio objects belong to the bucket, while chart acknowledgements belong to
    # the dashboard database. Reuse immutable objects after a database replacement.
    known = {
        key.removeprefix("audio/").removesuffix("." + codec)
        for key in inventory
        if re.fullmatch(r"audio/[a-f0-9]{64}\." + codec, key)
    }
    batch, hashes, prepared = [], {}, 0
    catalog.details.refresh()
    if library.signatures != catalog.details.signatures:
        library.sources.clear()
        library.folder_files.clear()
        library.folders = None
        library.signatures = catalog.details.signatures
    keys = list(catalog.details.metadata)
    priority = {
        key.split(":", 1)[0]
        for key in read_json(proxy / "cache/total_volforce.json", {}).get(
            "chart_volforce", {}
        )
    }
    # Keep every difficulty of a priority song together. Shared audio must not
    # become available only for the difficulty present in the player's records.
    keys.sort(key=lambda key: key.split(":", 1)[0] not in priority)
    for key in keys:
        mid, diff = map(int, key.split(":"))
        source = library.source(mid, diff)
        if source is None or library.failures.get(str(source), 0) > time.monotonic():
            continue
        try:
            record = library.get(mid, diff, prepare=False)
            if record is None:
                if prepared >= 2:
                    catalog.audio_pending = True
                    # Other charts may already have prepared/uploaded audio.
                    # Publish those mappings without waiting for more conversion.
                    continue
                prepared += 1
                record = library.get(mid, diff)
        except (OSError, ValueError, RuntimeError) as error:
            # One unsupported custom container must not stall the whole library.
            library.failures[str(source)] = time.monotonic() + 3600
            print(
                f"Audio {mid} skipped ({type(error).__name__}); retrying later.",
                flush=True,
            )
            continue
        if not record:
            continue
        object_key = f"audio/{record['id']}.{codec}"
        record["url"] = public + "/" + quote(object_key, safe="/")
        if record["variant"] == "full":
            from scripts.chart_view import prepare

            timeline = prepare(catalog.details, mid, diff)
            if timeline:
                chart_id, chart_file = timeline
                chart_key = f"charts/{chart_id}.json"
                size = chart_file.stat().st_size
                if (
                    chart_key in inventory
                    or not limit_bytes
                    or used_bytes + size <= limit_bytes
                ):
                    if chart_key not in inventory:
                        client.upload_file(
                            str(chart_file),
                            audio["bucket"],
                            chart_key,
                            ExtraArgs={
                                "ContentType": "application/json",
                                "ContentEncoding": "gzip",
                                "CacheControl": "public, max-age=31536000, immutable",
                            },
                        )
                        inventory[chart_key] = size
                        used_bytes += size
                    record["chart_url"] = public + "/" + chart_key
        digest = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
        if state["charts"].get(key) == digest and record["id"] in known:
            continue
        if record["id"] not in known:
            size = (library.directory / (record["id"] + "." + codec)).stat().st_size
            if (
                limit_bytes
                and used_bytes - inventory.get(object_key, 0) + size > limit_bytes
            ):
                if getattr(catalog, "audio_budget_message", None) != used_bytes:
                    print(
                        f"Audio upload stopped: bucket uses {used_bytes / 1e9:.3f} GB; next track would exceed the {limit_gb:g} GB budget. Remove obsolete objects or reduce bitrate.",
                        flush=True,
                    )
                    catalog.audio_budget_message = used_bytes
                break
            client.upload_file(
                str(library.directory / (record["id"] + "." + codec)),
                audio["bucket"],
                object_key,
                ExtraArgs={
                    "ContentType": "audio/flac" if codec == "flac" else "audio/ogg",
                    "CacheControl": "public, max-age=31536000, immutable",
                },
            )
            used_bytes += size - inventory.get(object_key, 0)
            inventory[object_key] = size
            known.add(record["id"])
            state["objects"] = sorted(known)
            write_json(checkpoint, state)
            print(f"Uploaded audio {mid} ({record['duration']:.1f}s)", flush=True)
        batch.append(record)
        hashes[key] = digest
        if len(batch) >= 24:
            catalog.audio_pending = True
            break
    if batch:
        upload(
            config["url"],
            config["token"],
            {"plays": [], "observations": [], "audio": batch},
            config.get("bypass"),
        )
        state["charts"].update(hashes)
        write_json(checkpoint, state)
        print(f"Synced audio player metadata for {len(batch)} charts.", flush=True)
