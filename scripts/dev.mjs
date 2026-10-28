import { createPreviewCache, previewSourceSignature } from "../lib/preview-cache.mjs";
import { createPreviewWorker } from "../lib/preview-worker.mjs";
import { createPreviewLive } from "../lib/preview-live.mjs";
import { sendAudioFile } from "./audio-http.mjs";
import { packSearchIndex } from "../lib/search-index.mjs";
import { unlockResponse } from "../lib/unlocks.mjs";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const game = path.dirname(root);
const proxy = path.join(game, "SDVX7-Proxy-main");
const python = path.join(
    proxy,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".json": "application/json",
};
const audioTasks = new Map();
let searchTask = null,
    searchCache = null,
    searchAt = 0,
    searchRevision = null;
const previewSources = [
    path.join(proxy, "player-data/score_log.jsonl"),
    path.join(proxy, "player-data/volforce_history.jsonl"),
    path.join(proxy, "player-data/server_data.json"),
    path.join(proxy, "player-data/playtime.json"),
    path.join(proxy, ".env"),
    path.join(root, ".local/sync-config.json"),
    path.join(game, "data/others/music_db.xml"),
    path.join(game, "data/others/appeal_card.xml"),
    path.join(game, "data/music"),
    path.join(game, "data_mods/ryunet_custom/others/music_db.merged.xml"),
    path.join(game, "data_mods/ryunet_custom/music"),
];
const requestSignature = async () => {
    const scripts = (await readdir(path.join(root, "scripts")))
        .filter((name) => name.endsWith(".py"))
        .sort()
        .map((name) => path.join(root, "scripts", name));
    return previewSourceSignature([
        ...scripts,
        path.join(root, ".local/audio-config.json"),
        path.join(root, ".local/sync-config.json"),
        path.join(proxy, ".env"),
    ]);
};
const requestOptions = {
    module: "scripts.preview_requests",
    signature: requestSignature,
};
const previewWorker = createPreviewWorker(python, root, {
    signature: requestSignature,
});
const chartWorker = createPreviewWorker(python, root, requestOptions);
const audioWorker = createPreviewWorker(python, root, requestOptions);
const searchWorker = createPreviewWorker(python, root, requestOptions);
const previewCache = createPreviewCache({
    signature: async () =>
        JSON.stringify(
            await Promise.all([
                previewSourceSignature(
                    previewSources,
                    path.join(proxy, "player-data/playtime.json"),
                ),
                requestSignature(),
            ]),
        ),
    async build() {
        const started = performance.now();
        console.log("[preview] Building archive...");
        await previewWorker.export();
        console.log(`[preview] Archive ready in ${Math.round(performance.now() - started)} ms`);
    },
    read: async () => JSON.parse(await readFile(path.join(root, ".local/preview-data.json"), "utf8")),
});
try {
    await previewCache.refresh();
} catch (error) {
    previewWorker.close();
    throw error;
}
const previewLive = createPreviewLive(previewSources, () => previewCache.refresh());
// Periodic background rescans also recover changes missed by file notifications.
const rescan = setInterval(() => previewLive.refresh(), 60000);
rescan.unref();
const server = createServer(async (req, res) => {
    const started = performance.now();
    const requestPath = new URL(req.url, "http://localhost").pathname;
    res.on("finish", () =>
        console.log(
            `[preview] ${req.method} ${requestPath} ${res.statusCode} ${Math.round(performance.now() - started)} ms`,
        ),
    );
    try {
        if (
            req.method !== "GET" &&
            !(
                req.method === "HEAD" &&
                (requestPath === "/api/audio-file" ||
                    /^\/effects\/[a-f0-9]{64}\.wav$/.test(requestPath))
            )
        ) {
            res.writeHead(405);
            res.end();
            return;
        }
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/api/unlocks") {
            const result = await unlockResponse(req.url);
            res.writeHead(result.status, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(result.body));
            return;
        }
        if (url.pathname === "/api/events") {
            previewLive.connect(res);
            return;
        }
        if (/^\/effects\/[a-f0-9]{64}\.wav$/.test(url.pathname)) {
            await sendAudioFile(
                req,
                res,
                path.join(root, ".local", url.pathname.slice(1)),
            );
            return;
        }
        if (url.pathname === "/api/audio-file") {
            const id = url.searchParams.get("id");
            const format = url.searchParams.get("format") || "opus";
            if (
                !/^[a-f0-9]{64}$/.test(id || "") ||
                !["opus", "flac"].includes(format)
            ) {
                res.writeHead(400);
                res.end();
                return;
            }
            await sendAudioFile(
                req,
                res,
                path.join(root, ".local/audio", id + "." + format),
            );
            return;
        }
        if (url.pathname === "/api/audio") {
            const mid = url.searchParams.get("music"),
                diff = url.searchParams.get("diff");
            if (
                !/^[1-9]\d{0,7}$/.test(mid || "") ||
                Number(mid) > 10000000 ||
                !/^[0-5]$/.test(diff || "")
            ) {
                res.writeHead(400);
                res.end();
                return;
            }
            const key = mid + ":" + diff;
            if (!audioTasks.has(key))
                audioTasks.set(
                    key,
                    audioWorker
                        .request({ operation: "audio", music: mid, diff })
                        .finally(() => audioTasks.delete(key)),
                );
            const record = await audioTasks.get(key);
            res.writeHead(record ? 200 : 404, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(record || { error: "Audio unavailable" }));
            return;
        }
        if (url.pathname === "/api/search") {
            const revision = await requestSignature();
            if (
                !searchCache ||
                revision !== searchRevision ||
                Date.now() - searchAt > 60000
            ) {
                if (!searchTask)
                    searchTask = searchWorker
                        .request({ operation: "search" })
                        .then((result) => {
                            searchCache = JSON.stringify(packSearchIndex(result));
                            searchAt = Date.now();
                            searchRevision = revision;
                        })
                        .finally(() => {
                            searchTask = null;
                        });
                await searchTask;
            }
            res.writeHead(200, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
            res.end(searchCache);
            return;
        }
        if (
            url.pathname === "/api/chart" ||
            url.pathname === "/api/chart-view"
        ) {
            const music = url.searchParams.get("music"),
                diff = url.searchParams.get("diff");
            if (
                !/^[1-9]\d{0,7}$/.test(music || "") ||
                Number(music) > 10000000 ||
                !/^[0-5]$/.test(diff || "")
            ) {
                res.writeHead(400);
                res.end();
                return;
            }
            const record = await chartWorker.request({
                operation:
                    url.pathname === "/api/chart-view" ? "chart-view" : "chart",
                music,
                diff,
                check: url.searchParams.get("check") === "1",
                effects: url.searchParams.get("effects") === "1",
            });
            res.writeHead(record ? 200 : 404, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(record || { error: "Chart not found" }));
            return;
        }
        if (url.pathname === "/api/cover") {
            const id = url.searchParams.get("id");
            if (!/^[a-f0-9]{64}$/.test(id || "")) {
                res.writeHead(400);
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "image/webp" });
            res.end(
                await readFile(path.join(root, ".local/covers", `${id}.webp`)),
            );
            return;
        }
        if (url.pathname === "/api/data") {
            // A request reads one completed revision. Rebuilding happens in the
            // background and emits an event when the next revision is ready.
            void previewLive.refresh();
            const section = url.searchParams.get("section") || "full";
            if (!["full", "revision", "archive", "catalog"].includes(section)) {
                res.writeHead(400, { "Content-Type": types[".json"] });
                res.end(JSON.stringify({ error: "Invalid archive request" }));
                return;
            }
            const result = previewCache.get(section, url.searchParams.get("revision"));
            if (!result) {
                res.writeHead(409, { "Content-Type": types[".json"], "Cache-Control": "no-store" });
                res.end(JSON.stringify({ code: "REVISION_CHANGED" }));
                return;
            }
            res.writeHead(200, { "Content-Type": types[".json"], "Cache-Control": "no-store" });
            res.end(JSON.stringify(result));
            return;
        }
        const relative = decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
        );
        const file = path.resolve(publicRoot, "." + relative);
        if (!file.startsWith(publicRoot + path.sep)) {
            res.writeHead(403);
            res.end();
            return;
        }
        const body = await readFile(file);
        res.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type":
                types[path.extname(file)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
        });
        res.end(body);
    } catch (error) {
        console.error(
            `[preview] ${req.method} ${requestPath} failed:`,
            error.stderr || error.message,
        );
        const status = error.code === "ENOENT" ? 404 : 500;
        if (!res.headersSent) {
            res.writeHead(status);
            res.end(status === 404 ? "Not found" : "Preview request failed");
        } else res.destroy();
    }
}).listen(port, "127.0.0.1", () =>
    console.log(`Local dashboard: http://localhost:${port}`),
);

server.on("close", () => {
    clearInterval(rescan);
    previewLive.close();
    previewWorker.close();
    chartWorker.close();
    audioWorker.close();
    searchWorker.close();
});
