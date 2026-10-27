export const UNLOCK_METHODS = Object.freeze({
    default_unlocked: "Unlocked by default",
    blc: "BLC",
    blaster_gate: "BLASTER GATE",
    variant_gate: "VARIANT GATE",
    arena_station: "ARENA STATION",
    stamp: "Stamp events",
    extrack_challenge: "EXTRACK CHALLENGE",
    conditional_input: "Conditional unlocks",
    event_mission: "Event missions",
    crossover_event: "Cross-game events",
    limited_time: "Limited-time charts",
    removed: "Removed",
    unknown: "Unknown",
});

export function unlockFolder(method) {
    return Object.hasOwn(UNLOCK_METHODS, method)
        ? UNLOCK_METHODS[method]
        : UNLOCK_METHODS.unknown;
}

export function chartUnlockFolder(chart, methods) {
    if (chart.is_custom) return "Custom Map";
    return unlockFolder(
        methods?.get(`${chart.music_id}:${chart.diff_idx}`) ||
            methods?.get(`${chart.music_id}:*`),
    );
}

let savedMethods,
    methodsTask,
    methodsLoadedAt = 0;

export function loadUnlockMethods() {
    if (methodsTask) return methodsTask;
    if (savedMethods && Date.now() - methodsLoadedAt < 60000)
        return Promise.resolve(savedMethods);
    methodsTask = fetch("/api/unlocks?index=methods")
        .then(async (response) => {
            if (!response.ok) throw new Error("Unlock methods unavailable");
            const { methods } = await response.json();
            if (
                !methods ||
                typeof methods !== "object" ||
                Array.isArray(methods) ||
                !Object.entries(methods).every(
                    ([key, method]) =>
                        /^[1-9]\d{0,7}:(?:[0-5]|\*)$/.test(key) &&
                        typeof method === "string",
                )
            )
                throw new Error("Invalid unlock methods");
            savedMethods = new Map(Object.entries(methods));
            methodsLoadedAt = Date.now();
            return savedMethods;
        })
        .finally(() => {
            methodsTask = null;
        });
    return methodsTask;
}
