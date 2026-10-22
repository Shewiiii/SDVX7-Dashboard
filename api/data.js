import { database } from "../lib/database.mjs";
import { requestRefresh } from "../lib/refresh.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    if (!process.env.DATABASE_URL)
        return res.status(503).json({ error: "Data is not connected yet" });
    try {
        const sql = database();
        if (
            new URL(req.url, "http://localhost").searchParams.get("refresh") ===
            "1"
        )
            await requestRefresh(sql);
        const [records, states] = await sql.transaction([
            sql`SELECT kind, jsonb_agg(record ORDER BY COALESCE(record->>'received_at', record->>'timestamp')) AS items
          FROM dashboard_records WHERE kind IN ('play', 'observation') GROUP BY kind`,
            sql`SELECT record, synced_at FROM dashboard_state WHERE id = 1`,
        ]);
        const grouped = Object.fromEntries(
            records.map((r) => [r.kind, r.items]),
        );
        return res.status(200).json({
            plays: grouped.play || [],
            observations: grouped.observation || [],
            state: states[0]?.record || { name: "Player", charts: [] },
            synced_at: states[0]?.synced_at || null,
            source: "cloud",
        });
    } catch {
        res.setHeader("Cache-Control", "no-store");
        return res
            .status(503)
            .json({ error: "Data unavailable. Try again shortly" });
    }
}
