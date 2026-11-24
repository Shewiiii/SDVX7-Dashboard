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

function moveHistoryLayer(layer, camera, bounds) {
    const { range } = layer;
    const span = camera.end - camera.start;
    const scaleX = (range.end - range.start) / span;
    const offsetX =
        bounds.left * (1 - scaleX) +
        ((range.start - camera.start) / span) * (bounds.right - bounds.left);
    for (const [group, low, high] of [
        [layer.chart, "low", "high"],
        [layer.total, "totalLow", "totalHigh"],
    ]) {
        const height = camera[high] - camera[low];
        const scaleY = (range[high] - range[low]) / height;
        const offsetY =
            bounds.bottom * (1 - scaleY) -
            ((range[low] - camera[low]) / height) *
                (bounds.bottom - bounds.top);
        group.setAttribute(
            "transform",
            `matrix(${scaleX} 0 0 ${scaleY} ${offsetX} ${offsetY})`,
        );
    }
}

function interpolateValueAxis(source, target, low, high, progress) {
    // Blend the value-to-pixel mapping so narrow ranges do not move late
    const sourceWeight = (1 - progress) / (source[high] - source[low]);
    const targetWeight = progress / (target[high] - target[low]);
    const scale = sourceWeight + targetWeight;
    const minimum =
        (source[low] * sourceWeight + target[low] * targetWeight) / scale;
    return { [low]: minimum, [high]: minimum + 1 / scale };
}

function zoomHistory(svg, viewport, previous, next) {
    const outgoing = previous.layers.reduce((visible, layer) =>
        layer.opacity >= visible.opacity ? layer : visible,
    );
    const incoming = next.layers[0];
    const source = previous.camera;
    const target = incoming.range;
    const sourceSpan = source.end - source.start;
    const targetSpan = target.end - target.start;
    const outgoingOpacity = outgoing.opacity;
    viewport.prepend(outgoing.element);
    viewport.classList.add("history-zooming");
    next.layers.unshift(outgoing);

    motion.tweenChart(svg, (progress) => {
        if (progress === 1) {
            outgoing.element.remove();
            viewport.classList.remove("history-zooming");
            incoming.element.removeAttribute("opacity");
            incoming.chart.removeAttribute("transform");
            incoming.total.removeAttribute("transform");
            incoming.opacity = 1;
            next.layers = [incoming];
            next.camera = target;
            next.moving = false;
            next.labelCamera(target);
            return;
        }
        const end = source.end + (target.end - source.end) * progress;
        const span = sourceSpan * (targetSpan / sourceSpan) ** progress;
        const camera = {
            start: end - span,
            end,
            ...interpolateValueAxis(source, target, "low", "high", progress),
            ...interpolateValueAxis(
                source,
                target,
                "totalLow",
                "totalHigh",
                progress,
            ),
        };
        next.camera = camera;
        next.moving = true;
        next.labelCamera(camera);
        outgoing.opacity = outgoingOpacity * (1 - progress);
        incoming.opacity = progress;
        for (const layer of next.layers) {
            moveHistoryLayer(layer, camera, next.bounds);
            layer.element.setAttribute("opacity", layer.opacity);
        }
    });
}

export function createPerformanceHistory({
    getData,
    getSongs,
    rankingOptions,
    shown,
}) {
    let hover = null;
    let plot = null;

    function render({
        days,
        difficulty,
        now = Date.now(),
        animate = true,
        transition = false,
    } = {}) {
        const data = getData();
        if (!data) return;
        const songs = getSongs();
        const plays = performance(data.plays, { days, difficulty, now });
        const svg = $("chart");
        const reveal = animate || motion.isPending(svg);
        const previous = plot;
        svg.replaceChildren();
        svg.removeAttribute("aria-hidden");
        hover = null;
        $("popup").hidden = true;
        $("chart-empty").hidden = !!plays.length;
        if (!plays.length) {
            plot = null;
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
        const range = { start, end, low, high, totalLow, totalHigh };
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
        const ticks = [];
        function addTick(attributes, caption) {
            const node = svgElement("text", attributes);
            ticks.push({ node, caption });
            svg.append(node);
        }
        function labelCamera(camera) {
            for (const { node, caption } of ticks) {
                const text = caption(camera);
                if (node.textContent !== text) node.textContent = text;
            }
        }
        const gridCount = mobile ? 8 : 12;
        for (let i = 0; i <= gridCount; i++) {
            const ratio = i / gridCount;
            const py = top + ratio * (bottom - top);
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: py,
                    y2: py,
                    class: "grid",
                }),
            );
            addTick({ x: right + (mobile ? 7 : 13), y: py + 4 }, (camera) =>
                vf(camera.high - ratio * (camera.high - camera.low)),
            );
            if (observations.length && shown.has("total"))
                addTick(
                    {
                        x: left - (mobile ? 7 : 13),
                        y: py + 4,
                        "text-anchor": "end",
                    },
                    (camera) =>
                        vf(
                            camera.totalHigh -
                                ratio * (camera.totalHigh - camera.totalLow),
                        ),
                );
        }
        const tickCount = mobile ? 3 : 5;
        for (let i = 0; i <= tickCount; i++) {
            const ratio = i / tickCount;
            addTick(
                {
                    x: left + ratio * (right - left),
                    y: bottom + 27,
                    "text-anchor": "middle",
                },
                (camera) => {
                    const span = camera.end - camera.start;
                    const time = camera.start + ratio * span;
                    return span < 86400000 ? clock(time) : shortDate(time);
                },
            );
        }
        labelCamera(range);
        const clip = svgElement("clipPath", { id: "history-plot-clip" });
        clip.append(
            svgElement("rect", {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            }),
        );
        const viewport = svgElement("g", {
            "clip-path": "url(#history-plot-clip)",
        });
        const seriesLayer = svgElement("g", { class: "history-series" });
        const chartLayer = svgElement("g");
        const totalLayer = svgElement("g");
        seriesLayer.append(chartLayer, totalLayer);
        viewport.append(seriesLayer);
        svg.append(clip, viewport);
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
            const layer = series === "total" ? totalLayer : chartLayer;
            if (points.length === 1) {
                layer.append(
                    svgElement("circle", {
                        cx: x(points[0][0]),
                        cy: mapper(points[0][1]),
                        r: 3,
                        fill: color,
                    }),
                );
            } else
                layer.append(
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
                    calculateChartVf(
                        play.level,
                        play.score,
                        play.clear_type,
                    ) ?? play.play_vf;
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
            chartLayer.append(group);
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
        plot = {
            width,
            camera: range,
            labelCamera,
            bounds: { left, right, top, bottom },
            layers: [
                {
                    element: seriesLayer,
                    chart: chartLayer,
                    total: totalLayer,
                    range,
                    opacity: 1,
                },
            ],
        };
        if (
            !reveal &&
            transition &&
            previous?.width === width &&
            Object.keys(range).some(
                (key) => previous.camera[key] !== range[key],
            )
        )
            zoomHistory(svg, viewport, previous, plot);
        else motion.history(svg, reveal);
        if (animate) motion.data($("chart-summary"));
    }

    function showChartPopup(event) {
        if (!hover || plot?.moving) return;
        const bounds = $("chart").getBoundingClientRect();
        const px =
            ((event.clientX - bounds.left) / bounds.width) * hover.width;
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
        popup.innerHTML = `<strong>${date(time)} ${clock(time)}</strong>${lines.join("")}`;
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

    return { render };
}
