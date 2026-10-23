import hashlib
import io
import json
import logging
import math
import struct
import tempfile
import wave
from functools import lru_cache
from pathlib import Path

from scripts.companion import ROOT

logger = logging.getLogger(__name__)


def schedule(sections, seconds, beat, resolution):
    def table(name):
        rows = []
        for row in sections.get(name, []):
            values = [float(v) for v in " ".join(row).split(",") if v.strip()]
            if any(not math.isfinite(v) for v in values):
                raise ValueError("Invalid audio effect parameter")
            rows.append(values)
        return rows

    def events(name):
        return [
            [
                round(seconds(beat(r[0])), 6),
                round(seconds(beat(r[0]) + int(r[1]) / resolution), 6),
                int(r[2]),
            ]
            for r in sections.get(name, [])
            if len(r) >= 3
        ]

    fx, chips = [], []
    for name in ("TRACK2", "TRACK7"):
        for start, end, selector in events(name):
            if end > start and 2 <= selector < 254:
                fx.append([start, end, selector - 2])
            elif end == start and 1 <= selector <= 14:
                chips.append([start, selector])
    return {
        "schema": 1,
        "definitions": table("FXBUTTON EFFECT INFO"),
        "laser_definitions": table("TAB EFFECT INFO"),
        "assignments": table("TAB PARAM ASSIGN INFO"),
        "fx": sorted(fx),
        "auto": [[a, b, s - 2] for a, b, s in events("TRACK AUTO TAB") if 2 <= s < 254],
        "chips": sorted(chips),
        # One filter selector per point in the visual laser timeline. Keeping
        # these separately preserves the existing geometry and density format.
        "laser_filters": [],
    }


def prepare_bank(base_root):
    path = Path(base_root) / "sound/ver5/general_sampler.s3p"
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    return _bank_result(str(path), stat.st_size, stat.st_mtime_ns)


@lru_cache(maxsize=4)
def _bank_result(path, size, modified):
    # A missing decoder or damaged bank should not retry once per difficulty.
    # A source change or tracker restart will try again.
    try:
        return _prepare_bank(path, size, modified)
    except (OSError, ValueError, RuntimeError) as error:
        logger.warning(
            "Chart effects: shared samples unavailable (%s)", type(error).__name__
        )
        return None


def _prepare_bank(path, size, modified):
    from scripts.audio import command, configuration, tools, write_json

    raw = Path(path).read_bytes()
    if len(raw) < 8 or raw[:4] != b"S3P0":
        raise ValueError("Invalid sample bank")
    count = struct.unpack_from("<I", raw, 4)[0]
    if not 1 <= count <= 64 or len(raw) < 8 + count * 8:
        raise ValueError("Invalid sample table")
    digest = hashlib.sha256(b"chart-samples-v1\0" + raw).hexdigest()
    directory = ROOT / ".local/effects"
    target = directory / (digest + ".wav")
    manifest = directory / (digest + ".json")
    if target.is_file() and manifest.is_file():
        return json.loads(manifest.read_text(encoding="utf-8"))
    ffmpeg, _ = tools(configuration())
    chunks, entries, cursor = [], [], 0
    with tempfile.TemporaryDirectory() as temporary:
        for index in range(min(count, 15)):
            offset, length = struct.unpack_from("<II", raw, 8 + index * 8)
            if length < 32 or offset + length > len(raw):
                raise ValueError("Truncated sample")
            sample = raw[offset : offset + length]
            if sample[:4] != b"S3V0":
                raise ValueError("Unsupported sample")
            header = struct.unpack_from("<I", sample, 4)[0]
            if not 24 <= header < length:
                raise ValueError("Invalid sample header")
            gain = 10 ** (struct.unpack_from("<h", sample, 20)[0] / 256 / 20)
            source = Path(temporary) / "sample.s3v"
            source.write_bytes(sample[header:])
            pcm = command(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-i",
                    str(source),
                    "-f",
                    "s16le",
                    "-acodec",
                    "pcm_s16le",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-",
                ]
            )
            frames = len(pcm) // 4
            if frames > 44100 * 30 or len(pcm) % 4 or not math.isfinite(gain):
                raise ValueError("Invalid decoded sample")
            entries.append([cursor, frames, round(gain, 8)])
            cursor += frames
            chunks.append(pcm)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        wav.writeframes(b"".join(chunks))
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=directory, suffix=".tmp", delete=False
    ) as stream:
        temporary = Path(stream.name)
        stream.write(output.getvalue())
    try:
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    result = {"id": digest, "rate": 44100, "entries": entries}
    write_json(manifest, result)
    return result
