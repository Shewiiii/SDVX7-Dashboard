import { database } from "../lib/database.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    const params = new URL(req.url, "http://localhost").searchParams;
    const mid = params.get("music"),
        diff = params.get("diff");
    if (
        !/^[1-9]\d{0,7}$/.test(mid || "") ||
        Number(mid) > 10000000 ||
        !/^[0-5]$/.test(diff || "")
    )
        return res.status(400).json({ error: "Invalid chart" });
    try {
        const sql = database();
        const rows =
            await sql`SELECT record FROM dashboard_records WHERE kind = 'audio' AND id = ${mid + ":" + diff}`;
        if (!rows.length || !/\.(opus|flac)$/.test(rows[0].record.url || ""))
            return res
                .status(404)
                .json({ error: "Audio has not synced for this chart" });
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        return res.status(200).json(rows[0].record);
    } catch {
        return res.status(503).json({ error: "Audio metadata unavailable" });
    }
}
