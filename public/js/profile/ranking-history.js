import { topCharts } from "./top-charts.js";
import { calculateChartVf } from "./volforce.js";

const cache = new WeakMap();
const keyOf = (chart) => `${chart.music_id}:${chart.diff_idx}`;

export function rankingHistory(data, { includeCustom = false } = {}) {
    let variants = cache.get(data);
    if (!variants) {
        variants = new Map();
        cache.set(data, variants);
    }
    if (variants.has(includeCustom)) return variants.get(includeCustom);

    const tracked = new Map();
    for (const play of data.plays) {
        const key = keyOf(play);
        const best = tracked.get(key) || { score: 0, clear_type: 0 };
        best.score = Math.max(best.score, play.score || 0);
        best.clear_type = Math.max(best.clear_type, play.clear_type || 0);
        tracked.set(key, best);
    }

    let estimated = false;
    const records = new Map();
    for (const chart of data.state.charts || []) {
        const best = tracked.get(keyOf(chart));
        const score = chart.score > (best?.score || 0) ? chart.score : 0;
        const clear =
            chart.clear_type > (best?.clear_type || 0) ? chart.clear_type : 0;
        const unknown = !best && !Number.isSafeInteger(chart.score);
        const value = calculateChartVf(chart.level, score, clear) ?? 0;
        records.set(keyOf(chart), {
            ...chart,
            score,
            clear_type: clear,
            vf: unknown ? chart.vf : value,
        });
        estimated ||= score > 0 || clear > 0 || unknown;
    }

    const events = [
        ...data.plays.map((play) => ({
            timestamp: play.received_at,
            time: Date.parse(play.received_at),
            play,
        })),
        ...data.observations.map((observation) => ({
            timestamp: observation.timestamp,
            time: Date.parse(observation.timestamp),
        })),
    ]
        .filter((event) => Number.isFinite(event.time))
        .sort((a, b) => a.time - b.time);
    const observations = [];
    const options = { includeCustom };

    function append(timestamp, charts, force = false) {
        const top = topCharts({ ...data.state, charts }, options);
        const point = {
            timestamp,
            total_vf:
                top.reduce((sum, chart) => sum + Math.round(chart.vf * 1000), 0) /
                1000,
            minimum_vf: top.length === 50 ? top[49].vf : null,
            top_count: top.length,
        };
        const previous = observations.at(-1);
        if (previous?.timestamp === timestamp) observations.pop();
        else if (
            !force &&
            previous?.total_vf === point.total_vf &&
            previous?.minimum_vf === point.minimum_vf &&
            previous?.top_count === point.top_count
        )
            return;
        observations.push(point);
    }

    for (const event of events) {
        const play = event.play;
        if (play) {
            const key = keyOf(play);
            const previous = records.get(key) || { ...play, vf: 0 };
            const score = Math.max(previous.score || 0, play.score || 0);
            const clear = Math.max(previous.clear_type || 0, play.clear_type || 0);
            const level = previous.level ?? play.level;
            records.set(key, {
                ...previous,
                level,
                score,
                clear_type: clear,
                vf:
                    calculateChartVf(level, score, clear) ??
                    Math.max(previous.vf || 0, play.play_vf || 0),
            });
        }
        append(event.timestamp, [...records.values()]);
    }

    const snapshotTime = Date.parse(data.state.updated_at || data.synced_at);
    const lastTime = Math.max(
        events.at(-1)?.time ?? -Infinity,
        Number.isFinite(snapshotTime) ? snapshotTime : -Infinity,
    );
    if (Number.isFinite(lastTime) && data.state.charts?.length)
        append(new Date(lastTime).toISOString(), data.state.charts, true);

    const result = { observations, estimated };
    variants.set(includeCustom, result);
    return result;
}
