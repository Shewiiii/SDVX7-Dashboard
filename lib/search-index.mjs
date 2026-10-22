// Fixed columns keep the separately fetched index compact. Credits are interned.
export const SEARCH_COLUMNS = [
    "music_id",
    "diff_idx",
    "effector",
    "illustrator",
    "bpm_min",
    "bpm_max",
    "length",
    "genre",
    "custom",
    "year",
    "version",
    "exscore",
    "bt_taps",
    "bt_holds",
    "fx_taps",
    "fx_holds",
    "laser_sections",
    "tempo_changes",
];
export function packSearchIndex(records) {
    const strings = [],
        ids = new Map();
    const intern = (value) => {
        value = typeof value === "string" ? value : "";
        if (!ids.has(value)) {
            ids.set(value, strings.length);
            strings.push(value);
        }
        return ids.get(value);
    };
    return {
        schema: 1,
        strings,
        rows: records.map((record) => [
            record.music_id,
            record.diff_idx,
            intern(record.effector),
            intern(record.illustrator),
            record.bpm_min ?? null,
            record.bpm_max ?? null,
            record.length ?? null,
            record.genre ?? null,
            record.is_custom === true ? 1 : 0,
            Number(record.distribution_date?.slice(0, 4)) || null,
            record.version ?? null,
            record.max_exscore ?? null,
            ...[
                "bt_taps",
                "bt_holds",
                "fx_taps",
                "fx_holds",
                "laser_sections",
            ].map((key) => record.counts?.[key] ?? null),
            record.tempo_changes ?? null,
        ]),
    };
}
