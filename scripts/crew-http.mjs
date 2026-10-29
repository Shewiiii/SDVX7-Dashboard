import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { sendAudioFile } from "./audio-http.mjs";

const execute = promisify(execFile);

export function createCrewPreview(root, python) {
    const cache = path.join(root, ".local/crews");
    const graphics = path.resolve(root, "../data/graphics");
    let preparing;
    const afpTasks = new Map();
    const voiceTasks = new Map();
    const run = (args) =>
        execute(python, ["-m", "scripts.crews", ...args], {
            cwd: root,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
    async function prepare() {
        if (!preparing)
            preparing = run([]).catch((error) => {
                preparing = null;
                throw error;
            });
        await preparing;
    }
    return async (req, res, url) => {
        if (url.pathname === "/api/crews") {
            let config = {};
            try {
                config = JSON.parse(
                    await readFile(
                        path.join(root, ".local/crew-config.json"),
                        "utf8",
                    ),
                );
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            if (config.mode === "off") {
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                });
                res.end(JSON.stringify({ crews: [], available: false }));
                return true;
            }
            await prepare();
            const catalog = JSON.parse(
                await readFile(path.join(cache, "catalog.json"), "utf8"),
            );
            const raw = JSON.parse(
                await readFile(
                    path.resolve(
                        root,
                        "../SDVX7-Proxy-main/player-data/server_data.json",
                    ),
                    "utf8",
                ),
            );
            const selected = raw.profile_parameters?.find(
                (entry) => entry.type === 2 && entry.id === 1,
            )?.param?.[24];
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
            });
            res.end(
                JSON.stringify({
                    ...catalog,
                    base: "/crew-assets/",
                    selected,
                    available: true,
                }),
            );
            return true;
        }
        if (!url.pathname.startsWith("/crew-assets/")) return false;
        await prepare();
        const relative = decodeURIComponent(
            url.pathname.slice("/crew-assets/".length),
        );
        const afp = relative.match(/^afp\/(\d+-\d+)\.json$/);
        const voice = relative.match(
            /^voices\/(vo\d{3}_[a-z_]+)\/(vo\d{3}_\d{2}_[a-z]+)-(\d+)\.json$/,
        );
        if (voice) {
            if (!voiceTasks.has(relative))
                voiceTasks.set(
                    relative,
                    run(["--voice", ...voice.slice(1)]).finally(() => {
                        voiceTasks.delete(relative);
                    }),
                );
            await voiceTasks.get(relative);
        }
        if (afp) {
            if (!afpTasks.has(afp[1]))
                afpTasks.set(
                    afp[1],
                    run(["--afp", afp[1]]).catch((error) => {
                        afpTasks.delete(afp[1]);
                        throw error;
                    }),
                );
            await afpTasks.get(afp[1]);
        }
        const directory =
            relative.startsWith("live2d/") ||
            relative.startsWith("crew_portrait/")
                ? graphics
                : relative.startsWith("portraits/")
                  ? path.join(graphics, "crew_icon")
                  : relative.startsWith("runtime/")
                    ? path.join(root, ".local/crew-tools")
                    : cache;
        const name =
            relative.startsWith("portraits/") || relative.startsWith("runtime/")
                ? relative.split("/").slice(1).join("/")
                : relative;
        const file = path.resolve(directory, name);
        if (
            !file.startsWith(directory + path.sep) ||
            !/\.(json|png|js|moc3|opus|flac)$/.test(file)
        ) {
            res.writeHead(404);
            res.end();
            return true;
        }
        if (/\.(opus|flac)$/.test(file)) {
            await sendAudioFile(req, res, file);
            return true;
        }
        const size = (await stat(file)).size;
        const type =
            {
                ".json": "application/json",
                ".png": "image/png",
                ".js": "text/javascript",
            }[path.extname(file)] || "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": type,
            "Content-Length": size,
            "Cache-Control": "no-store",
        });
        await pipeline(createReadStream(file), res);
        return true;
    };
}
