import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
function refresh() {
    if (exportTask) return exportTask;
    exportTask = new Promise((resolve, reject) => {
        const child = spawn(
            python,
            ["-c", "from sync import export_preview; export_preview()"],
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
    }).finally(() => {
        exportTask = null;
    });
    return exportTask;
}
await refresh();
createServer(async (req, res) => {
    try {
        if (req.method !== "GET") {
            res.writeHead(405);
            res.end();
            return;
        }
        const url = new URL(req.url, "http://localhost");
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
            const playtime = await runFile(
                python,
                [path.join(root, "playtime.py")],
                { cwd: root },
            );
            data.state.playtime = JSON.parse(playtime.stdout);
            res.writeHead(200, {
                "Content-Type": types[".json"],
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(data));
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
    } catch {
        res.writeHead(404);
        res.end("Not found");
    }
}).listen(port, "127.0.0.1", () =>
    console.log(`Local dashboard: http://localhost:${port}`),
);
