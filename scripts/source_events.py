from pathlib import Path
from threading import Event

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


class SourceEvents(FileSystemEventHandler):
    """Wake the sync worker from native filesystem notifications."""

    def __init__(self, paths):
        self.paths = {Path(path).resolve() for path in paths}
        self.changed = Event()
        self.observer = Observer()

    def on_any_event(self, event):
        if event.is_directory or event.event_type not in {
            "created",
            "modified",
            "moved",
            "deleted",
        }:
            return
        paths = (event.src_path, getattr(event, "dest_path", None))
        if any(path and Path(path).resolve() in self.paths for path in paths):
            self.changed.set()

    def __enter__(self):
        for directory in {path.parent for path in self.paths}:
            directory.mkdir(parents=True, exist_ok=True)
            self.observer.schedule(self, str(directory), recursive=False)
        self.observer.start()
        return self.changed

    def __exit__(self, *exc):
        self.observer.stop()
        self.observer.join(timeout=5)
