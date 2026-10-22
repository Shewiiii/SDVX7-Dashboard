import { database, databaseFailure } from "../lib/database.mjs";
import { requestRefresh } from "../lib/refresh.mjs";
import {
    cachedArchive,
    archiveSnapshot,
    revisionQuery,
    emptyRevision,
    etag,
} from "../lib/archive.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET")
        return res.status(405).json({ error: "GET required" });
    if (!process.env.DATABASE_URL)
        return res.status(503).json({ error: "Data is not connected yet" });
    const params = new URL(req.url, "http://localhost").searchParams;
    const section = params.get("section") || "full";
    const wanted = params.get("revision");
    if (
        !["full", "revision", "archive", "catalog"].includes(section) ||
        (wanted && wanted.length > 128)
    )
        return res.status(400).json({ error: "Invalid archive request" });
    try {
        const sql = database();
        const fresh = params.get("refresh") === "1";
        if (fresh) await requestRefresh(sql);
        const readRevision = async () =>
            (await revisionQuery(sql))[0] || emptyRevision;
        const revision =
            fresh || wanted || params.get("check") === "1"
                ? await readRevision()
                : await cachedArchive("revision", 10000, readRevision);
        let body = revision;
        let lifetime = 15;
        if (section !== "revision") {
            const token =
                section === "catalog"
                    ? revision.catalog_revision
                    : revision.revision;
            if (wanted && wanted !== token)
                return res.status(409).json({
                    code: "REVISION_CHANGED",
                    error: "Archive changed. Check the revision again.",
                });
            const key =
                section === "full"
                    ? `${section}:${revision.revision}:${revision.catalog_revision}`
                    : `${section}:${token}`;
            body = await cachedArchive(
                key,
                section === "catalog" ? 86400000 : 60000,
                async () => {
                    const snapshot = await archiveSnapshot(sql, section);
                    const actual =
                        section === "catalog"
                            ? snapshot.catalog_revision
                            : snapshot.revision;
                    if (actual !== token)
                        throw Object.assign(new Error("Revision changed"), {
                            code: "REVISION_CHANGED",
                        });
                    return snapshot;
                },
            );
            lifetime = wanted ? (section === "catalog" ? 31536000 : 3600) : 15;
        }
        if (!fresh && params.get("check") !== "1") {
            res.setHeader(
                "Cache-Control",
                wanted
                    ? "public, max-age=300"
                    : "public, max-age=0, must-revalidate",
            );
            res.setHeader(
                "Vercel-CDN-Cache-Control",
                `public, s-maxage=${lifetime}`,
            );
        }
        const tag = etag(JSON.stringify(body));
        res.setHeader("ETag", tag);
        if (req.headers["if-none-match"] === tag) return res.status(304).end();
        return res.status(200).json(body);
    } catch (error) {
        res.setHeader("Cache-Control", "no-store");
        if (error.code === "REVISION_CHANGED")
            return res.status(409).json({
                code: error.code,
                error: "Archive changed. Check the revision again.",
            });
        return res
            .status(503)
            .json(
                databaseFailure(error, "Data unavailable. Try again shortly"),
            );
    }
}
