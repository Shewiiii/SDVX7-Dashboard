from __future__ import annotations

import codecs
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, TextIO


def timestamp() -> str:
    return datetime.now().astimezone().strftime("[%Y-%m-%d %H:%M:%S]")


def log(message: str, *, stream: TextIO) -> None:
    stream.write(f"{timestamp()} {message}\n")
    stream.flush()


def forward_pipe(source: BinaryIO, stream: TextIO) -> None:
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    for chunk in iter(source.readline, b""):
        text = decoder.decode(chunk)
        if text:
            stream.write(f"{timestamp()} {text}")
            stream.flush()
    text = decoder.decode(b"", final=True)
    if text:
        stream.write(f"{timestamp()} {text}\n")
        stream.flush()


@contextmanager
def forward_log(path: Path, stream: TextIO) -> Iterator[None]:
    with path.open("rb") as source:
        source.seek(0, 2)
        stop = threading.Event()

        def forward() -> None:
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            pending = ""
            while True:
                chunk = source.read(8192)
                if chunk:
                    pending += decoder.decode(chunk)
                    lines = pending.splitlines(keepends=True)
                    if lines and not lines[-1].endswith(("\r", "\n")):
                        pending = lines.pop()
                    else:
                        pending = ""
                    stream.writelines(f"{timestamp()} {line}" for line in lines)
                    stream.flush()
                elif stop.is_set():
                    pending += decoder.decode(b"", final=True)
                    if pending:
                        stream.write(f"{timestamp()} {pending}\n")
                    stream.flush()
                    return
                else:
                    stop.wait(0.1)

        thread = threading.Thread(target=forward, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join()
