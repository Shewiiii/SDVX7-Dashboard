import { topCharts } from "./top-charts.js";

export function comparisonVolforce(state, options = {}, overrides = {}) {
    if (!state?.charts?.length) return null;

    const songs = new Map(
        (state.catalog || []).map((song) => [song.music_id, song]),
    );
    const charts = state.charts.map((chart) => {
        const level =
            chart.level ??
            songs
                .get(chart.music_id)
                ?.difficulties?.find(
                    (difficulty) => difficulty.diff_idx === chart.diff_idx,
                )?.level;
        const override = overrides[`${chart.music_id}:${chart.diff_idx}`];
        const useOverride =
            override &&
            chart.is_custom !== true &&
            songs.get(chart.music_id)?.is_custom !== true &&
            override.nabla_level === level;

        return {
            ...chart,
            level: useOverride
                ? override.eg_level
                : Number.isFinite(level)
                  ? Math.trunc(level)
                  : level,
        };
    });
    const top = topCharts({ ...state, charts }, options);

    return (
        top.reduce((sum, chart) => sum + Math.round(chart.vf * 1000), 0) / 1000
    );
}

export function parseVolforceRanking(csv) {
    const playerRow =
        /(?:^|\r?\n)\d+,(?:"(?:[^"]|"")*"|[^",\r\n]*),(\d+\.\d{3}),SV-\d{4}-\d{4}(?=\r?\n|$)/g;
    return Array.from(csv.matchAll(playerRow), (match) =>
        Math.round(Number(match[1]) * 1000),
    ).sort((a, b) => b - a);
}

export function volforceTopPercent(total, ranking) {
    if (!Number.isFinite(total) || total < 0 || !ranking.length) return null;

    const threshold = Math.round(total * 1000);
    let low = 0;
    let high = ranking.length;

    while (low < high) {
        const middle = (low + high) >> 1;
        if (ranking[middle] >= threshold) low = middle + 1;
        else high = middle;
    }

    return (low / ranking.length) * 100;
}

export function volforceSamples(ranking) {
    if (!ranking.length) return [];

    const counts = Array(240).fill(0);
    for (const value of ranking) {
        const index = Math.min(counts.length - 1, Math.floor(value / 100));
        counts[index]++;
    }

    return counts.map((count, index) => ({
        lower: index / 10,
        upper: (index + 1) / 10,
        count,
        percent: (count / ranking.length) * 100,
    }));
}

export function volforceDensity(ranking) {
    const samples = volforceSamples(ranking);
    if (!samples.length) return [];

    const changes = samples.slice(1).map(
        (sample, index) => sample.percent - samples[index].percent,
    );
    const slopes = samples.map((_, index) => {
        const before = changes[index - 1];
        const after = changes[index];
        return before * after > 0
            ? (2 * before * after) / (before + after)
            : 0;
    });

    // Interpolate between sample centres without changing their percentages
    return Array.from({ length: 24 * 80 + 1 }, (_, pointIndex) => {
        const value = pointIndex / 80;
        const position = value * 10 - 0.5;
        const index = Math.max(
            0,
            Math.min(samples.length - 2, Math.floor(position)),
        );
        const t = Math.max(0, Math.min(1, position - index));
        const start = samples[index].percent;
        const end = samples[index + 1].percent;
        const percent =
            (2 * t ** 3 - 3 * t ** 2 + 1) * start +
            (t ** 3 - 2 * t ** 2 + t) * slopes[index] +
            (-2 * t ** 3 + 3 * t ** 2) * end +
            (t ** 3 - t ** 2) * slopes[index + 1];

        return [
            value,
            Math.max(Math.min(start, end), Math.min(Math.max(start, end), percent)),
        ];
    });
}

export async function loadVolforceRanking() {
    const response = await fetch("/game-data/SDVX_VI_Ranking_M0N0.csv");
    if (!response.ok) throw new Error("VolForce reference ranking unavailable");

    const ranking = parseVolforceRanking(await response.text());
    if (!ranking.length) throw new Error("Empty VolForce reference ranking");

    return ranking;
}

export async function loadVolforceOverrides() {
    const response = await fetch("/game-data/nabla-to-eg-vf.json");
    if (!response.ok) throw new Error("VolForce level overrides unavailable");

    const charts = (await response.json())?.charts;
    if (
        !charts ||
        typeof charts !== "object" ||
        Array.isArray(charts) ||
        Object.entries(charts).some(
            ([key, chart]) =>
                !/^[1-9]\d{0,7}:[0-5]$/.test(key) ||
                !Number.isInteger(chart?.eg_level) ||
                chart.eg_level < 1 ||
                chart.eg_level > 20 ||
                !Number.isFinite(chart.nabla_level) ||
                chart.nabla_level < 1 ||
                chart.nabla_level > 20.9,
        )
    )
        throw new Error("Invalid VolForce level overrides");

    return charts;
}
