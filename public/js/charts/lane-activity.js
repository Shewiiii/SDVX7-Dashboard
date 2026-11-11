export const SHARED_LANE_PEAK = 4;

export function hasLaneActions(chart) {
    return (
        chart.lane_actions_version === 1 &&
        chart.duration > 0 &&
        chart.lane_actions?.length === 8 &&
        chart.lane_actions.every(
            (lane) =>
                lane.length === 64 &&
                lane.every((value) => Number.isFinite(value) && value >= 0),
        )
    );
}

export function laneOpacity(actions, seconds) {
    const intensity = Math.min(1, actions / seconds / SHARED_LANE_PEAK);

    return 0.35 + 0.65 * intensity ** 1.4;
}
