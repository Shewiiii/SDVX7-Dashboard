from pathlib import Path

PROXY_FOLDER = "SDVX7-Proxy-main"


def game_root(dashboard: Path) -> Path:
    game = dashboard.resolve().parent
    if not (game / "data/others/music_db.xml").is_file():
        raise ValueError(
            "Put SDVX7-Dashboard-main directly in the game folder, beside data. "
            "For an older installation, move the dashboard out of the legacy folder first."
        )
    return game


def proxy_root(dashboard: Path) -> Path:
    return game_root(dashboard) / PROXY_FOLDER


def validate_proxy(proxy: Path) -> None:
    if not all(
        (proxy / name).is_file()
        for name in ("config.py", "proxy/setup.py", "proxy/launcher.py", "proxy/playtime.py")
    ):
        raise ValueError("Proxy installation is missing or incomplete. Run setup-dashboard.bat.")
