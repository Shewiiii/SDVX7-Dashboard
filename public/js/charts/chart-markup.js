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

export const badge = (p) =>
    `<span class="difficulty-badge d${p.diff_idx}">${DIFFS[p.diff_idx]}${p.level ? " " + escape(p.level) : ""}</span>`;
export const clear = (p) =>
    `<span class="clear-label ${p.clear_type === 6 ? "puc" : ""}">${CLEARS[p.clear_type] || "—"}</span>`;
export const gradeMarkup = (score) => {
    const label = grade(score);
    return label === "—"
        ? label
        : `<img class="grade-icon" src="/assets/grades/${label.toLowerCase().replace("+", "-plus")}.png" alt="${label}" title="${label}">`;
};

export function createChartMarkup({ getData, getSongs, newPlayAttributes }) {
    function coverMarkup(p, size = "small") {
        const song = getSongs().get(p.music_id);
        const id = song?.difficulties.find(
            (d) => d.diff_idx === p.diff_idx,
        )?.cover;
        return `<span class="cover-tile ${size}">${id && /^[a-f0-9]{64}$/.test(id) ? `<img src="/api/cover?id=${id}" alt="${escape(song.title)} cover" loading="lazy" decoding="async">` : '<span class="cover-missing" aria-label="Cover unavailable">—</span>'}</span>`;
    }
    const chartButton = (p) =>
        `<button class="song-title open-chart" data-music="${p.music_id}" data-diff="${p.diff_idx}">${escape(chartTitle(p))}</button>`;

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
        const mark =
            saved || plays.length
                ? Math.max(
                      saved?.clear_type || 0,
                      ...plays.map((play) => play.clear_type),
                  )
                : null;
        const scores = [
            saved?.score,
            ...plays.map((play) => play.score),
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
        const chartVf =
            calculateChartVf(level, score, mark) ?? saved?.vf ?? null;
        const popupText =
            "Chart VF combines the highest score and clear mark for this chart, even when they come from different plays";
        const averageTiming = average(
            data.plays
                .filter(
                    (play) =>
                        play.music_id === chart.music_id &&
                        play.diff_idx === chart.diff_idx &&
                        Number.isFinite(play.timing),
                )
                .map((play) => play.timing),
        );
        const clearLabel =
            mark === null
                ? "—"
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
        return `<div class="play-row chart-row" ${rank === null ? newPlayAttributes(p) : ""} ${playAttributes(p)} data-music="${p.music_id}" data-diff="${p.diff_idx}"><span class="row-index">${rank !== null ? formatRank(rank) : clock(p.received_at)}</span>${coverMarkup(p)}${chartInfo(p)}<div class="row-values"><div class="row-vf">${vf(p.vf ?? p.play_vf)}</div><div class="row-score">${number(p.score)}</div></div></div>`;
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
