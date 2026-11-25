import { $ } from "../core/dom.js";
import { bindChartHover, positionChartPopup } from "../core/chart-hover.js";
import { date, number, shortDate } from "../core/format.js";
import { motion } from "../core/motion.js";
import { pathData, svgElement } from "../core/svg.js";
import { dailyActivity, DAY_MS, playtimeText } from "./metrics.js";

const playtimeSteps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
const axisIntervals = 4;

function duration(seconds) {
    const rounded = Math.round(seconds);
    return rounded < 60 ? `${rounded}s` : playtimeText(rounded);
}

function playtimeTick(seconds) {
    if (!seconds) return "0";
    if (seconds < 3600) return `${seconds / 60}m`;
    return seconds % 3600 ? playtimeText(seconds) : `${seconds / 3600}h`;
}

function playtimeSegments(points) {
    const segments = [];
    for (const point of points) {
        const last = segments.at(-1);
        if (last && point[0] === last.at(-1)[0] + 1) last.push(point);
        else segments.push([point]);
    }
    return segments;
}

function includeIdleDays(points) {
    return points.flatMap((point, index) => {
        if (!index) return [point];
        const [day] = point;
        const previous = points[index - 1][0];
        if (day === previous + 1) return [point];
        if (day === previous + 2) return [[day - 1, 0], point];
        return [[previous + 1, 0], [day - 1, 0], point];
    });
}

function renderSeries(svg, lines, series, { x, left, right, top, bottom }) {
    const isPlaytime = series.key === "playtime";
    const peak = series.points.reduce(
        (max, [, value]) => Math.max(max, value),
        0,
    );
    const target = peak / axisIntervals;
    const step = isPlaytime
        ? (playtimeSteps.find((value) => value >= target) ??
          Math.ceil(target / 3600) * 3600)
        : Math.max(1, Math.ceil(target));
    const maximum = step * axisIntervals;
    const y = (value) => bottom - (value / maximum) * (bottom - top);
    svg.append(
        svgElement(
            "text",
            {
                x: isPlaytime ? left : right,
                y: top - 16,
                "text-anchor": isPlaytime ? "start" : "end",
                class: "axis-caption",
            },
            series.label,
        ),
    );
    for (let index = 0; index <= axisIntervals; index++) {
        const value = index * step;
        svg.append(
            svgElement(
                "text",
                {
                    x: isPlaytime ? left - 8 : right + 8,
                    y: y(value) + 4,
                    "text-anchor": isPlaytime ? "end" : "start",
                },
                series.tick(value),
            ),
        );
    }
    const line = svgElement("g", { "data-activity-series": series.key });
    for (const segment of series.segments) {
        if (segment.length === 1) {
            const [[day, value]] = segment;
            line.append(
                svgElement("circle", {
                    cx: x(day),
                    cy: y(value),
                    r: 3,
                    fill: series.color,
                }),
            );
        } else {
            line.append(
                svgElement("path", {
                    d: pathData(segment, x, y),
                    fill: "none",
                    stroke: series.color,
                    "stroke-width": isPlaytime ? 2.5 : 1.5,
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                }),
            );
        }
    }
    lines.prepend(line);
    return y;
}

export function createDailyActivity() {
    const root = $("daily-activity");
    const svg = $("daily-activity-chart");
    const wrap = $("daily-activity-chart-wrap");
    const popup = $("daily-activity-popup");
    const summary = $("daily-activity-summary");
    const buttons = root.querySelectorAll("[data-activity-toggle]");
    const shown = new Set(
        Array.from(buttons, (button) => button.dataset.activityToggle),
    );
    let activity;
    let plot;

    function hide() {
        popup.hidden = true;
        plot?.crosshair.setAttribute("visibility", "hidden");
        plot?.markers.replaceChildren();
    }

    function show(event) {
        if (!plot) return;
        const {
            left,
            right,
            width,
            first,
            dayCount,
            x,
            series,
            crosshair,
            markers,
        } = plot;
        const bounds = svg.getBoundingClientRect();
        const px = ((event.clientX - bounds.left) / bounds.width) * width;
        if (px < left || px > right) {
            hide();
            return;
        }
        const day =
            first +
            Math.min(
                dayCount - 1,
                Math.floor(((px - left) / (right - left)) * dayCount),
            );
        const pxDay = x(day);
        const rows = [];
        markers.replaceChildren();
        for (const { key, label, color, valueAt, format, y } of series) {
            const value = valueAt(day);
            if (value === undefined) continue;
            markers.append(
                svgElement("circle", {
                    cx: pxDay,
                    cy: y(value),
                    r: 3.5,
                    fill: color,
                    stroke: "var(--panel)",
                    "stroke-width": 1.5,
                }),
            );
            rows.push(
                `<div class="popup-line"><span><i class="dot daily-activity-${key}-dot"></i>${label}</span><b>${format(value)}</b></div>`,
            );
        }
        if (!rows.length) {
            hide();
            return;
        }
        crosshair.setAttribute("x1", pxDay);
        crosshair.setAttribute("x2", pxDay);
        crosshair.setAttribute("visibility", "visible");
        popup.innerHTML = `<strong>${date(day * DAY_MS, "UTC")}</strong>${rows.join("")}`;
        positionChartPopup(popup, wrap, event);
    }

    function renderPlot(reveal = false) {
        hide();
        plot = null;
        svg.replaceChildren();
        wrap.hidden = !activity.hasActivity;
        if (wrap.hidden) {
            motion.stop(svg);
            return;
        }

        const { first, last, countStart, countEnd, timePoints } = activity;
        const countPoints = [...activity.countPoints];
        if (countStart <= countEnd) {
            if (countPoints[0]?.[0] !== countStart)
                countPoints.unshift([countStart, 0]);
            if (countPoints.at(-1)?.[0] !== countEnd)
                countPoints.push([countEnd, 0]);
        }
        const dayCount = last - first + 1;
        const series = [
            {
                key: "playtime",
                label: "Active playtime",
                color: "var(--accent)",
                points: timePoints,
                segments: playtimeSegments(timePoints),
                valueAt: (day) => activity.timeByDay.get(day),
                format: duration,
                tick: playtimeTick,
            },
            {
                key: "count",
                label: "Play count",
                color: "var(--faint)",
                points: countPoints,
                segments: [includeIdleDays(countPoints)],
                valueAt: (day) =>
                    day >= countStart && day <= countEnd
                        ? (activity.playCounts.get(day) ?? 0)
                        : undefined,
                format: number,
                tick: number,
            },
        ].filter(({ key, points }) => points.length && shown.has(key));

        const mobile = window.matchMedia("(max-width: 900px)").matches;
        const width = mobile
            ? Math.max(260, svg.getBoundingClientRect().width)
            : 1100;
        const height = mobile ? 175 : 205;
        const left = mobile ? 52 : 69;
        const right = width - (mobile ? 46 : 72);
        const top = 33;
        const bottom = height - 33;
        const x = (day) =>
            left + ((day - first + 0.5) / dayCount) * (right - left);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        for (let index = 0; index <= axisIntervals; index++) {
            const y = bottom - (index / axisIntervals) * (bottom - top);
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: y,
                    y2: y,
                    class: "grid",
                }),
            );
        }
        const lines = svgElement("g", { class: "history-series" });
        for (const item of series)
            item.y = renderSeries(svg, lines, item, {
                x,
                left,
                right,
                top,
                bottom,
            });
        svg.append(lines);
        const labelCount = Math.min(dayCount, mobile ? 4 : 6);
        for (let index = 0; index < labelCount; index++) {
            const day =
                first +
                Math.round((index / (labelCount - 1 || 1)) * (dayCount - 1));
            svg.append(
                svgElement(
                    "text",
                    { x: x(day), y: bottom + 24, "text-anchor": "middle" },
                    shortDate(day * DAY_MS, "UTC"),
                ),
            );
        }
        const crosshair = svgElement("line", {
            y1: top,
            y2: bottom,
            class: "crosshair",
            visibility: "hidden",
        });
        const markers = svgElement("g", { "pointer-events": "none" });
        svg.append(crosshair, markers);
        plot = {
            left,
            right,
            width,
            first,
            dayCount,
            x,
            series,
            crosshair,
            markers,
        };
        motion.history(svg, reveal);
    }

    function render(plays, dailyPlaytime, { days, now, animate, transition }) {
        const previous = activity;
        activity = dailyActivity(plays, dailyPlaytime, { days, now });
        const { first, last, dayStreak, weekStreak, averageSeconds } = activity;
        const rangeChanged =
            first !== previous?.first || last !== previous?.last;
        const reveal = !previous || animate || (transition && rangeChanged);
        root.hidden = false;
        summary.innerHTML = [
            `<span><strong>${number(dayStreak)}</strong> ${dayStreak === 1 ? "day" : "days"} streak</span>`,
            `<span><strong>${number(weekStreak)}</strong> ${weekStreak === 1 ? "week" : "weeks"} streak</span>`,
            `<span><strong>${averageSeconds === null ? "0h 0m" : duration(averageSeconds)}</strong> per day on average</span>`,
        ].join("");
        renderPlot(reveal || !previous?.hasActivity);
        if (reveal || motion.isPending(summary)) motion.data(summary);
    }

    for (const button of buttons) {
        button.addEventListener("click", () => {
            const key = button.dataset.activityToggle;
            if (shown.has(key)) shown.delete(key);
            else shown.add(key);
            button.setAttribute("aria-pressed", String(shown.has(key)));
            renderPlot();
        });
    }
    bindChartHover(svg, wrap, { show, hide });
    return { render };
}
