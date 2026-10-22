let initialized;

async function initialize(sql) {
    if (!initialized)
        initialized = (async () => {
            await sql`CREATE TABLE IF NOT EXISTS dashboard_sync (
            id integer PRIMARY KEY CHECK (id = 1),
            requested_id bigint NOT NULL DEFAULT 0,
            completed_id bigint NOT NULL DEFAULT 0,
            seen_at timestamptz NOT NULL DEFAULT now()
        )`;
            // Persist the destination identity across deploys and credential changes.
            // A replacement database needs fresh checkpoints even at the same URL.
            await sql`ALTER TABLE dashboard_sync ADD COLUMN IF NOT EXISTS
                database_id text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text)`;
        })().catch((error) => {
            initialized = null;
            throw error;
        });
    await initialized;
}

export async function syncStatus(sql) {
    await initialize(sql);
    const [status] = await sql`INSERT INTO dashboard_sync (id) VALUES (1)
        ON CONFLICT (id) DO UPDATE SET seen_at = now()
        RETURNING requested_id, completed_id, database_id`;
    return {
        requested_id: Number(status.requested_id),
        completed_id: Number(status.completed_id),
        database_id: status.database_id,
    };
}

export async function completeRefresh(sql, id) {
    await sql`UPDATE dashboard_sync
        SET completed_id = GREATEST(completed_id, ${id}), seen_at = now()
        WHERE id = 1 AND requested_id >= ${id}`;
}

export async function requestRefresh(
    sql,
    { timeout = 8000, interval = 250 } = {},
) {
    const [table] =
        await sql`SELECT to_regclass('dashboard_sync') IS NOT NULL AS ready`;
    if (!table.ready) return false;
    const [request] = await sql`UPDATE dashboard_sync
        SET requested_id = CASE WHEN requested_id = completed_id
            THEN requested_id + 1 ELSE requested_id END
        WHERE id = 1 AND seen_at > now() - interval '10 seconds'
        RETURNING requested_id`;
    if (!request) return false;
    const id = Number(request.requested_id);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const [status] = await sql`SELECT completed_id,
            seen_at > now() - interval '10 seconds' AS online
            FROM dashboard_sync WHERE id = 1`;
        if (!status) return false;
        if (Number(status.completed_id) >= id) return true;
        if (!status.online) return false;
    }
    return false;
}
