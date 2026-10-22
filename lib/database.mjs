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

export async function initialize(sql) {
    await sql`CREATE TABLE IF NOT EXISTS dashboard_records (
    kind text NOT NULL, id text NOT NULL, record jsonb NOT NULL,
    PRIMARY KEY (kind, id)
  )`;
    await sql`CREATE TABLE IF NOT EXISTS dashboard_state (
    id integer PRIMARY KEY CHECK (id = 1),
    record jsonb NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
  )`;
}
