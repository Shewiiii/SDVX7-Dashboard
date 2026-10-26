import { readFile, stat } from "node:fs/promises";
import { UNLOCK_METHODS } from "../public/unlock-methods.js";

export function createUnlockCatalog(
    file = new URL("../public/game-data/unlocks.jsonl", import.meta.url),
) {
    let saved;

    async function readCatalog() {
        const info = await stat(file);
        const signature = `${info.mtimeMs}:${info.size}`;
        if (!saved || saved.signature !== signature) {
            const entry = { signature };
            entry.task = readFile(file, "utf8")
                .then((text) => {
                    const charts = new Map();
                    for (const line of text.split(/\r?\n/)) {
                        if (!line.trim()) continue;
                        const row = JSON.parse(line);
                        if (
                            typeof row.chart_id !== "string" ||
                            !/^[1-9]\d{0,7}:(?:[0-5]|\*)$/.test(row.chart_id) ||
                            !Object.hasOwn(UNLOCK_METHODS, row.method) ||
                            typeof row.description !== "string" ||
                            !row.description.trim() ||
                            !/^\d{4}-\d{2}-\d{2}$/.test(row.as_of || "") ||
                            !Array.isArray(row.source) ||
                            !row.source.every((url) => {
                                if (typeof url !== "string") return false;
                                try {
                                    return ["http:", "https:"].includes(
                                        new URL(url).protocol,
                                    );
                                } catch {
                                    return false;
                                }
                            })
                        )
                            throw new Error("Invalid unlock catalog");
                        const key = row.chart_id;
                        if (charts.has(key))
                            throw new Error("Duplicate unlock chart");
                        charts.set(key, row);
                    }
                    return {
                        charts,
                        methods: Object.fromEntries(
                            [...charts].map(([key, row]) => [key, row.method]),
                        ),
                    };
                })
                .catch((error) => {
                    if (saved === entry) saved = null;
                    throw error;
                });
            saved = entry;
        }
        return saved.task;
    }

    return {
        async get(music, diff) {
            const { charts } = await readCatalog();
            const row = charts.get(`${music}:${diff}`) || charts.get(`${music}:*`);
            return row
                ? {
                      music_id: music,
                      diff_idx: diff,
                      method: row.method,
                      description: row.description,
                      as_of: row.as_of,
                      source: row.source,
                  }
                : null;
        },
        async methods() {
            return (await readCatalog()).methods;
        },
    };
}

export function createUnlockLookup(file) {
    return createUnlockCatalog(file).get;
}

const catalog = createUnlockCatalog();

export async function unlockResponse(url) {
    const params = new URL(url, "http://localhost").searchParams;
    const music = params.get("music"),
        diff = params.get("diff");
    const indexRequested = params.has("index");
    const methodsIndex =
        params.get("index") === "methods" &&
        !params.has("music") &&
        !params.has("diff");
    if (indexRequested && !methodsIndex)
        return { status: 400, body: { error: "Invalid unlock index" } };
    if (
        !methodsIndex &&
        (!/^[1-9]\d{0,7}$/.test(music || "") ||
            Number(music) > 10000000 ||
            !/^[0-5]$/.test(diff || ""))
    )
        return { status: 400, body: { error: "Invalid chart" } };
    try {
        if (methodsIndex)
            return { status: 200, body: { methods: await catalog.methods() } };
        const record = await catalog.get(Number(music), Number(diff));
        return record
            ? { status: 200, body: record }
            : { status: 404, body: { error: "Unlock method is unknown" } };
    } catch {
        return {
            status: 503,
            body: { error: "Unlock information is temporarily unavailable" },
        };
    }
}
