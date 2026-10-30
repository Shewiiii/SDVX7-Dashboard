"""Calculate the published player radar from saved scores and chart metadata."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


def chart_contribution(
    level: int, radar: int, score: int, exscore: int, maximum: int
) -> int:
    """Keep integer truncation at the stages used by the published formula."""
    # https://note.com/logthm/n/n59dca7461be8
    multiplier = min(2 * (level + 30), 100)
    normal = 3 * score * radar // 40_000_000
    ex_factor = max(1000 + 2 * 2 ** ((21 - level) // 2) * (exscore - maximum), 0)
    extra = radar * ex_factor // 4000
    return multiplier * (normal + extra)


def calculate_profile_radar(
    records: Mapping[str, Any],
    radars: Mapping[int, Mapping[int, list[int] | None]],
    levels: Mapping[int, Mapping[int, float]],
    metadata: Mapping[str, Mapping[str, Any]],
    *,
    include_custom: bool = True,
) -> dict[str, Any] | None:
    best: list[dict[int, int]] = [{} for _ in range(6)]
    excluded = 0
    used = 0
    custom_songs = {
        key.partition(":")[0]
        for key, info in metadata.items()
        if info.get("is_custom") is True
    }

    for key, record in records.items():
        if not isinstance(record, dict):
            continue
        score = record.get("score")
        if type(score) is not int or not 0 < score <= 10_000_000:
            continue
        try:
            mid, diff = map(int, key.split(":"))
        except (AttributeError, TypeError, ValueError):
            continue
        if not include_custom and str(mid) in custom_songs:
            continue
        radar = radars.get(mid, {}).get(diff)
        level = levels.get(mid, {}).get(diff)
        if (
            not isinstance(radar, list)
            or len(radar) != 6
            or any(type(value) is not int or value < 0 for value in radar)
            or not isinstance(level, (int, float))
            or not math.isfinite(level)
            or not 1 <= level < 21
        ):
            excluded += 1
            continue
        # Charts without radar attributes cannot contribute to any category.
        if not any(radar):
            continue
        maximum = metadata.get(key, {}).get("max_exscore")
        exscore = record.get("exscore")
        valid_ex = (
            type(exscore) is int
            and exscore >= 0
            and isinstance(maximum, (int, float))
            and not isinstance(maximum, bool)
            and math.isfinite(maximum)
            and maximum > 0
            and int(maximum) == maximum
            and exscore <= maximum
        )
        if not valid_ex:
            excluded += 1
        used += 1
        for axis, attribute in enumerate(radar):
            # Missing EX metadata leaves the normal-score contribution available.
            value = chart_contribution(
                math.floor(level),
                attribute,
                score,
                exscore if valid_ex else 0,
                int(maximum) if valid_ex else 1_000_000_000,
            )
            if value > 0:
                best[axis][mid] = max(best[axis].get(mid, 0), value)

    if not used:
        return None
    top = [sorted(songs.values(), reverse=True)[:50] for songs in best]
    return {
        "values": [sum(values) // 40 / 100 for values in top],
        "song_counts": [len(values) for values in top],
        "complete": excluded == 0,
    }
