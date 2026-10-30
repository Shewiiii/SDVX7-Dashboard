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

export function historyCursor(value) {
    if (
        typeof value !== "string" ||
        !/^[a-f0-9]{32}:(0|[1-9]\d{0,18})$/.test(value)
    )
        return null;
    const [epoch, revision] = value.split(":");
    return BigInt(revision) <= 9223372036854775807n
        ? { epoch, revision }
        : null;
}

export function compatibleHistoryCursor(previous, current) {
    const before = historyCursor(previous),
        after = historyCursor(current);
    return (
        !!before &&
        !!after &&
        before.epoch === after.epoch &&
        BigInt(before.revision) <= BigInt(after.revision)
    );
}

export function revisionQuery(sql) {
    // Fingerprint inside Postgres, do not transfer the catalog just to check it.
    return sql`SELECT synced_at::text AS revision,
        CASE WHEN to_jsonb(s)->>'history_epoch' IS NOT NULL THEN
            (to_jsonb(s)->>'history_epoch') || ':' || (to_jsonb(s)->>'history_revision')
            ELSE NULL END AS history_cursor,
        md5(jsonb_build_object('catalog', COALESCE(record->'catalog', '[]'::jsonb),
            'appeal_cards', COALESCE(record->'appeal_cards', '[]'::jsonb))::text) AS catalog_revision
        FROM dashboard_state s WHERE id = 1`;
}
export const emptyRevision = { revision: "empty", catalog_revision: "empty" };
export async function archiveSnapshot(sql, section, since = null) {
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
    if (section !== "catalog") {
        const cursor = historyCursor(since);
        queries.push(
            cursor
                ? sql`SELECT kind,
        jsonb_agg(record ORDER BY COALESCE(record->>'received_at', record->>'timestamp')) AS items
        FROM dashboard_records WHERE kind IN ('play', 'observation')
            AND history_revision > ${cursor.revision}::bigint GROUP BY kind`
                : sql`SELECT kind,
        jsonb_agg(record ORDER BY COALESCE(record->>'received_at', record->>'timestamp')) AS items
        FROM dashboard_records WHERE kind IN ('play', 'observation') GROUP BY kind`,
        );
    }
    const [revisions, states, records = []] = await sql.transaction(queries, {
        isolationLevel: "RepeatableRead",
        readOnly: true,
    });
    const version = revisions[0] || emptyRevision;
    if (since && !compatibleHistoryCursor(since, version.history_cursor))
        return archiveSnapshot(sql, section);
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
        ...(since ? { delta: true, base_cursor: since } : {}),
        plays: grouped.play || [],
        observations: grouped.observation || [],
        state: states[0]?.record || { name: "Player", charts: [] },
        synced_at: states[0]?.synced_at || null,
        source: "cloud",
    };
}
