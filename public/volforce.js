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
