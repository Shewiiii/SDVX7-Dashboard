import { calculateChartVf } from "./volforce.js";

export function topCharts(state, { includeCustom = false } = {}) {
    const customSongs = new Set(
        (state.catalog || [])
            .filter((song) => song.is_custom === true)
            .map((song) => song.music_id),
    );

    return (state.charts || [])
        .filter(
            (chart) =>
                includeCustom ||
                (chart.is_custom !== true && !customSongs.has(chart.music_id)),
        )
        .map((chart) => ({
            ...chart,
            vf:
                calculateChartVf(
                    chart.level,
                    chart.score,
                    chart.clear_type,
                ) ?? chart.vf,
        }))
        .sort(
            (a, b) =>
                b.vf - a.vf ||
                a.music_id - b.music_id ||
                a.diff_idx - b.diff_idx,
        )
        .slice(0, 50);
}
