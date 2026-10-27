export const DIFFICULTY_LIMITS = [1, 20.9, 0.1];

export function difficultyStep(level, direction = 1) {
    if (level < 17 || (level === 17 && direction < 0)) return 1;
    return level < 18 || (level === 18 && direction < 0) ? 0.5 : 0.1;
}

export function nextDifficulty(level, direction) {
    const step = Math.round(difficultyStep(level, direction) * 10);
    const tenths = Math.round(level * 10);
    const next =
        direction > 0
            ? (Math.floor(tenths / step) + 1) * step
            : (Math.ceil(tenths / step) - 1) * step;
    return Math.max(
        DIFFICULTY_LIMITS[0],
        Math.min(DIFFICULTY_LIMITS[1], next / 10),
    );
}
