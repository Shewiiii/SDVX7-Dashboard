from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from .wiki_tables import (
    DIFFICULTIES,
    SongIndex,
    cell_text,
    expand_table,
    normalize,
    section_context,
)

SOURCE = "atwiki_songs_current"
URL = "https://w.atwiki.jp/sdvx/pages/12300.html"
LEGEND = {
    "灰色": ("blc", "インプットが必要"),
    "水色": ("conditional_input", "特殊な条件"),
    "緑色": ("blaster_gate", "BLASTER GATE"),
    "桃色": ("crossover_event", "連動・合同イベント"),
    "黄緑色": ("arena_station", "ARENA STATION"),
    "あずき色": ("variant_gate", "VARIANT GATE"),
}
SONG_ALIASES = {
    ("VIIIX", "Tanchiky"): ("VIIIΧ", "Tanchiky"),
    ("華麗なる！音戯探偵ひなビタ♫", "音戯探偵ひなビタ♫"): (
        "華麗なる！音戯探偵ひなビタ鷸",
        "音戯探偵ひなビタ鷸",
    ),
}


def match_song(index: SongIndex, title: str, artist: str) -> tuple[int | None, str]:
    music_id, match_kind = index.match(title, artist)
    alias = SONG_ALIASES.get((title, artist))
    if music_id is not None or match_kind == "ambiguous" or alias is None:
        return music_id, match_kind
    local_title, local_artist = alias
    candidates = [
        song
        for song in index.titles.get(normalize(local_title), [])
        if normalize(song["artist"]) == normalize(local_artist)
    ]
    if len(candidates) == 1:
        return candidates[0]["id"], "verified_atwiki_alias"
    return None, "ambiguous" if candidates else "unmatched"


def background_color(cell: Tag) -> str:
    style = str(cell.get("style", ""))
    match = re.search(r"(?:^|;)\s*background-color\s*:\s*([^;]+)", style, re.I)
    value = match[1] if match else str(cell.get("bgcolor", ""))
    value = value.lower().replace("!important", "").strip()
    if value in {"", "transparent", "inherit"}:
        if re.search(r"(?:^|;)\s*background\s*:", style, re.I):
            raise ValueError("Unsupported atwiki background shorthand")
        return ""
    if re.fullmatch(r"#[0-9a-f]{3}", value):
        return "".join(char * 2 for char in value[1:])
    if re.fullmatch(r"#[0-9a-f]{6}", value):
        return value[1:]
    rgb = re.fullmatch(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", value)
    if rgb and all(int(part) <= 255 for part in rgb.groups()):
        return "".join(f"{int(part):02x}" for part in rgb.groups())
    if value == "white":
        return "ffffff"
    raise ValueError(f"Unsupported atwiki background color: {value}")


def unlock_legend(body: Tag) -> dict[str, str]:
    colors = {}
    found = set()
    for span in body.select("span[style], span[bgcolor]"):
        label = cell_text(span)
        if label not in LEGEND:
            continue
        explanation = []
        for sibling in span.next_siblings:
            if isinstance(sibling, Tag) and sibling.name == "br":
                break
            explanation.append(
                sibling.get_text(" ", strip=True)
                if isinstance(sibling, Tag)
                else str(sibling)
            )
        method, expected = LEGEND[label]
        text = "".join(explanation)
        if "背景のTRACK" not in text or expected not in text:
            continue
        color = background_color(span)
        if not color or color == "ffffff" or color in colors:
            raise ValueError("Ambiguous atwiki unlock legend")
        colors[color] = method
        found.add(label)
    if found != set(LEGEND):
        raise ValueError("Atwiki unlock legend was not recognized")
    return colors


def song_rules(path: Path) -> list[dict[str, Any]]:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    body = soup.select_one("#wikibody")
    if body is None:
        raise ValueError(f"Expected a published atwiki article: {path}")
    colors = unlock_legend(body)
    rules = []
    for table_index, table in enumerate(body.find_all("table")):
        grid = expand_table(table)
        if len(grid) < 3 or "MUSIC" not in [cell_text(c) for c in grid[0]]:
            continue
        top = [cell_text(c) for c in grid[0]]
        header = [cell_text(c) for c in grid[1]]
        columns = [
            (column, DIFFICULTIES[label])
            for column, label in enumerate(header)
            if top[column] == "Lv" and label in DIFFICULTIES
        ]
        if "Artist" not in top or not columns:
            raise ValueError("Atwiki song table headers were not recognized")
        title_index = top.index("MUSIC")
        artist_index = top.index("Artist")
        headings, context = section_context(table)
        for row in grid[2:]:
            title = cell_text(row[title_index])
            if not title or title == "MUSIC":
                continue
            if len({id(cell) for cell in row if cell is not None}) <= 1:
                continue
            for column, diff in columns:
                cell = row[column]
                level = cell_text(cell)
                if level in {"", "-", "－", "―"}:
                    continue
                if not re.fullmatch(r"\d+(?:\.\d+)?", level):
                    raise ValueError(
                        f"Unrecognized atwiki chart level: {title}: {level}"
                    )
                if float(level) <= 0:
                    continue
                color = next(
                    (
                        color
                        for candidate in (cell, row[title_index], cell.parent, table)
                        if candidate is not None
                        and (color := background_color(candidate))
                    ),
                    "",
                )
                if color not in {"", "ffffff"} and color not in colors:
                    raise ValueError(
                        f"Unrecognized atwiki unlock color: {title}: {color}"
                    )
                rules.append(
                    {
                        "title": title,
                        "artist": cell_text(row[artist_index]),
                        "difficulty_indices": [diff],
                        "method": colors.get(color, "default_unlocked"),
                        "availability": "source_listed",
                        "source": SOURCE,
                        "url": URL,
                        "table_index": table_index,
                        "headings": headings,
                        "source_fields": {"level": level, "background_color": color},
                        "section_context_ja": context,
                    }
                )
    if not rules:
        raise ValueError(f"No recognized atwiki song tables in {path}")
    return rules
