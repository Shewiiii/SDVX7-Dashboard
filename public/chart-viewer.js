import { validTimeline } from "./chart-timeline.js";
import { showPanel } from "./panels.js";
export { validTimeline } from "./chart-timeline.js";
import { mountSilentChartPlayer } from "./chart-transport.js";
import { getAudioMetadata, mountAudioPlayer } from "./audio-player.js";
import { createChartPlayback } from "./chart-playback.js";
import { createChartAudio } from "./chart-audio.js";
import { DIFFS } from "./metrics.js";
import {
    closePanelLink,
    createPanelShareButton,
    openPanelLink,
} from "./panel-links.js";

// Single-note thickness in CSS pixels. Adjust BT and FX independently here.
export const SINGLE_NOTE_HEIGHT = { bt: 10, fx: 10 };
const HIT_FADE_SECONDS = 0.24;
const HIT_ATTACK_SECONDS = 0.01;
const timelineRequests = new Map();
async function chartAvailable(chart) {
    const key = `${chart.music_id}:${chart.diff_idx}`;
    const cached = timelineRequests.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.task;
    const entry = { at: Date.now(), ttl: 10000 };
    entry.task = fetch(
        `/api/chart-view?music=${chart.music_id}&diff=${chart.diff_idx}&check=1`,
        { cache: "no-store" },
    )
        .then(async (response) => {
            if (!response.ok) return false;
            const result = await response.json();
            const available = result.available === true;
            if (available) entry.ttl = 300000;
            return available;
        })
        .catch(() => false);
    timelineRequests.set(key, entry);
    if (timelineRequests.size > 64)
        timelineRequests.delete(timelineRequests.keys().next().value);
    return entry.task;
}

const timingCache = new WeakMap();
const SPEED_KEY = "sdvx-chart-mod-speed";
const SCALE_KEY = "sdvx-chart-scale";
const BASE_VISUAL_SCALE = 0.8;
const FPS_KEY = "sdvx-chart-fps";
const OFFSET_KEY = "sdvx-chart-offset";
const EXTENDED_LASERS_KEY = "sdvx-chart-extended-lasers";

// Skip whole groups of off-screen objects while preserving their paint order.
function timeBlocks(items, start, end) {
    const blocks = [];
    for (let i = 0; i < items.length; i += 32) {
        const group = items.slice(i, i + 32);
        blocks.push({
            items: group,
            start: Math.min(...group.map(start)),
            end: Math.max(...group.map(end)),
        });
    }
    return blocks;
}

function* visibleBlocks(blocks, start, end) {
    for (const block of blocks) {
        if (block.end < start || block.start > end) continue;
        yield* block.items;
    }
}

export function createFrameLimiter(getLimit) {
    let last = -Infinity;
    return (now, force = false) => {
        const limit = getLimit();
        const interval = limit ? 1000 / limit : 0;
        if (!force && now - last < interval - 0.5) return false;
        last =
            !force && interval && Number.isFinite(last)
                ? last +
                  Math.max(1, Math.floor((now - last + 0.5) / interval)) *
                      interval
                : now;
        return true;
    };
}

// USC MMod: choose the BPM with the longest cumulative duration, then keep
// HiSpeed = ModSpeed / that BPM fixed. Its visible track spans 8 / HiSpeed beats.
export function chartTiming(chart) {
    if (timingCache.has(chart)) return timingCache.get(chart);
    let beat = 0;
    const tempos = chart.tempos.map(([at, bpm], i, entries) => {
        if (i) beat += ((at - entries[i - 1][0]) * entries[i - 1][1]) / 60;
        return { at, bpm, beat };
    });
    const timingAt = (at) => {
        let low = 0,
            high = tempos.length;
        while (low + 1 < high) {
            const mid = (low + high) >>> 1;
            if (tempos[mid].at <= at) low = mid;
            else high = mid;
        }
        return tempos[low];
    };
    const beatAt = (at) => {
        const p = timingAt(at);
        return p.beat + ((at - p.at) * p.bpm) / 60;
    };
    const lastObject = Math.max(
        0,
        chart.buttons.reduce((end, n) => Math.max(end, n[1]), 0),
        chart.lasers.reduce(
            (end, l) => Math.max(end, l.points.at(-1)?.[0] || 0),
            0,
        ),
    );
    const durations = new Map();
    let longest = -1,
        referenceBpm = tempos[0].bpm;
    for (let i = 0; i < tempos.length; i++) {
        const { at, bpm } = tempos[i];
        const end = Math.min(tempos[i + 1]?.at ?? lastObject, lastObject);
        const duration = (durations.get(bpm) || 0) + Math.max(0, end - at);
        durations.set(bpm, duration);
        if (duration > longest) {
            longest = duration;
            referenceBpm = bpm;
        }
    }
    const timing = {
        beatAt,
        bpmAt: (at) => timingAt(at).bpm,
        referenceBpm,
        buttons: chart.buttons.map(([a, b, lane]) => [
            beatAt(a),
            beatAt(b),
            lane,
        ]),
        lasers: chart.lasers.map((l) => {
            const points = l.points.map(([at, x]) => [beatAt(at), x]);
            return {
                side: l.side,
                points,
                // USC's extended range doubles the span about its midpoint.
                // Cache both views without changing audio/filter coordinates.
                extendedPoints: l.ranges?.includes(2)
                    ? points.map(([at, x], i) => [
                          at,
                          l.ranges[i] === 2 ? x * 2 - 0.5 : x,
                      ])
                    : points,
            };
        }),
        measures: chart.measures.map(([at, n]) => [beatAt(at), n]),
    };
    timing.chips = timing.buttons.filter(([a, b]) => a === b);
    timing.holds = timing.buttons.filter(([a, b]) => a !== b);
    // Paint every FX body and head first, then every BT body and head. A later
    // FX chip must never cover a BT hold, regardless of the chart's time order.
    timing.buttonLayers = [true, false].map((fx) => {
        const matches = ([, , lane]) => (lane === 1 || lane === 6) === fx;
        return {
            holds: timing.holds.filter(matches),
            chips: timing.chips.filter(matches),
        };
    });
    timing.chipSeconds = chart.buttons.filter(([a, b]) => a === b);
    timing.holdSeconds = chart.buttons.filter(([a, b]) => a !== b);
    for (const layer of timing.buttonLayers)
        layer.holdBlocks = timeBlocks(
            layer.holds,
            (n) => n[0],
            (n) => n[1],
        );
    timing.holdSecondBlocks = timeBlocks(
        timing.holdSeconds,
        (n) => n[0],
        (n) => n[1],
    );
    timing.laserBlocks = timeBlocks(
        timing.lasers,
        (l) => l.points[0]?.[0] ?? Infinity,
        (l) => l.points.at(-1)?.[0] ?? -Infinity,
    );
    timingCache.set(chart, timing);
    return timing;
}

// Six lane widths, as in USC: four BT lanes between the two laser lanes.
// Keep the lane size fixed while extended lasers leave the panel.
export function chartLayout(width, height) {
    const track = Math.min(340, width - 56);
    const lane = track / 6,
        left = (width - track) / 2;
    return {
        track,
        lane,
        left,
        // Leave a short visible stretch of lanes below the judgement line.
        bottom: height - Math.max(48, Math.min(90, height * 0.1)),
        laneBottom: height - 8,
        laserX: (x) => left + lane / 2 + x * lane * 5,
    };
}

function firstAtOrAfter(points, at) {
    let low = 0,
        high = points.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (points[mid][0] < at) low = mid + 1;
        else high = mid;
    }
    return low;
}

// Derive feedback from song time rather than accumulating events, so pause,
// scrubbing and restarting cannot leave stale hit effects on the judgement line.
export function chartHitEffects(chart, at) {
    const timing = chartTiming(chart),
        effects = [];
    for (
        let i = firstAtOrAfter(timing.chipSeconds, at - HIT_FADE_SECONDS);
        i < timing.chipSeconds.length;
        i++
    ) {
        const [start, , button] = timing.chipSeconds[i];
        if (start > at) break;
        effects.push({
            button,
            held: false,
            age: at - start,
            // Finish the entrance before fading; keep the total lifetime fixed.
            fade:
                Math.max(0, at - start - HIT_ATTACK_SECONDS) /
                (HIT_FADE_SECONDS - HIT_ATTACK_SECONDS),
        });
    }
    for (const [start, end, button] of visibleBlocks(
        timing.holdSecondBlocks,
        at - HIT_FADE_SECONDS,
        at,
    )) {
        if (start > at || end + HIT_FADE_SECONDS < at) continue;
        effects.push({
            button,
            held: at < end,
            age: at - start,
            fade: Math.max(0, at - end) / HIT_FADE_SECONDS,
        });
    }
    return effects;
}

// Geometry changes on layout/scroll events, not as the song advances.
function chartSurface(canvas, chart, extendedLasers, viewport, visualScale = 1) {
    const width = viewport.clientWidth,
        height = viewport.clientHeight;
    if (!width || !height) return;
    const timing = chartTiming(chart);
    const { track, lane, left, bottom, laneBottom, laserX } = chartLayout(
        width,
        height,
    );
    let padding = 0,
        visibleTop = 0,
        visibleBottom = height;
    if (viewport !== canvas) {
        const boundsKey = extendedLasers ? "extendedBounds" : "normalBounds";
        if (!timing[boundsKey]) {
            let min = 0,
                max = 1;
            for (const laser of timing.lasers)
                for (const [, x] of extendedLasers
                    ? laser.extendedPoints
                    : laser.points) {
                    min = Math.min(min, x);
                    max = Math.max(max, x);
                }
            timing[boundsKey] = [min, max];
        }
        const [min, max] = timing[boundsKey];
        const scaledX = x => width / 2 + (laserX(x) - width / 2) * visualScale;
        const half = (lane / 2 + 2) * visualScale;
        padding = Math.ceil(
            Math.max(0, half - scaledX(min), scaledX(max) + half - width),
        );
        const dialog = canvas.parentElement;
        const origin = dialog.getBoundingClientRect();
        const area = viewport.getBoundingClientRect();
        const panel = viewport
            .closest(".chart-viewer-content")
            .getBoundingClientRect();
        const scaleX = origin.width / dialog.offsetWidth || 1;
        const scaleY = origin.height / dialog.offsetHeight || 1;
        visibleTop = Math.max(0, (panel.top - area.top) / scaleY);
        visibleBottom = Math.min(height, (panel.bottom - area.top) / scaleY);
        // Paint in the dialog's transparent shell, outside its scrolling panels.
        const styles = {
            left: `${(area.left - origin.left) / scaleX - padding}px`,
            top: `${(area.top - origin.top) / scaleY}px`,
            width: `${width + padding * 2}px`,
            height: `${height}px`,
        };
        for (const [name, value] of Object.entries(styles))
            if (canvas.style[name] !== value) canvas.style[name] = value;
    }
    const paintWidth = width + padding * 2;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (
        canvas.width !== Math.round(paintWidth * scale) ||
        canvas.height !== Math.round(height * scale)
    ) {
        canvas.width = Math.round(paintWidth * scale);
        canvas.height = Math.round(height * scale);
    }
    const ctx = canvas.getContext("2d");
    return {
        ctx,
        timing,
        width,
        height,
        track,
        lane,
        left,
        bottom,
        laneBottom,
        laserX,
        padding,
        paintWidth,
        scale,
        visibleTop,
        visibleBottom,
    };
}

export function createChartRenderer(canvas, viewport = canvas) {
    let surface, previousChart, previousExtended, previousScale;
    return {
        invalidate() {
            surface = undefined;
        },
        draw(chart, time, hiSpeed = 1, extendedLasers = true, visualScale = 1) {
            if (
                !surface ||
                chart !== previousChart ||
                extendedLasers !== previousExtended ||
                visualScale !== previousScale
            ) {
                surface = chartSurface(canvas, chart, extendedLasers, viewport, visualScale);
                previousChart = chart;
                previousExtended = extendedLasers;
                previousScale = visualScale;
            }
            if (surface)
                drawChart(
                    canvas,
                    chart,
                    time,
                    hiSpeed,
                    extendedLasers,
                    viewport,
                    surface,
                    visualScale,
                );
        },
    };
}

export function drawChart(
    canvas,
    chart,
    time,
    hiSpeed = 1,
    extendedLasers = true,
    viewport = canvas,
    surface,
    visualScale = 1,
) {
    surface ??= chartSurface(canvas, chart, extendedLasers, viewport, visualScale);
    if (!surface) return;
    const {
        ctx,
        timing,
        width,
        height,
        track,
        lane,
        left,
        bottom,
        laneBottom,
        laserX,
        padding,
        paintWidth,
        scale,
        visibleTop,
        visibleBottom,
    } = surface;
    ctx.setTransform(scale, 0, 0, scale, padding * scale, 0);
    ctx.clearRect(-padding, 0, paintWidth, height);
    ctx.save();
    // Scale the world around the judgement line, never the viewport. Its
    // inverse bounds reveal more chart ahead as notes and lanes get smaller.
    ctx.translate(width / 2, bottom);
    ctx.scale(visualScale, visualScale);
    ctx.translate(-width / 2, -bottom);
    const viewLeft = width / 2 + (-padding - width / 2) / visualScale;
    const viewWidth = paintWidth / visualScale;
    const top = bottom + (visibleTop - bottom) / visualScale;
    const viewBottom = bottom + (visibleBottom - bottom) / visualScale;
    const laneEnd = bottom + (laneBottom - bottom) / visualScale;
    ctx.beginPath();
    ctx.rect(viewLeft, top, viewWidth, Math.max(0, viewBottom - top));
    ctx.clip();
    const speed = ((bottom - 20) * hiSpeed) / 8;
    const now = timing.beatAt(time),
        lastBeat = now + (bottom - top) / speed;
    const y = (at) => bottom - (at - now) * speed;
    const colors = ["#24d9ff", "#ff49ba"];
    const cursors = [laserX(0), laserX(1)];

    ctx.fillStyle = "#080b1248";
    ctx.fillRect(left + lane, top, lane * 4, laneEnd - top);
    for (const side of [0, 1]) {
        ctx.fillStyle = side ? "#ff49ba0d" : "#24d9ff0d";
        ctx.fillRect(left + side * lane * 5, top, lane, laneEnd - top);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
        ctx.strokeStyle =
            i <= 1 ? "#24d9ff60" : i >= 5 ? "#ff49ba60" : "#939ca536";
        ctx.beginPath();
        ctx.moveTo(left + i * lane, top);
        ctx.lineTo(left + i * lane, laneEnd);
        ctx.stroke();
    }
    // Only chart objects stop at the judgement line, the lanes continue below.
    // Include the laser overhang while preserving the vertical judgment cutoff.
    ctx.save();
    ctx.beginPath();
    ctx.rect(viewLeft, top, viewWidth, Math.max(0, bottom - top));
    ctx.clip();
    for (let beat = Math.ceil(now); beat <= lastBeat; beat++) {
        ctx.strokeStyle = "#949ead16";
        ctx.beginPath();
        ctx.moveTo(left, y(beat));
        ctx.lineTo(left + track, y(beat));
        ctx.stroke();
    }
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    const measureStart = firstAtOrAfter(timing.measures, now);
    for (let i = measureStart; i < timing.measures.length; i++) {
        const [at, number] = timing.measures[i];
        if (at > lastBeat) break;
        const py = y(at);
        ctx.strokeStyle = "#929da45c";
        ctx.beginPath();
        ctx.moveTo(left, py);
        ctx.lineTo(left + track, py);
        ctx.stroke();
        ctx.fillStyle = "#a2a9b9";
        ctx.fillText(String(number), left - 8, py + 3);
    }
    const paintButton = ([start, end, button]) => {
        const fx = button === 1 || button === 6;
        const column = fx ? (button === 1 ? 0 : 2) : button - 2;
        const x = left + lane * (1 + column) + 1.5;
        const w = lane * (fx ? 2 : 1) - 3;
        if (end > start) {
            const holdTop = Math.max(top, y(end)),
                base = Math.min(bottom, y(start));
            ctx.fillStyle = fx ? "#ed950e80" : "#c7deff66";
            ctx.fillRect(x, holdTop, w, base - holdTop);
            ctx.fillStyle = fx ? "#ffb329a0" : "#e2edff99";
            ctx.fillRect(x, holdTop, 1.5, base - holdTop);
            ctx.fillRect(x + w - 1.5, holdTop, 1.5, base - holdTop);
        }
        if (start < now) return;
        const noteHeight =
            end > start ? 4 : SINGLE_NOTE_HEIGHT[fx ? "fx" : "bt"];
        ctx.fillStyle = fx ? "#ffae18" : "#eff6ff";
        ctx.fillRect(x, y(start) - noteHeight / 2, w, noteHeight);
        ctx.fillStyle = fx ? "#fff0bc" : "#ffffff";
        ctx.fillRect(x, y(start) - noteHeight / 2, w, 1);
    };
    for (const layer of timing.buttonLayers) {
        for (const note of visibleBlocks(layer.holdBlocks, now, lastBeat)) {
            if (note[1] >= now && note[0] <= lastBeat) paintButton(note);
        }
        for (
            let i = firstAtOrAfter(layer.chips, now);
            i < layer.chips.length;
            i++
        ) {
            if (layer.chips[i][0] > lastBeat) break;
            paintButton(layer.chips[i]);
        }
    }
    // Horizontal-width ribbons, instead of perpendicular strokes: diagonals and
    // slams keep the same lane width, matching USC's flat laser mesh geometry.
    const terminalLength = Math.max(12, lane * 0.65);
    const paintTerminal = (point, direction, color) => {
        const center = laserX(point[1]),
            py = y(point[0]);
        if (py < top - terminalLength || py > bottom + terminalLength) return;
        const terminalTop = direction > 0 ? py : py - terminalLength;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.globalAlpha = 0.38;
        ctx.beginPath();
        ctx.rect(center - lane / 2, terminalTop, lane, terminalLength);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.stroke();
    };
    for (const laser of visibleBlocks(
        timing.laserBlocks,
        now,
        lastBeat + terminalLength / speed,
    )) {
        const points = extendedLasers ? laser.extendedPoints : laser.points;
        if (
            !points.length ||
            points.at(-1)[0] < now ||
            points[0][0] > lastBeat + terminalLength / speed
        )
            continue;
        const color = colors[laser.side],
            half = lane / 2;
        // Downward inlet and upward outlet turn standalone slams into a tube
        // with a readable traversal direction, without letters or arrow icons.
        paintTerminal(points[0], 1, color);
        paintTerminal(points.at(-1), -1, color);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        for (
            let i = Math.max(1, firstAtOrAfter(points, now));
            i < points.length;
            i++
        ) {
            const a = points[i - 1],
                b = points[i];
            if (a[0] > lastBeat) break;
            if (b[0] < now) continue;
            let x1 = laserX(a[1]),
                x2 = laserX(b[1]);
            let y1 = y(a[0]),
                y2 = y(b[0]);
            const slam = a[0] === b[0];
            if (slam) {
                if (a[0] < now) continue;
                // A small visible cap for an instantaneous horizontal jump.
                const thickness = Math.max(
                    4,
                    Math.min(
                        lane * 0.3,
                        (timing.beatAt(time + 0.05) - now) * speed,
                    ),
                );
                ctx.globalAlpha = 0.6;
                ctx.fillRect(
                    Math.min(x1, x2) - half,
                    y1 - thickness / 2,
                    Math.abs(x2 - x1) + lane,
                    thickness,
                );
                ctx.globalAlpha = 0.95;
                ctx.fillRect(
                    Math.min(x1, x2) - half,
                    y1 - thickness / 2,
                    Math.abs(x2 - x1) + lane,
                    1,
                );
                if (a[0] === now) cursors[laser.side] = x2;
                continue;
            }
            if (a[0] <= now && b[0] >= now) {
                x1 += ((x2 - x1) * (now - a[0])) / (b[0] - a[0]);
                y1 = bottom;
                cursors[laser.side] = x1;
            }
            if (b[0] > lastBeat) {
                x2 = x1 + (x2 - x1) * ((y1 - top) / (y1 - y2));
                y2 = top;
            }
            ctx.globalAlpha = 0.38;
            ctx.beginPath();
            ctx.moveTo(x1 - half, y1);
            ctx.lineTo(x2 - half, y2);
            ctx.lineTo(x2 + half, y2);
            ctx.lineTo(x1 + half, y1);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(x1 - half, y1);
            ctx.lineTo(x2 - half, y2);
            ctx.moveTo(x1 + half, y1);
            ctx.lineTo(x2 + half, y2);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = "#e2e7efd9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left - 6, bottom);
    ctx.lineTo(left + track + 6, bottom);
    ctx.stroke();
    const paintDiamond = (x, radius, color, opacity = 1) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.moveTo(x, bottom - radius);
        ctx.lineTo(x + radius, bottom);
        ctx.lineTo(x, bottom + radius);
        ctx.lineTo(x - radius, bottom);
        ctx.closePath();
        ctx.fill();
    };
    const diamondRadius = Math.max(4, lane * 0.12);
    for (const side of [0, 1])
        paintDiamond(cursors[side], diamondRadius, colors[side]);
    const feedback = chartHitEffects(chart, time).sort(
        (a, b) =>
            Number(b.button === 1 || b.button === 6) -
            Number(a.button === 1 || a.button === 6),
    );
    for (const effect of feedback) {
        const fx = effect.button === 1 || effect.button === 6;
        const column = fx ? (effect.button === 1 ? 1 : 3) : effect.button - 1.5;
        const x = left + lane * (1 + column);
        const attack = Math.min(1, effect.age / HIT_ATTACK_SECONDS);
        const opacity = attack * Math.max(0, 1 - effect.fade);
        // Match the laser cursors: one flat diamond. Only the short entrance
        // scales it, and holds keep a fixed size until their release fades out.
        paintDiamond(
            x,
            diamondRadius * 1.5 * (0.5 + attack * 0.5),
            fx ? "#ffae18" : "#eff6ff",
            opacity,
        );
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

export function createChartViewer() {
    const dialog = document.getElementById("chart-viewer");
    const body = document.getElementById("chart-viewer-body");
    const closeButton = document.getElementById("chart-viewer-close");
    dialog.setAttribute("closedby", "none");
    const content = document.createElement("div");
    content.className = "chart-viewer-content";
    content.append(...dialog.children);
    dialog.append(content);
    const buttonChecks = new WeakMap();
    let dispose,
        request,
        observer,
        trigger,
        settingsPanel,
        chartCanvas,
        current,
        closing = false;
    const panelLink = () =>
        current && {
            panel: "chart",
            song: current.music_id,
            diff: current.diff_idx,
        };
    const actions = document.createElement("div");
    actions.className = "panel-heading-actions";
    closeButton.before(actions);
    actions.append(createPanelShareButton(panelLink, "chart viewer"), closeButton);

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        closePanelLink(panelLink());
        dispose?.();
        request?.abort();
        observer?.disconnect();
        dialog.classList.remove("is-visible");
        await Promise.allSettled(dialog.getAnimations().map((a) => a.finished));
        dialog.close();
    }
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        void close();
    });
    dialog.addEventListener("click", (e) => {
        // The dialog is a transparent shell around the two visible panels.
        // Empty space inside that shell is backdrop too.
        if (e.target === dialog) void close();
    });
    dialog.addEventListener("close", () => {
        closePanelLink(panelLink());
        dispose?.();
        request?.abort();
        observer?.disconnect();
        body.replaceChildren();
        settingsPanel?.remove();
        settingsPanel = undefined;
        chartCanvas?.remove();
        chartCanvas = undefined;
        closing = false;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
    return {
        close,
        get link() {
            return dialog.open ? panelLink() : null;
        },
        async updateButton(button, chart) {
            if (!button) return;
            const key = `${chart.music_id}:${chart.diff_idx}`;
            const previous = buttonChecks.get(button);
            const check = { key };
            buttonChecks.set(button, check);
            if (previous?.key !== key) button.hidden = true;
            try {
                const available = await chartAvailable(chart);
                if (buttonChecks.get(button) === check && button.isConnected)
                    button.hidden = !available;
            } catch {
                if (buttonChecks.get(button) === check) button.hidden = true;
            }
        },
        async open(chart, button) {
            if (dialog.open) return;
            const key = `${chart.music_id}:${chart.diff_idx}`;
            if (
                dialog.open ||
                (buttonChecks.has(button) &&
                    buttonChecks.get(button).key !== key)
            )
                return;
            trigger = button;
            current = chart;
            openPanelLink(panelLink());
            dispose = undefined;
            request = new AbortController();
            const { signal } = request;
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "chart-viewer",
                }),
            );
            body.innerHTML = `<div class="chart-viewer-song"><span class="cover-tile chart-viewer-jacket"><span class="cover-missing" aria-label="Cover unavailable">—</span></span><div class="chart-viewer-song-info"><div class="chart-viewer-song-title"></div><div class="chart-viewer-song-artist"></div><span class="difficulty-badge"></span></div></div>
                <div class="chart-viewer-workspace"><div class="chart-viewer-main">
                    <p class="details-message" role="status">Loading song...</p><div class="chart-viewer-stage" hidden><canvas aria-label="Animated 2D chart preview"></canvas></div><section class="chart-viewer-player" aria-label="Song player"></section>
                </div>
                <section id="chart-speed-settings" class="chart-viewer-settings" aria-labelledby="chart-settings-title" hidden>
                    <h2 id="chart-settings-title">Chart settings</h2>
                    <div class="settings-control"><span id="chart-playback-speed-label">Playback speed</span><div class="segmented chart-viewer-rates" role="group" aria-labelledby="chart-playback-speed-label">${[0.25, 0.5, 0.75, 1, 1.5].map((rate) => `<button type="button" data-playback-rate="${rate}" aria-pressed="${rate === 1}" class="${rate === 1 ? "selected" : ""}">${rate}×</button>`).join("")}</div></div>
                    <div class="chart-viewer-settings-grid">
                        <div>
                            <label class="settings-control" for="chart-scale"><span>Scale</span><output for="chart-scale">100%</output><input id="chart-scale" type="range" min="25" max="150" step="5" value="100"></label>
                            <div class="settings-control">
                                <label for="chart-lane-speed">Lane speed</label>
                                <output for="chart-lane-speed"></output>
                                <div class="chart-viewer-lane-controls">
                                    <input id="chart-lane-speed" type="range" min="1" max="20" step="0.01" aria-label="Set lane speed">
                                    <input class="chart-viewer-lane-number" type="number" min="1" max="20" step="0.01" aria-label="Type lane speed from 1 to 20">
                                </div>
                            </div>
                            <label class="settings-control" for="chart-fps"><span>FPS limit</span><output for="chart-fps"></output><input id="chart-fps" type="range" min="15" max="245" step="5" value="245"></label>
                            <label class="settings-control" for="chart-offset"><span>Offset</span><output for="chart-offset">0 ms</output><input id="chart-offset" type="range" min="-500" max="500" step="1" value="0"></label>
                        </div>
                        <div>
                            <div class="settings-row"><span id="chart-extended-lasers-label">Extended lasers</span><div class="segmented" role="group" aria-labelledby="chart-extended-lasers-label"><button type="button" data-extended-lasers="on" aria-pressed="true">On</button><button type="button" data-extended-lasers="off" aria-pressed="false">Off</button></div></div>
                            <div class="settings-group"><div class="settings-row"><span id="chart-effects-label">Sound effects</span><div class="segmented" role="group" aria-labelledby="chart-effects-label" aria-describedby="chart-effects-hint"><button type="button" data-chart-effects="on" aria-pressed="true">On</button><button type="button" data-chart-effects="off" aria-pressed="false">Off</button></div></div><small id="chart-effects-hint" class="settings-hint">May differ from the game</small></div>
                        </div>
                    </div>
                    <div class="settings-footer"><button class="text-button chart-viewer-settings-reset" type="button">Reset</button></div>
                </section></div>`;
            body.querySelector(".chart-viewer-song-title").textContent =
                chart.title || "Chart";
            const artist = body.querySelector(".chart-viewer-song-artist");
            artist.textContent = chart.artist || "";
            artist.hidden = !chart.artist;
            const badge = body.querySelector(".difficulty-badge");
            badge.classList.add(`d${chart.diff_idx}`);
            badge.textContent =
                `${DIFFS[chart.diff_idx]} ${chart.level ?? ""}`.trim();
            if (
                typeof chart.cover === "string" &&
                /^[a-f0-9]{64}$/.test(chart.cover)
            ) {
                const jacket = body.querySelector(".chart-viewer-jacket");
                const placeholder = jacket.firstElementChild;
                const image = document.createElement("img");
                image.alt = "";
                image.decoding = "async";
                image.addEventListener(
                    "error",
                    () => jacket.replaceChildren(placeholder),
                    { signal, once: true },
                );
                image.src = `/api/cover?id=${chart.cover}`;
                jacket.replaceChildren(image);
            }
            const message = body.querySelector(".details-message"),
                stage = body.querySelector(".chart-viewer-stage");
            const canvas = stage.querySelector("canvas"),
                scaleSlider = body.querySelector("#chart-scale"),
                laneSlider = body.querySelector("#chart-lane-speed"),
                laneNumber = body.querySelector(".chart-viewer-lane-number"),
                laneOutput = body.querySelector(
                    'output[for="chart-lane-speed"]',
                ),
                fpsSlider = body.querySelector("#chart-fps"),
                offsetSlider = body.querySelector("#chart-offset"),
                settings = body.querySelector("#chart-speed-settings");
            canvas.classList.add("chart-viewer-canvas");
            canvas.hidden = true;
            canvas.setAttribute("aria-hidden", "true");
            chartCanvas = canvas;
            dialog.append(canvas);
            stage.setAttribute("role", "img");
            stage.setAttribute("aria-label", "Animated 2D chart preview");
            settingsPanel = settings;
            const desktop = matchMedia("(min-width: 960px)");
            const placeSettings = () => {
                const parent = desktop.matches
                    ? dialog
                    : body.querySelector(".chart-viewer-workspace");
                parent.append(settings);
            };
            placeSettings();
            desktop.addEventListener("change", placeSettings, { signal });
            let timeline,
                time = 0,
                referenceBpm = 120,
                hiSpeed = 1,
                modSpeed = 700,
                visualScale = 1,
                fpsLimit = 0,
                offsetMs = 0,
                extendedLasers = true,
                hasFullAudio = false,
                transportRate = 1;
            let playback = createChartPlayback({ signal });
            const effects = createChartAudio({
                getChart: () => timeline,
                signal,
            });
            const setPlaybackRate = (rate) => {
                transportRate = rate;
                dispose?.setPlaybackRate(rate);
                for (const button of settings.querySelectorAll(
                    "[data-playback-rate]",
                )) {
                    const selected =
                        Number(button.dataset.playbackRate) === rate;
                    button.classList.toggle("selected", selected);
                    button.setAttribute("aria-pressed", String(selected));
                }
            };
            for (const button of settings.querySelectorAll(
                "[data-playback-rate]",
            ))
                button.addEventListener(
                    "click",
                    () => setPlaybackRate(Number(button.dataset.playbackRate)),
                    { signal },
                );
            const selectToggle = (attribute, enabled) => {
                for (const button of dialog.querySelectorAll(
                    `[${attribute}]`,
                )) {
                    const selected =
                        (button.getAttribute(attribute) === "on") === enabled;
                    button.setAttribute("aria-pressed", String(selected));
                    button.classList.toggle("selected", selected);
                }
            };
            const setEffects = (enabled, persist = false) => {
                effectsEnabled = enabled;
                effects.enabled = hasFullAudio && enabled;
                selectToggle("data-chart-effects", enabled);
                if (persist) {
                    try {
                        localStorage.setItem(
                            "sdvx-chart-effects",
                            String(enabled),
                        );
                    } catch {
                        /* Optional storage. */
                    }
                    dispose?.refreshSource();
                }
            };
            let effectsEnabled = true;
            try {
                effectsEnabled =
                    localStorage.getItem("sdvx-chart-effects") !== "false";
            } catch {
                /* Optional storage. */
            }
            setEffects(effectsEnabled);
            // This control is created after the page's initial motion setup.
            // Reuse its sliding highlight and release the observers on close.
            void import("./motion.js").then(({ initSegmentedControl }) => {
                if (signal.aborted) return;
                for (const control of settings.querySelectorAll(".segmented")) {
                    const cleanup = initSegmentedControl(control);
                    signal.addEventListener("abort", cleanup, { once: true });
                }
            });
            for (const button of dialog.querySelectorAll(
                "[data-chart-effects]",
            ))
                button.addEventListener(
                    "click",
                    () =>
                        setEffects(button.dataset.chartEffects === "on", true),
                    { signal },
                );
            try {
                const saved = Number(localStorage.getItem(SPEED_KEY));
                if (Number.isFinite(saved) && saved > 0) modSpeed = saved;
                const savedScale = Number(localStorage.getItem(SCALE_KEY));
                if (Number.isFinite(savedScale) && savedScale >= 0.25 && savedScale <= 1.5)
                    visualScale = savedScale;
                const savedFps = Number(localStorage.getItem(FPS_KEY));
                const savedOffset = Number(localStorage.getItem(OFFSET_KEY));
                if (Number.isFinite(savedOffset)) offsetMs = savedOffset;
                extendedLasers =
                    localStorage.getItem(EXTENDED_LASERS_KEY) !== "false";
                if (
                    Number.isFinite(savedFps) &&
                    savedFps >= 15 &&
                    savedFps <= 240
                )
                    fpsLimit = savedFps;
            } catch {
                /* Storage can be unavailable in private browsing. */
            }
            const shouldDraw = createFrameLimiter(() => fpsLimit);
            const renderer = createChartRenderer(canvas, stage);
            const draw = () => {
                if (timeline)
                    renderer.draw(
                        timeline,
                        time - offsetMs / 1000,
                        hiSpeed,
                        extendedLasers,
                        visualScale * BASE_VISUAL_SCALE,
                    );
            };
            const setScale = (value, persist = false) => {
                if (!Number.isFinite(value)) return;
                visualScale = Math.max(0.25, Math.min(1.5, value));
                const percent = Math.round(visualScale * 100);
                scaleSlider.value = percent;
                scaleSlider.setAttribute("aria-valuetext", `${percent}%`);
                settings.querySelector('output[for="chart-scale"]').value = `${percent}%`;
                if (persist) {
                    try {
                        localStorage.setItem(SCALE_KEY, String(visualScale));
                    } catch {
                        /* Optional storage. */
                    }
                }
                draw();
            };
            setScale(visualScale);
            scaleSlider.addEventListener("input", () => setScale(Number(scaleSlider.value) / 100, true), { signal });
            const setExtendedLasers = (enabled, persist = false) => {
                extendedLasers = enabled;
                selectToggle("data-extended-lasers", enabled);
                if (persist) {
                    try {
                        localStorage.setItem(
                            EXTENDED_LASERS_KEY,
                            String(enabled),
                        );
                    } catch {
                        /* Optional storage. */
                    }
                }
                draw();
            };
            setExtendedLasers(extendedLasers);
            for (const button of dialog.querySelectorAll(
                "[data-extended-lasers]",
            ))
                button.addEventListener(
                    "click",
                    () =>
                        setExtendedLasers(
                            button.dataset.extendedLasers === "on",
                            true,
                        ),
                    { signal },
                );
            const setFps = (value, persist = false) => {
                fpsLimit = value >= 245 ? 0 : value;
                fpsSlider.value = fpsLimit || 245;
                const label = fpsLimit ? `${fpsLimit} FPS` : "Unlimited";
                settings.querySelector('output[for="chart-fps"]').value = label;
                fpsSlider.setAttribute("aria-valuetext", label);
                if (persist) {
                    try {
                        localStorage.setItem(FPS_KEY, String(fpsLimit));
                    } catch {
                        /* Optional storage. */
                    }
                }
                draw();
            };
            setFps(fpsLimit || 245);
            fpsSlider.addEventListener(
                "input",
                () => setFps(Number(fpsSlider.value), true),
                { signal },
            );
            let displayedSpeed = NaN;
            const currentBpm = () =>
                timeline
                    ? chartTiming(timeline).bpmAt(time - offsetMs / 1000)
                    : referenceBpm;
            const updateLaneSpeed = (force = false) => {
                // USC scrollSpeed = current BPM × HiSpeed. Use hundreds of
                // effective BPM for the 1-20 control, without clamping playback.
                const actual = (currentBpm() * hiSpeed) / 100;
                if (!force && actual === displayedSpeed) return;
                displayedSpeed = actual;
                laneOutput.value = `${actual.toFixed(2)}`;
                const selectable = Math.max(1, Math.min(20, actual)).toFixed(2);
                laneSlider.value = selectable;
                laneSlider.setAttribute(
                    "aria-valuetext",
                    `Set speed ${selectable}; actual ${actual.toFixed(2)}`,
                );
                if (force || document.activeElement !== laneNumber)
                    laneNumber.value = selectable;
            };
            const setLaneSpeed = (value) => {
                if (!Number.isFinite(value)) return;
                const target = Math.max(1, Math.min(20, value));
                // Like USC's live adjustment, resolve the multiplier using the
                // current BPM, then retain it through later tempo changes.
                modSpeed = target * 100;
                hiSpeed = modSpeed / currentBpm();
                try {
                    localStorage.setItem(SPEED_KEY, String(modSpeed));
                } catch {
                    /* Optional storage. */
                }
                updateLaneSpeed(true);
                draw();
            };
            const setOffset = (value, persist = false) => {
                if (!Number.isFinite(value)) return;
                offsetMs = Math.max(-500, Math.min(500, Math.round(value)));
                if (persist) {
                    try {
                        localStorage.setItem(OFFSET_KEY, String(offsetMs));
                    } catch {
                        /* Optional storage. */
                    }
                }
                offsetSlider.value = offsetMs;
                const label = `${offsetMs > 0 ? "+" : ""}${offsetMs} ms`;
                settings.querySelector('output[for="chart-offset"]').value =
                    label;
                offsetSlider.setAttribute("aria-valuetext", label);
                playback.setOffset(offsetMs / 1000);
                updateLaneSpeed(true);
                draw();
            };
            setOffset(offsetMs);
            offsetSlider.addEventListener(
                "input",
                () => setOffset(Number(offsetSlider.value), true),
                { signal },
            );
            laneSlider.addEventListener(
                "input",
                () => setLaneSpeed(Number(laneSlider.value)),
                { signal },
            );
            const commitSpeed = () => {
                if (
                    laneNumber.value.trim() &&
                    Number.isFinite(laneNumber.valueAsNumber)
                )
                    setLaneSpeed(laneNumber.valueAsNumber);
                else updateLaneSpeed(true);
            };
            laneNumber.addEventListener("change", commitSpeed, { signal });
            laneNumber.addEventListener("blur", () => updateLaneSpeed(true), {
                signal,
            });
            laneNumber.addEventListener(
                "keydown",
                (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitSpeed();
                        dialog.focus({ preventScroll: true });
                    }
                },
                { signal },
            );
            settings
                .querySelector(".chart-viewer-settings-reset")
                .addEventListener(
                    "click",
                    () => {
                        setPlaybackRate(1);
                        setScale(1, true);
                        setOffset(0, true);
                        setLaneSpeed(7);
                        setFps(245, true);
                        setEffects(true, true);
                        setExtendedLasers(true, true);
                    },
                    { signal },
                );
            const redrawLayout = () => {
                renderer.invalidate();
                draw();
            };
            observer = new ResizeObserver(redrawLayout);
            for (const element of [stage, body, content, dialog])
                observer.observe(element);
            window.addEventListener("resize", redrawLayout, {
                signal,
                passive: true,
            });
            window.visualViewport?.addEventListener("resize", redrawLayout, {
                signal,
                passive: true,
            });
            dialog.addEventListener("scroll", redrawLayout, {
                signal,
                capture: true,
                passive: true,
            });
            document.fonts?.ready.then(() => {
                if (!signal.aborted) redrawLayout();
            });
            dialog.addEventListener(
                "transitionend",
                (event) => {
                    if (event.target === dialog) redrawLayout();
                },
                { signal },
            );
            showPanel(dialog);
            getComputedStyle(dialog).opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            (button ? closeButton : dialog).focus({ preventScroll: true });
            const onTime = (at, frame) => {
                time = at;
                if (shouldDraw(frame.timestamp, frame.force)) draw();
                if (timeline) updateLaneSpeed();
            };
            const player = body.querySelector(".chart-viewer-player");
            const updateAudioControls = () => {
                settings
                    .querySelector("[data-chart-effects]")
                    .closest(".settings-group").hidden = !hasFullAudio;
                offsetSlider.closest("label").hidden = !hasFullAudio;
                effects.enabled = hasFullAudio && effectsEnabled;
            };
            const silent = () => {
                if (signal.aborted || !timeline) return;
                dispose?.();
                hasFullAudio = false;
                updateAudioControls();
                playback = createChartPlayback({ signal });
                playback.setChart(timeline);
                playback.setOffset(offsetMs / 1000);
                dispose = mountSilentChartPlayer(
                    player,
                    timeline,
                    playback,
                    onTime,
                );
                dispose.setPlaybackRate(transportRate);
            };
            const loadViewer = async () => {
                message.textContent = "Loading chart...";
                try {
                    const audio = await getAudioMetadata(chart).catch(
                        () => null,
                    );
                    if (signal.aborted) return;
                    const fallback = `/api/chart-view?music=${chart.music_id}&diff=${chart.diff_idx}`;
                    hasFullAudio = audio?.variant === "full";
                    const urls = [
                        ...new Set(
                            [hasFullAudio && audio.chart_url, fallback].filter(
                                Boolean,
                            ),
                        ),
                    ];
                    for (const url of urls) {
                        try {
                            const res = await fetch(url, { signal });
                            if (!res.ok) continue;
                            const value = await res.json();
                            if (validTimeline(value, chart)) {
                                timeline = value;
                                break;
                            }
                        } catch (error) {
                            if (signal.aborted) return;
                        }
                    }
                    if (!timeline) throw Error("Chart unavailable");
                    if (signal.aborted) return;
                    playback.setChart(timeline);
                    referenceBpm = chartTiming(timeline).referenceBpm;
                    hiSpeed = modSpeed / referenceBpm;
                    message.hidden = true;
                    stage.hidden = false;
                    canvas.hidden = false;
                    settings.hidden = false;
                    updateAudioControls();
                    updateLaneSpeed(true);
                    if (hasFullAudio) {
                        dispose = mountAudioPlayer(player, chart, null, {
                            initialAudio: audio,
                            prepareSource: (record, report) =>
                                effects.prepare(record, report),
                            seekTimeline: playback,
                            onTime,
                            onUnavailable: silent,
                            onPlaybackError: silent,
                        });
                        dispose.setPlaybackRate(transportRate);
                    } else silent();
                    draw();
                } catch {
                    if (!signal.aborted)
                        message.textContent =
                            "Chart isn’t available yet. Close and reopen after the next sync.";
                }
            };
            void loadViewer();
            dialog.addEventListener(
                "keydown",
                (event) => {
                    if (
                        !dialog.open ||
                        closing ||
                        event.isComposing ||
                        event.ctrlKey ||
                        event.altKey ||
                        event.metaKey
                    )
                        return;
                    const target = event.target;
                    if (
                        target.closest(
                            "textarea, select, [contenteditable]:not([contenteditable='false']), input:not([type='range'])",
                        )
                    )
                        return;
                    const controls = body.querySelector(
                        ".details-audio-controls",
                    );
                    if (!controls || controls.hidden) return;
                    const space = event.code === "Space" || event.key === " ";
                    if (
                        !space &&
                        event.key !== "ArrowLeft" &&
                        event.key !== "ArrowRight"
                    )
                        return;
                    event.preventDefault();
                    // Capture before the density slider's own keyboard handling.
                    event.stopPropagation();
                    if (space) {
                        if (!event.repeat)
                            body.querySelector(".details-audio-toggle").click();
                    } else {
                        const seek = body.querySelector(".details-audio-seek");
                        const step = event.shiftKey ? 1 : 5;
                        seek.value = Math.max(
                            0,
                            Math.min(
                                Number(seek.max),
                                Number(seek.value) +
                                    (event.key === "ArrowLeft" ? -step : step),
                            ),
                        );
                        seek.dispatchEvent(
                            new Event("input", { bubbles: true }),
                        );
                    }
                },
                { signal, capture: true },
            );
        },
    };
}
