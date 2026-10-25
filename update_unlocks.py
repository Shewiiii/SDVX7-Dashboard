from __future__ import annotations

from datetime import date
from pathlib import Path

from unlock_search.export_jsonl import CUSTOM_MDB, export_catalog
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
    export_catalog(
        audit=audit,
        custom_mdb=CUSTOM_MDB,
        output_path=dashboard / "public/unlocks.jsonl",
    )
    print("Unlock catalog updated. Report: .local/unlocks/manifest.json")


if __name__ == "__main__":
    print(
        "This script will attempt to scrap data from known sources and Asphyxia, but will be incomplete. "
        "Missing entries can be completed in unlock_overrides.json."
    )
    print(
        "Requires Python 3.11+, and asphyxia-core-win-x64 folder in "
        "your game's root folder"
    )
    main()
