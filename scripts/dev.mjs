import { createHash } from "node:crypto";
import { sendAudioFile } from "./audio-http.mjs";
import { packSearchIndex } from "../lib/search-index.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const python = path.join(
    root,
    "..",
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const runFile = promisify(execFile);
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".json": "application/json",
};
let exportTask = null;
const audioTasks = new Map();
let searchTask = null,
    searchCache = null,
    searchAt = 0;
let exportedSignature = null;
let exportedAt = 0;
const tracker = path.dirname(root);
const game = path.dirname(tracker);
const previewSources = [
    path.join(tracker, "score_log.txt"),
    path.join(tracker, "volforce_history.jsonl"),
    path.join(tracker, "cache/total_volforce.json"),
    path.join(tracker, "cache/playtime.json"),
    path.join(tracker, ".env"),
    path.join(root, ".local/sync-config.json"),
    path.join(root, ".local/preview-data.json"),
    path.join(game, "data/others/music_db.xml"),
    path.join(game, "data/others/appeal_card.xml"),
    path.join(game, "data/music"),
    path.join(game, "data_mods/ryunet_custom/others/music_db.merged.xml"),
    path.join(game, "data_mods/ryunet_custom/music"),
];
async function sourceSignature() {
    return JSON.stringify(
        await Promise.all(
            previewSources.map(async (file) => {
                try {
                    const info = await stat(file);
                    return [info.mtimeMs, info.size];
                } catch (error) {
                    if (error.code === "ENOENT") return null;
                    throw error;
                }
            }),
        ),
    );
}
async function refresh() {
    const signature = await sourceSignature();
    if (exportTask) return exportTask;
    // Source edits invalidate immediately; periodically rescan nested artwork too.
    if (signature === exportedSignature && Date.now() - exportedAt < 60000)
        return;
    const started = performance.now();
    console.log("[preview] Building archive...");
    exportTask = new Promise((resolve, reject) => {
        const child = spawn(
            python,
            [
                "-u",
                "-c",
                "from scripts.sync import export_preview; export_preview()",
            ],
            {
                cwd: root,
            },
        );
        child.stdout.on("data", (data) => process.stdout.write(data));
        child.stderr.on("data", (data) => process.stderr.write(data));
        child.on("error", reject);
        child.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error("Export failed")),
        );
    })
        .then(async () => {
            console.log(
                `[preview] Archive ready in ${Math.round(performance.now() - started)} ms`,
            );
            // The export itself rewrites preview-data.json.
            exportedSignature = await sourceSignature();
            exportedAt = Date.now();
            // Do not swallow an input change that happened while exporting.
            const before = JSON.parse(signature),
                after = JSON.parse(exportedSignature);
            const outputIndex = 6;
            before[outputIndex] = after[outputIndex];
            if (JSON.stringify(before) !== JSON.stringify(after))
                exportedSignature = null;
        })
        .finally(() => {
            exportTask = null;
        });
    return exportTask;
}
await refresh();
createServer(async (req, res) => {
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
            !(req.method === "HEAD" && requestPath === "/api/audio-file")
        ) {
            res.writeHead(405);
            res.end();
            return;
        }
        const url = new URL(req.url, "http://localhost");
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
                    runFile(
                        python,
                        [
                            "-u",
                            "-c",
                            `from scripts.audio import preview; preview(${mid},${diff})`,
                        ],
                        { cwd: root, maxBuffer: 100000, timeout: 200000 },
                    ).finally(() => audioTasks.delete(key)),
                );
            const result = await audioTasks.get(key);
            if (result.stderr) process.stderr.write(result.stderr);
            const record = JSON.parse(result.stdout);
            res.writeHead(record ? 200 : 404, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(record || { error: "Audio unavailable" }));
            return;
        }
        if (url.pathname === "/api/search") {
            if (!searchCache || Date.now() - searchAt > 60000) {
                if (!searchTask)
                    searchTask = runFile(
                        python,
                        [
                            "-c",
                            "from scripts.chart_details import search_preview; search_preview()",
                        ],
                        { cwd: root, maxBuffer: 16000000 },
                    )
                        .then((result) => {
                            if (result.stderr)
                                process.stderr.write(result.stderr);
                            searchCache = JSON.stringify(
                                packSearchIndex(JSON.parse(result.stdout)),
                            );
                            searchAt = Date.now();
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
        if (url.pathname === "/api/chart") {
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
            const result = await runFile(
                python,
                [
                    "-c",
                    "from scripts.chart_details import preview; preview(" +
                        music +
                        "," +
                        diff +
                        ")",
                ],
                { cwd: root, maxBuffer: 100000 },
            );
            const record = JSON.parse(result.stdout);
            if (result.stderr) process.stderr.write(result.stderr);
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
            await refresh();
            const data = JSON.parse(
                await readFile(
                    path.join(root, ".local/preview-data.json"),
                    "utf8",
                ),
            );
            const section = url.searchParams.get("section") || "full";
            const library = {
                catalog: data.state.catalog || [],
                appeal_cards: data.state.appeal_cards || [],
            };
            const versions = {
                revision: data.synced_at || "empty",
                catalog_revision: createHash("md5")
                    .update(JSON.stringify(library))
                    .digest("hex"),
            };
            const expected =
                section === "catalog"
                    ? versions.catalog_revision
                    : versions.revision;
            if (
                url.searchParams.has("revision") &&
                url.searchParams.get("revision") !== expected
            ) {
                res.writeHead(409, {
                    "Content-Type": types[".json"],
                    "Cache-Control": "no-store",
                });
                res.end(JSON.stringify({ code: "REVISION_CHANGED" }));
                return;
            }
            let result;
            if (section === "revision") result = versions;
            else if (section === "catalog")
                result = {
                    catalog_revision: versions.catalog_revision,
                    state: library,
                };
            else {
                const playtime = await runFile(
                    python,
                    ["-m", "scripts.playtime"],
                    { cwd: root },
                );
                data.state.playtime = JSON.parse(playtime.stdout);
                if (playtime.stderr) process.stderr.write(playtime.stderr);
                if (section === "archive") {
                    delete data.state.catalog;
                    delete data.state.appeal_cards;
                }
                result = { ...data, ...versions };
            }
            res.writeHead(200, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
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
