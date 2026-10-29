export default async function handler(req, res) {
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
        const response = await fetch(new URL("catalog.json", base));
        if (!response.ok) throw Error("Crew catalog unavailable");
        const catalog = await response.json();
        res.setHeader("Cache-Control", "public, max-age=60");
        return res
            .status(200)
            .json({ ...catalog, base: base.href, available: true });
    } catch {
        return res.status(503).json({ error: "Crew assets are unavailable." });
    }
}
