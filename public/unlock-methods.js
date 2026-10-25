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
    conflict: "Uncertain",
});

export function unlockFolder(method) {
    return Object.hasOwn(UNLOCK_METHODS, method)
        ? UNLOCK_METHODS[method]
        : UNLOCK_METHODS.unknown;
}
