import {
    normalizeSearch,
    parseSearch,
    extraSearchText,
    matchesSearchFilters,
} from "./search-query.js";
export { normalizeSearch } from "./search-query.js";
export const DIFFS = ["NOV", "ADV", "EXH", "INF/VVD", "MXM", "ULT"];
export const CLEARS = [
    "No clear",
    "Crash",
    "Effective",
    "Excessive",
    "Maxxive",
    "UC",
    "PUC",
];
export const byTime = (a, b) =>
    Date.parse(a.received_at || a.timestamp) -
    Date.parse(b.received_at || b.timestamp);
export const vf = (value) => (Number.isFinite(value) ? value.toFixed(3) : "—");
export function timingText(ms) {
    if (!Number.isFinite(ms)) return "—";
    const magnitude = Math.abs(ms);
    let rounded = magnitude.toFixed(1);
    // Python rounds exact decimal ties to even; JavaScript toFixed rounds up.
    // At one decimal place, the binary-exact ties are odd quarter milliseconds.
    if (Number.isInteger(magnitude * 4) && (magnitude * 4) % 2 === 1) {
        const lower = Math.floor(magnitude * 10);
        rounded = ((lower + (lower % 2)) / 10).toFixed(1);
    }
    const sign = ms < 0 || Object.is(ms, -0) ? "-" : "+";
    const emoji = ms > 0 ? "🐇" : ms < 0 ? "🐢" : "🐈";
    return `${sign}${rounded} ms ${emoji}`;
}
export const average = (values) =>
    values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

export function playtimeText(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toLocaleString()}h ${String(minutes).padStart(2, "0")}m`;
}

// Same thresholds and quarter ranks as the proxy's profile command.
export const VF_CLASSES = [
    { name: "Sienna", minimum: 0, step: 2.5 },
    { name: "Cobalt", minimum: 10, step: 0.5 },
    { name: "Dandelion", minimum: 12, step: 0.5 },
    { name: "Cyan", minimum: 14, step: 0.25 },
    { name: "Scarlet", minimum: 15, step: 0.25 },
    { name: "Coral", minimum: 16, step: 0.25 },
    { name: "Argento", minimum: 17, step: 0.25 },
    { name: "Eldora", minimum: 18, step: 0.25 },
    { name: "Crimson", minimum: 19, step: 0.25 },
    { name: "Imperial", minimum: 20, step: 1 },
];

export function volforceClass(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return null;
    value = Math.round(value * 1000) / 1000;
    const index = VF_CLASSES.findLastIndex(({ minimum }) => value >= minimum);
    const { name, minimum, step } = VF_CLASSES[index];
    const rank = Math.min(3, Math.floor((value - minimum) / step));
    return {
        number: index + 1,
        name: `${name} ${["I", "II", "III", "IV"][rank]}`,
    };
}

export function sessions(plays) {
    const groups = [];
    for (const play of [...plays].sort(byTime)) {
        const previous = groups.at(-1);
        if (
            !previous ||
            Date.parse(play.received_at) -
                Date.parse(previous.at(-1).received_at) >
                45 * 60000
        )
            groups.push([play]);
        else previous.push(play);
    }
    return groups;
}

export function performance(
    plays,
    { days = 0, difficulty = 1, now = Date.now() } = {},
) {
    const cutoff = days ? now - days * 86400000 : -Infinity;
    return plays
        .filter(
            (p) =>
                p.clear_type > 1 &&
                p.diff_idx >= difficulty &&
                Number.isFinite(p.play_vf) &&
                Date.parse(p.received_at) >= cutoff,
        )
        .sort(byTime);
}

export const TIMING_OFFSETS = [87.5, 37.5, 25, 0, -25, -37.5, -87.5];
export function timingHistogram(
    plays,
    { days = 0, difficulty = 1, now = Date.now() } = {},
) {
    const bins = Array(7).fill(0);
    const cutoff = days ? now - days * 86400000 : -Infinity;
    let recorded = 0;
    for (const play of plays) {
        const histogram = play.timing_histogram;
        if (
            play.timing_eligible !== true ||
            play.diff_idx < difficulty ||
            !(Date.parse(play.received_at) >= cutoff) ||
            !Array.isArray(histogram) ||
            histogram.length !== 7 ||
            !histogram.every(
                (count) => Number.isSafeInteger(count) && count >= 0,
            ) ||
            !histogram.some((count) => count > 0)
        )
            continue;
        histogram.forEach((count, index) => (bins[index] += count));
        recorded++;
    }
    const hits = bins.reduce((sum, count) => sum + count, 0);
    const weighted = bins.reduce(
        (sum, count, index) => sum + count * TIMING_OFFSETS[index],
        0,
    );
    return {
        bins,
        plays: recorded,
        hits,
        average: hits ? weighted / hits : null,
    };
}

export function rolling(plays, window) {
    let sum = 0;
    return plays.map((p, index) => {
        sum += p.play_vf;
        if (index >= window) sum -= plays[index - window].play_vf;
        return [Date.parse(p.received_at), sum / Math.min(index + 1, window)];
    });
}

// Sample the drawn line: steps use the preceding value; averages interpolate.
// Do not invent values outside the line or across missing-data gaps.
export function lineValue(points, time, step = false) {
    if (!points.length || time < points[0][0] || time > points.at(-1)[0])
        return null;
    let low = 0,
        high = points.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (points[middle][0] <= time) low = middle + 1;
        else high = middle;
    }
    const previous = points[low - 1],
        next = points[low];
    if (previous[1] === null) return null;
    if (step || !next || previous[0] === time) return previous[1];
    if (next[1] === null) return null;
    return (
        previous[1] +
        ((next[1] - previous[1]) * (time - previous[0])) /
            (next[0] - previous[0])
    );
}

export function visibleObservations(observations, start, end) {
    const sorted = [...observations].sort(byTime);
    let previous;
    const visible = [];
    for (const observation of sorted) {
        const t = Date.parse(observation.timestamp);
        if (t <= start) previous = observation;
        else if (t <= end) visible.push({ ...observation, time: t });
    }
    if (previous) visible.unshift({ ...previous, time: start });
    if (visible.length && visible.at(-1).time < end)
        visible.push({ ...visible.at(-1), time: end });
    return visible;
}

export function topCharts(state) {
    return [...(state.charts || [])]
        .sort(
            (a, b) =>
                b.vf - a.vf ||
                a.music_id - b.music_id ||
                a.diff_idx - b.diff_idx,
        )
        .slice(0, 50);
}

export function summary(data) {
    const top = topCharts(data.state);
    const observed = [...data.observations].sort(byTime);
    const latest = observed.at(-1);
    const total = top.length
        ? top.reduce((s, p) => s + p.vf, 0)
        : (latest?.total_vf ?? null);
    return {
        total,
        top,
        best: top[0]?.vf ?? null,
        entry:
            top.length === 50
                ? (Math.round(top[49].vf * 1000) + 1) / 1000
                : null,
        growth:
            total !== null && observed.length
                ? total - observed[0].total_vf
                : null,
        sessions: sessions(data.plays),
    };
}

export const PAGE_SIZE = 50;
export const chartKey = (chart) => `${chart.music_id}:${chart.diff_idx}`;

function countChartPlays(plays) {
    const counts = new Map();
    for (const play of plays) {
        const key = chartKey(play);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function groupChartPlays(plays) {
    const bestPlays = new Map();
    for (const play of plays) {
        const key = chartKey(play);
        const previous = bestPlays.get(key);
        if (!previous || (play.score ?? -1) > (previous.score ?? -1))
            bestPlays.set(key, play);
    }
    return [...bestPlays.values()];
}

export function recordList(
    data,
    catalog,
    { top = false, query = "", sort = "recent" } = {},
) {
    const source = top
        ? topCharts(data.state).map((chart, index) => ({
              ...chart,
              rank: index + 1,
          }))
        : data.plays;
    let records = filterCharts(source, catalog, query);
    const totalPlays = records.length;
    const grouped = !top && sort === "plays";
    const playCounts =
        sort === "plays" ? countChartPlays(data.plays) : new Map();
    const latestPlays = new Map();
    if (top && sort === "recent") {
        for (const play of data.plays) {
            const time = Date.parse(play.received_at || play.timestamp);
            const key = chartKey(play);
            if (
                Number.isFinite(time) &&
                time > (latestPlays.get(key) ?? -Infinity)
            )
                latestPlays.set(key, time);
        }
    }
    const recentFirst = top
        ? (a, b) =>
              (latestPlays.get(chartKey(b)) ?? -Infinity) -
                  (latestPlays.get(chartKey(a)) ?? -Infinity) || a.rank - b.rank
        : (a, b) => byTime(b, a);
    const chartOrder = new Map();
    if (sort === "plays") {
        const ordered = [...records].sort(recentFirst);
        for (const record of ordered) {
            const key = chartKey(record);
            if (!chartOrder.has(key)) chartOrder.set(key, chartOrder.size);
        }
        if (grouped) records = groupChartPlays(ordered);
    }
    const comparators = {
        vf: (a, b) => (b.vf ?? b.play_vf) - (a.vf ?? a.play_vf),
        score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
        recent: recentFirst,
        plays: (a, b) =>
            (playCounts.get(chartKey(b)) || 0) -
                (playCounts.get(chartKey(a)) || 0) ||
            chartOrder.get(chartKey(a)) - chartOrder.get(chartKey(b)) ||
            recentFirst(a, b),
    };
    records = [...records].sort(comparators[sort] || recentFirst);
    return { records, grouped, totalPlays, playCounts };
}

export function paginate(records, page, pageSize = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(records.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    const start = page * pageSize;
    return {
        page,
        pages,
        start,
        items: records.slice(start, start + pageSize),
    };
}

export function songCatalog(data) {
    if (data.state.catalog?.length) return data.state.catalog;
    const songs = new Map();
    for (const chart of [...(data.state.charts || []), ...data.plays]) {
        let song = songs.get(chart.music_id);
        if (!song) {
            song = {
                music_id: chart.music_id,
                title: chart.title,
                artist: chart.artist,
                forms: [
                    [normalizeSearch(chart.title)],
                    [],
                    [normalizeSearch(chart.artist)],
                    [],
                ],
                difficulties: [],
            };
            songs.set(chart.music_id, song);
        }
        if (!song.difficulties.some((d) => d.diff_idx === chart.diff_idx))
            song.difficulties.push({
                diff_idx: chart.diff_idx,
                level: chart.level,
            });
    }
    return [...songs.values()];
}

function songSearchRank(song, { tokens, term }, extra = []) {
    const groups = song.forms?.some((forms) => forms.length)
        ? [...song.forms]
        : [
              [normalizeSearch(song.title)],
              [],
              [normalizeSearch(song.artist)],
              [],
          ];
    if (song.title_ascii)
        groups[0] = [...groups[0], normalizeSearch(song.title_ascii)];
    groups.push(extra);
    let rank = tokens.length ? null : [0, 0];
    for (
        let priority = 0;
        priority < groups.length && tokens.length;
        priority++
    ) {
        const matching = groups[priority].filter((form) =>
            tokens.every((token) => form.includes(token)),
        );
        if (matching.length) {
            rank = [
                priority,
                Math.min(
                    ...matching.map((form) =>
                        form === term ? 0 : form.startsWith(term) ? 1 : 2,
                    ),
                ),
            ];
            break;
        }
    }
    if (
        !rank &&
        tokens.every((token) =>
            groups.some((forms) => forms.some((form) => form.includes(token))),
        )
    )
        rank = [groups.length, 0];
    return rank;
}

export function filterCharts(charts, catalog, query) {
    if (!query.trim()) return charts;
    const search = parseSearch(query);
    const songs = new Map(catalog.map((song) => [song.music_id, song]));
    return charts.filter((chart) => {
        if (search.difficulty >= 0 && chart.diff_idx !== search.difficulty)
            return false;
        const song = songs.get(chart.music_id) || chart;
        const difficulty =
            song.difficulties?.find((d) => d.diff_idx === chart.diff_idx) ||
            chart;
        return (
            matchesSearchFilters(song, difficulty, search) &&
            songSearchRank(song, search, extraSearchText(song, difficulty)) !==
                null
        );
    });
}

export function searchCharts(catalog, query, limit = PAGE_SIZE) {
    const search = parseSearch(query);
    const matches = [];
    for (const song of catalog) {
        const baseRank = songSearchRank(song, search);
        for (const d of song.difficulties) {
            if (search.difficulty >= 0 && d.diff_idx !== search.difficulty)
                continue;
            if (!matchesSearchFilters(song, d, search)) continue;
            const rank =
                baseRank ||
                songSearchRank(song, search, extraSearchText(song, d));
            if (rank) matches.push({ ...song, ...d, rank });
        }
    }
    return matches
        .sort(
            (a, b) =>
                a.rank[0] - b.rank[0] ||
                a.rank[1] - b.rank[1] ||
                (a.title.toLocaleLowerCase() < b.title.toLocaleLowerCase()
                    ? -1
                    : a.title.toLocaleLowerCase() > b.title.toLocaleLowerCase()
                      ? 1
                      : 0) ||
                a.music_id - b.music_id ||
                b.diff_idx - a.diff_idx,
        )
        .slice(0, limit);
}

export function searchSongs(catalog, query, plays = [], limit = PAGE_SIZE) {
    const counts = new Map();
    for (const play of plays) {
        if (
            play.score > 0 &&
            play.clear_type >= 1 &&
            play.clear_type <= 6 &&
            Number.isFinite(play.play_vf)
        ) {
            const key = chartKey(play);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    const songs = new Map();
    for (const chart of searchCharts(catalog, query, Infinity)) {
        let match = songs.get(chart.music_id);
        if (!match) {
            match = { ...chart, difficulties: [] };
            songs.set(chart.music_id, match);
        }
        match.difficulties.push({
            diff_idx: chart.diff_idx,
            level: chart.level,
        });
        if (
            (counts.get(chartKey(chart)) || 0) >
            (counts.get(chartKey(match)) || 0)
        ) {
            match.diff_idx = chart.diff_idx;
            match.level = chart.level;
            match.cover = chart.cover;
        }
    }
    return [...songs.values()].slice(0, limit);
}

export function chartPlays(data, musicId, difficulty) {
    return data.plays
        .filter(
            (p) =>
                p.music_id === musicId &&
                p.diff_idx === difficulty &&
                p.score > 0 &&
                p.clear_type >= 1 &&
                p.clear_type <= 6 &&
                Number.isFinite(p.play_vf),
        )
        .sort((a, b) => b.score - a.score || byTime(b, a));
}

export const SCORE_GRADES = [
    [9900000, "S", 105],
    [9800000, "AAA+", 102],
    [9700000, "AAA", 100],
    [9500000, "AA+", 97],
    [9300000, "AA", 94],
    [9000000, "A+", 91],
    [8700000, "A", 88],
    [7500000, "B", 85],
    [6500000, "C", 82],
    [0, "D", 80],
];
export const VF_CLEARS = [
    { type: 1, multiplier: 50 },
    { type: 2, multiplier: 100 },
    { type: 3, multiplier: 102 },
    { type: 4, multiplier: 104 },
    { type: 5, multiplier: 106 },
    { type: 6, multiplier: 110 },
];

export function grade(score) {
    return SCORE_GRADES.find(([min]) => score >= min)?.[1] || "—";
}

export function calculateChartVf(level, score, clearType) {
    const clear = VF_CLEARS.find(({ type }) => type === clearType);
    if (
        !Number.isFinite(level) ||
        level <= 0 ||
        !Number.isSafeInteger(score) ||
        score < 0 ||
        score > 10000000 ||
        !clear
    )
        return null;
    const multiplier = SCORE_GRADES.find(([min]) => score >= min)[2];
    const numerator =
        BigInt(Math.round(level * 10)) *
        BigInt(score) *
        BigInt(multiplier) *
        BigInt(clear.multiplier) *
        20n;
    return Number(numerator / 1000000000000n) / 1000;
}
