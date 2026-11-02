"""Download missing browser runtimes for local crew previews"""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

from scripts.local_config import ROOT, protected_path

RUNTIMES = {
    "pixi.min.js": "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
    "unsafe-eval.js": "https://cdn.jsdelivr.net/npm/@pixi/unsafe-eval@6.5.10/dist/browser/unsafe-eval.js",
    "cubism4.min.js": "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js",
    "live2dcubismcore.min.js": "https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js",
}


def download(url: str, target: Path) -> None:
    if target.is_file():
        return
    request = urllib.request.Request(url, headers={"User-Agent": "SDVX-Dashboard"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(target)


def install_runtime(name: str) -> Path:
    if name not in RUNTIMES:
        raise ValueError("Unknown crew runtime")
    directory = protected_path("crew-tools", ROOT)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / name
    download(RUNTIMES[name], target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", choices=RUNTIMES)
    arguments = parser.parse_args()
    install_runtime(arguments.name)


if __name__ == "__main__":
    main()
