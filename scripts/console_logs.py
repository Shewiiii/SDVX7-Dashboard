from __future__ import annotations

import codecs
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TextIO


@contextmanager
def forward_log(path: Path, stream: TextIO) -> Iterator[None]:
    with path.open("rb") as source:
        source.seek(0, 2)
        stop = threading.Event()

        def forward() -> None:
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            while True:
                chunk = source.read(8192)
                if chunk:
                    stream.write(decoder.decode(chunk))
                    stream.flush()
                elif stop.is_set():
                    stream.write(decoder.decode(b"", final=True))
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
