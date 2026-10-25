import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any

from dotenv import dotenv_values, set_key, unset_key

from scripts.companion import load_config, normalize_currency, proxy_module, save_config
from scripts.layout import PROXY_FOLDER, game_root

LEGACY_FOLDER = "SDVX7-VolForce-Tracker-main"
PLAYTIME_KEYS = (
    "INITIAL_PLAYTIME",
    "PLAYTIME_BASELINE_SECONDS",
    "PLAYTIME_BASELINE_PLAYS",
)


def ensure_stopped(*roots: Path) -> None:
    if os.name != "nt":
        return
    script = """
$ErrorActionPreference = 'Stop'
$roots = $env:SDVX_MIGRATION_ROOTS | ConvertFrom-Json
$processes = @(Get-CimInstance Win32_Process)
$ancestors = @{}
$taskPid = [int]$env:SDVX_MIGRATION_PID
while ($taskPid -and -not $ancestors.ContainsKey($taskPid)) {
    $ancestors[$taskPid] = $true
    $parent = $processes | Where-Object { $_.ProcessId -eq $taskPid } | Select-Object -First 1
    if (-not $parent) { break }
    $taskPid = [int]$parent.ParentProcessId
}
$busy = @($processes | Where-Object {
    if ($ancestors.ContainsKey([int]$_.ProcessId)) { return $false }
    if ($_.Name -notin @('python.exe', 'pythonw.exe', 'node.exe')) { return $false }
    $text = [string]$_.ExecutablePath + ' ' + [string]$_.CommandLine
    foreach ($root in $roots) {
        if ($text.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
})
if ($busy.Count) { exit 2 }
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        env={
            **os.environ,
            "SDVX_MIGRATION_ROOTS": json.dumps([str(root.resolve()) for root in roots]),
            "SDVX_MIGRATION_PID": str(os.getpid()),
        },
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
        timeout=30,
    )
    if result.returncode:
        raise ValueError(
            "Close the old bot, proxy and dashboard sessions, then rerun setup to migrate."
        )


def legacy_files(legacy: Path) -> list[Path]:
    files = []
    for directory, dirs, names in os.walk(legacy, followlinks=False):
        for name in [*dirs, *names]:
            path = Path(directory) / name
            attributes = getattr(path.lstat(), "st_file_attributes", 0)
            if path.is_symlink() or attributes & getattr(
                stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0
            ):
                raise ValueError(f"Cannot migrate linked files or folders: {path}")
        files.extend(Path(directory) / name for name in names)
    return sorted(files)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def verify_source(legacy: Path, signatures: dict[str, str]) -> None:
    current = {
        str(path.relative_to(legacy)): digest(path) for path in legacy_files(legacy)
    }
    if current != signatures:
        raise ValueError(
            "The old installation changed during migration. Close it and run setup again; its folder was kept."
        )


@dataclass
class Migration:
    legacy: Path
    game: Path
    backup: Path | None
    signatures: dict[str, str]

    def finish(self) -> None:
        # Never recursively remove a computed path outside this exact game child.
        if (
            self.legacy.is_symlink()
            or self.legacy.resolve() != self.game.resolve() / LEGACY_FOLDER
            or self.legacy.name != LEGACY_FOLDER
        ):
            raise ValueError(
                "Unexpected legacy folder location; cleanup was cancelled."
            )
        ensure_stopped(self.legacy, self.game / PROXY_FOLDER)
        verify_source(self.legacy, self.signatures)
        if self.backup is not None:
            try:
                with zipfile.ZipFile(self.backup) as archive:
                    if archive.testzip() is not None:
                        raise ValueError(
                            "Legacy backup verification failed; the old folder was kept."
                        )
            except zipfile.BadZipFile as error:
                raise ValueError(
                    "Legacy backup verification failed; the old folder was kept."
                ) from error

        def remove_readonly(
            function: Callable[[str], object],
            path: str,
            error: tuple[type[BaseException], BaseException, TracebackType | None],
        ) -> None:
            resolved = Path(path).resolve()
            if not resolved.is_relative_to(self.legacy.resolve()):
                raise ValueError("Refusing cleanup outside the legacy folder.")
            os.chmod(path, stat.S_IWRITE)
            function(path)

        shutil.rmtree(self.legacy, onerror=remove_readonly)
        message = "Legacy installation removed."
        if self.backup is not None:
            message += f" Backup: {self.backup}"
        print(message, flush=True)


def ask_backup() -> bool:
    while True:
        answer = input("Save a backup? (Y/n): ").strip().lower()
        if answer in ("", "y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        print("Enter yes or no.")


def backup_legacy(dashboard: Path, proxy: Path, legacy: Path) -> Migration:
    local = dashboard / ".local"
    local.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(
        prefix="legacy-backup-", suffix=".zip", dir=local
    )
    os.close(descriptor)
    backup = Path(filename)
    signatures = {}
    print("Backing up the old installation before migration...", flush=True)
    with zipfile.ZipFile(backup, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in legacy_files(legacy):
            relative = str(path.relative_to(legacy))
            hasher = hashlib.sha256()
            with (
                path.open("rb") as source,
                archive.open(
                    "legacy/" + Path(relative).as_posix(), "w", force_zip64=True
                ) as target,
            ):
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(block)
                    hasher.update(block)
            signatures[relative] = hasher.hexdigest()
        for name in (".env", "player-data/playtime.json", "cache/total_volforce.json"):
            path = proxy / name
            if path.is_file():
                archive.write(path, "proxy-before/" + name)
    migration = Migration(legacy, legacy.parent, backup, signatures)
    verify_source(legacy, signatures)
    with zipfile.ZipFile(backup) as archive:
        if archive.testzip() is not None:
            raise ValueError("Could not verify legacy backup. The old folder was kept.")
    return migration


def records(path: Path) -> Iterator[dict[str, Any]]:
    decoder = json.JSONDecoder()
    with path.open(encoding="utf-8-sig") as stream:
        for line in stream:
            text = line.strip()
            while text:
                record, offset = decoder.raw_decode(text)
                if not isinstance(record, dict):
                    raise TypeError(f"Expected a JSON object in {path}")
                yield record
                text = text[offset:].lstrip()


def merge_log(source: Path, destination: Path) -> None:
    if not source.is_file():
        return
    # Validate before copying; accept historical lines with concatenated objects.
    old = list(records(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(source, destination)
        return
    key = lambda item: json.dumps(
        item, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    known = {key(item) for item in records(destination)}
    additions = []
    for item in old:
        value = key(item)
        if value not in known:
            additions.append(value.encode("utf-8") + b"\n")
            known.add(value)
    if additions:
        # Append to keep existing dashboard byte offsets valid.
        with destination.open("a+b") as stream:
            if stream.tell():
                stream.seek(-1, os.SEEK_END)
                if stream.read(1) != b"\n":
                    stream.write(b"\n")
            stream.writelines(additions)


def copy_missing(source: Path, destination: Path) -> None:
    if not source.is_dir():
        return
    for path in source.rglob("*"):
        target = destination / path.relative_to(source)
        if path.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def migrate_preferences(
    dashboard: Path,
    proxy: Path,
    legacy_values: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    config_path = dashboard / ".local/sync-config.json"
    config = load_config(config_path)
    env_path = proxy / ".env"
    original_env = env_path.read_bytes() if env_path.exists() else None
    proxy_values = dotenv_values(env_path, interpolate=False)
    changed = False
    # Import the earlier proxy settings and
    # then the original application's values only where preferences are missing.
    for values in (proxy_values, legacy_values or {}):
        for field, keys in (
            ("name", ("DASHBOARD_USERNAME", "TRACKER_USERNAME")),
            ("currency", ("DASHBOARD_CURRENCY", "TRACKER_CURRENCY")),
        ):
            if config.get(field, "").strip():
                continue
            value = next(
                (values.get(key) for key in keys if values.get(key)), ""
            ).strip()
            if not value:
                continue
            if field == "currency":
                try:
                    value = normalize_currency(value)
                except ValueError:
                    continue
            else:
                value = value[:40]
            config[field] = value
            changed = True
    if changed:
        save_config(config, config_path)

    preference_keys = (
        "DASHBOARD_USERNAME",
        "DASHBOARD_CURRENCY",
        "TRACKER_USERNAME",
        "TRACKER_CURRENCY",
    )
    if original_env is not None and any(key in proxy_values for key in preference_keys):
        # Save dashboard preferences first; remove obsolete proxy keys afterward.
        temporary = env_path.with_name(".env.preferences.tmp")
        try:
            temporary.write_bytes(original_env)
            for key in preference_keys:
                if key in proxy_values:
                    unset_key(temporary, key)
            if env_path.read_bytes() != original_env:
                raise ValueError(
                    "Proxy settings changed during preference migration. Run setup again."
                )
            temporary.replace(env_path)
        finally:
            temporary.unlink(missing_ok=True)
    return config


def migrate_legacy(dashboard: Path, proxy: Path) -> Migration | None:
    game = game_root(dashboard)
    legacy = game / LEGACY_FOLDER
    if not legacy.exists():
        migrate_preferences(dashboard, proxy)
        return None
    if legacy.is_symlink() or legacy.resolve() != game / LEGACY_FOLDER:
        raise ValueError(
            "The legacy folder must be a regular directory in the game folder."
        )
    if (
        not (legacy / "config.py").is_file()
        or not (legacy / "tracker/launcher.py").is_file()
    ):
        raise ValueError("The legacy folder was not recognized and was kept unchanged.")
    ensure_stopped(legacy, proxy)
    if ask_backup():
        migration = backup_legacy(dashboard, proxy, legacy)
    else:
        signatures = {
            str(path.relative_to(legacy)): digest(path) for path in legacy_files(legacy)
        }
        migration = Migration(legacy, game, None, signatures)
    # Retain deployment identity and sync checkpoints when installing a fresh ZIP.
    for name in (
        "SDVX7-Tracker-Dashboard-main",
        "SDVX7-Dashboard-main",
        "SDVX7-Tracker-Dashboard",
    ):
        old_dashboard = legacy / name
        for directory in (".local", ".vercel"):
            copy_missing(old_dashboard / directory, dashboard / directory)
        if (old_dashboard / ".env.local").is_file() and not (
            dashboard / ".env.local"
        ).exists():
            shutil.copy2(old_dashboard / ".env.local", dashboard / ".env.local")
    merge_log(legacy / "score_log.txt", proxy / "player-data/score_log.jsonl")
    merge_log(
        legacy / "volforce_history.jsonl", proxy / "player-data/volforce_history.jsonl"
    )
    snapshot = proxy / "cache/total_volforce.json"
    if (legacy / "cache/total_volforce.json").is_file() and not snapshot.exists():
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy / "cache/total_volforce.json", snapshot)

    old = dotenv_values(legacy / ".env", interpolate=False)
    migrate_preferences(dashboard, proxy, old)
    env_path = proxy / ".env"
    current = dotenv_values(env_path, interpolate=False)
    settings = {}
    for target, source in (
        ("SERVER", "TRACKER_SERVER"),
        ("UPSTREAM", "TRACKER_UPSTREAM"),
        ("PROXY_PORT", "TRACKER_PROXY_PORT"),
        ("SPICE_CONFIG", "TRACKER_SPICE_CONFIG"),
        ("GAME_LOG", "TRACKER_GAME_LOG"),
    ):
        value = old.get(target) or old.get(source)
        if value and not current.get(target):
            settings[target] = value

    helpers = proxy_module(proxy, "playtime")
    old_time = {
        key: old.get(key) or old.get("TRACKER_" + key) or "0" for key in PLAYTIME_KEYS
    }
    new_time = {key: current.get(key) or "0" for key in PLAYTIME_KEYS}
    old_path = legacy / "cache/playtime.json"
    new_path = proxy / "player-data/playtime.json"

    def summary(path: Path, values: dict[str, str]) -> dict[str, Any]:
        return helpers.load_playtime_summary(
            path,
            values["INITIAL_PLAYTIME"],
            int(values["PLAYTIME_BASELINE_SECONDS"]),
            int(values["PLAYTIME_BASELINE_PLAYS"]),
        )

    old_summary = summary(old_path, old_time)
    new_summary = summary(new_path, new_time)
    # Both collectors observe the same game log: adding totals would double count.
    old_total = old_summary["total_seconds"]
    new_total = new_summary["total_seconds"]
    if old_path.is_file() and (not new_path.exists() or old_total > new_total):
        new_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = new_path.with_suffix(".migration.tmp")
        shutil.copy2(old_path, temporary)
        temporary.replace(new_path)
        settings.update(old_time)
        if new_total > old_total:
            # Keep a larger imported total while retaining the legacy log cursor.
            state = helpers.read_state(new_path)
            settings.update(
                INITIAL_PLAYTIME=f"{new_total}s",
                PLAYTIME_BASELINE_SECONDS=str(state["seconds"]),
            )
    elif old_total > new_total:
        if new_path.exists():
            # An import without a legacy state must not acquire existing local
            # seconds a second time.
            state = helpers.read_state(new_path)
            settings.update(
                INITIAL_PLAYTIME=f"{old_total}s",
                PLAYTIME_BASELINE_SECONDS=str(state["seconds"]),
                PLAYTIME_BASELINE_PLAYS=new_time["PLAYTIME_BASELINE_PLAYS"],
            )
        else:
            settings.update(old_time)
    if settings:
        temporary_env = env_path.with_suffix(".migration.tmp")
        if env_path.exists():
            shutil.copy2(env_path, temporary_env)
        else:
            temporary_env.write_text("", encoding="utf-8")
        for key, value in settings.items():
            set_key(temporary_env, key, value, quote_mode="always")
        temporary_env.replace(env_path)
    print("Legacy histories, playtime and dashboard settings migrated.", flush=True)
    return migration
