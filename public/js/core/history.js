export function historyIdentity(record, kind) {
    return JSON.stringify(
        kind === "plays"
            ? [
                  record.received_at,
                  record.music_id,
                  record.diff_idx,
                  record.score,
                  record.clear_type,
              ]
            : [
                  record.timestamp,
                  record.total_vf,
                  record.minimum_vf,
                  record.top_count,
              ],
    );
}

export function mergeHistory(previous, updates, kind) {
    const records = new Map(
        previous.map((row) => [historyIdentity(row, kind), row]),
    );
    for (const row of updates) records.set(historyIdentity(row, kind), row);
    return [...records.values()].sort(
        (a, b) =>
            Date.parse(a.received_at || a.timestamp) -
            Date.parse(b.received_at || b.timestamp),
    );
}

export function historyChanges(previous, current, kind) {
    const known = new Map(
        previous.map((row) => [
            historyIdentity(row, kind),
            JSON.stringify(row),
        ]),
    );
    const keys = new Set(current.map((row) => historyIdentity(row, kind)));
    if ([...known.keys()].some((key) => !keys.has(key))) return null;
    return current.filter(
        (row) => known.get(historyIdentity(row, kind)) !== JSON.stringify(row),
    );
}

export function mergeArchive(previous, update) {
    if (!update.delta) return update;
    if (
        !previous ||
        update.base_cursor !== previous.history_cursor ||
        !update.history_cursor ||
        !Array.isArray(update.plays) ||
        !Array.isArray(update.observations)
    )
        throw Object.assign(new Error("History base changed"), {
            code: "HISTORY_RESET",
        });
    const { delta, base_cursor, ...archive } = update;
    return {
        ...archive,
        plays: mergeHistory(previous.plays, update.plays, "plays"),
        observations: mergeHistory(
            previous.observations,
            update.observations,
            "observations",
        ),
    };
}
