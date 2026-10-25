import { database } from "../lib/database.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    const params = new URL(req.url, "http://localhost").searchParams;
    const music = params.get("music"),
        diff = params.get("diff");
    if (
        !/^[1-9]\d{0,7}$/.test(music || "") ||
        Number(music) > 10000000 ||
        !/^[0-5]$/.test(diff || "")
    )
        return res.status(400).json({ error: "Invalid chart" });
    try {
        const sql = database();
        const rows =
            await sql`SELECT record FROM dashboard_records WHERE kind = 'chart_detail' AND id = ${music + ":" + diff}`;
        if (!rows.length)
            return res
                .status(404)
                .json({ error: "Details have not synced yet" });
        // Older summaries stay usable while updated statistics are syncing.
        if (
            !rows[0].record.chart ||
            (rows[0].record.chart.laser_density_version === 2 &&
                Number.isInteger(rows[0].record.chart.max_chain) &&
                typeof rows[0].record.chart.max_chain_estimated === "boolean")
        )
            res.setHeader(
                "Cache-Control",
                "public, max-age=300, s-maxage=300, stale-if-error=86400",
            );
        const { timeline, ...summary } = rows[0].record;
        return res.status(200).json(summary);
    } catch {
        return res
            .status(503)
            .json({ error: "Details unavailable. Try again shortly" });
    }
}
