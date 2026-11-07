import { topCharts } from "./top-charts.js";

export function comparisonVolforce(state, options = {}) {
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

        return {
            ...chart,
            level: Number.isFinite(level) ? Math.trunc(level) : level,
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

export async function loadVolforceRanking() {
    const response = await fetch("/game-data/SDVX_VI_Ranking_M0N0.csv");
    if (!response.ok) throw new Error("VOLFORCE reference ranking unavailable");

    const ranking = parseVolforceRanking(await response.text());
    if (!ranking.length) throw new Error("Empty VOLFORCE reference ranking");

    return ranking;
}
