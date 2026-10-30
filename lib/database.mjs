import { neon } from "@neondatabase/serverless";

export function databaseFailure(error, fallback) {
    if (
        /exceeded.{0,100}quota|quota.{0,100}exceeded/i.test(
            String(error?.message || ""),
        )
    ) {
        return {
            code: "DATABASE_QUOTA_EXCEEDED",
            error: "Database quota exceeded. Check your Neon project usage to restore access.",
        };
    }
    return { error: fallback };
}

export function database() {
    if (!process.env.DATABASE_URL)
        throw new Error("Database is not configured");
    return neon(process.env.DATABASE_URL);
}

const initialized = new Map();

export async function initialize(sql) {
    const key = process.env.DATABASE_URL || sql;
    if (!initialized.has(key)) {
        const task = (async () => {
            await sql`CREATE TABLE IF NOT EXISTS dashboard_records (
    kind text NOT NULL, id text NOT NULL, record jsonb NOT NULL,
    PRIMARY KEY (kind, id)
  )`;
            await sql`CREATE TABLE IF NOT EXISTS dashboard_state (
    id integer PRIMARY KEY CHECK (id = 1),
    record jsonb NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
  )`;
            await sql`ALTER TABLE dashboard_records ADD COLUMN IF NOT EXISTS
                history_revision bigint NOT NULL DEFAULT 0`;
            await sql`ALTER TABLE dashboard_state
                ADD COLUMN IF NOT EXISTS history_revision bigint NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS history_epoch text NOT NULL
                    DEFAULT md5(random()::text || clock_timestamp()::text)`;
            await sql`CREATE INDEX IF NOT EXISTS dashboard_history_revision
                ON dashboard_records (history_revision)
                WHERE kind IN ('play', 'observation')`;
        })().catch((error) => {
            initialized.delete(key);
            throw error;
        });
        initialized.clear();
        initialized.set(key, task);
    }
    await initialized.get(key);
}
