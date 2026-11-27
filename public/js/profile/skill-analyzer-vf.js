import { chartKey } from "./metrics.js";
import { calculateChartVf } from "./volforce.js";

export function applySkillAnalyzerVf(data) {
    const courses = new Map();
    for (const play of data.plays) {
        if (play.is_skill_analyzer !== true) continue;
        const key = chartKey(play);
        if (!courses.has(key))
            courses.set(key, {
                scores: new Set(),
                marks: new Set(),
                bestScore: 0,
                bestMark: 0,
            });
        const course = courses.get(key);
        course.scores.add(play.score);
        course.marks.add(play.clear_type);
    }
    if (!courses.size) return data;

    // Normalize legacy Play VF when the archive loads so all views use the same values
    const plays = data.plays.map((play) => {
        if (play.is_skill_analyzer === true)
            return play.play_vf === 0 ? play : { ...play, play_vf: 0 };
        const course = courses.get(chartKey(play));
        if (course) {
            course.bestScore = Math.max(course.bestScore, play.score);
            course.bestMark = Math.max(course.bestMark, play.clear_type);
        }
        return play;
    });

    // Older proxy snapshots can contain Dan scores that predate the cache fix
    // Replace it only when the score matches a logged Dan stage and beats every regular play
    const charts = data.state.charts.flatMap((chart) => {
        const course = courses.get(chartKey(chart));
        if (!course) return [chart];
        const danScore =
            chart.score > course.bestScore && course.scores.has(chart.score);
        // Crash is shared by regular and Dan plays, so require a matching Dan score for that mark
        const danMark =
            chart.clear_type > course.bestMark &&
            course.marks.has(chart.clear_type) &&
            (chart.clear_type > 1 || danScore);
        if (!danScore && !danMark) return [chart];
        const score = danScore ? course.bestScore : chart.score;
        const clear_type = danMark ? course.bestMark : chart.clear_type;
        if (!score && !clear_type) return [];
        return [
            {
                ...chart,
                score,
                clear_type,
                vf: calculateChartVf(chart.level, score, clear_type) ?? 0,
            },
        ];
    });
    return { ...data, plays, state: { ...data.state, charts } };
}
