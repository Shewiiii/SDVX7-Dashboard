from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _migrate(source: Path, target: Path, root: Path) -> None:
    local = (root / ".local").resolve()
    if any(not path.resolve().is_relative_to(local) for path in (source, target)):
        raise ValueError("Local data must stay inside the dashboard workspace")
    if not source.exists():
        return
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            source.rename(target)
        except FileNotFoundError:
            if not target.exists():
                raise
    elif source.is_dir() and target.is_dir():
        for child in source.iterdir():
            _migrate(child, target / child.name, root)
        if not any(source.iterdir()):
            source.rmdir()


def protected_path(name: str, root: Path = ROOT, *, legacy: str | None = None) -> Path:
    target = root / ".local/do-not-delete" / name
    _migrate(root / ".local" / (legacy or name), target, root)
    return target


def config_path(name: str, root: Path = ROOT) -> Path:
    directory = protected_path("config", root)
    target = directory / name
    _migrate(root / ".local" / name, target, root)
    return target


def sync_path(name: str, root: Path = ROOT) -> Path:
    return protected_path("sync/" + name, root, legacy=name)


def metadata_path(name: str, root: Path = ROOT) -> Path:
    return protected_path("metadata/" + name, root, legacy=name)


def audio_metadata_path(root: Path = ROOT) -> Path:
    directory = root / ".local/do-not-delete/metadata/audio"
    for source in (root / ".local/audio").glob("*.json"):
        _migrate(source, directory / source.name, root)
    return directory
