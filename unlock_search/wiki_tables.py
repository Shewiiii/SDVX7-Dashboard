from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

DIFFICULTIES = {
    "NOV": 0,
    "ADV": 1,
    "EXH": 2,
    "INF": 3,
    "GRV": 3,
    "HVN": 3,
    "XCD": 3,
    "NBL": 3,
    "MXM": 4,
    "ULT": 5,
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def cell_text(cell: Tag | None) -> str:
    if cell is None:
        return ""
    return re.sub(r"\*\d+", "", cell.get_text(" ", strip=True)).strip()


def expand_table(table: Tag) -> list[list[Tag | None]]:
    grid: dict[tuple[int, int], Tag] = {}
    rows = table.find_all("tr")
    width = 0
    for row_index, row in enumerate(rows):
        column = 0
        for cell in row.find_all(["td", "th"], recursive=False):
            while (row_index, column) in grid:
                column += 1
            rowspan = int(str(cell.get("rowspan", "1")))
            colspan = int(str(cell.get("colspan", "1")))
            if not 1 <= rowspan <= 1000 or not 1 <= colspan <= 100:
                raise ValueError("Unexpected table span")
            for y in range(row_index, row_index + rowspan):
                for x in range(column, column + colspan):
                    if (y, x) in grid:
                        raise ValueError("Overlapping table cells")
                    grid[y, x] = cell
            column += colspan
        width = max(width, column)
    return [[grid.get((y, x)) for x in range(width)] for y in range(len(rows))]


def section_context(table: Tag) -> tuple[list[str], str]:
    headings: dict[int, str] = {}
    for heading in table.find_all_previous(re.compile(r"^h[2-4]$")):
        level = int(heading.name[1])
        if level not in headings and (not headings or level < min(headings)):
            headings[level] = heading.get_text(" ", strip=True).replace(" †", "")
    nearest = table.find_previous(re.compile(r"^h[2-4]$"))
    text = []
    if nearest is not None:
        for sibling in nearest.next_siblings:
            if sibling is table:
                break
            if isinstance(sibling, Tag):
                if re.fullmatch(r"h[2-4]", sibling.name):
                    break
                if sibling.name != "table":
                    text.append(sibling.get_text(" ", strip=True))
    return [headings[key] for key in sorted(headings)], "\n".join(text)


class SongIndex:
    def __init__(self, songs: list[dict[str, Any]]) -> None:
        self.titles: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for song in songs:
            self.titles[normalize(song["title"])].append(song)

    def match(self, title: str, artist: str = "") -> tuple[int | None, str]:
        candidates = self.titles.get(normalize(title), [])
        if len(candidates) == 1:
            return candidates[0]["id"], "unique_normalized_title"
        if artist:
            candidates = [
                song
                for song in candidates
                if normalize(song["artist"]) == normalize(artist)
            ]
            if len(candidates) == 1:
                return candidates[0]["id"], "title_and_artist"
        return None, "ambiguous" if candidates else "unmatched"


def named_rules(path: Path, source: str, url: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    body = soup.select_one("#body")
    if body is None or "の編集" in soup.title.get_text():
        raise ValueError(f"Expected a published wiki article: {path}")
    rules = []
    for table_index, table in enumerate(body.find_all("table")):
        grid = expand_table(table)
        header_index = next(
            (
                i
                for i, row in enumerate(grid[:3])
                if "曲名" in [cell_text(c) for c in row]
            ),
            None,
        )
        if header_index is None:
            continue
        header_rows = len(table.select("thead tr")) or header_index + 1
        header = [cell_text(c) for c in grid[header_rows - 1]]
        column_diffs = [
            {
                DIFFICULTIES[cell_text(row[column])]
                for row in grid[:header_rows]
                if cell_text(row[column]) in DIFFICULTIES
            }
            for column in range(len(header))
        ]
        title_index = header.index("曲名")
        artist_index = (
            header.index("アーティスト") if "アーティスト" in header else None
        )
        headings, context = section_context(table)
        heading = headings[-1] if headings else ""
        if source == "bemani_removed":
            if "削除年月日" not in header:
                continue
            method = "removed"
        elif source == "bemani_blaster":
            method = "blaster_gate"
        elif source == "bemani_variant":
            method = "variant_gate"
        elif source == "bemani_arena":
            method = "arena_station"
        elif "EXTRACK CHALLENGE" in heading:
            method = "extrack_challenge"
        elif "スタンプ" in heading:
            method = "stamp"
        elif "条件付き" in heading:
            method = "conditional_input"
        elif "オリジナル楽曲コンテスト" in heading:
            continue
        else:
            continue

        indices = sorted(
            {DIFFICULTIES[label] for label in header if label in DIFFICULTIES}
        )
        for row in grid[header_rows:]:
            values = [cell_text(c) for c in row]
            if len({id(c) for c in row if c is not None}) <= 1:
                continue
            title = values[title_index]
            if not title or title == "曲名":
                continue
            diffs = (
                sorted(
                    {
                        diff
                        for choices, value in zip(column_diffs, values, strict=True)
                        for diff in choices
                        if re.fullmatch(r"\d+(?:\.\d+)?", value)
                    }
                )
                if indices
                else []
            )
            if "難易度" in header:
                label = values[header.index("難易度")]
                diffs = [DIFFICULTIES[label]] if label in DIFFICULTIES else []
            if source == "bemani_blaster" and "Lv" in header and not diffs:
                diffs = [3]
            if source == "bemani_arena":
                diffs = [3]
            fields = dict(zip(header, values, strict=True))
            rules.append(
                {
                    "title": title,
                    "artist": values[artist_index] if artist_index is not None else "",
                    "difficulty_indices": diffs,
                    "method": method,
                    "availability": "ended"
                    if any("終了" in h for h in headings)
                    else "source_listed",
                    "source": source,
                    "url": url,
                    "table_index": table_index,
                    "headings": headings,
                    "source_fields": fields,
                    "section_context_ja": context,
                }
            )
    if not rules:
        raise ValueError(f"No recognized song tables in {path}")
    return rules
