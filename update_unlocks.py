from __future__ import annotations

from datetime import date
from pathlib import Path

from unlock_search.export_jsonl import CUSTOM_MDB, export_catalog
from unlock_search.probe_wiki import probe
from unlock_search.research_unlocks import (
    PLUGIN,
    ROOT,
    build_audit,
    prepare_sources,
)


def main() -> None:
    dashboard = Path(__file__).resolve().parent

    print("Refreshing public unlock sources...", flush=True)
    manifest = prepare_sources(refresh=True)
    audit = build_audit(
        ROOT / "data/others/music_db.xml",
        CUSTOM_MDB,
        PLUGIN,
        date.today(),
        manifest,
    )
    print("Looking up unresolved songs...", flush=True)
    wiki = probe(audit, len(audit["songs"]), refresh=True)

    export_catalog(
        audit=audit,
        wiki=wiki,
        custom_mdb=CUSTOM_MDB,
        output_path=dashboard / "public/unlocks.jsonl",
    )
    print("Unlock catalog updated. Report: .local/unlocks/manifest.json")


if __name__ == "__main__":
    print(
        "Requires Python 3.11+, and asphyxia-core-win-x64 folder in "
        "your game's root folder"
    )
    main()
