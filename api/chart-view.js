import { database } from "../lib/database.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
    const params = new URL(req.url, "http://localhost").searchParams;
    const music = params.get("music"), diff = params.get("diff");
    if (!/^[1-9]\d{0,7}$/.test(music || "") || Number(music) > 10000000 || !/^[0-5]$/.test(diff || ""))
        return res.status(400).json({ error: "Invalid chart" });
    try {
        const sql = database(), id = music + ":" + diff;
        if (params.get("check") === "1") {
            const rows = await sql`SELECT (record->>'timeline') IS NOT NULL AS available FROM dashboard_records WHERE kind = 'chart_detail' AND id = ${id}`;
            return res.status(200).json({ available: rows[0]?.available === true });
        }
        const rows = await sql`SELECT record->>'timeline' AS timeline FROM dashboard_records WHERE kind = 'chart_detail' AND id = ${id}`;
        if (!rows[0]?.timeline) return res.status(404).json({ error: "Chart has not synced yet" });
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        return res.status(200).send(Buffer.from(rows[0].timeline, "base64"));
    } catch {
        return res.status(503).json({ error: "Chart unavailable. Try again shortly" });
    }
}
