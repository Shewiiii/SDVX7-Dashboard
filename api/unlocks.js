import { unlockResponse } from "../lib/unlocks.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    const result = await unlockResponse(req.url);
    if (result.status === 200)
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.status(result.status).json(result.body);
}
