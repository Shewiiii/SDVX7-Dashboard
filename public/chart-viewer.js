import { getAudioMetadata, mountAudioPlayer } from "./audio-player.js";
import { createSettingsPanel } from "./settings-panel.js";
import { createChartPlayback } from "./chart-playback.js";
import { createChartAudio } from "./chart-audio.js";
import { DIFFS } from "./metrics.js";

// Single-note thickness in CSS pixels. Adjust BT and FX independently here.
export const SINGLE_NOTE_HEIGHT = { bt: 10, fx: 10 };
const HIT_FADE_SECONDS = 0.24;
const canViewChart = (audio) =>
    audio?.variant === "full" &&
    typeof audio.chart_url === "string" &&
    audio.chart_url.length > 0;

export function validTimeline(value, chart) {
    const time = (n) => Number.isFinite(n) && n >= 0 && n <= 7200;
    const rows = (array, limit, check) =>
        Array.isArray(array) && array.length <= limit && array.every(check);
    let points = 0;
    return (
        value?.schema === 1 &&
        value.music_id === chart.music_id &&
        value.diff_idx === chart.diff_idx &&
        time(value.duration) &&
        value.duration > 0 &&
        rows(
            value.buttons,
            200000,
            (n) =>
                Array.isArray(n) &&
                n.length === 3 &&
                time(n[0]) &&
                time(n[1]) &&
                n[1] >= n[0] &&
                Number.isInteger(n[2]) &&
                n[2] >= 1 &&
                n[2] <= 6,
        ) &&
        rows(
            value.lasers,
            50000,
            (l) =>
                (l.side === 0 || l.side === 1) &&
                (l.ranges === undefined ||
                    (rows(
                        l.ranges,
                        200000,
                        (range) => range === 1 || range === 2,
                    ) &&
                        l.ranges.length === l.points?.length)) &&
                rows(
                    l.points,
                    200000,
                    (p) =>
                        Array.isArray(p) &&
                        p.length === 2 &&
                        time(p[0]) &&
                        Number.isFinite(p[1]) &&
                        Math.abs(p[1]) <= 4,
                ) &&
                (points += l.points.length) <= 200000,
        ) &&
        rows(
            value.measures,
            10001,
            (m) =>
                Array.isArray(m) &&
                m.length === 2 &&
                time(m[0]) &&
                Number.isInteger(m[1]),
        ) &&
        rows(
            value.tempos,
            200000,
            (p) =>
                Array.isArray(p) &&
                p.length === 2 &&
                time(p[0]) &&
                Number.isFinite(p[1]) &&
                p[1] > 0,
        ) &&
        value.tempos.length > 0 &&
        value.tempos.every(([at], i) => !i || at >= value.tempos[i - 1][0])
    );
}

const timingCache = new WeakMap();
const SPEED_KEY = "sdvx-chart-mod-speed";
const FPS_KEY = "sdvx-chart-fps";
const EXTENDED_LASERS_KEY = "sdvx-chart-extended-lasers";

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
    timingCache.set(chart, timing);
    return timing;
}

// Six lane widths, as in USC: four BT lanes between the two laser lanes.
// Keep the lane size fixed; extended lasers may leave the canvas on mobile.
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
            fade: (at - start) / HIT_FADE_SECONDS,
        });
    }
    for (const [start, end, button] of timing.holdSeconds) {
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

export function drawChart(
    canvas,
    chart,
    time,
    hiSpeed = 1,
    extendedLasers = true,
) {
    const width = canvas.clientWidth,
        height = canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (
        canvas.width !== Math.round(width * scale) ||
        canvas.height !== Math.round(height * scale)
    ) {
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const timing = chartTiming(chart);
    const { track, lane, left, bottom, laneBottom, laserX } = chartLayout(
        width,
        height,
    );
    const speed = ((bottom - 20) * hiSpeed) / 8;
    const now = timing.beatAt(time),
        lastBeat = now + bottom / speed;
    const y = (at) => bottom - (at - now) * speed;
    const colors = ["#24d9ff", "#ff49ba"];
    const cursors = [laserX(0), laserX(1)];

    ctx.fillStyle = "#080b1248";
    ctx.fillRect(left + lane, 0, lane * 4, laneBottom);
    for (const side of [0, 1]) {
        ctx.fillStyle = side ? "#ff49ba0d" : "#24d9ff0d";
        ctx.fillRect(left + side * lane * 5, 0, lane, laneBottom);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
        ctx.strokeStyle =
            i <= 1 ? "#24d9ff60" : i >= 5 ? "#ff49ba60" : "#939ca536";
        ctx.beginPath();
        ctx.moveTo(left + i * lane, 0);
        ctx.lineTo(left + i * lane, laneBottom);
        ctx.stroke();
    }
    // Only chart objects stop at the judgement line; the lanes continue below.
    // Clip across the viewport so extended lasers can still leave the lanes.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, bottom);
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
            const top = Math.max(0, y(end)),
                base = Math.min(bottom, y(start));
            ctx.fillStyle = fx ? "#ed950e80" : "#c7deff66";
            ctx.fillRect(x, top, w, base - top);
            ctx.fillStyle = fx ? "#ffb329a0" : "#e2edff99";
            ctx.fillRect(x, top, 1.5, base - top);
            ctx.fillRect(x + w - 1.5, top, 1.5, base - top);
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
        for (const note of layer.holds) {
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
        if (py < -terminalLength || py > bottom + terminalLength) return;
        const top = direction > 0 ? py : py - terminalLength;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.globalAlpha = 0.38;
        ctx.beginPath();
        ctx.rect(center - lane / 2, top, lane, terminalLength);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.stroke();
    };
    for (const laser of timing.lasers) {
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
                ctx.fillStyle = color;
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
                x2 = x1 + (x2 - x1) * (y1 / (y1 - y2));
                y2 = 0;
            }
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.38;
            ctx.beginPath();
            ctx.moveTo(x1 - half, y1);
            ctx.lineTo(x2 - half, y2);
            ctx.lineTo(x2 + half, y2);
            ctx.lineTo(x1 + half, y1);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.25;
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
        const attack = Math.min(1, effect.age / 0.025);
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
}

export function createChartViewer() {
    const dialog = document.getElementById("chart-viewer");
    const body = document.getElementById("chart-viewer-body");
    const closeButton = document.getElementById("chart-viewer-close");
    const buttonChecks = new WeakMap();
    let dispose,
        request,
        observer,
        overflow,
        trigger,
        closing = false;
    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
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
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
        )
            void close();
    });
    dialog.addEventListener("close", () => {
        dispose?.();
        request?.abort();
        observer?.disconnect();
        document.documentElement.style.overflow = overflow;
        body.replaceChildren();
        closing = false;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
    return {
        async updateButton(button, chart) {
            if (!button) return;
            const key = `${chart.music_id}:${chart.diff_idx}`;
            const previous = buttonChecks.get(button);
            const check = { key };
            buttonChecks.set(button, check);
            if (previous?.key !== key) button.hidden = true;
            try {
                const audio = await getAudioMetadata(chart);
                if (buttonChecks.get(button) === check && button.isConnected)
                    button.hidden = !canViewChart(audio);
            } catch {
                if (buttonChecks.get(button) === check) button.hidden = true;
            }
        },
        async open(chart, button) {
            if (dialog.open) return;
            const key = `${chart.music_id}:${chart.diff_idx}`;
            const audio = await getAudioMetadata(chart).catch(() => null);
            if (
                dialog.open ||
                (buttonChecks.has(button) &&
                    buttonChecks.get(button).key !== key)
            )
                return;
            const unavailable = () => {
                if (
                    button?.isConnected &&
                    (!buttonChecks.has(button) ||
                        buttonChecks.get(button).key === key)
                )
                    button.hidden = true;
                void close();
            };
            if (!canViewChart(audio)) {
                unavailable();
                return;
            }
            trigger = button;
            request = new AbortController();
            const { signal } = request;
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "chart-viewer",
                }),
            );
            overflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            body.innerHTML = `<p class="details-song"></p>
                <div class="chart-viewer-tools" hidden>
                    <div class="appearance-settings chart-viewer-settings">
                        <button type="button" class="appearance-toggle chart-viewer-settings-toggle" aria-label="Chart settings" title="Chart settings" aria-expanded="false" aria-controls="chart-speed-settings">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 6h8m4 0h4M14 3v6M4 12h3m4 0h9M9 9v6M4 18h10m4 0h2M16 15v6"/></svg>
                        </button>
                        <section id="chart-speed-settings" class="panel settings-panel chart-viewer-settings-panel" aria-labelledby="chart-settings-title" hidden inert>
                            <h2 id="chart-settings-title">Chart settings</h2>
                            <div class="settings-control">
                                <label for="chart-lane-speed" title="Current BPM × HiSpeed ÷ 100">Lane speed</label>
                                <output for="chart-lane-speed" title="Actual speed follows BPM and can go outside 1–20."></output>
                                <div class="chart-viewer-lane-controls">
                                    <input id="chart-lane-speed" type="range" min="1" max="20" step="0.01" aria-label="Set lane speed">
                                    <input class="chart-viewer-lane-number" type="number" min="1" max="20" step="0.01" aria-label="Type lane speed from 1 to 20">
                                </div>
                            </div>
                            <label class="settings-control" for="chart-fps"><span>FPS limit</span><output for="chart-fps"></output><input id="chart-fps" type="range" min="15" max="245" step="5" value="245"></label>
                            <label class="settings-control" for="chart-offset" title="Positive values delay chart visuals relative to the audio."><span>Offset</span><output for="chart-offset">0 ms</output><input id="chart-offset" type="range" min="-500" max="500" step="1" value="0"></label>
                            <div class="settings-row"><span id="chart-extended-lasers-label">Extended lasers</span><div class="segmented" role="group" aria-labelledby="chart-extended-lasers-label"><button type="button" data-extended-lasers="on" aria-pressed="true">On</button><button type="button" data-extended-lasers="off" aria-pressed="false">Off</button></div></div>
                            <div class="settings-group"><div class="settings-row"><span id="chart-effects-label">Sound effects</span><div class="segmented" role="group" aria-labelledby="chart-effects-label" aria-describedby="chart-effects-hint"><button type="button" data-chart-effects="on" aria-pressed="true">On</button><button type="button" data-chart-effects="off" aria-pressed="false">Off</button></div></div><small id="chart-effects-hint" class="settings-hint">May differ from the game</small></div>
                            <div class="settings-footer"><button class="text-button chart-viewer-settings-reset" type="button">Reset</button></div>
                        </section>
                    </div>
                </div>
                <p class="details-message" role="status">Loading song...</p><div class="chart-viewer-stage" hidden><canvas aria-label="Animated 2D chart preview"></canvas></div><section class="chart-viewer-player" aria-label="Song player"></section>`;
            body.querySelector(".details-song").textContent =
                `${chart.title || "Chart"} · ${DIFFS[chart.diff_idx]} ${chart.level ?? ""}`;
            const message = body.querySelector(".details-message"),
                stage = body.querySelector(".chart-viewer-stage");
            const canvas = stage.querySelector("canvas"),
                laneSlider = body.querySelector("#chart-lane-speed"),
                laneNumber = body.querySelector(".chart-viewer-lane-number"),
                laneOutput = body.querySelector(
                    'output[for="chart-lane-speed"]',
                ),
                fpsSlider = body.querySelector("#chart-fps"),
                offsetSlider = body.querySelector("#chart-offset"),
                settings = body.querySelector("#chart-speed-settings"),
                settingsButton = body.querySelector(
                    ".chart-viewer-settings-toggle",
                );
            const tools = body.querySelector(".chart-viewer-tools");
            let timeline,
                time = 0,
                referenceBpm = 120,
                hiSpeed = 1,
                modSpeed = 700,
                fpsLimit = 0,
                offsetMs = 0,
                extendedLasers = true;
            const playback = createChartPlayback({ signal });
            const effects = createChartAudio({
                getChart: () => timeline,
                signal,
            });
            const selectToggle = (attribute, enabled) => {
                for (const button of body.querySelectorAll(`[${attribute}]`)) {
                    const selected =
                        (button.getAttribute(attribute) === "on") === enabled;
                    button.setAttribute("aria-pressed", String(selected));
                    button.classList.toggle("selected", selected);
                }
            };
            const setEffects = (enabled, persist = false) => {
                effects.enabled = enabled;
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
            for (const button of body.querySelectorAll("[data-chart-effects]"))
                button.addEventListener(
                    "click",
                    () =>
                        setEffects(button.dataset.chartEffects === "on", true),
                    { signal },
                );
            try {
                const saved = Number(localStorage.getItem(SPEED_KEY));
                if (Number.isFinite(saved) && saved > 0) modSpeed = saved;
                const savedFps = Number(localStorage.getItem(FPS_KEY));
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
            const draw = () => {
                if (timeline)
                    drawChart(
                        canvas,
                        timeline,
                        time - offsetMs / 1000,
                        hiSpeed,
                        extendedLasers,
                    );
            };
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
            for (const button of body.querySelectorAll(
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
                body.querySelector('output[for="chart-fps"]').value = label;
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
            const setOffset = (value) => {
                if (!Number.isFinite(value)) return;
                offsetMs = Math.max(-500, Math.min(500, Math.round(value)));
                offsetSlider.value = offsetMs;
                const label = `${offsetMs > 0 ? "+" : ""}${offsetMs} ms`;
                body.querySelector('output[for="chart-offset"]').value = label;
                offsetSlider.setAttribute("aria-valuetext", label);
                playback.setOffset(offsetMs / 1000);
                updateLaneSpeed(true);
                draw();
            };
            setOffset(0);
            offsetSlider.addEventListener(
                "input",
                () => setOffset(Number(offsetSlider.value)),
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
                    }
                },
                { signal },
            );
            createSettingsPanel({
                toggle: settingsButton,
                panel: settings,
                signal,
            });
            body.querySelector(".chart-viewer-settings-reset").addEventListener(
                "click",
                () => {
                    setOffset(0);
                    setLaneSpeed(7);
                    setFps(245, true);
                    setEffects(true, true);
                    setExtendedLasers(true, true);
                },
                { signal },
            );
            observer = new ResizeObserver(draw);
            observer.observe(canvas);
            dialog.showModal();
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            closeButton.focus({ preventScroll: true });
            dispose = mountAudioPlayer(
                body.querySelector(".chart-viewer-player"),
                chart,
                null,
                {
                    initialAudio: audio,
                    prepareSource: (audio, report) =>
                        effects.prepare(audio, report),
                    seekTimeline: playback,
                    onTime(at, frame) {
                        time = at;
                        if (shouldDraw(frame.timestamp, frame.force)) draw();
                        if (timeline) updateLaneSpeed();
                    },
                    onUnavailable: unavailable,
                    async onReady(audio) {
                        if (!canViewChart(audio)) {
                            unavailable();
                            return;
                        }
                        timeline = undefined;
                        stage.hidden = true;
                        message.hidden = false;
                        message.textContent = "Loading chart...";
                        try {
                            const res = await fetch(audio.chart_url, {
                                signal,
                            });
                            if (!res.ok) throw Error("unavailable");
                            const value = await res.json();
                            if (!validTimeline(value, chart))
                                throw Error("invalid");
                            if (signal.aborted) return;
                            timeline = value;
                            playback.setChart(timeline);
                            referenceBpm = chartTiming(timeline).referenceBpm;
                            hiSpeed = modSpeed / referenceBpm;
                            message.hidden = true;
                            stage.hidden = false;
                            tools.hidden = false;
                            updateLaneSpeed(true);
                            draw();
                        } catch (error) {
                            if (!signal.aborted) {
                                console.error(
                                    "[chart-viewer] Could not load chart",
                                    chart.music_id,
                                    chart.diff_idx,
                                    error,
                                );
                                message.textContent =
                                    "Could not load the chart. Close and reopen to retry.";
                            }
                        }
                    },
                },
            );
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
                            ".chart-viewer-settings, textarea, select, [contenteditable]:not([contenteditable='false']), input:not(.details-audio-seek)",
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
                        seek.value = Math.max(
                            0,
                            Math.min(
                                Number(seek.max),
                                Number(seek.value) +
                                    (event.key === "ArrowLeft" ? -5 : 5),
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
