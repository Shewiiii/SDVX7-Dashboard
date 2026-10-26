import { cachedArchive } from "../lib/archive.mjs";
import { createHash } from "node:crypto";
import { database } from "../lib/database.mjs";
import { packSearchIndex } from "../lib/search-index.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    try {
        const sql = database();
        // Project only search metadata in SQL; graph arrays never cross the wire.
        const body = await cachedArchive("search-index-v2", 300000, async () => {
            const records =
                await sql`SELECT record->'music_id' AS music_id, record->'diff_idx' AS diff_idx,
            record->>'effector' AS effector, record->>'illustrator' AS illustrator,
            record->'bpm_min' AS bpm_min, record->'bpm_max' AS bpm_max,
            record->'genre' AS genre, record->'is_custom' AS is_custom,
            record->>'distribution_date' AS distribution_date, record->'version' AS version,
            record->'max_exscore' AS max_exscore, record#>'{chart,duration}' AS length,
            record#>'{chart,counts}' AS counts, record#>'{chart,bpm_change_count}' AS tempo_changes,
            record#>'{chart,visual_gimmicks}' AS visual_gimmicks,
            record#>'{chart,visual_gimmicks_version}' AS visual_gimmicks_version
            FROM dashboard_records WHERE kind = 'chart_detail' ORDER BY id`;
            return JSON.stringify(packSearchIndex(records));
        });
        const etag =
            '"' + createHash("sha256").update(body).digest("hex") + '"';
        res.setHeader(
            "Cache-Control",
            "public, max-age=300, s-maxage=300, stale-if-error=86400",
        );
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).send(body);
    } catch {
        return res
            .status(503)
            .json({ error: "Search metadata unavailable. Try again shortly." });
    }
}
