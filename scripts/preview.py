"""Reuse the parsed catalog and artwork caches between local preview exports."""

import json
import sys
from contextlib import redirect_stdout

from scripts.companion import resolve_proxy
from scripts.sync import Catalog, export_preview


def main() -> None:
    catalog = None
    for command in sys.stdin:
        if command.strip() != "export":
            continue
        try:
            # stdout is reserved for acknowledgements; normal status stays visible.
            with redirect_stdout(sys.stderr):
                if catalog is None:
                    catalog = Catalog(resolve_proxy())
                export_preview(catalog)
            print(json.dumps({"ok": True}), flush=True)
        except Exception as error:
            print(f"Preview export failed: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            print(json.dumps({"ok": False, "error": f"Preview export failed ({type(error).__name__})"}), flush=True)
            catalog = None


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
