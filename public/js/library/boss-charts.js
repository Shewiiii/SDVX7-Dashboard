let charts, task;

export function installBossCharts(data) {
    if (
        !data?.charts ||
        typeof data.charts !== "object" ||
        Array.isArray(data.charts) ||
        !Object.entries(data.charts).every(
            ([key, row]) =>
                /^[1-9]\d{0,7}:(?:[0-5]|\*)$/.test(key) &&
                row &&
                typeof row === "object" &&
                !Array.isArray(row),
        )
    )
        throw Error("Invalid boss chart data");
    charts = new Set(Object.keys(data.charts));
}

export function isBossChart(chart) {
    if (!charts) return undefined;
    return (
        charts.has(`${chart.music_id}:${chart.diff_idx}`) ||
        charts.has(`${chart.music_id}:*`)
    );
}

export async function loadBossCharts() {
    if (charts) return;
    if (!task) {
        task = fetch("/game-data/boss_charts.json")
            .then(async (response) => {
                if (!response.ok) throw Error("Boss charts unavailable");
                installBossCharts(await response.json());
            })
            .finally(() => {
                task = null;
            });
    }
    return task;
}
