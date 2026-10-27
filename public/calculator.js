import {
    CLEARS,
    DIFFS,
    SCORE_GRADES,
    VF_CLEARS,
    average,
    calculateChartVf,
    vf,
} from "./metrics.js";
import { svgElement, pathData } from "./svg.js";
import { motion } from "./motion.js";
import {
    DIFFICULTY_LIMITS,
    difficultyStep,
    nextDifficulty,
} from "./difficulty.js";

const defaults = {
    mode: "score",
    level: 17,
    score: 9700000,
    targetScore: 9700000,
    targetLevel: 17,
};
const limits = { level: DIFFICULTY_LIMITS, score: [0, 10000000, 1] };
const formatScore = (score) => score.toLocaleString();
const formatScoreInput = (score) =>
    String(score).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
const scoreMatchTolerance = 50000;
const scoreScaleFocus = 100000;
const scoreScaleLog = Math.log1p(limits.score[1] / scoreScaleFocus);
const difficultyScaleFocus = 0.5;
const difficultyScaleLog = Math.log1p(
    (limits.level[1] - limits.level[0]) / difficultyScaleFocus,
);

function scorePosition(score) {
    return (
        1 -
        Math.log1p((limits.score[1] - score) / scoreScaleFocus) / scoreScaleLog
    );
}

function scoreAtPosition(position) {
    const score =
        limits.score[1] -
        scoreScaleFocus * Math.expm1((1 - position) * scoreScaleLog);
    return Math.max(limits.score[0], Math.min(limits.score[1], score));
}

function difficultyPosition(level) {
    return (
        1 -
        Math.log1p((limits.level[1] - level) / difficultyScaleFocus) /
            difficultyScaleLog
    );
}

function difficultyAtPosition(position) {
    const level =
        limits.level[1] -
        difficultyScaleFocus * Math.expm1((1 - position) * difficultyScaleLog);
    return Math.max(limits.level[0], Math.min(limits.level[1], level));
}

function parseScore(value) {
    const digits = value.replace(/[\s,]/g, "");
    return /^-?\d+$/.test(digits) ? Number(digits) : NaN;
}

function snapDifficulty(level) {
    const step = Math.round(difficultyStep(level) * 10);
    const nearest = Math.round(Math.round(level * 10) / step) * step;
    return Math.max(limits.level[0], Math.min(limits.level[1], nearest / 10));
}

export function createCalculator(getSummary, renderChartRow, getChartPlays) {
    const $ = (id) => document.getElementById(`calculator-${id}`);
    const svg = $("chart");
    const target = $("target");
    const popup = $("popup");
    let state = { ...defaults },
        plot,
        rendered = false,
        chartSignature = "",
        chartFilter = null,
        plottedCharts = [];

    function getCharts() {
        const charts = chartFilter
            ? getChartPlays(chartFilter.music_id, chartFilter.diff_idx).map(
                  (play) => ({ ...play, ...chartFilter, vf: play.play_vf }),
              )
            : getSummary()?.top || [];
        return charts.map((chart, index) => ({ ...chart, rank: index + 1 }));
    }

    function formatScoreField(preserveCaret = false) {
        const input = $("score");
        const digitsBeforeCaret = input.value
            .slice(0, input.selectionStart)
            .replace(/\D/g, "").length;
        input.value = formatScoreInput(state.score);
        input.setAttribute("aria-valuenow", state.score);
        if (preserveCaret && document.activeElement === input) {
            let caret = 0,
                digits = 0;
            while (caret < input.value.length && digits < digitsBeforeCaret) {
                if (/\d/.test(input.value[caret])) digits++;
                caret++;
            }
            input.setSelectionRange(caret, caret);
        }
    }

    function syncControls() {
        $("level").value = state.level;
        formatScoreField();
        for (const key of ["level", "score"])
            $(key).removeAttribute("aria-invalid");
        $("validation").hidden = true;
        const variableScore = state.mode === "score";
        $("level-field").hidden = !variableScore;
        $("score-field").hidden = variableScore;
        document
            .querySelectorAll("[data-calculator-mode]")
            .forEach((button) => {
                const selected = button.dataset.calculatorMode === state.mode;
                button.classList.toggle("selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            });
    }

    function updateTarget(
        value = state.mode === "score" ? state.targetScore : state.targetLevel,
    ) {
        if (!plot) return;
        const score = state.mode === "score" ? Math.round(value) : state.score;
        const showPuc = score === limits.score[1];
        $("vf-6")
            .closest("[data-clear]")
            .setAttribute("aria-disabled", String(!showPuc));
        if (plot.showPuc !== showPuc) {
            motion.calculatorCurves(svg, showPuc, plot.showPuc !== undefined);
            plot.showPuc = showPuc;
        }
        const [, scoreGrade, multiplier] = SCORE_GRADES.find(
            ([minimum]) => score >= minimum,
        );
        const level =
            state.mode === "difficulty" ? snapDifficulty(value) : state.level;
        if (state.mode === "score") state.targetScore = score;
        else state.targetLevel = level;
        const point = state.mode === "score" ? score : level;
        target.value =
            state.mode === "score"
                ? scorePosition(score)
                : difficultyPosition(level);
        $("point").textContent =
            state.mode === "score"
                ? `${formatScore(score)} · ${scoreGrade}`
                : String(level);
        target.setAttribute("aria-valuetext", $("point").textContent);
        $("grade-name").textContent = scoreGrade;
        $("grade-multiplier").textContent = `×${(multiplier / 100).toFixed(2)}`;
        $("formula-level").textContent = level;
        $("formula-score").textContent = formatScoreInput(score);
        $("formula-grade").textContent = (multiplier / 100).toFixed(2);
        $("formula-grade").title = `${scoreGrade} grade coefficient`;
        plot.markers.replaceChildren(
            svgElement("line", {
                x1: plot.x(point),
                x2: plot.x(point),
                y1: plot.top,
                y2: plot.bottom,
                class: "calculator-crosshair",
            }),
        );
        const worst = getSummary()?.top?.at(-1)?.vf;
        for (const { type } of VF_CLEARS) {
            const value = calculateChartVf(level, score, type);
            const output = $(`vf-${type}`);
            output.textContent = vf(value);
            const legend = output.closest("[data-clear]");
            const improves =
                Number.isFinite(worst) &&
                value > worst &&
                (type !== 6 || showPuc);
            legend.classList.toggle("is-upgrade", improves);
            legend.title = improves ? "Above Worst Chart VF" : "";
            if ((type === 6) !== showPuc) continue;
            plot.markers.append(
                svgElement("circle", {
                    cx: plot.x(point),
                    cy: plot.y(value),
                    r: 3.5,
                    class: "calculator-point",
                    "data-clear": type,
                }),
            );
        }
    }

    function updateReferences({ animate = true } = {}) {
        if (!plot) return;
        const top = getSummary()?.top || [];
        const references = [
            { key: "best", label: "Best", value: top[0]?.vf },
            {
                key: "average",
                label: "Average Top 50",
                value: average(top.map((chart) => chart.vf)),
            },
            { key: "worst", label: "Worst", value: top.at(-1)?.vf },
        ].filter(
            ({ value }) =>
                Number.isFinite(value) && value >= 0 && value <= plot.ceiling,
        );
        const previousGroup = svg.querySelector(".calculator-references");
        const signature = JSON.stringify(references);
        if (previousGroup?.dataset.values === signature) return;
        motion.stop(previousGroup);
        previousGroup?.remove();
        const legend = $("reference-legend");
        legend.hidden = !references.length;
        legend.innerHTML = references
            .map(
                ({ key, label, value }) =>
                    `<div data-reference="${key}"><svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4"/></svg><span>${label}</span><output>${vf(value)}</output></div>`,
            )
            .join("");
        if (!references.length) return;

        const group = svgElement("g", {
            class: "calculator-references",
            "data-values": signature,
        });
        for (const { key, label, value } of references) {
            const guide = svgElement("g", {
                class: "calculator-reference",
                "data-reference": key,
                "data-vf": value,
                "aria-label": `${label} · ${vf(value)}`,
            });
            guide.append(
                svgElement("line", {
                    x1: plot.left,
                    x2: plot.right,
                    y1: plot.y(value),
                    y2: plot.y(value),
                }),
            );
            group.append(guide);
        }
        svg.insertBefore(group, plot.markers);
        if (animate && !motion.isPending(svg))
            motion.calculatorReferences(group);
    }

    function matchesChart(chart) {
        if (chartFilter) return true;
        return state.mode === "score"
            ? chart.level === state.level
            : Number.isSafeInteger(chart.score) &&
                  Math.abs(chart.score - state.score) <= scoreMatchTolerance;
    }

    function updateCharts(charts, points) {
        plottedCharts = charts;
        const matches = charts.filter(matchesChart);
        const noun = chartFilter ? "play" : "chart";
        $("match-count").textContent =
            `${matches.length} ${noun}${matches.length === 1 ? "" : "s"}`;
        $("filter").hidden = !chartFilter;
        $("filter-label").textContent = chartFilter
            ? `Showing: ${chartFilter.artist} - ${chartFilter.title} (${DIFFS[chartFilter.diff_idx]} ${chartFilter.level ?? "—"})`
            : "";
        $("matches").innerHTML = matches.length
            ? matches.map((chart) => renderChartRow(chart, chart.rank)).join("")
            : `<div class="empty-list">${chartFilter ? "No recorded plays for this chart yet." : "No matching Top 50 charts."}</div>`;

        for (const chart of charts) {
            const value = state.mode === "score" ? chart.score : chart.level;
            if (
                !Number.isFinite(value) ||
                value < plot.minimum ||
                value > plot.maximum ||
                !Number.isFinite(chart.vf) ||
                chart.vf < 0 ||
                chart.vf > plot.ceiling
            )
                continue;
            const matching = matchesChart(chart);
            const caption = `${chart.title || `Chart ${chart.music_id}`} · ${DIFFS[chart.diff_idx]} ${chart.level ?? ""} · ${Number.isFinite(chart.score) ? formatScoreInput(chart.score) : "—"} · VF ${vf(chart.vf)}`;
            const dot = svgElement("g", {
                class: `calculator-chart-dot chart-row${matching ? " is-matching" : ""}`,
                "data-music": chart.music_id,
                "data-diff": chart.diff_idx,
                "data-rank": chart.rank,
                tabindex: 0,
                role: "button",
                "aria-label": `${chartFilter ? "Play" : "Top"} ${chart.rank} · ${caption} · ${CLEARS[chart.clear_type]}. View plays`,
            });
            dot.append(
                svgElement("circle", {
                    cx: plot.x(value),
                    cy: plot.y(chart.vf),
                    r: 9,
                    class: "calculator-dot-target",
                }),
                svgElement("circle", {
                    cx: plot.x(value),
                    cy: plot.y(chart.vf),
                    r: 2.4,
                    class: "calculator-dot",
                }),
            );
            points.append(dot);
        }
    }

    function showChartPreview(dot) {
        const rank = Number(dot.dataset.rank);
        const chart = plottedCharts[rank - 1];
        if (!chart) return;
        popup.innerHTML = renderChartRow(chart, rank);
        popup.hidden = false;
        const wrap = svg.parentElement.getBoundingClientRect();
        const bounds = dot
            .querySelector(".calculator-dot")
            .getBoundingClientRect();
        const left =
            bounds.left + bounds.width / 2 - wrap.left - popup.offsetWidth / 2;
        const above = bounds.top - wrap.top - popup.offsetHeight - 12;
        const fitsAbove = above >= 0 && wrap.top + above >= 8;
        popup.style.left = `${Math.max(8, Math.min(left, wrap.width - popup.offsetWidth - 8))}px`;
        popup.style.top = `${fitsAbove ? above : bounds.bottom - wrap.top + 12}px`;
    }

    function hideChartPreview() {
        popup.hidden = true;
    }

    function render({ animate = true } = {}) {
        animate = animate || !rendered;
        rendered = true;
        const previous = plot;
        hideChartPreview();
        motion.stop(svg);
        svg.replaceChildren();
        const variableScore = state.mode === "score";
        const value = variableScore ? state.targetScore : state.targetLevel;
        const showPuc =
            (variableScore ? Math.round(value) : state.score) ===
            limits.score[1];
        const transitionCurves =
            animate &&
            previous?.mode === state.mode &&
            previous.showPuc !== showPuc;
        const mobile = matchMedia("(max-width: 700px)").matches;
        const width = mobile
            ? Math.max(260, svg.getBoundingClientRect().width)
            : 1100;
        const height = mobile ? 330 : 390;
        const left = 25,
            right = width - (mobile ? 56 : 74);
        const top = variableScore ? 48 : 32,
            bottom = height - 58;
        const minimum = variableScore ? 0 : limits.level[0];
        const maximum = variableScore ? limits.score[1] : limits.level[1];
        const position = variableScore ? scorePosition : difficultyPosition;
        const x = (value) => left + position(value) * (right - left);
        const valueAt = (point, type) =>
            calculateChartVf(
                variableScore ? state.level : point,
                variableScore ? point : state.score,
                type,
            );
        const charts = getCharts();
        chartSignature = JSON.stringify(charts);
        const peak = Math.max(
            valueAt(maximum, 6),
            ...charts.map((chart) => chart.vf).filter(Number.isFinite),
        );
        const power = 10 ** Math.floor(Math.log10(Math.max(peak / 5, 0.001)));
        const step = Math.ceil(peak / (5 * power)) * power || 0.001;
        const ceiling = step * 5;
        const y = (value) => bottom - (value / ceiling) * (bottom - top);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute(
            "aria-label",
            variableScore
                ? `Chart VolForce by score on a reversed logarithmic scale at difficulty ${state.level}, for available clear types`
                : `Chart VolForce by difficulty on a reversed logarithmic scale at score ${formatScore(state.score)}, for available clear types`,
        );

        for (let tick = 0; tick <= 10; tick++) {
            const value = (tick * step) / 2;
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: y(value),
                    y2: y(value),
                    class: "grid",
                }),
                svgElement(
                    "text",
                    {
                        x: right + 10,
                        y: y(value) + 4,
                        "text-anchor": "start",
                    },
                    vf(value),
                ),
            );
        }
        const ticks = variableScore
            ? [
                  0, 5000000, 8000000, 9000000, 9500000, 9800000, 9900000,
                  10000000,
              ]
            : [...Array.from({ length: 20 }, (_, index) => index + 1), maximum];
        const tickSpacing = variableScore ? 42 : 28;
        let previousTick = left - 100;
        for (const value of ticks) {
            if (
                value !== maximum &&
                (x(value) - previousTick < tickSpacing ||
                    right - x(value) < tickSpacing)
            )
                continue;
            previousTick = x(value);
            svg.append(
                svgElement("line", {
                    x1: x(value),
                    x2: x(value),
                    y1: top,
                    y2: bottom,
                    class: "calculator-guide",
                }),
                svgElement(
                    "text",
                    {
                        x: x(value),
                        y: bottom + 21,
                        "text-anchor": "middle",
                    },
                    variableScore
                        ? value
                            ? `${value / 1000000}M`
                            : "0"
                        : value,
                ),
            );
        }
        if (variableScore) {
            let previous = right + 100;
            for (const [threshold, label] of SCORE_GRADES) {
                if (!threshold || previous - x(threshold) < (mobile ? 36 : 42))
                    continue;
                previous = x(threshold);
                svg.append(
                    svgElement("line", {
                        x1: x(threshold),
                        x2: x(threshold),
                        y1: top,
                        y2: bottom,
                        class: "calculator-guide grade-guide",
                    }),
                    svgElement(
                        "text",
                        {
                            x: x(threshold),
                            y: top - 12,
                            "text-anchor": "middle",
                            class: "axis-caption",
                        },
                        label,
                    ),
                );
            }
        }
        svg.append(
            svgElement(
                "text",
                {
                    x: right,
                    y: 17,
                    "text-anchor": "end",
                    class: "axis-caption",
                },
                "Chart VF",
            ),
            svgElement(
                "text",
                {
                    x: (left + right) / 2,
                    y: height - 9,
                    "text-anchor": "middle",
                    class: "axis-caption",
                },
                variableScore ? "Score" : "Difficulty",
            ),
        );

        const points = variableScore
            ? [
                  ...new Set([
                      ...Array.from({ length: 401 }, (_, index) =>
                          Math.round(scoreAtPosition(index / 400)),
                      ),
                      ...SCORE_GRADES.flatMap(([threshold]) =>
                          threshold ? [threshold - 1, threshold] : [],
                      ),
                  ]),
              ].sort((a, b) => a - b)
            : Array.from({ length: 200 }, (_, index) => (index + 10) / 10);
        const defs = svgElement("defs");
        svg.append(defs);
        const gradientId = "calculator-area-gradient";
        const gradient = svgElement("linearGradient", {
            id: gradientId,
            x1: 0,
            x2: 0,
            y1: top,
            y2: bottom,
            gradientUnits: "userSpaceOnUse",
            "data-clear": 6,
        });
        for (const [offset, opacity] of [
            ["0%", 0.18],
            ["60%", 0.045],
            ["100%", 0],
        ])
            gradient.append(
                svgElement("stop", { offset, "stop-opacity": opacity }),
            );
        defs.append(gradient);
        for (const { type } of [...VF_CLEARS].reverse()) {
            const line = pathData(
                points.map((point) => [point, valueAt(point, type)]),
                x,
                y,
            );
            const curve = svgElement("g", {
                class: "calculator-curve",
                "data-clear": type,
            });
            if (type >= 5)
                curve.append(
                    svgElement("path", {
                        d: `${line} L${right},${bottom} L${left},${bottom} Z`,
                        fill: `url(#${gradientId})`,
                        class: "calculator-area",
                    }),
                );
            curve.append(
                svgElement("path", { d: line, class: "calculator-line" }),
            );
            svg.append(curve);
        }
        const chartPoints = svgElement("g", {
            class: "calculator-chart-points",
        });
        const markers = svgElement("g", {
            class: "calculator-markers",
            "aria-hidden": "true",
        });
        svg.append(chartPoints, markers);
        plot = {
            mode: state.mode,
            showPuc: transitionCurves ? previous.showPuc : undefined,
            x,
            y,
            left,
            right,
            top,
            bottom,
            minimum,
            maximum,
            ceiling,
            markers,
        };
        updateReferences({ animate: false });
        updateCharts(charts, chartPoints);
        target.min = 0;
        target.max = 1;
        target.step = 0.000001;
        $("target-label").textContent = variableScore
            ? "Target score"
            : "Target difficulty";
        if (transitionCurves)
            motion.calculatorCurves(svg, previous.showPuc, false);
        updateTarget(value);
        if (!transitionCurves) motion.calculator(svg, animate);
    }

    document.querySelectorAll("[data-calculator-mode]").forEach((button) => {
        button.addEventListener("click", () => {
            if (state.mode === button.dataset.calculatorMode) return;
            state.mode = button.dataset.calculatorMode;
            syncControls();
            render();
        });
    });
    for (const key of ["level", "score"]) {
        $(key).addEventListener("input", () => {
            const value =
                key === "score"
                    ? parseScore($(key).value)
                    : $(key).valueAsNumber;
            const [min, max] = limits[key];
            const valid =
                $(key).validity.valid &&
                Number.isFinite(value) &&
                value >= min &&
                value <= max &&
                (key !== "score" || Number.isSafeInteger(value));
            $(key).setAttribute("aria-invalid", String(!valid));
            $("validation").hidden = valid;
            $("validation").textContent =
                key === "level"
                    ? "Enter a difficulty from 1 to 20.9, in steps of 0.1."
                    : "Enter a whole score from 0 to 10,000,000.";
            if (!valid) return;
            const changed = state[key] !== value;
            state[key] = value;
            if (key === "score") formatScoreField(true);
            if (!changed) return;
            render();
        });
        $(key).addEventListener("blur", () => {
            const input = $(key);
            const value =
                key === "score" ? parseScore(input.value) : input.valueAsNumber;
            const [min, max] = limits[key];
            if (Number.isNaN(value) || (value >= min && value <= max)) return;
            input.value = Math.max(min, Math.min(max, value));
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        $(key).addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                $(key).blur();
                return;
            }
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            stepInput(key, event.key === "ArrowUp" ? 1 : -1);
        });
    }
    function stepInput(key, direction) {
        const input = $(key);
        const value =
            key === "score" ? parseScore(input.value) : input.valueAsNumber;
        const current = Number.isFinite(value) ? value : state[key];
        input.value =
            key === "level"
                ? nextDifficulty(current, direction)
                : Math.max(
                      limits.score[0],
                      Math.min(limits.score[1], current + direction * 25000),
                  );
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelectorAll("[data-step-input]").forEach((button) => {
        button.addEventListener("click", () =>
            stepInput(button.dataset.stepInput, Number(button.dataset.step)),
        );
    });
    target.addEventListener("input", () => {
        updateTarget(
            state.mode === "score"
                ? scoreAtPosition(target.valueAsNumber)
                : difficultyAtPosition(target.valueAsNumber),
        );
    });
    target.addEventListener("keydown", (event) => {
        if (state.mode !== "difficulty") return;
        const direction = ["ArrowRight", "ArrowUp"].includes(event.key)
            ? 1
            : ["ArrowLeft", "ArrowDown"].includes(event.key)
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        updateTarget(nextDifficulty(state.targetLevel, direction));
    });
    svg.addEventListener("pointerover", (event) => {
        const dot = event.target.closest(".calculator-chart-dot");
        if (dot && !dot.contains(event.relatedTarget)) showChartPreview(dot);
    });
    svg.addEventListener("pointerout", (event) => {
        const dot = event.target.closest(".calculator-chart-dot");
        if (dot && !dot.contains(event.relatedTarget)) hideChartPreview();
    });
    svg.addEventListener("pointerleave", hideChartPreview);
    svg.addEventListener("focusin", (event) => {
        const dot = event.target.closest(".calculator-chart-dot");
        if (dot) showChartPreview(dot);
    });
    svg.addEventListener("focusout", hideChartPreview);
    svg.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideChartPreview();
        const dot = event.target.closest(".calculator-chart-dot");
        if (!dot || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        dot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    function clearFilter() {
        chartFilter = null;
        $("filter").hidden = true;
        hideChartPreview();
    }
    $("filter-remove").addEventListener("click", () => {
        clearFilter();
        render({ animate: false });
    });
    $("legend").innerHTML =
        VF_CLEARS.map(
            ({ type, multiplier }) =>
                `<div data-clear="${type}"><svg class="calculator-legend-border" aria-hidden="true"><rect width="100%" height="100%" pathLength="1"/></svg><span><i class="dot"></i>${CLEARS[type]} ×${(multiplier / 100).toFixed(2)}</span><output id="calculator-vf-${type}"></output></div>`,
        ).join("") +
        '<div class="calculator-grade" aria-label="Score grade multiplier"><span><i class="dot"></i><span id="calculator-grade-name"></span></span><output id="calculator-grade-multiplier"></output></div>';
    syncControls();

    return {
        render,
        clearFilter,
        updateData({ animate = true } = {}) {
            const charts = getCharts();
            const signature = JSON.stringify(charts);
            if (signature === chartSignature) {
                updateReferences({ animate });
                updateTarget();
                return;
            }
            if (!plot || charts.some((chart) => chart.vf > plot.ceiling)) {
                render({ animate: false });
                if (animate)
                    motion.calculatorReferences(
                        svg.querySelector(".calculator-references"),
                    );
                return;
            }
            chartSignature = signature;
            hideChartPreview();
            const points = svg.querySelector(".calculator-chart-points");
            motion.stop(points);
            points.replaceChildren();
            updateCharts(charts, points);
            updateReferences({ animate });
            updateTarget();
        },
        openChart(chart) {
            chartFilter = { ...chart };
            const bestScore =
                getChartPlays(chart.music_id, chart.diff_idx)[0]?.score ??
                defaults.score;
            state = {
                ...state,
                mode: "score",
                level: chart.level ?? defaults.level,
                score: bestScore,
            };
            syncControls();
        },
        reset() {
            clearFilter();
            state = { ...defaults };
            syncControls();
        },
    };
}
