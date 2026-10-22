import { createHash } from "node:crypto";

// Coalesce concurrent requests. Failures are never cached, and memory is bounded.
const cache = new Map();
export function cachedArchive(key, ttl, read) {
    const saved = cache.get(key);
    if (saved && saved.until > Date.now()) return saved.task;
    const entry = { until: Date.now() + ttl };
    entry.task = Promise.resolve()
        .then(read)
        .catch((error) => {
            if (cache.get(key) === entry) cache.delete(key);
            throw error;
        });
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > 8) cache.delete(cache.keys().next().value);
    return entry.task;
}
export const etag = (value) =>
    '"' + createHash("sha256").update(value).digest("hex") + '"';
export function revisionQuery(sql) {
    // Fingerprint inside Postgres; do not transfer the catalog just to check it.
    return sql`SELECT synced_at::text AS revision,
        md5(jsonb_build_object('catalog', COALESCE(record->'catalog', '[]'::jsonb),
            'appeal_cards', COALESCE(record->'appeal_cards', '[]'::jsonb))::text) AS catalog_revision
        FROM dashboard_state WHERE id = 1`;
}
export const emptyRevision = { revision: "empty", catalog_revision: "empty" };
export async function archiveSnapshot(sql, section) {
    const projection =
        section === "catalog"
            ? sql`SELECT jsonb_build_object('catalog', COALESCE(record->'catalog', '[]'::jsonb),
            'appeal_cards', COALESCE(record->'appeal_cards', '[]'::jsonb)) AS record,
            synced_at FROM dashboard_state WHERE id = 1`
            : section === "archive"
              ? sql`SELECT record - 'catalog' - 'appeal_cards' AS record, synced_at
            FROM dashboard_state WHERE id = 1`
              : sql`SELECT record, synced_at FROM dashboard_state WHERE id = 1`;
    const queries = [revisionQuery(sql), projection];
    if (section !== "catalog")
        queries.push(sql`SELECT kind,
        jsonb_agg(record ORDER BY COALESCE(record->>'received_at', record->>'timestamp')) AS items
        FROM dashboard_records WHERE kind IN ('play', 'observation') GROUP BY kind`);
    const [revisions, states, records = []] = await sql.transaction(queries, {
        isolationLevel: "RepeatableRead",
        readOnly: true,
    });
    const version = revisions[0] || emptyRevision;
    if (section === "catalog")
        return {
            catalog_revision: version.catalog_revision,
            state: states[0]?.record || { catalog: [], appeal_cards: [] },
        };
    const grouped = Object.fromEntries(
        records.map((row) => [row.kind, row.items]),
    );
    return {
        ...version,
        plays: grouped.play || [],
        observations: grouped.observation || [],
        state: states[0]?.record || { name: "Player", charts: [] },
        synced_at: states[0]?.synced_at || null,
        source: "cloud",
    };
}
