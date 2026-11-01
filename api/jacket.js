import { cachedArchive } from "../lib/archive.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).end();
    const params = new URL(req.url, "http://localhost").searchParams;
    const music = params.get("music");
    const diff = params.get("diff");
    if (
        !/^[1-9]\d{0,7}$/.test(music || "") ||
        Number(music) > 10000000 ||
        !/^[0-5]$/.test(diff || "")
    )
        return res.status(400).json({ error: "Invalid chart" });
    if (!process.env.JACKET_ASSET_URL) return res.status(404).end();
    try {
        const configured = process.env.JACKET_ASSET_URL;
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
            throw Error("Invalid jacket asset URL");
        const body = await cachedArchive(
            `jacket-catalog:${base.href}`,
            60000,
            async () => {
                const response = await fetch(new URL("catalog.json", base), {
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw Error("Jacket catalog unavailable");
                const catalog = await response.json();
                if (
                    !catalog.jackets ||
                    typeof catalog.jackets !== "object" ||
                    Array.isArray(catalog.jackets)
                )
                    throw Error("Invalid jacket catalog");
                return JSON.stringify(catalog.jackets);
            },
        );
        const digest = JSON.parse(body)[`${music}:${diff}`];
        if (!/^[a-f0-9]{64}$/.test(digest || "")) return res.status(404).end();
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
        return res
            .status(200)
            .json({ url: new URL(`${digest}.jpg`, base).href });
    } catch {
        return res
            .status(503)
            .json({ error: "High quality jacket unavailable" });
    }
}
