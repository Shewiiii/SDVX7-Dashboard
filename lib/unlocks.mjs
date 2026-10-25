import { readFile, stat } from "node:fs/promises";

export function createUnlockLookup(
    file = new URL("../public/unlocks.jsonl", import.meta.url),
) {
    let saved;

    return async (music, diff) => {
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
                    return charts;
                })
                .catch((error) => {
                    if (saved === entry) saved = null;
                    throw error;
                });
            saved = entry;
        }
        const charts = await saved.task;
        const row = charts.get(`${music}:${diff}`) || charts.get(`${music}:*`);
        return row
            ? {
                  music_id: music,
                  diff_idx: diff,
                  description: row.description,
                  as_of: row.as_of,
                  source: row.source,
              }
            : null;
    };
}

const lookup = createUnlockLookup();

export async function unlockResponse(url) {
    const params = new URL(url, "http://localhost").searchParams;
    const music = params.get("music"),
        diff = params.get("diff");
    if (
        !/^[1-9]\d{0,7}$/.test(music || "") ||
        Number(music) > 10000000 ||
        !/^[0-5]$/.test(diff || "")
    )
        return { status: 400, body: { error: "Invalid chart" } };
    try {
        const record = await lookup(Number(music), Number(diff));
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
