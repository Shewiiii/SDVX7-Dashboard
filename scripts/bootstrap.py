import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from scripts.layout import PROXY_FOLDER, game_root, validate_proxy

ROOT = Path(__file__).resolve().parents[1]
PROXY_REPOSITORY = "https://github.com/Shewiiii/SDVX7-Proxy.git"


def ensure_proxy(game: Path) -> Path:
    proxy = game / PROXY_FOLDER
    if proxy.exists():
        validate_proxy(proxy)
        return proxy
    git = shutil.which("git")
    if not git:
        raise ValueError("Install Git for Windows, then run setup-dashboard.bat again.")
    # Clone away from the final path so a failed download can be retried safely.
    with tempfile.TemporaryDirectory(prefix=".proxy-install-", dir=game) as temporary:
        checkout = Path(temporary) / "checkout"
        print("Downloading SDVX Proxy...", flush=True)
        subprocess.run(
            [git, "clone", "--depth", "1", PROXY_REPOSITORY, str(checkout)],
            check=True,
        )
        validate_proxy(checkout)
        checkout.rename(proxy)
    return proxy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 10):  # noqa: UP036
        raise ValueError("Python 3.10 or newer is required.")
    proxy = ensure_proxy(game_root(ROOT))
    # Run migration before setup
    subprocess.run(
        [sys.executable, "-c", "from proxy.setup import install; install()"],
        cwd=proxy,
        check=True,
    )
    python = (
        proxy / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    command = [str(python), "-m", "scripts.setup"]
    if args.update:
        command.append("--update")
    return subprocess.call(command, cwd=ROOT)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Dashboard setup could not start: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    except (EOFError, KeyboardInterrupt):
        print("Setup cancelled. Run it again to resume.")
        raise SystemExit(1) from None
