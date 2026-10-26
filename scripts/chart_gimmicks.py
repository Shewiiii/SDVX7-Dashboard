"""Detect transformations of the lane surface or the stage that contains it."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Callable

VISUAL_GIMMICKS_VERSION = 2

# These controls move the lane surface or stage, rotate it, or reshape it.
# Other visual controls can change decoration without changing the playable lane.
LANE_TRANSFORMS = {
    "LaneY",
    "HudY",
    "BIL_RotZ",
    "Morphing2",
}
NUMBER = re.compile(
    r"^[fdi]?([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)[f]?$", re.IGNORECASE
)


def number(token: str) -> float | None:
    match = NUMBER.fullmatch(token)
    if match is None:
        return None
    value = float(match[1])
    return value if math.isfinite(value) else None


def has_visual_gimmicks(
    sections: dict[str, list[list[str]]],
    *,
    beat: Callable[[str], float],
    seconds: Callable[[float], float],
    resolution: int,
    start: float,
    end: float,
) -> bool:
    """Track each transform's state and require an effect during playable notes."""
    if end <= start:
        return False
    events: dict[str, list[tuple[float, float, bool, bool]]] = defaultdict(list)

    def add(
        channel: str,
        row: list[str],
        before: bool,
        after: bool,
    ) -> None:
        try:
            position = beat(row[0])
            at = seconds(position)
            ticks = number(row[3])
            if ticks is None:
                return
            length = seconds(position + ticks / resolution) - at
        except (ValueError, KeyError, OverflowError):
            return
        if math.isfinite(at) and math.isfinite(length) and length >= 0:
            events[channel].append((at, at + length, before, after))

    for section in ("SPCONTROLER", "LOCKED_SPCONTROLER"):
        for row in sections.get(section, []):
            if len(row) < 6:
                continue
            command = row[1]
            if command in LANE_TRANSFORMS:
                first, last = number(row[4]), number(row[5])
                if first is not None and last is not None:
                    add(command, row, first != 0, last != 0)

    for changes in events.values():
        changes.sort(key=lambda event: event[0])
        for i, (at, until, before, after) in enumerate(changes):
            following = changes[i + 1][0] if i + 1 < len(changes) else math.inf
            if (
                (before or after)
                and at < end
                and min(until, following) > start
                and until > at
            ) or (after and max(at, until, start) < min(following, end)):
                return True
    return False
