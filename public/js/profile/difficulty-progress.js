import { $, setText } from "../core/dom.js";
import { bindChartHover, positionChartPopup } from "../core/chart-hover.js";
import { date, number, shortDate } from "../core/format.js";
import { pathData, svgElement } from "../core/svg.js";
import { DIFFICULTY_LIMITS } from "../library/difficulty.js";
import { chartKey, playCutoff } from "./metrics.js";
import {
    maxScore,
    parseScore,
    stepScore,
    writeScoreInput,
} from "./score-input.js";

const periodNames = {
    day: { title: "Daily clear rate", label: "Date", prefix: "" },
    week: { title: "Weekly clear rate", label: "Week of", prefix: "Week of " },
    month: { title: "Monthly clear rate", label: "Month", prefix: "" },
};
const monthDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
});
const fullAccentPlayCount = 20;
const lowPlayCountThreshold = 10;

function periodStart(time, unit) {
    const start = new Date(time);
    if (unit === "week")
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (unit === "month") start.setDate(1);
    return start.setHours(0, 0, 0, 0);
}

function nextPeriod(time, unit) {
    const start = new Date(time);
    if (unit === "month") start.setMonth(start.getMonth() + 1);
    else start.setDate(start.getDate() + (unit === "week" ? 7 : 1));
    return start.setHours(0, 0, 0, 0);
}

export function indexDifficultyProgress(
    plays,
    songs,
    {
        includeCustom = false,
        minimum = 8500000,
        aprilFools = new Set(),
        days = 0,
        now = Date.now(),
    } = {},
) {
    const periods = new Map();
    const levels = new Set();
    const attempts = plays
        .map((play) => ({ play, time: Date.parse(play.received_at) }))
        .filter(
            ({ play, time }) =>
                Number.isFinite(time) &&
                Number.isSafeInteger(play.score) &&
                play.score >= 0 &&
                play.score <= maxScore &&
                Number.isInteger(play.clear_type) &&
                play.clear_type >= 0 &&
                play.clear_type <= 6,
        )
        .sort((a, b) => a.time - b.time);
    const cutoff = playCutoff(days, now);
    const unit =
        days === 7
            ? "day"
            : !days &&
                attempts[0]?.time < playCutoff(120, attempts.at(-1)?.time)
              ? "month"
              : "week";

    for (const { play, time } of attempts) {
        const song = songs.get(play.music_id);
        const difficulty = song?.difficulties.find(
            ({ diff_idx }) => diff_idx === play.diff_idx,
        );
        if (
            !includeCustom &&
            (play.is_custom || song?.is_custom || difficulty?.is_custom)
        )
            continue;

        const rating = play.level || difficulty?.level;
        if (!Number.isFinite(rating) || rating < 1) continue;
        const level = Math.floor(rating);
        levels.add(level);
        if (time < cutoff) continue;

        const key = chartKey(play);
        if (
            play.score < minimum &&
            !aprilFools.has(key) &&
            !aprilFools.has(`${play.music_id}:*`)
        )
            continue;

        const start = periodStart(time, unit);
        if (!periods.has(start)) periods.set(start, new Map());
        const byLevel = periods.get(start);
        if (!byLevel.has(level)) byLevel.set(level, new Map());
        const charts = byLevel.get(level);
        if (!charts.has(key))
            charts.set(key, {
                chart: {
                    ...play,
                    title: song?.title || play.title,
                    level: rating,
                },
                attempts: 0,
                clear: 0,
            });
        const entry = charts.get(key);
        entry.attempts++;
        entry.clear += Number(play.clear_type >= 2);
    }

    return {
        periods,
        levels: [...levels].sort((a, b) => b - a),
        unit,
    };
}

export function difficultyProgressWindow(index, level) {
    const starts = [...index.periods.keys()].filter((start) =>
        index.periods.get(start).has(level),
    );
    const last = starts.at(-1);
    const periods = [];
    for (
        let start = starts[0];
        start <= last;
        start = nextPeriod(start, index.unit)
    ) {
        const charts = [
            ...(index.periods.get(start)?.get(level)?.values() ?? []),
        ];
        periods.push(
            charts.reduce(
                (week, chart) => {
                    week.attempts += chart.attempts;
                    week.clear += chart.clear;
                    return week;
                },
                { start, charts, attempts: 0, clear: 0 },
            ),
        );
    }
    return periods;
}

function clearRate(week) {
    return (week.clear / week.attempts) * 100;
}

function formatRate(value) {
    return `${number(Math.round(value))}%`;
}

function displayRate(week) {
    return week.attempts
        ? formatRate(clearRate(week))
        : "No qualifying plays";
}

export function createDifficultyProgress({
    coverMarkup,
    chartInfo,
    revealChart,
    stopChart,
}) {
    const svg = $("progress-chart");
    const wrap = $("progress-chart-wrap");
    const popup = $("progress-popup");
    const controls = document.querySelector(".progress-controls");
    const level = $("progress-level");
    const cutoff = $("progress-minimum");
    const footer = $("progress-footer");
    const breakdown = $("progress-breakdown");
    const weekSelect = $("progress-week");
    let index,
        plays,
        songs,
        includeCustom,
        days,
        now,
        periods,
        selectedPeriod,
        plot;
    let selectedLevel;
    let minimum = parseScore(cutoff.value);
    let aprilFools = new Set();
    let requestedExceptions = false;

    function labelDate(time, full = false) {
        if (index.unit === "month") return monthDate.format(time);
        return full ? date(time) : shortDate(time);
    }

    function renderPeriod() {
        const period = periods.find(({ start }) => start === selectedPeriod);
        if (!period) return;
        weekSelect.value = String(selectedPeriod);
        const charts = [...period.charts].sort(
            (a, b) => b.attempts - a.attempts,
        );
        $("progress-songs").innerHTML = charts
            .map((entry) => {
                const result = `${number(entry.clear)}/${number(entry.attempts)} clears`;
                return `<li class="progress-song">${coverMarkup(entry.chart, "small", false)}${chartInfo(entry.chart, { showClear: false })}<span class="progress-song-result">${result}</span></li>`;
            })
            .join("");
    }

    function renderSummary(populated) {
        const total = { attempts: 0, clear: 0 };
        let best = 0;
        let worse = 100;
        for (const period of populated) {
            const rate = clearRate(period);
            total.attempts += period.attempts;
            total.clear += period.clear;
            best = Math.max(best, rate);
            worse = Math.min(worse, rate);
        }
        $("progress-summary").innerHTML =
            `<span><strong>${number(total.attempts)}</strong> ${total.attempts === 1 ? "play" : "plays"}</span><span>Average <strong>${formatRate(clearRate(total))}</strong></span><span>Best <strong>${formatRate(best)}</strong></span><span>Worse <strong>${formatRate(worse)}</strong></span>`;
    }

    function hidePopup() {
        popup.hidden = true;
        plot?.crosshair.setAttribute("visibility", "hidden");
    }

    function resetPlot() {
        hidePopup();
        stopChart(svg);
        svg.replaceChildren();
        plot = null;
    }

    function render() {
        const { title, label } = periodNames[index.unit];
        setText("difficulty-progress-title", title);
        setText("progress-period-label", label);
        if (!index?.levels.length) {
            resetPlot();
            svg.setAttribute("hidden", "");
            footer.hidden = true;
            $("progress-empty").hidden = false;
            setText("progress-empty", "No recorded plays with a chart level");
            return;
        }
        periods = difficultyProgressWindow(index, selectedLevel);
        const populated = periods.filter(({ attempts }) => attempts);
        $("progress-empty").hidden = !!populated.length;
        svg.toggleAttribute("hidden", !populated.length);
        footer.hidden = !populated.length;
        if (!populated.length) {
            resetPlot();
            setText("progress-empty", "No qualifying plays");
            return;
        }
        renderSummary(populated);

        const small = matchMedia("(max-width: 900px)").matches;
        const width = small
            ? Math.max(260, svg.getBoundingClientRect().width)
            : 1100;
        const signature = JSON.stringify([
            selectedLevel,
            index.unit,
            periods.map(({ start, attempts, clear }) => [
                start,
                attempts,
                clear,
            ]),
        ]);
        const changed = plot?.signature !== signature;
        if (!changed && plot.width === width) {
            hidePopup();
            renderPeriod();
            return;
        }

        resetPlot();
        const height = small ? 240 : 280;
        const left = 45,
            right = width - 29,
            top = 24,
            bottom = height - 38;
        const lastColumn = periods.length - 1;
        const x = (column) =>
            left + (lastColumn ? column / lastColumn : 0.5) * (right - left);
        const y = (value) => bottom - (value / 100) * (bottom - top);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("aria-label", `${title} for level ${selectedLevel}`);
        for (const value of [0, 25, 50, 75, 100]) {
            const lineY = y(value);
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: lineY,
                    y2: lineY,
                    class: "grid",
                }),
                svgElement(
                    "text",
                    { x: left - 9, y: lineY + 4, "text-anchor": "end" },
                    `${value}%`,
                ),
            );
        }

        const gradientId = "progress-play-gradient";
        const gradient = svgElement("linearGradient", {
            id: gradientId,
            gradientUnits: "userSpaceOnUse",
            x1: left,
            x2: right,
        });
        const defs = svgElement("defs");
        defs.append(gradient);

        const series = svgElement("g", { class: "history-series" });
        let segment = [];
        function appendLine() {
            if (segment.length > 1)
                series.append(
                    svgElement("path", {
                        d: pathData(segment, x, y),
                        fill: "none",
                        stroke: `url(#${gradientId})`,
                        "stroke-width": 2,
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    }),
                );
            segment = [];
        }
        const ticks = periods.map(({ start }, column) =>
            svgElement(
                "text",
                { x: x(column), y: bottom + 22, "text-anchor": "middle" },
                labelDate(start),
            ),
        );
        svg.append(...ticks);
        const labelWidth = Math.max(
            ...ticks.map((tick) => tick.getComputedTextLength()),
        );
        const tickStep = Math.max(
            1,
            Math.ceil(((labelWidth + 14) * lastColumn) / (right - left)),
        );
        ticks.forEach((tick, column) => {
            if (
                column > 0 &&
                (column < tickStep || (lastColumn - column) % tickStep !== 0)
            )
                tick.remove();
        });

        const dots = [];
        for (const [column, period] of periods.entries()) {
            if (!period.attempts) {
                appendLine();
                continue;
            }
            const value = clearRate(period);
            segment.push([column, value]);
            const dot = svgElement("circle", {
                cx: x(column),
                cy: y(value),
                r: 3.5,
                class: "hover-point",
            });
            const stop = svgElement("stop", {
                class: "progress-play-stop",
                offset: column / Math.max(1, lastColumn),
            });
            const accent =
                period.attempts >= fullAccentPlayCount
                    ? 100
                    : (100 * (period.attempts - 1)) / (fullAccentPlayCount - 1);
            dot.style.setProperty("--progress-accent-weight", `${accent}%`);
            stop.style.setProperty("--progress-accent-weight", `${accent}%`);
            dots.push(dot);
            gradient.append(stop);
        }
        appendLine();
        series.append(...dots);
        const crosshair = svgElement("line", {
            y1: top,
            y2: bottom,
            class: "crosshair",
            visibility: "hidden",
        });
        svg.append(defs, series, crosshair);
        plot = { width, left, right, x, crosshair, signature };
        weekSelect.replaceChildren(
            ...periods.map(
                ({ start }) => new Option(labelDate(start, true), start),
            ),
        );
        if (!periods.some(({ start }) => start === selectedPeriod))
            selectedPeriod = populated.at(-1).start;
        renderPeriod();
        if (changed) revealChart(svg);
    }

    function weekAt(event) {
        if (!plot) return -1;
        const rect = svg.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * plot.width;
        if (px < plot.left - 12 || px > plot.right + 12) return -1;
        return Math.max(
            0,
            Math.min(
                periods.length - 1,
                Math.round(
                    ((px - plot.left) / (plot.right - plot.left)) *
                        (periods.length - 1),
                ),
            ),
        );
    }

    bindChartHover(svg, wrap, {
        show(event) {
            const column = weekAt(event);
            if (column < 0) return hidePopup();
            const period = periods[column];
            const x = plot.x(column);
            plot.crosshair.setAttribute("x1", x);
            plot.crosshair.setAttribute("x2", x);
            plot.crosshair.setAttribute("visibility", "visible");
            const heading = document.createElement("strong");
            heading.textContent = `${periodNames[index.unit].prefix}${labelDate(period.start, true)}`;
            const value = document.createElement("div");
            value.className = "popup-value";
            value.textContent = displayRate(period);
            const clearRow = document.createElement("div");
            clearRow.className = "popup-line";
            const clears = document.createElement("span");
            clears.textContent = period.attempts
                ? `${number(period.clear)} of ${number(period.attempts)} cleared`
                : `${number(0)} plays`;
            clearRow.append(clears);
            popup.replaceChildren(heading, value, clearRow);
            if (
                period.attempts > 0 &&
                period.attempts < lowPlayCountThreshold
            ) {
                const notice = document.createElement("span");
                notice.className = "progress-low-play-count";
                notice.textContent = "Low play count";
                clearRow.before(notice);
            }
            positionChartPopup(popup, wrap, event);
        },
        hide: hidePopup,
    });
    svg.addEventListener("click", (event) => {
        const column = weekAt(event);
        if (column < 0) return;
        selectedPeriod = periods[column].start;
        breakdown.open = true;
        renderPeriod();
    });
    weekSelect.addEventListener("change", () => {
        selectedPeriod = Number(weekSelect.value);
        renderPeriod();
    });

    function updateIndex() {
        index = indexDifficultyProgress(plays, songs, {
            includeCustom,
            minimum,
            aprilFools,
            days,
            now,
        });
        controls.hidden = !index.levels.length;
        level.max = Math.max(
            Math.floor(DIFFICULTY_LIMITS[1]),
            index.levels[0] ?? 0,
        );
        if (selectedLevel === undefined || selectedLevel > Number(level.max)) {
            const counts = new Map();
            for (const byLevel of index.periods.values()) {
                for (const [value, charts] of byLevel) {
                    const attempts = [...charts.values()].reduce(
                        (sum, entry) => sum + entry.attempts,
                        0,
                    );
                    counts.set(value, (counts.get(value) || 0) + attempts);
                }
            }
            selectedLevel = index.levels.reduce(
                (best, value) =>
                    (counts.get(value) || 0) > (counts.get(best) || 0)
                        ? value
                        : best,
                index.levels[0],
            );
            level.value = selectedLevel ?? "";
        }
        render();

        if (requestedExceptions || !plays.some(({ score }) => score < minimum))
            return;
        requestedExceptions = true;
        fetch("/api/unlocks?index=april-fools")
            .then(async (response) =>
                response.ok ? (await response.json()).charts : null,
            )
            .then((charts) => {
                if (!Array.isArray(charts)) return;
                aprilFools = new Set(charts);
                updateIndex();
            })
            .catch(() => {});
    }

    function updateLevel() {
        const input = level.valueAsNumber;
        const value = Number.isInteger(input)
            ? Math.max(Number(level.min), Math.min(Number(level.max), input))
            : selectedLevel;
        level.value = value;
        if (value === selectedLevel) return;
        selectedLevel = value;
        render();
    }
    level.addEventListener("change", updateLevel);
    level.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            level.blur();
        }
    });
    for (const button of controls.querySelectorAll(
        "[data-progress-level-step]",
    )) {
        button.addEventListener("click", () => {
            level.stepUp(Number(button.dataset.progressLevelStep));
            updateLevel();
        });
    }

    function updateCutoff(direction = 0) {
        const input = parseScore(cutoff.value);
        const value = stepScore(
            Number.isSafeInteger(input) ? input : minimum,
            direction,
        );
        writeScoreInput(cutoff, value);
        if (value === minimum) return;
        minimum = value;
        updateIndex();
    }
    cutoff.addEventListener("change", () => updateCutoff());
    cutoff.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter") {
            event.preventDefault();
            cutoff.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            updateCutoff(event.key === "ArrowUp" ? 1 : -1);
        }
    });
    for (const button of controls.querySelectorAll("[data-progress-step]")) {
        button.addEventListener("click", () =>
            updateCutoff(Number(button.dataset.progressStep)),
        );
    }

    return {
        update(
            nextPlays,
            nextSongs,
            { includeCustom: allowCustom, days: nextDays, now: nextNow } = {},
        ) {
            if (
                nextPlays === plays &&
                nextSongs === songs &&
                allowCustom === includeCustom &&
                nextDays === days
            ) {
                const small = matchMedia("(max-width: 900px)").matches;
                const width = small
                    ? Math.max(260, svg.getBoundingClientRect().width)
                    : 1100;
                if (
                    plot &&
                    Math.abs(plot.width - width) > 1 &&
                    wrap.getClientRects().length
                )
                    render();
                return;
            }
            plays = nextPlays;
            songs = nextSongs;
            includeCustom = allowCustom;
            if (days !== nextDays) selectedPeriod = null;
            days = nextDays;
            now = nextNow;
            updateIndex();
        },
    };
}
