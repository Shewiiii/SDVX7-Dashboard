from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Callable
from fractions import Fraction
from functools import cache


def maximum_chain(
    sections: dict[str, list[list[str]]],
    resolution: int,
    beat: Callable[[str], float],
) -> int:
    """Estimate chains from VOX timing when no total is available."""

    @cache
    def position(value: str) -> Fraction:
        return Fraction(beat(value)).limit_denominator(1_000_000)

    tempos = sorted(
        {position(row[0]): float(row[1]) for row in sections["BPM INFO"]}.items()
    )
    changes = [point for point, _ in tempos]

    def spacing(point: Fraction) -> Fraction:
        bpm = tempos[max(0, bisect_right(changes, point) - 1)][1]
        return Fraction(1, 4 if bpm < 255 else 2)

    def ticks(start: Fraction, end: Fraction) -> list[Fraction]:
        interval = spacing(start)
        first = -(-start // interval) * interval
        result = []
        while first < end:
            result.append(first)
            first += spacing(first)
        return result

    def laser_chain(start: Fraction, end: Fraction, slams: list[Fraction]) -> int:
        points = ticks(start, end)
        occupied = set()
        for slam in slams:
            index = bisect_left(points, slam)
            if not points:
                continue
            if index == 0:
                occupied.add(0)
            elif index == len(points):
                if slam < points[-1] + spacing(points[-1]):
                    occupied.add(index - 1)
            else:
                middle = points[index - 1] + spacing(points[index - 1]) / 2
                if slam <= middle:
                    occupied.add(index - 1)
                if slam >= middle:
                    occupied.add(index)
        return len(points) - len(occupied) + len(slams)

    total = 0
    for lane in (2, 3, 4, 5, 6, 7):
        for row in sections.get(f"TRACK{lane}", []):
            if len(row) < 3:
                continue
            length = int(row[1])
            if length == 0:
                total += 1
                continue
            start = position(row[0])
            count = len(ticks(start, start + Fraction(length, resolution)))
            count += int(start % spacing(start) != 0)
            # Long holds stop judging before the visible tail.
            total += count - int(count >= 6) - int(count >= 8)

    for lane in (1, 8):
        groups: dict[Fraction, list[list[str]]] = {}
        for row in sections.get(f"TRACK{lane}", []):
            if len(row) >= 3:
                groups.setdefault(position(row[0]), []).append(row)
        start = None
        slams = []
        for point, rows in sorted(groups.items()):
            flags = {int(row[2]) for row in rows}
            slam = Fraction(rows[0][1]) != Fraction(rows[-1][1])
            if 1 in flags and 2 in flags:
                total += int(slam)
                continue
            if 1 in flags:
                start = point
                slams = []
            if slam:
                slams.append(point)
            if 2 in flags and start is not None:
                total += laser_chain(start, point, slams)
                start = None
                slams = []
    return total
