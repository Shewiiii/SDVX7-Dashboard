import { SKILL_ANALYZER_COURSES } from "../../game-data/skill-analyzer.js";
import { chartKey } from "../profile/metrics.js";

export function danName(level) {
    if (level === 12) return "Infinite Dan";
    const suffix =
        level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
    return `${level}${suffix} Dan`;
}

const courseNames = new Map();
for (const { level, name, tracks } of SKILL_ANALYZER_COURSES) {
    const label = level >= 1 && level <= 12 ? danName(level) : name;
    for (const track of tracks) {
        const key = chartKey(track);
        const previous = courseNames.get(key);
        courseNames.set(
            key,
            previous === undefined || previous === label ? label : null,
        );
    }
}

export function skillCourseLabel(play) {
    return courseNames.get(chartKey(play)) ?? "Skill Analyzer";
}
