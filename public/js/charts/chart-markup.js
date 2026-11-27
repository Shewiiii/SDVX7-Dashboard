import {
    DIFFS,
    CLEARS,
    vf,
    average,
    grade,
    chartPlays,
    calculateChartVf,
    timingText,
} from "../profile/metrics.js";
import {
    escape,
    number,
    clock,
    chartTitle,
    formatRank,
} from "../core/format.js";
import { songPath } from "../core/song-links.js";
import { skillCourseLabel } from "../library/skill-courses.js";

export const badge = (p) =>
    `<span class="difficulty-badge d${p.diff_idx}">${DIFFS[p.diff_idx]}${p.level ? " " + escape(p.level) : ""}</span>`;
export function clear(p) {
    if (p.is_skill_analyzer === true) {
        const label = escape(skillCourseLabel(p));
        return `<span class="clear-label skill-analyzer-clear" title="${label}">${label}</span>`;
    }
    return `<span class="clear-label ${p.clear_type === 6 ? "puc" : ""}">${CLEARS[p.clear_type] || "—"}</span>`;
}
export function recordVfMarkup(play) {
    const value = vf(play.vf ?? play.play_vf);
    return play.is_skill_analyzer === true
        ? `<span class="skill-analyzer-vf">${value}</span>`
        : value;
}

export const gradeMarkup = (score) => {
    const label = grade(score);
    return label === "—"
        ? label
        : `<img class="grade-icon" src="/assets/grades/${label.toLowerCase().replace("+", "-plus")}.png" alt="${label}" title="${label}">`;
};

export function createChartMarkup({ getData, getSongs, newPlayAttributes }) {
    function coverMarkup(p, size = "small", linked = true) {
        const song = getSongs().get(p.music_id);
        const id = song?.difficulties.find(
            (d) => d.diff_idx === p.diff_idx,
        )?.cover;
        const image =
            id && /^[a-f0-9]{64}$/.test(id)
                ? `<img src="/api/cover?id=${id}" alt="${escape(song.title)} cover" loading="lazy" decoding="async">`
                : '<span class="cover-missing" aria-label="Cover unavailable">—</span>';
        return linked
            ? `<a class="cover-tile ${size} open-chart" href="${songPath(p.music_id, p.diff_idx)}" data-music="${p.music_id}" data-diff="${p.diff_idx}">${image}</a>`
            : `<span class="cover-tile ${size}">${image}</span>`;
    }
    const chartButton = (p) =>
        `<a class="song-title open-chart" href="${songPath(p.music_id, p.diff_idx)}" data-music="${p.music_id}" data-diff="${p.diff_idx}">${escape(chartTitle(p))}</a>`;

    function chartInfo(
        p,
        {
            artist = false,
            detailsClass = "",
            titleMarkup = chartButton(p),
            showClear = true,
        } = {},
    ) {
        return `<div class="entry-song-info">${titleMarkup}${artist ? `<div class="artist">${escape(p.artist)}</div>` : ""}<div class="song-details ${detailsClass}">${badge(p)}${showClear ? clear(p) : ""}</div></div>`;
    }

    function chartSummaryMarkup(
        chart,
        plays = chartPlays(getData(), chart.music_id, chart.diff_idx),
    ) {
        const data = getData();
        const songs = getSongs();
        const saved = data.state.charts.find(
            (record) =>
                record.music_id === chart.music_id &&
                record.diff_idx === chart.diff_idx,
        );
        // Dan stages stay in play history but never supply a Chart VF score or clear mark
        const regularPlays = plays.filter(
            (play) => play.is_skill_analyzer !== true,
        );
        const regularMark =
            saved || regularPlays.length
                ? Math.max(
                      saved?.clear_type || 0,
                      ...regularPlays.map((play) => play.clear_type),
                  )
                : null;
        const scores = [
            saved?.score,
            ...regularPlays.map((play) => play.score),
        ].filter(Number.isSafeInteger);
        const score = scores.length ? Math.max(...scores) : null;
        const level =
            chart.level ??
            saved?.level ??
            songs
                .get(chart.music_id)
                ?.difficulties.find(
                    (difficulty) => difficulty.diff_idx === chart.diff_idx,
                )?.level;
        const chartHistory = data.plays.filter(
            (play) =>
                play.music_id === chart.music_id &&
                play.diff_idx === chart.diff_idx,
        );
        const hasDan = chartHistory.some(
            (play) => play.is_skill_analyzer === true,
        );
        const danOnly = !saved && hasDan && !regularPlays.length;
        const chartVf =
            calculateChartVf(level, score, regularMark) ??
            saved?.vf ??
            (danOnly ? 0 : null);
        const popupText =
            "Chart VF combines the highest regular-play score and clear mark for this chart, even when they come from different plays";
        const averageTiming = average(
            chartHistory.map((play) => play.timing).filter(Number.isFinite),
        );
        // A Dan attempt earns the Played badge for display
        const mark = hasDan ? Math.max(regularMark ?? 0, 1) : regularMark;
        // The chart summary uses the in-game Played label beside the clear-mark icon
        const clearLabel =
            mark === null
                ? "—"
                : mark === 1
                  ? "Played"
                  : mark >= 2 && mark <= 4
                    ? `${CLEARS[mark]} Clear`
                    : CLEARS[mark];
        const clearIcon =
            mark === null
                ? ""
                : `<img class="clear-mark-icon" src="/assets/clear-marks/${CLEARS[mark].toLowerCase().replaceAll(" ", "-")}.png" alt="" aria-hidden="true" width="26" height="20">`;
        return `<div class="selected-summary"><span class="selected-clear">${clearIcon}${clearLabel}</span><button type="button" class="chart-vf-trigger" aria-describedby="chart-vf-popup" data-chart-vf-description="${escape(popupText)}">Chart VF: <span class="chart-vf-value">${vf(chartVf)}</span></button><span>Timing: ${timingText(averageTiming)}</span><span>${plays.length} ${plays.length === 1 ? "play" : "plays"}</span></div>`;
    }

    function playAttributes(play) {
        return `data-play="${escape(
            JSON.stringify({
                received_at: play.received_at,
                score: play.score,
                clear_type: play.clear_type,
            }),
        )}"`;
    }

    function row(p, rank = null) {
        return `<a class="play-row chart-row" href="${songPath(p.music_id, p.diff_idx)}" ${rank === null ? newPlayAttributes(p) : ""} ${playAttributes(p)} data-music="${p.music_id}" data-diff="${p.diff_idx}"><span class="row-index">${rank !== null ? formatRank(rank) : clock(p.received_at)}</span>${coverMarkup(p, "small", false)}${chartInfo(p, { titleMarkup: `<span class="song-title">${escape(chartTitle(p))}</span>` })}<div class="row-values"><div class="row-vf">${recordVfMarkup(p)}</div><div class="row-score">${number(p.score)}</div></div></a>`;
    }

    function chartSongMarkup(chart) {
        return `${coverMarkup(chart, "chart-viewer-jacket")}<div class="chart-viewer-song-info"><div class="chart-viewer-song-title">${escape(chart.title)}</div><div class="chart-viewer-song-artist">${escape(chart.artist)}</div>${badge(chart)}</div>`;
    }

    return {
        coverMarkup,
        chartInfo,
        chartSummaryMarkup,
        row,
        playAttributes,
        chartSongMarkup,
    };
}

export function difficultyRange(song) {
    const difficulties = [...song.difficulties].sort(
        (a, b) => a.diff_idx - b.diff_idx,
    );
    const first = difficulties[0],
        last = difficulties.at(-1);
    return `<span class="song-option-range">${badge(first)}${first.diff_idx === last.diff_idx ? "" : `<span aria-hidden="true">~</span>${badge(last)}`}</span>`;
}
