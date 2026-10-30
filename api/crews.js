import { cachedArchive, etag } from "../lib/archive.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).end();
    const configured = process.env.CREW_ASSET_URL;
    if (!configured)
        return res.status(200).json({ crews: [], available: false });
    try {
        const base = new URL(
            configured.endsWith("/") ? configured : configured + "/",
        );
        if (
            base.protocol !== "https:" ||
            base.username ||
            base.password ||
            base.search ||
            base.hash
        )
            throw Error("Invalid crew asset URL");
        const body = await cachedArchive(
            `crew-catalog:${base.href}`,
            60000,
            async () => {
                const response = await fetch(new URL("catalog.json", base), {
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw Error("Crew catalog unavailable");
                const catalog = await response.json();
                if (!Array.isArray(catalog.crews))
                    throw Error("Invalid crew catalog");
                return JSON.stringify({
                    ...catalog,
                    base: base.href,
                    available: true,
                });
            },
        );
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=60");
        const tag = etag(body);
        res.setHeader("ETag", tag);
        if (req.headers?.["if-none-match"] === tag)
            return res.status(304).end();
        return res.status(200).json(JSON.parse(body));
    } catch {
        return res.status(503).json({ error: "Crew assets are unavailable." });
    }
}
