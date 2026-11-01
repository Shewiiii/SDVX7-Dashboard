from __future__ import annotations

import sys

from scripts.audio_setup import edit_r2, prompt, saved_r2


def main() -> None:
    has_r2 = saved_r2() is not None
    print(
        "Optional dashboard features\n1. Audio playback\n2. Nemsys Crew\n3. High quality jackets"
    )
    if has_r2:
        print("4. Edit Cloudflare R2 configuration\n5. Delete data from Cloudflare R2")
    choice = prompt("Feature", "1")
    if choice == "1":
        from scripts.audio_setup import main as setup
    elif choice == "2":
        from scripts.crew_setup import main as setup
    elif choice == "3":
        from scripts.jacket_setup import main as setup
    elif choice == "4" and has_r2:
        setup = edit_r2
    elif choice == "5" and has_r2:
        from scripts.r2_cleanup import main as setup
    else:
        raise ValueError("Choose 1, 2, 3, 4, or 5." if has_r2 else "Choose 1, 2, or 3.")
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
