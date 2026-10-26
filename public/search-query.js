import { SONG_GENRES } from "./song-metadata.js";
import { isBossChart } from "./boss-charts.js";

export function normalizeSearch(value) {
    return String(value)
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/ß/g, "ss")
        .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\u3099\u309a]/gu, "");
}
const fields = [
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
    "gimmicks",
];
const aliases = {
    bpm: "bpm_max",
    bpmmin: "bpm_min",
    bpmmax: "bpm_max",
    diff: "diff_idx",
    difficulty: "diff_idx",
    duration: "length",
    score: "score",
    grade: "grade",
    clear: "clear",
    top50: "top50",
    boss: "boss",
    id: "id",
    level: "level",
    notes: "notes",
    peak: "peak",
    tsumami: "tsumami",
    tricky: "tricky",
    handtrip: "handtrip",
    onehand: "onehand",
    artist: "artist",
    title: "title",
};
for (const field of fields.slice(2)) aliases[field] = field;
const grades = ["D", "C", "B", "A", "A+", "AA", "AA+", "AAA", "AAA+", "S"];
const diffs = ["NOV", "ADV", "EXH", "INF", "MXM", "ULT"];
const clears = [
    "noclear",
    "crash",
    "effective",
    "excessive",
    "maxxive",
    "uc",
    "puc",
];
const textFields = new Set([
    "effector",
    "illustrator",
    "genre",
    "artist",
    "title",
]);
const booleanFields = new Set(["custom", "top50", "boss", "gimmicks"]);
const genreNames = new Set(
    SONG_GENRES.flatMap(([, label, aliases = []]) =>
        [label, ...aliases].map(normalizeSearch),
    ),
);
let index = new Map(),
    best = new Map(),
    top = new Set();

const genreCache = new Map();
export function genreText(genre, custom) {
    const key = `${genre}:${custom}`;
    if (!genreCache.has(key))
        genreCache.set(
            key,
            custom
                ? "Custom Map"
                : SONG_GENRES.filter(([bit]) => (genre || 0) & bit)
                      .map(([, label, aliases = []]) =>
                          [label, ...aliases].join(" "),
                      )
                      .join(" ") || "Other",
        );
    return genreCache.get(key);
}
export function installSearchIndex(packed) {
    if (
        ![1, 2].includes(packed?.schema) ||
        !Array.isArray(packed.rows) ||
        packed.rows.length > 48000 ||
        !Array.isArray(packed.strings)
    )
        throw Error("Invalid search index");
    const columns = packed.schema === 1 ? fields.slice(0, -1) : fields;
    const next = new Map();
    for (const row of packed.rows) {
        if (
            !Array.isArray(row) ||
            row.length !== columns.length ||
            !Number.isInteger(row[0]) ||
            !Number.isInteger(row[1]) ||
            row[1] < 0 ||
            row[1] > 5 ||
            (packed.schema === 2 && ![null, 0, 1].includes(row.at(-1)))
        )
            throw Error("Invalid search record");
        const record = Object.fromEntries(
            columns.map((field, i) => [field, row[i]]),
        );
        for (const field of ["effector", "illustrator"]) {
            const value = packed.strings[record[field]];
            if (typeof value !== "string") throw Error("Invalid search credit");
            record[field] = value;
        }
        record._text = [
            record.effector,
            record.illustrator,
            genreText(record.genre, record.custom),
        ].map(normalizeSearch);
        next.set(`${record.music_id}:${record.diff_idx}`, record);
    }
    index = next;
}
export function setSearchData(data) {
    best = new Map();
    for (const chart of [...data.plays, ...(data.state.charts || [])]) {
        const key = `${chart.music_id}:${chart.diff_idx}`,
            previous = best.get(key) || { score: 0, clear: 0 };
        best.set(key, {
            score: Math.max(previous.score, chart.score || 0),
            clear: Math.max(previous.clear, chart.clear_type || 0),
        });
    }
    top = new Set(
        [...(data.state.charts || [])]
            .sort(
                (a, b) =>
                    b.vf - a.vf ||
                    a.music_id - b.music_id ||
                    a.diff_idx - b.diff_idx,
            )
            .slice(0, 50)
            .map((c) => `${c.music_id}:${c.diff_idx}`),
    );
}
export function parseSearch(query) {
    const words = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const filters = [],
        free = [],
        excludedTokens = [],
        errors = [];
    let difficulty = -1;
    for (const word of words) {
        const boolean = word.match(/^(!?)(custom|top50)$/i);
        const filter = boolean
            ? `${boolean[2]}=${boolean[1] ? "false" : "true"}`
            : word;
        const match = filter.match(
            /^([a-z_][a-z_0-9-]*)(<=|>=|!=|=|<|>)(.*)$/i,
        );
        if (!match) {
            if (word.startsWith("!") && word.length > 1) {
                const value = normalizeSearch(
                    word.slice(1).replace(/^"|"$/g, ""),
                );
                if (!value) errors.push(`Invalid filter: ${word}`);
                else if (genreNames.has(value))
                    filters.push({
                        field: "genre",
                        operator: "!=",
                        expected: value,
                    });
                else excludedTokens.push(value);
            } else free.push(word.replace(/^"|"$/g, ""));
            continue;
        }
        const [, rawField, rawOperator, raw] = match,
            field = aliases[rawField.toLowerCase().replace(/-/g, "")];
        const optionalField =
            textFields.has(field) || ["custom", "top50"].includes(field);
        let operator = rawOperator,
            value = raw;
        if (value.startsWith("!")) {
            if (!optionalField || !["=", "!="].includes(operator)) {
                errors.push(`Invalid value: ${word}`);
                continue;
            }
            operator = operator === "=" ? "!=" : "=";
            value = value.slice(1);
        }
        value = value.replace(/^"|"$/g, "");
        if (!field || !value) {
            errors.push(`Invalid filter: ${word}`);
            continue;
        }
        if (field === "id") {
            if (!["=", "!="].includes(operator)) {
                errors.push("Use = or != with id");
                continue;
            }
            const id = value.match(/^([1-9]\d{0,7})(?::([0-5]|\*))?$/);
            if (!id || Number(id[1]) > 10000000) {
                errors.push(`Invalid value: ${word}`);
                continue;
            }
            filters.push({
                field,
                operator,
                expected: {
                    music_id: Number(id[1]),
                    diff_idx: !id[2] || id[2] === "*" ? null : Number(id[2]),
                },
            });
            continue;
        }
        let expected;
        if (textFields.has(field)) {
            if (!["=", "!="].includes(operator)) {
                errors.push(`Use = or != with ${rawField}`);
                continue;
            }
            expected = normalizeSearch(value);
        } else if (field === "diff_idx")
            expected = diffs.indexOf(
                value
                    .toUpperCase()
                    .replace(/^(INF\/VVD|VVD|GRV|HVN|XCD|NBL)$/, "INF"),
            );
        else if (field === "grade")
            expected =
                value.toLowerCase() === "unplayed"
                    ? -1
                    : grades.indexOf(value.toUpperCase());
        else if (field === "clear")
            expected = clears.indexOf(normalizeSearch(value));
        else if (booleanFields.has(field))
            expected = /^(true|yes|1)$/i.test(value)
                ? 1
                : /^(false|no|0)$/i.test(value)
                  ? 0
                  : NaN;
        else expected = Number(value);
        if (
            (!textFields.has(field) &&
                (!Number.isFinite(expected) ||
                    (["diff_idx", "clear", "grade"].includes(field) &&
                        expected < 0 &&
                        !(
                            field === "grade" &&
                            value.toLowerCase() === "unplayed"
                        )))) ||
            expected === ""
        )
            errors.push(`Invalid value: ${word}`);
        else filters.push({ field, operator, expected });
    }
    const last = free.at(-1)?.toUpperCase();
    if (
        diffs.includes(last) ||
        ["INF/VVD", "VVD", "GRV", "HVN", "XCD", "NBL"].includes(last)
    ) {
        difficulty = diffs.indexOf(
            ["INF/VVD", "VVD", "GRV", "HVN", "XCD", "NBL"].includes(last)
                ? "INF"
                : last,
        );
        free.pop();
    }
    const tokens = free.map(normalizeSearch).filter(Boolean);
    return {
        difficulty,
        tokens,
        term: tokens.join(""),
        excludedTokens,
        filters,
        errors,
    };
}
export function extraSearchText(song, difficulty) {
    const record = index.get(`${song.music_id}:${difficulty.diff_idx}`);
    return record
        ? record._text
        : [normalizeSearch(genreText(song.genre, song.is_custom))];
}

export function songVersion(song) {
    for (const difficulty of song.difficulties) {
        const key = `${song.music_id}:${difficulty.diff_idx}`;
        const version = index.get(key)?.version;
        if (Number.isInteger(version)) return version;
    }
    return song.version;
}

export function matchesSearchFilters(song, d, search) {
    if (search.errors.length) return false;
    if (search.excludedTokens?.length) {
        const text = [
            song.title,
            song.artist,
            song.title_ascii || "",
            ...(song.forms || []).flat(),
            ...extraSearchText(song, d),
        ].map(normalizeSearch);
        if (
            search.excludedTokens.some((token) =>
                text.some((value) => value.includes(token)),
            )
        )
            return false;
    }
    const key = `${song.music_id}:${d.diff_idx}`,
        record = index.get(key),
        played = best.get(key);
    for (const { field, operator, expected } of search.filters) {
        if (field === "id") {
            const matches =
                song.music_id === expected.music_id &&
                (expected.diff_idx === null || d.diff_idx === expected.diff_idx);
            if (operator === "!=" ? matches : !matches) return false;
            continue;
        }
        let actual;
        if (field === "level") actual = d.level;
        else if (field === "diff_idx") actual = d.diff_idx;
        else if (field === "score") actual = played?.score || 0;
        else if (field === "clear") actual = played?.clear || 0;
        else if (field === "top50") actual = Number(top.has(key));
        else if (field === "boss") {
            const boss = isBossChart({ music_id: song.music_id, ...d });
            if (boss === undefined) return false;
            actual = Number(boss);
        } else if (field === "grade") {
            const score = played?.score || 0;
            actual = score
                ? [
                      0, 6500000, 7500000, 8700000, 9000000, 9300000, 9500000,
                      9700000, 9800000, 9900000,
                  ].findLastIndex((min) => score >= min)
                : -1;
        } else if (field === "artist" || field === "title")
            actual = normalizeSearch(song[field]);
        else if (field === "genre")
            actual = normalizeSearch(
                genreText(
                    record?.genre ?? song.genre,
                    record?.custom ?? song.is_custom,
                ),
            );
        else if (field === "custom")
            actual = record?.custom ?? Number(song.is_custom === true);
        else if (field === "year") actual = record?.year ?? song.release_year;
        else if (
            [
                "notes",
                "peak",
                "tsumami",
                "tricky",
                "handtrip",
                "onehand",
            ].includes(field)
        )
            actual =
                d.radar?.[
                    [
                        "notes",
                        "peak",
                        "tsumami",
                        "tricky",
                        "handtrip",
                        "onehand",
                    ].indexOf(field)
                ];
        else actual = record?.[field];
        if (textFields.has(field)) {
            actual = normalizeSearch(actual ?? "");
            if (
                operator === "!="
                    ? actual.includes(expected)
                    : !actual.includes(expected)
            )
                return false;
        } else {
            if (!Number.isFinite(actual)) return false;
            if (
                !(operator === ">"
                    ? actual > expected
                    : operator === ">="
                      ? actual >= expected
                      : operator === "<"
                        ? actual < expected
                        : operator === "<="
                          ? actual <= expected
                          : operator === "!="
                            ? actual !== expected
                            : actual === expected)
            )
                return false;
        }
    }
    return true;
}
