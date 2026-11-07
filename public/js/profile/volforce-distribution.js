import { svgElement, pathData } from "../core/svg.js";
import { motion } from "../core/motion.js";
import { bindChartHover, positionChartPopup } from "../core/chart-hover.js";
import { volforceDensity, volforceTopPercent } from "./volforce-ranking.js";

export function createVolforceDistribution(root) {
    const svg = root.querySelector("svg");
    const subtitle = root.querySelector("[data-distribution-subtitle]");
    const summary = root.querySelector("#vf-distribution-summary");
    const empty = root.querySelector("[data-distribution-empty]");
    const popup = root.querySelector(".chart-popup");
    const wrap = popup.parentElement;
    let ranking = [];
    let points = [];
    let total = null;
    let rawTotal = null;
    let signature;
    let drawn = false;
    let failed = false;
    let hover = null;

    function densityAt(value) {
        const index = Math.floor(value * 8);
        const previous = points[index];
        const following = points[index + 1] || previous;
        return previous
            ? previous[1] + (following[1] - previous[1]) * (value * 8 - index)
            : 0;
    }

    function hidePopup() {
        popup.hidden = true;
        if (!hover) return;
        hover.crosshair.setAttribute("visibility", "hidden");
        hover.point.setAttribute("visibility", "hidden");
    }

    function showPopup(event) {
        if (!hover) return;
        const bounds = svg.getBoundingClientRect();
        const position =
            ((event.clientX - bounds.left) / bounds.width) * hover.width;
        if (position < hover.left || position > hover.right) {
            hidePopup();
            return;
        }

        const value =
            ((position - hover.left) / (hover.right - hover.left)) *
            hover.maximum;
        const top = volforceTopPercent(value, ranking);
        const topLabel = top === 0 ? "0%" : `${top.toFixed(2)}%`;
        const lower = Math.max(0, value - 0.25);
        const upper = value + 0.25;
        const share =
            volforceTopPercent(lower, ranking) -
            volforceTopPercent(upper, ranking);
        const count = Math.round((share / 100) * ranking.length);
        hover.crosshair.setAttribute("x1", position);
        hover.crosshair.setAttribute("x2", position);
        hover.crosshair.setAttribute("visibility", "visible");
        hover.point.setAttribute("cx", position);
        hover.point.setAttribute("cy", hover.y(densityAt(value)));
        hover.point.setAttribute("visibility", "visible");
        popup.innerHTML = `<strong>${value.toFixed(3)} VF</strong><div class="popup-line"><span>Top</span><b>${topLabel}</b></div><div class="popup-line"><span>Profiles ±0.25 VF</span><b>${count.toLocaleString()}</b></div>`;
        positionChartPopup(popup, wrap, event);
    }

    bindChartHover(svg, wrap, { show: showPopup, hide: hidePopup });

    function draw() {
        if (!ranking.length) {
            svg.setAttribute("hidden", "");
            empty.hidden = false;
            empty.textContent = failed
                ? "Ranking datasheet not available"
                : "Loading VF distribution...";
            return;
        }

        const availableWidth = svg.parentElement.clientWidth;
        if (!availableWidth || root.closest("[hidden]")) return;

        const mobile = window.matchMedia("(max-width: 900px)").matches;
        const width = mobile ? Math.max(260, availableWidth - 18) : 1100;
        const height = mobile ? 270 : 300;
        const next = `${width}:${total}:${rawTotal}:${ranking.length}`;
        if (signature === next) return;
        signature = next;
        hidePopup();
        hover = null;

        const animate = !drawn || motion.isPending(svg);
        if (!motion.isPending(svg)) motion.stop(svg);
        drawn = true;
        svg.removeAttribute("hidden");
        empty.hidden = true;
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.replaceChildren();

        const left = mobile ? 39 : 69;
        const right = width - (mobile ? 18 : 72);
        const top = 54;
        const bottom = height - 46;
        const maximum = points.at(-1)[0];
        const peak = Math.max(...points.map((point) => point[1]));
        const step = Math.max(1, Math.ceil(peak / 4));
        const x = (value) => left + (value / maximum) * (right - left);
        const y = (percent) => bottom - (percent / (step * 4)) * (bottom - top);
        const text = (value, attributes) =>
            svgElement("text", attributes, value);
        const percent = volforceTopPercent(total, ranking);
        const formatPercent = (value) =>
            value === null
                ? "—"
                : value < 0.01
                  ? "<0.01%"
                  : `${value.toFixed(2)}%`;
        const topValue = formatPercent(percent);
        const topLabel = percent === null ? "" : `Top ${topValue}`;
        const rawTopValue = formatPercent(
            volforceTopPercent(rawTotal, ranking),
        );

        subtitle.textContent = `Based on ${ranking.length.toLocaleString()} EXCEED GEAR arcade profiles`;
        let description = Number.isFinite(total)
            ? `${total.toFixed(3)} Exceed Gear VF, ${topLabel}`
            : "No data available";
        if (Number.isFinite(rawTotal))
            description += `, ${rawTotal.toFixed(3)} ∇ VF, Raw Top ${rawTopValue}`;
        summary?.replaceChildren(
            ...[
                [
                    "Exceed Gear VF",
                    Number.isFinite(total) ? total.toFixed(3) : "—",
                ],
                [
                    "∇ VF",
                    Number.isFinite(rawTotal) ? rawTotal.toFixed(3) : "—",
                ],
                ["Top", topValue],
                ["Raw Top", rawTopValue],
            ].map(([label, value]) => {
                const entry = document.createElement("span");
                const number = document.createElement("strong");
                number.textContent = value;
                if (label === "Exceed Gear VF") {
                    const trigger = document.createElement("button");
                    trigger.type = "button";
                    trigger.className = "chart-vf-trigger";
                    trigger.textContent = label;
                    trigger.dataset.chartVfDescription =
                        "Chart levels with a decimal part in top 50 are truncated, so their chart VF are closer to EXCEED GEAR's. This is not perfect however, as some chart levels have been adjusted, like SuddeИDeath.";
                    trigger.setAttribute("aria-describedby", "chart-vf-popup");
                    entry.append(number, " ", trigger);
                } else if (label === "∇ VF") {
                    entry.append(number, ` ${label}`);
                } else entry.append(`${label} `, number);
                return entry;
            }),
        );
        svg.setAttribute(
            "aria-label",
            `VolForce distribution of ${ranking.length.toLocaleString()} SDVX6 arcade profiles, April 2025. ${description}`,
        );
        svg.append(
            text("Profiles (% / VF)", {
                x: left,
                y: 17,
                class: "axis-caption",
            }),
        );

        for (let tick = 0; tick <= 4; tick++) {
            const value = tick * step;
            svg.append(
                svgElement("line", {
                    x1: left,
                    x2: right,
                    y1: y(value),
                    y2: y(value),
                    class: "grid",
                }),
                text(`${value}%`, {
                    x: left - 10,
                    y: y(value) + 3,
                    "text-anchor": "end",
                }),
            );
        }

        for (let tick = 0; tick <= maximum; tick++) {
            svg.append(
                text(String(tick), {
                    x: x(tick),
                    y: bottom + 21,
                    "text-anchor": "middle",
                }),
            );
        }
        svg.append(
            text("VolForce", {
                x: (left + right) / 2,
                y: height - 5,
                "text-anchor": "middle",
                class: "axis-caption",
            }),
        );

        const gradientId = "vf-distribution-gradient";
        const defs = svgElement("defs");
        const gradient = svgElement("linearGradient", {
            id: gradientId,
            x1: 0,
            x2: 0,
            y1: top,
            y2: bottom,
            gradientUnits: "userSpaceOnUse",
        });
        for (const [offset, opacity] of [
            ["0%", 0.2],
            ["65%", 0.08],
            ["100%", 0],
        ]) {
            gradient.append(
                svgElement("stop", { offset, "stop-opacity": opacity }),
            );
        }
        defs.append(gradient);
        svg.append(defs);

        const line = pathData(points, x, y);
        const curve = svgElement("g", { class: "calculator-curve" });
        curve.append(
            svgElement("path", {
                d: `${line} L${x(points.at(-1)[0])},${bottom} L${left},${bottom} Z`,
                fill: `url(#${gradientId})`,
            }),
            svgElement("path", { d: line, class: "calculator-line" }),
        );
        svg.append(curve);

        const markers = svgElement("g", { class: "calculator-markers" });
        for (const [value, raw] of [
            [rawTotal, true],
            [total, false],
        ]) {
            if (!Number.isFinite(value) || value < 0 || value > maximum)
                continue;

            const position = x(value);
            const density = densityAt(value);
            const marker = svgElement("g", {
                class: raw
                    ? "vf-distribution-raw-marker"
                    : "vf-distribution-marker",
                "data-vf": value.toFixed(3),
                "aria-label": raw
                    ? `${value.toFixed(3)} ∇ VF`
                    : `${value.toFixed(3)} Exceed Gear VF, ${topLabel}`,
            });
            const anchor =
                position > right - 90
                    ? "end"
                    : position < left + 90
                      ? "start"
                      : "middle";
            const caption = raw
                ? `${value.toFixed(3)} ∇ VF`
                : `${value.toFixed(3)} EG VF`;
            marker.append(
                svgElement("line", {
                    x1: position,
                    x2: position,
                    y1: top - (raw ? 26 : 10),
                    y2: bottom,
                }),
                svgElement("circle", {
                    cx: position,
                    cy: y(density),
                    r: 4,
                    class: "calculator-point",
                }),
                text(caption, {
                    x: position,
                    y: top - (raw ? 35 : 19),
                    "text-anchor": anchor,
                }),
            );
            markers.append(marker);
        }
        svg.append(markers);
        const crosshair = svgElement("line", {
            class: "crosshair",
            y1: top,
            y2: bottom,
            visibility: "hidden",
        });
        const point = svgElement("circle", {
            class: "hover-point",
            r: 3.5,
            visibility: "hidden",
        });
        svg.append(crosshair, point);
        hover = { width, left, right, maximum, y, crosshair, point };
        motion.calculator(svg, animate);
        if (summary && animate) motion.data(summary);
    }

    new ResizeObserver(draw).observe(svg.parentElement);

    return {
        render(source, value, rawValue = null) {
            if (source !== ranking) {
                ranking = source;
                points = volforceDensity(ranking);
                signature = null;
            }
            total = value;
            rawTotal = rawValue;
            draw();
        },
        unavailable() {
            failed = true;
            draw();
        },
    };
}
