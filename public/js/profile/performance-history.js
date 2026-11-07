import { $, setText } from "../core/dom.js";
import { date, shortDate, clock, number } from "../core/format.js";
import { svgElement, pathData } from "../core/svg.js";
import { motion } from "../core/motion.js";
import { bindChartHover, positionChartPopup } from "../core/chart-hover.js";
import {
    vf,
    average,
    performance,
    rolling,
    visibleObservations,
    calculateChartVf,
    lineValue,
} from "./metrics.js";
import { rankingHistory } from "./ranking-history.js";

export function createPerformanceHistory({
    getData,
    getSongs,
    rankingOptions,
    shown,
}) {
    let hover = null;

    function render({ days, difficulty, animate = true } = {}) {
        const data = getData();
        if (!data) return;
        const songs = getSongs();
        const plays = performance(data.plays, { days, difficulty });
        const svg = $("chart");
        svg.replaceChildren();
        svg.removeAttribute("aria-hidden");
        hover = null;
        $("popup").hidden = true;
        $("chart-empty").hidden = !!plays.length;
        if (!plays.length) {
            setText("chart-summary", "No data available");
            return;
        }
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        const width = mobile
                ? Math.max(260, svg.getBoundingClientRect().width)
                : 1100,
            height = mobile ? 300 : 380;
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const left = mobile ? 52 : 69,
            right = width - (mobile ? 46 : 72),
            top = 33,
            bottom = height - 50;
        let start = Date.parse(plays[0].received_at),
            end = Date.parse(plays.at(-1).received_at);
        const history = rankingHistory(data, rankingOptions());
        const lastObservation = history.observations.length
            ? Math.max(
                  ...history.observations.map((o) => Date.parse(o.timestamp)),
              )
            : end;
        end = Math.max(end, lastObservation);
        if (start === end) {
            start -= 30000;
            end += 30000;
        }
        const observations = visibleObservations(
            history.observations,
            start,
            end,
        );
        const values = plays.map((p) => p.play_vf);
        const thresholds = observations
            .filter((o) => o.minimum_vf !== null)
            .map((o) => o.minimum_vf);
        const min = Math.min(...values, ...thresholds),
            max = Math.max(...values, ...thresholds);
        const padding = Math.max((max - min) * 0.14, 0.015);
        const low = Math.max(0, min - padding),
            high = max + padding;
        const totalValues = observations.map((o) => o.total_vf);
        const totalMin = totalValues.length ? Math.min(...totalValues) : 0;
        const totalMax = totalValues.length ? Math.max(...totalValues) : 1;
        const totalPad = Math.max((totalMax - totalMin) * 0.14, 0.025);
        const totalLow = Math.max(0, totalMin - totalPad),
            totalHigh = totalMax + totalPad;
        const x = (time) =>
            left + ((time - start) / (end - start)) * (right - left);
        const y = (value) =>
            bottom - ((value - low) / (high - low)) * (bottom - top);
        const ty = (value) =>
            bottom -
            ((value - totalLow) / (totalHigh - totalLow)) * (bottom - top);
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
        );
        if (observations.length && shown.has("total"))
            svg.append(
                svgElement(
                    "text",
                    {
                        x: left,
                        y: 17,
                        class: "axis-caption",
                    },
                    "Total VF",
                ),
            );
        const gridCount = mobile ? 8 : 12;
        for (let i = 0; i <= gridCount; i++) {
            const py = top + (i / gridCount) * (bottom - top);
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: py,
                    y2: py,
                    class: "grid",
                }),
            );
            svg.append(
                svgElement(
                    "text",
                    {
                        x: right + (mobile ? 7 : 13),
                        y: py + 4,
                    },
                    vf(high - (i / gridCount) * (high - low)),
                ),
            );
            if (observations.length && shown.has("total"))
                svg.append(
                    svgElement(
                        "text",
                        {
                            x: left - (mobile ? 7 : 13),
                            y: py + 4,
                            "text-anchor": "end",
                        },
                        vf(
                            totalHigh -
                                (i / gridCount) * (totalHigh - totalLow),
                        ),
                    ),
                );
        }
        const singleDay = end - start < 86400000;
        const tickCount = mobile ? 3 : 5;
        for (let i = 0; i <= tickCount; i++) {
            const t = start + (i / tickCount) * (end - start);
            svg.append(
                svgElement(
                    "text",
                    { x: x(t), y: bottom + 27, "text-anchor": "middle" },
                    singleDay ? clock(t) : shortDate(t),
                ),
            );
        }
        const seriesLayer = svgElement("g", { class: "history-series" });
        svg.append(seriesLayer);
        function line(
            series,
            points,
            color,
            width,
            mapper = y,
            step = false,
            dash = "",
        ) {
            if (!shown.has(series) || !points.length) return;
            if (points.length === 1) {
                seriesLayer.append(
                    svgElement("circle", {
                        cx: x(points[0][0]),
                        cy: mapper(points[0][1]),
                        r: 3,
                        fill: color,
                    }),
                );
            } else
                seriesLayer.append(
                    svgElement("path", {
                        d: pathData(points, x, mapper, step),
                        fill: "none",
                        stroke: color,
                        "stroke-width": width,
                        "stroke-linejoin": "round",
                        "stroke-linecap": "round",
                        "stroke-dasharray": dash,
                    }),
                );
        }
        // Keep separate threshold segments when the Top 50 was not full
        let segment = [];
        for (const o of observations) {
            if (o.minimum_vf === null) {
                if (segment.length) segment.push([o.time, segment.at(-1)[1]]);
                line(
                    "threshold",
                    segment,
                    "var(--chart-top50)",
                    1.2,
                    y,
                    true,
                    "4 5",
                );
                segment = [];
            } else segment.push([o.time, o.minimum_vf]);
        }
        line("threshold", segment, "var(--chart-top50)", 1.2, y, true, "4 5");
        let best = 0;
        const bestPoints = plays
            .filter(
                (play) =>
                    rankingOptions().includeCustom ||
                    (play.is_custom !== true &&
                        songs.get(play.music_id)?.is_custom !== true),
            )
            .map((play) => {
                const value =
                    calculateChartVf(play.level, play.score, play.clear_type) ??
                    play.play_vf;
                best = Math.max(best, value);
                return [Date.parse(play.received_at), best];
            });
        if (bestPoints.length && bestPoints.at(-1)[0] < end)
            bestPoints.push([end, best]);
        const avg10Points = rolling(plays, 10),
            avg100Points = rolling(plays, 100);
        const totalPoints = observations.map((o) => [o.time, o.total_vf]);
        line("best", bestPoints, "var(--chart-best)", 1.5, y, true);
        if (shown.has("plays")) {
            const group = svgElement("g", {
                fill: "var(--chart-play-points)",
                opacity: 0.58,
            });
            plays.forEach((p) =>
                group.append(
                    svgElement("circle", {
                        cx: x(Date.parse(p.received_at)),
                        cy: y(p.play_vf),
                        r: 2.4,
                    }),
                ),
            );
            seriesLayer.append(group);
        }
        line("avg10", avg10Points, "var(--chart-avg10)", 1.8);
        line("avg100", avg100Points, "var(--chart-avg100)", 2.8);
        line("total", totalPoints, "var(--chart-total)", 1.6, ty, true);
        const crosshair = svgElement("line", {
            x1: 0,
            x2: 0,
            y1: top,
            y2: bottom,
            class: "crosshair",
            visibility: "hidden",
        });
        const markers = svgElement("g", {
            class: "hover-markers",
            "pointer-events": "none",
        });
        const series = [
            {
                key: "total",
                label: "Total VF",
                points: totalPoints,
                color: "var(--chart-total)",
                step: true,
                y: ty,
            },
            {
                key: "avg100",
                label: "Avg 100",
                points: avg100Points,
                color: "var(--chart-avg100)",
                y,
            },
            {
                key: "avg10",
                label: "Avg 10",
                points: avg10Points,
                color: "var(--chart-avg10)",
                y,
            },
            {
                key: "best",
                label: "Best VF",
                points: bestPoints,
                color: "var(--chart-best)",
                step: true,
                y,
            },
            {
                key: "threshold",
                label: "Top 50",
                points: observations.map((o) => [o.time, o.minimum_vf]),
                color: "var(--chart-top50)",
                step: true,
                y,
            },
        ];
        svg.append(crosshair, markers);
        hover = {
            series,
            x,
            start,
            end,
            left,
            right,
            crosshair,
            markers,
            width,
        };
        $("chart-summary").innerHTML =
            `<span><strong>${number(plays.length)}</strong> plays</span><span>Best <strong>${vf(bestPoints.length ? best : null)}</strong></span><span>Average <strong>${vf(average(values))}</strong></span>`;
        motion.history(svg, animate);
        if (animate) motion.data($("chart-summary"));
    }

    function showChartPopup(event) {
        if (!hover) return;
        const bounds = $("chart").getBoundingClientRect();
        const px = ((event.clientX - bounds.left) / bounds.width) * hover.width;
        if (px < hover.left || px > hover.right) {
            hidePopup();
            return;
        }
        const time =
            hover.start +
            ((px - hover.left) / (hover.right - hover.left)) *
                (hover.end - hover.start);
        const x = hover.x(time);
        hover.crosshair.setAttribute("x1", x);
        hover.crosshair.setAttribute("x2", x);
        hover.crosshair.setAttribute("visibility", "visible");
        hover.markers.replaceChildren();
        const lines = hover.series
            .filter((series) => shown.has(series.key))
            .map((series) => {
                const value = lineValue(series.points, time, series.step);
                if (value !== null)
                    hover.markers.append(
                        svgElement("circle", {
                            cx: x,
                            cy: series.y(value),
                            r: 3.5,
                            fill: series.color,
                            stroke: "var(--panel)",
                            "stroke-width": 1.5,
                            "data-line": series.key,
                        }),
                    );
                return `<div class="popup-line"><span><i class="dot ${series.key}"></i>${series.label}</span><b>${vf(value)}</b></div>`;
            });
        if (!lines.length) {
            hidePopup();
            return;
        }
        const popup = $("popup");
        popup.innerHTML = `<strong>${date(time)} · ${clock(time)}</strong>${lines.join("")}`;
        positionChartPopup(popup, $("chart-wrap"), event);
    }
    function hidePopup() {
        $("popup").hidden = true;
        if (hover) {
            hover.crosshair.setAttribute("visibility", "hidden");
            hover.markers.replaceChildren();
        }
    }
    bindChartHover($("chart"), $("chart-wrap"), {
        show: showChartPopup,
        hide: hidePopup,
    });

    return {
        render,
        clearHover() {
            hidePopup();
            hover = null;
        },
    };
}
