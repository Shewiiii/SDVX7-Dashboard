import { Client } from "@neondatabase/serverless";
import { directDatabaseUrl, streamArchiveEvents } from "../lib/events.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!url)
        return res.status(503).json({ error: "Data is not connected yet" });
    try {
        const client = new Client({
            connectionString: directDatabaseUrl(url),
            connectionTimeoutMillis: 8000,
            query_timeout: 5000,
        });
        await streamArchiveEvents(req, res, client);
    } catch {
        if (!res.headersSent)
            res.status(503).json({ error: "Live updates unavailable" });
        else if (!res.writableEnded) res.end();
    }
}
