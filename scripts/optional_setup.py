from __future__ import annotations

import sys

from scripts.audio_setup import prompt


def main() -> None:
    print("Optional dashboard features\n1. Audio playback\n2. Nemsys Crew")
    choice = prompt("Feature", "2")
    if choice == "1":
        from scripts.audio_setup import main as setup
    elif choice == "2":
        from scripts.crew_setup import main as setup
    else:
        raise ValueError("Choose 1 or 2.")
    setup()


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("Optional setup cancelled.")
        raise SystemExit(1) from None
    except Exception as error:  # noqa: BLE001
        message = (
            str(error)
            if isinstance(error, (ValueError, RuntimeError))
            else type(error).__name__
        )
        print(f"Optional setup did not finish: {message}", file=sys.stderr)
        raise SystemExit(1) from None
