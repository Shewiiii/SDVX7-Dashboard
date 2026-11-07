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

export function volforceDensity(ranking) {
    if (!ranking.length) return [];

    const buckets = new Map();
    for (const value of ranking) {
        const key = Math.floor(value / 100);
        const bucket = buckets.get(key) || { count: 0, sum: 0 };
        bucket.count++;
        bucket.sum += value;
        buckets.set(key, bucket);
    }
    const samples = [...buckets.values()].map(({ count, sum }) => ({
        value: sum / count / 1000,
        count,
    }));
    const bandwidth = 0.4;
    const maximum = 24;
    const factor = 100 / (ranking.length * bandwidth * Math.sqrt(2 * Math.PI));

    return Array.from({ length: maximum * 8 + 1 }, (_, index) => {
        const value = index / 8;
        const density = samples.reduce((sum, sample) => {
            const distance = (value - sample.value) / bandwidth;
            const reflected = (value + sample.value) / bandwidth;
            return (
                sum +
                sample.count *
                    (Math.exp(-0.5 * distance ** 2) +
                        Math.exp(-0.5 * reflected ** 2))
            );
        }, 0);

        return [value, density * factor];
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
