import { watch, existsSync } from "node:fs";
import path from "node:path";

export function createPreviewLive(paths, refresh) {
    const sources = paths.map((file) => path.resolve(file));
    const watchers = new Map(),
        clients = new Set();
    let stopped = false,
        pending = false,
        running = false;
    async function changed() {
        pending = true;
        if (running) return;
        running = true;
        try {
            while (pending && !stopped) {
                pending = false;
                if (await refresh() === false) continue;
                for (const client of clients)
                    client.write("event: archive\ndata: {}\n\n");
            }
        } catch (error) {
            console.error("[preview] Archive rebuild failed:", error.message);
            // Keep the last snapshot readable; reconnects retry the refresh.
            for (const client of clients) client.end();
        } finally {
            running = false;
        }
    }
    function watchDirectories() {
        for (const source of sources) {
            let directory = path.dirname(source);
            while (
                !existsSync(directory) &&
                directory !== path.dirname(directory)
            )
                directory = path.dirname(directory);
            if (watchers.has(directory)) continue;
            const watcher = watch(
                directory,
                { persistent: false },
                (_, filename) => {
                    if (stopped) return;
                    const file = filename
                        ? path.resolve(directory, String(filename))
                        : directory;
                    if (
                        !sources.some(
                            (source) =>
                                source === file ||
                                source.startsWith(file + path.sep),
                        )
                    )
                        return;
                    watchDirectories();
                    void changed();
                },
            );
            watcher.on("error", () => {
                watcher.close();
                watchers.delete(directory);
            });
            watchers.set(directory, watcher);
        }
    }
    watchDirectories();
    return {
        refresh: changed,
        connect(res) {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store, no-transform",
                "X-Accel-Buffering": "no",
            });
            clients.add(res);
            res.write("retry: 1000\nevent: connected\ndata: {}\n\n");
            const heartbeat = setInterval(
                () => res.write(": heartbeat\n\n"),
                15000,
            );
            res.once("close", () => {
                clients.delete(res);
                clearInterval(heartbeat);
            });
        },
        close() {
            stopped = true;
            for (const watcher of watchers.values()) watcher.close();
            for (const client of clients) client.end();
        },
    };
}
