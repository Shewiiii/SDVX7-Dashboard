import { database, initialize } from "../lib/database.mjs";
import { syncStatus, completeRefresh } from "../lib/refresh.mjs";
import {
    authorized,
    cleanPlay,
    cleanObservation,
    cleanState,
    cleanCover,
    recordId,
} from "../lib/records.mjs";

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method))
        return res.status(405).json({ error: "GET or POST required" });
    if (!authorized(req.headers.authorization, process.env.SYNC_TOKEN))
        return res.status(401).json({ error: "Unauthorized" });
    if (req.method === "GET") {
        try {
            return res.status(200).json({
                ok: true,
                ...(await syncStatus(database())),
            });
        } catch {
            return res
                .status(503)
                .json({ error: "Sync unavailable. Retry later" });
        }
    }
    let plays, observations, state, covers, refreshId;
    try {
        const body =
            typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        if (
            !body ||
            !Array.isArray(body.plays) ||
            !Array.isArray(body.observations) ||
            body.plays.length > 200 ||
            body.observations.length > 200
        )
            throw new Error("Invalid batch");
        plays = body.plays.map(cleanPlay);
        observations = body.observations.map(cleanObservation);
        state = body.state === undefined ? null : cleanState(body.state);
        if (
            body.covers !== undefined &&
            (!Array.isArray(body.covers) || body.covers.length > 30)
        )
            throw new Error("Invalid covers");
        covers = (body.covers || []).map(cleanCover);
        refreshId = body.refresh_id;
        if (
            refreshId !== undefined &&
            (!Number.isSafeInteger(refreshId) || refreshId < 1)
        )
            throw new Error("Invalid refresh acknowledgement");
    } catch {
        return res.status(400).json({ error: "Invalid upload" });
    }
    try {
        const sql = database();
        await initialize(sql);
        const candidates = [
            ...plays.map((record) => ({
                kind: "play",
                id: recordId(record),
                record,
            })),
            ...observations.map((record) => ({
                kind: "observation",
                id: recordId(record),
                record,
            })),
            ...covers.map((record) => ({
                kind: "cover",
                id: record.id,
                record,
            })),
        ];
        const rows = [
            ...new Map(
                candidates.map((row) => [row.kind + ":" + row.id, row]),
            ).values(),
        ];
        const queries = [
            sql`INSERT INTO dashboard_records (kind, id, record)
      SELECT x.kind, x.id, x.record FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS x(kind text, id text, record jsonb) ON CONFLICT (kind, id) DO UPDATE SET record = EXCLUDED.record
      WHERE dashboard_records.record IS DISTINCT FROM EXCLUDED.record`,
        ];
        if (state)
            queries.push(sql`INSERT INTO dashboard_state (id, record) VALUES (1, ${JSON.stringify(state)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record ||
        jsonb_build_object('catalog', COALESCE(EXCLUDED.record->'catalog', dashboard_state.record->'catalog', '[]'::jsonb),
          'appeal_card', COALESCE(EXCLUDED.record->'appeal_card', dashboard_state.record->'appeal_card', 'null'::jsonb),
          'appeal_cards', COALESCE(EXCLUDED.record->'appeal_cards', dashboard_state.record->'appeal_cards', '[]'::jsonb),
          'playtime', COALESCE(EXCLUDED.record->'playtime', dashboard_state.record->'playtime', 'null'::jsonb),
          'skill_level', COALESCE(EXCLUDED.record->'skill_level', dashboard_state.record->'skill_level', 'null'::jsonb)),
        synced_at = now()`);
        await sql.transaction(queries);
        if (refreshId !== undefined) await completeRefresh(sql, refreshId);
        return res
            .status(200)
            .json({ ok: true, accepted: rows.length, play_schema: 4 });
    } catch {
        return res
            .status(503)
            .json({ error: "Database unavailable. Retry later" });
    }
}
