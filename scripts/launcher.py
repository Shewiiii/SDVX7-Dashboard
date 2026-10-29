from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

from scripts.companion import ROOT, load_config, proxy_python, resolve_proxy
from scripts.console_logs import forward_log, forward_pipe, log
from scripts.process_lifetime import contain_process_tree, stop_orphaned_sync


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
    proxy = resolve_proxy()
    python = proxy_python(proxy)
    connected = bool(config.get("url") and len(config.get("token", "")) >= 32)
    if connected and sync_running():
        # Also recover workers launched before the scripts/ reorganization.
        stop_orphaned_sync(python, ROOT / "sync.py")
    local = ROOT / ".local"
    local.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    sync_process = proxy_process = None
    proxy_output = None
    retry_at = 0
    started_sync = False
    hidden = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    with (
        (local / "sync.log").open("ab") as output,
        (local / "sync-errors.log").open("ab") as errors,
        forward_log(local / "sync.log", sys.stdout),
        forward_log(local / "sync-errors.log", sys.stderr),
    ):

        def start_sync() -> subprocess.Popen[bytes]:
            return subprocess.Popen(
                [str(python), "-u", "-m", "scripts.sync"],
                cwd=ROOT,
                env=env,
                stdout=output,
                stderr=errors,
                **hidden,
            )

        try:
            proxy_process = subprocess.Popen(
                [str(python), "-u", "-m", "proxy.launcher"],
                cwd=proxy,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            proxy_output = threading.Thread(
                target=forward_pipe,
                args=(proxy_process.stdout, sys.stdout),
                name="proxy-console",
                daemon=True,
            )
            proxy_output.start()
            if not connected:
                log(
                    "Dashboard is not connected. Run Setup-dashboard.bat to enable cloud sync.",
                    stream=sys.stdout,
                )
            elif sync_running():
                log(
                    "Dashboard sync is already running. Using the existing worker.",
                    stream=sys.stdout,
                )
            while proxy_process.poll() is None:
                if (
                    connected
                    and time.monotonic() >= retry_at
                    and (sync_process is None or sync_process.poll() is not None)
                ):
                    try:
                        if not sync_running():
                            sync_process = start_sync()
                            started_sync = True
                            log(
                                "Dashboard sync started. The proxy runs independently.",
                                stream=sys.stdout,
                            )
                    except OSError:
                        log(
                            "Dashboard sync could not start. Retrying in 30 seconds. The proxy continues.",
                            stream=sys.stdout,
                        )
                    retry_at = time.monotonic() + 30
                time.sleep(0.5)
            return proxy_process.returncode or 0
        except KeyboardInterrupt:
            log("Stopping proxy and dashboard sync...", stream=sys.stdout)
            # The original launcher receives Ctrl+C through the shared console.
            try:
                proxy_process.wait(timeout=8)
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                stop_owned(proxy_process)
            return 0
        finally:
            stop_owned(proxy_process)
            stop_owned(sync_process)
            if proxy_output:
                proxy_output.join(timeout=1)
            if connected and started_sync and not sync_running():
                try:
                    final_sync = subprocess.Popen(
                        [
                            str(python),
                            "-u",
                            "-c",
                            "from scripts.sync import run; run(once=True)",
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
                        log("Remaining records will sync next session.", stream=sys.stdout)
                except OSError:
                    log(
                        "Final sync could not start. Remaining records will sync next session.",
                        stream=sys.stdout,
                    )


if __name__ == "__main__":
    try:
        contain_process_tree()
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        log(f"Cannot start dashboard companion: {error}", stream=sys.stderr)
        raise SystemExit(1) from None
