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
                            row.schema_version !== 1 ||
                            !Number.isInteger(row.music_id) ||
                            !Number.isInteger(row.diff_idx) ||
                            typeof row.arcade?.description !== "string"
                        )
                            throw new Error("Invalid unlock catalog");
                        const key = `${row.music_id}:${row.diff_idx}`;
                        if (charts.has(key))
                            throw new Error("Duplicate unlock chart");
                        charts.set(key, {
                            music_id: row.music_id,
                            diff_idx: row.diff_idx,
                            description: row.arcade.description,
                            as_of: row.as_of,
                        });
                    }
                    return charts;
                })
                .catch((error) => {
                    if (saved === entry) saved = null;
                    throw error;
                });
            saved = entry;
        }
        return (await saved.task).get(`${music}:${diff}`) || null;
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
