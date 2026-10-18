from __future__ import annotations

import os
import subprocess
import sys
import time

from companion import ROOT, load_config, resolve_tracker, tracker_python


def sync_running() -> bool:
    path = ROOT / ".local/sync.lock"
    if not path.exists():
        return False
    with path.open("r+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        except OSError:
            return True
    return False


def stop_owned(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    # Windows venv executables can spawn a Python child. Stop only our own tree.
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def main() -> int:
    config = load_config()
    tracker = resolve_tracker()
    python = tracker_python(tracker)
    connected = bool(config.get("url") and len(config.get("token", "")) >= 32)
    local = ROOT / ".local"
    local.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    sync_process = tracker_process = None
    retry_at = 0
    started_sync = False
    hidden = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    with (
        (local / "sync.log").open("ab") as output,
        (local / "sync-errors.log").open("ab") as errors,
    ):

        def start_sync() -> subprocess.Popen[bytes]:
            return subprocess.Popen(
                [str(python), "-u", str(ROOT / "sync.py")],
                cwd=ROOT,
                env=env,
                stdout=output,
                stderr=errors,
                **hidden,
            )

        try:
            tracker_process = subprocess.Popen(
                [str(python), "-u", "-m", "tracker.launcher"],
                cwd=tracker,
                env=env,
            )
            if not connected:
                print(
                    "Dashboard is not connected. Run Setup-dashboard.bat to enable cloud sync."
                )
            elif sync_running():
                print("Dashboard sync is already running. Using the existing worker.")
            while tracker_process.poll() is None:
                if (
                    connected
                    and time.monotonic() >= retry_at
                    and (sync_process is None or sync_process.poll() is not None)
                ):
                    try:
                        if not sync_running():
                            sync_process = start_sync()
                            started_sync = True
                            print(
                                "Dashboard sync started. The tracker runs independently."
                            )
                    except OSError:
                        print(
                            "Dashboard sync could not start. Retrying in 30 seconds. The tracker continues."
                        )
                    retry_at = time.monotonic() + 30
                time.sleep(0.5)
            return tracker_process.returncode or 0
        except KeyboardInterrupt:
            print("Stopping tracker and dashboard sync...")
            # The original launcher receives Ctrl+C through the shared console.
            try:
                tracker_process.wait(timeout=8)
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                stop_owned(tracker_process)
            return 0
        finally:
            stop_owned(tracker_process)
            stop_owned(sync_process)
            if connected and started_sync and not sync_running():
                try:
                    final_sync = subprocess.Popen(
                        [
                            str(python),
                            "-u",
                            "-c",
                            "from sync import run; run(once=True)",
                        ],
                        cwd=ROOT,
                        env=env,
                        stdout=output,
                        stderr=errors,
                        **hidden,
                    )
                    try:
                        final_sync.wait(timeout=15)
                    except (subprocess.TimeoutExpired, KeyboardInterrupt):
                        stop_owned(final_sync)
                        print("Remaining records will sync next session.")
                except OSError:
                    print(
                        "Final sync could not start. Remaining records will sync next session."
                    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError) as error:
        print(f"Cannot start dashboard companion: {error}", file=sys.stderr)
        raise SystemExit(1) from None
