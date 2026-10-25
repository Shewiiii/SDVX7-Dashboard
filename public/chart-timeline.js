export function validTimeline(value, chart) {
    const time = (n) => Number.isFinite(n) && n >= 0 && n <= 7200;
    const rows = (array, limit, check) =>
        Array.isArray(array) && array.length <= limit && array.every(check);
    let points = 0;
    return (
        value?.schema === 1 &&
        value.music_id === chart.music_id &&
        value.diff_idx === chart.diff_idx &&
        time(value.duration) &&
        value.duration > 0 &&
        rows(
            value.buttons,
            200000,
            (n) =>
                Array.isArray(n) &&
                n.length === 3 &&
                time(n[0]) &&
                time(n[1]) &&
                n[1] >= n[0] &&
                Number.isInteger(n[2]) &&
                n[2] >= 1 &&
                n[2] <= 6,
        ) &&
        rows(
            value.lasers,
            50000,
            (l) =>
                (l.side === 0 || l.side === 1) &&
                (l.ranges === undefined ||
                    (rows(
                        l.ranges,
                        200000,
                        (range) => range === 1 || range === 2,
                    ) &&
                        l.ranges.length === l.points?.length)) &&
                rows(
                    l.points,
                    200000,
                    (p) =>
                        Array.isArray(p) &&
                        p.length === 2 &&
                        time(p[0]) &&
                        Number.isFinite(p[1]) &&
                        Math.abs(p[1]) <= 4,
                ) &&
                (points += l.points.length) <= 200000,
        ) &&
        rows(
            value.measures,
            10001,
            (m) =>
                Array.isArray(m) &&
                m.length === 2 &&
                time(m[0]) &&
                Number.isInteger(m[1]),
        ) &&
        rows(
            value.tempos,
            200000,
            (p) =>
                Array.isArray(p) &&
                p.length === 2 &&
                time(p[0]) &&
                Number.isFinite(p[1]) &&
                p[1] > 0,
        ) &&
        value.tempos.length > 0 &&
        value.tempos.every(([at], i) => !i || at >= value.tempos[i - 1][0])
    );
}

