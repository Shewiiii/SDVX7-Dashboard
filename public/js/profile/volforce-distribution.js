import { svgElement, pathData } from "../core/svg.js";
import { motion } from "../core/motion.js";
import { bindChartHover, positionChartPopup } from "../core/chart-hover.js";
import {
    volforceSamples,
    volforceDensity,
    volforceTopPercent,
} from "./volforce-ranking.js";
import { VF_CLASSES, volforceClass } from "./metrics.js";

const tierThresholds = VF_CLASSES.flatMap(({ minimum, step }) =>
    Array.from({ length: 4 }, (_, rank) => minimum + rank * step),
);

export function createVolforceDistribution(root) {
    const svg = root.querySelector("svg");
    const subtitle = root.querySelector("[data-distribution-subtitle]");
    const summary = root.querySelector("#vf-distribution-summary");
    const empty = root.querySelector("[data-distribution-empty]");
    const popup = root.querySelector(".chart-popup");
    const wrap = popup.parentElement;
    let ranking = [];
    let samples = [];
    let points = [];
    let total = null;
    let rawTotal = null;
    let signature;
    let drawn = false;
    let failed = false;
    let hover = null;

    function percentageAt(value) {
        const position =
            (value / (points.at(-1)?.[0] || 1)) * (points.length - 1);
        const index = Math.floor(position);
        const previous = points[index];
        const following = points[index + 1] || previous;
        return previous
            ? previous[1] + (following[1] - previous[1]) * (position - index)
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
        const sample =
            samples[
                Math.min(
                    samples.length - 1,
                    Math.floor(Math.round(value * 1000) / 100),
                )
            ];
        const sampleRange = `${sample.lower.toFixed(1)}-${sample.upper.toFixed(1)} VF`;
        const tier = volforceClass(value);
        const currentClass = VF_CLASSES[tier.number - 1];
        const classUpper = VF_CLASSES[tier.number]?.minimum;
        const classShare =
            volforceTopPercent(currentClass.minimum, ranking) -
            (classUpper === undefined
                ? 0
                : volforceTopPercent(classUpper, ranking));
        const tierIndex = tierThresholds.findLastIndex(
            (threshold) => threshold <= Math.round(value * 1000) / 1000,
        );
        const lower = tierThresholds[tierIndex];
        const upper = tierThresholds[tierIndex + 1];
        const share =
            volforceTopPercent(lower, ranking) -
            (upper === undefined ? 0 : volforceTopPercent(upper, ranking));
        const range =
            upper === undefined
                ? `${lower.toFixed(3)}+ VF`
                : `${lower.toFixed(3)}-${(upper - 0.001).toFixed(3)} VF`;
        hover.crosshair.setAttribute("x1", position);
        hover.crosshair.setAttribute("x2", position);
        hover.crosshair.setAttribute("visibility", "visible");
        hover.point.setAttribute("cx", position);
        hover.point.setAttribute("cy", hover.y(percentageAt(value)));
        hover.point.setAttribute("visibility", "visible");
        popup.innerHTML = `<strong>${value.toFixed(3)} VF</strong><div class="popup-line"><span>Top</span><b>${topLabel}</b></div><div class="popup-line"><span>Players (${sampleRange})</span><b>${sample.percent.toFixed(2)}%</b></div><div class="popup-line"><span><img class="vf-distribution-class-icon" src="/assets/vf-classes/${tier.number}.png" width="22" height="22" alt="">${currentClass.name}</span><b>${classShare.toFixed(2)}%</b></div><div class="popup-line"><span>${tier.name}</span><b>${share.toFixed(2)}%</b></div><div class="popup-line"><span>VF Level range</span><b>${range}</b></div>`;
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
        const height = mobile ? 296 : 316;
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
        const top = 66;
        const bottom = height - (mobile ? 50 : 46);
        const maximum = points.at(-1)[0];
        const peak = Math.max(...points.map((point) => point[1]));
        const step = Math.max(0.1, Math.ceil((peak / 4) * 10) / 10);
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
                ["∇ VF", Number.isFinite(rawTotal) ? rawTotal.toFixed(3) : "—"],
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
                        "SDVX ∇ has introduced a decimal part in levels above 17, and buffed the level of around 35 charts. Exceed Gear VF is thus the total VF before these adjustments.";
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
            text("Players per 0.1 VF", {
                x: left,
                y: 17,
                class: "axis-caption",
            }),
        );

        for (let tick = 0; tick <= 4; tick++) {
            const value = Number((tick * step).toFixed(2));
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
                svgElement("line", {
                    x1: x(tick),
                    x2: x(tick),
                    y1: top,
                    y2: bottom,
                    class: "grid",
                    "stroke-opacity": 0.5,
                    "aria-hidden": "true",
                }),
            );
            if (mobile && tick % 2) continue;
            svg.append(
                text(String(tick), {
                    x: x(tick),
                    y: bottom + 21,
                    "text-anchor": "middle",
                    class: "vf-distribution-tick",
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

        const guides = svgElement("g", {
            class: "calculator-guides vf-distribution-class-guides",
        });
        const iconSize = Math.min(18, (right - left) / maximum + 2);
        svg.append(guides);
        VF_CLASSES.forEach(({ name, minimum }, index) => {
            const position = x(minimum);
            const guide = svgElement("g", {
                class: "vf-distribution-class-guide",
                "data-vf-class": index + 1,
                "data-vf": minimum,
                style: `--vf-class-color: var(--vf-class-${name.toLowerCase()})`,
            });
            guide.append(
                svgElement("title", {}, `${name}, ${minimum.toFixed(3)} VF`),
                svgElement("line", {
                    x1: position,
                    x2: position,
                    y1: top,
                    y2: bottom,
                    class: "vf-distribution-class-line",
                }),
                svgElement("image", {
                    href: `/assets/vf-classes/${index + 1}.png`,
                    x: position - iconSize / 2,
                    y: top - iconSize - 5,
                    width: iconSize,
                    height: iconSize,
                    preserveAspectRatio: "xMidYMid meet",
                    "aria-hidden": "true",
                }),
            );
            guides.append(guide);
        });

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
            const percent = percentageAt(value);
            const marker = svgElement("g", {
                class: raw
                    ? "vf-distribution-raw-marker"
                    : "vf-distribution-marker",
                "data-vf": value.toFixed(3),
                "aria-label": raw
                    ? `${value.toFixed(3)} ∇ VF`
                    : `${value.toFixed(3)} Exceed Gear VF, ${topLabel}`,
            });
            const caption = `${value.toFixed(3)} ${raw ? "∇" : "EG"} VF`;
            const captionY = raw ? 19 : 35;
            marker.append(
                svgElement("line", {
                    x1: position,
                    x2: position,
                    y1: top,
                    y2: bottom,
                }),
                svgElement("circle", {
                    cx: position,
                    cy: y(percent),
                    r: 4,
                    class: "calculator-point",
                }),
                text(caption, {
                    x: position,
                    y: captionY,
                    "text-anchor": "middle",
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
        motion.calculator(svg, animate, { guidesAfterCurve: true });
        if (summary && animate) motion.data(summary);
    }

    new ResizeObserver(draw).observe(svg.parentElement);

    return {
        render(source, value, rawValue = null) {
            if (source !== ranking) {
                ranking = source;
                samples = volforceSamples(ranking);
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
