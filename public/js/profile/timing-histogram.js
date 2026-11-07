import { $, setText } from "../core/dom.js";
import { number } from "../core/format.js";
import { svgElement } from "../core/svg.js";
import { motion } from "../core/motion.js";
import { timingHistogram, timingText, TIMING_OFFSETS } from "./metrics.js";

function smoothTimingPath(points) {
    // Keep the decorative curve within neighboring bucket values, without overshoot
    const slopes = points.map(([px, py], index) => {
        if (index === 0 || index === points.length - 1) return 0;
        const [previousX, previousY] = points[index - 1];
        const [nextX, nextY] = points[index + 1];
        const before = (py - previousY) / (px - previousX);
        const after = (nextY - py) / (nextX - px);
        return before * after <= 0
            ? 0
            : (2 * before * after) / (before + after);
    });
    let path = `M${points[0][0]},${points[0][1]}`;
    for (let index = 0; index < points.length - 1; index++) {
        const [x1, y1] = points[index],
            [x2, y2] = points[index + 1];
        const third = (x2 - x1) / 3;
        const clampY = (value) =>
            Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), value));
        path += ` C${x1 + third},${clampY(y1 + slopes[index] * third)} ${x2 - third},${clampY(y2 - slopes[index + 1] * third)} ${x2},${y2}`;
    }
    return path;
}

export function renderTimingHistogram(
    plays,
    { days, difficulty, animate = true } = {},
) {
    const stats = timingHistogram(plays, { days, difficulty });
    const svg = $("timing-chart");
    svg.replaceChildren();
    svg.removeAttribute("aria-hidden");
    svg.toggleAttribute("hidden", !stats.hits);
    $("timing-empty").hidden = !!stats.hits;
    if (!stats.hits) {
        setText("timing-summary", "No data available");
        return;
    }
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    const width = mobile
            ? Math.max(260, svg.getBoundingClientRect().width)
            : 1100,
        height = mobile ? 250 : 260;
    const left = mobile ? 48 : 69,
        right = width - (mobile ? 22 : 72);
    const top = 38,
        bottom = height - 55;
    const slot = (right - left) / 7;
    const x = (index) => left + (index + 0.5) * slot;
    const xOffset = (offset) => {
        for (let index = 0; index < TIMING_OFFSETS.length - 1; index++) {
            const early = TIMING_OFFSETS[index],
                late = TIMING_OFFSETS[index + 1];
            if (offset <= early && offset >= late)
                return x(index + (early - offset) / (early - late));
        }
        return x(3);
    };
    const peak = Math.max(...stats.bins);
    const power = 10 ** Math.floor(Math.log10(Math.max(peak / 4, 1)));
    const step = Math.ceil(peak / (4 * power)) * power;
    const maximum = step * 4;
    const y = (count) => bottom - (count / maximum) * (bottom - top);
    const compact = new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
    });
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const defs = svgElement("defs");
    const gradient = svgElement("linearGradient", {
        id: "timing-curve-gradient",
        class: "timing-curve-gradient",
        gradientUnits: "userSpaceOnUse",
        x1: 0,
        x2: 0,
        y1: top,
        y2: bottom,
    });
    for (const [offset, opacity] of [
        ["0%", 0.24],
        ["65%", 0.1],
        ["100%", 0],
    ])
        gradient.append(
            svgElement("stop", { offset, "stop-opacity": opacity }),
        );
    const mask = svgElement("mask", {
        id: "timing-curve-mask",
        maskUnits: "userSpaceOnUse",
        x: 0,
        y: 0,
        width,
        height,
    });
    mask.append(
        svgElement("rect", { x: 0, y: 0, width, height, fill: "white" }),
    );
    stats.bins.forEach((count, index) =>
        mask.append(
            svgElement("rect", {
                x: x(index) - slot * 0.34,
                y: y(count),
                width: slot * 0.68,
                height: bottom - y(count),
                rx: 3,
                fill: "black",
            }),
        ),
    );
    defs.append(gradient, mask);
    const curve = smoothTimingPath([
        [left, bottom],
        ...stats.bins.map((count, index) => [x(index), y(count)]),
        [right, bottom],
    ]);
    const backdrop = svgElement("g", {
        class: "timing-curve",
        "aria-hidden": "true",
        mask: "url(#timing-curve-mask)",
    });
    backdrop.append(
        svgElement("path", {
            d: curve + " Z",
            fill: "url(#timing-curve-gradient)",
        }),
        svgElement("path", { d: curve, class: "timing-curve-line" }),
    );
    svg.append(defs, backdrop);
    for (let tick = 0; tick <= 4; tick++) {
        const count = tick * step;
        svg.append(
            svgElement("line", {
                x1: left,
                x2: right,
                y1: y(count),
                y2: y(count),
                class: "grid",
            }),
        );
        svg.append(
            svgElement(
                "text",
                { x: left - 10, y: y(count) + 3, "text-anchor": "end" },
                compact.format(count),
            ),
        );
    }
    for (const [offset, judgement] of [
        [41.6, "CRITICAL"],
        [20.8, "S-CRITICAL"],
        [-20.8, "S-CRITICAL"],
        [-41.6, "CRITICAL"],
    ]) {
        const position = xOffset(offset);
        const caption = `${offset > 0 ? "+" : "−"}${Math.abs(offset)} ms`;
        svg.append(
            svgElement("line", {
                x1: position,
                x2: position,
                y1: top,
                y2: bottom,
                class: "timing-guide",
                "data-offset": offset,
            }),
        );
        svg.append(
            svgElement(
                "text",
                {
                    x: position,
                    y: 17,
                    "text-anchor": "middle",
                    class: "axis-caption timing-guide-value",
                },
                caption,
            ),
        );
        svg.append(
            svgElement(
                "text",
                {
                    x: position,
                    y: 30,
                    "text-anchor": "middle",
                    class: "timing-guide-label",
                },
                judgement,
            ),
        );
    }
    for (const [position, label, anchor] of [
        [left, "Early", "start"],
        [right, "Late", "end"],
    ])
        svg.append(
            svgElement(
                "text",
                {
                    x: position,
                    y: 17,
                    "text-anchor": anchor,
                    class: "axis-caption",
                },
                label,
            ),
        );
    stats.bins.forEach((count, index) => {
        const offset = TIMING_OFFSETS[index];
        const caption = offset > 0 ? `+${offset}` : String(offset);
        const bar = svgElement("rect", {
            x: x(index) - slot * 0.34,
            y: y(count),
            width: slot * 0.68,
            height: bottom - y(count),
            rx: 3,
            class: `timing-bar ${index < 3 ? "early" : index > 3 ? "late" : "center"}`,
            tabindex: count ? 0 : -1,
            role: "img",
            "aria-label": `${index < 3 ? "Early" : index > 3 ? "Late" : "Center"}, approximately ${caption} ms: ${number(count)} hits`,
        });
        bar.append(
            svgElement(
                "title",
                {},
                `${caption} ms (approx.) · ${number(count)} hits · ${((count / stats.hits) * 100).toFixed(1)}%`,
            ),
        );
        svg.append(bar);
        svg.append(
            svgElement(
                "text",
                {
                    x: x(index),
                    y: y(count) - 6,
                    "text-anchor": "middle",
                    class: "timing-count",
                },
                compact.format(count),
            ),
        );
        svg.append(
            svgElement(
                "text",
                {
                    x: x(index),
                    y: bottom + 20,
                    "text-anchor": "middle",
                    class: "timing-offset",
                },
                caption,
            ),
        );
    });
    svg.append(
        svgElement(
            "text",
            { x: (left + right) / 2, y: height - 9, "text-anchor": "middle" },
            "Approximate offset (ms)",
        ),
    );
    $("timing-summary").innerHTML =
        `<span><strong>${number(stats.plays)}</strong> plays</span><span><strong>${number(stats.hits)}</strong> notes</span><span>Average <strong>${timingText(stats.average)}</strong></span>`;
    motion.histogram(svg, animate);
    if (animate) motion.data($("timing-summary"));
}
