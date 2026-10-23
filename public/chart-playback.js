const clamp = (n, max = 1) => Math.max(0, Math.min(max, n));
const clock = (n) =>
    `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const rate = (n) => Number(n.toFixed(1)).toLocaleString();

function currentPoint(points, at) {
    let low = 0,
        high = points.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (points[mid][0] <= at) low = mid + 1;
        else high = mid;
    }
    return points[Math.max(0, low - 1)];
}

export function playbackContext(chart, at) {
    return {
        measure: currentPoint(chart.measures, at)?.[1] ?? 1,
        totalMeasures: chart.measures.at(-1)?.[1] ?? 1,
        bpm: currentPoint(chart.tempos, at)?.[1] ?? 0,
    };
}

// Use the same actions as Details: button/hold starts, laser starts, direction
// reversals, and straight-to-moving transitions. Movement amplitude adds no weight.
// Bins use audio time, including chart_offset, so scrubbing and density align.
export function chartDensity(chart, record, bins = 128) {
    const buttons = Array(bins).fill(0),
        lasers = Array(bins).fill(0);
    const count = (series, at) => {
        const audioTime = at - record.start + record.chart_offset;
        if (audioTime < 0 || audioTime > record.duration) return;
        series[
            Math.min(bins - 1, Math.floor((audioTime / record.duration) * bins))
        ]++;
    };
    for (const [at] of chart.buttons) count(buttons, at);
    for (const { points } of chart.lasers) {
        if (!points.length) continue;
        count(lasers, points[0][0]);
        let previousDirection = null;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1],
                b = points[i];
            const delta = b[1] - a[1];
            if (b[0] === a[0] && Math.abs(delta) <= 1e-6) continue;
            const direction = Math.abs(delta) <= 1e-6 ? 0 : Math.sign(delta);
            if (
                direction &&
                previousDirection !== null &&
                direction !== previousDirection
            )
                count(lasers, a[0]);
            previousDirection = direction;
        }
    }
    const seconds = record.duration / bins;
    return {
        buttons: buttons.map((n) => n / seconds),
        lasers: lasers.map((n) => n / seconds),
    };
}

// A chart-specific presentation over the shared audio transport. Details keeps
// its waveform; the chart viewer supplies this seekable action-density plot.
export function createChartPlayback({ signal }) {
    let chart, record, svg, seek, wave, context, playhead, popup, hoverLine;
    let density,
        mounted = false,
        dragging = null,
        position = 0,
        offset = 0;
    const events = { signal };
    const audioToChart = (at) =>
        at + record.start - record.chart_offset - offset;

    function hidePopup() {
        popup?.classList.remove("is-visible");
        hoverLine?.setAttribute("visibility", "hidden");
    }
    function inspect(fraction) {
        if (!density) return;
        fraction = clamp(fraction);
        const at = fraction * record.duration;
        const info = playbackContext(chart, audioToChart(at));
        const index = Math.min(
            density.buttons.length - 1,
            Math.floor(fraction * density.buttons.length),
        );
        popup.querySelector("strong").textContent =
            `${clock(at)} · Measure ${info.measure}`;
        const values = popup.querySelectorAll("b");
        values[0].textContent = `${rate(density.buttons[index])}/s`;
        values[1].textContent = `${rate(density.lasers[index])}/s`;
        values[2].textContent = `${rate(density.buttons[index] + density.lasers[index])}/s`;
        popup.classList.add("is-visible");
        const bounds = wave.getBoundingClientRect();
        const popupWidth = popup.offsetWidth;
        popup.style.left = `${Math.max(0, Math.min(bounds.width - popupWidth, fraction * bounds.width - popupWidth / 2))}px`;
        const x = fraction * 512;
        hoverLine.setAttribute("x1", x);
        hoverLine.setAttribute("x2", x);
        hoverLine.removeAttribute("visibility");
    }
    function fractionAt(event) {
        const bounds = wave.getBoundingClientRect();
        return clamp((event.clientX - bounds.left) / bounds.width);
    }
    function scrub(fraction) {
        seek.value = fraction * record.duration;
        seek.dispatchEvent(new Event("input", { bubbles: true }));
        inspect(fraction);
    }
    function render() {
        if (!svg) return;
        if (!chart) {
            svg.replaceChildren();
            return;
        }
        density = chartDensity(chart, {
            ...record,
            chart_offset: record.chart_offset + offset,
        });
        const max = Math.max(1, ...density.buttons, ...density.lasers);
        const path = (values) => {
            let d = "M0 60";
            values.forEach((value, i) => {
                const x = (i * 512) / values.length;
                const next = ((i + 1) * 512) / values.length;
                d += `H${x}V${60 - (value / max) * 54}H${next}`;
            });
            return d + "V60Z";
        };
        svg.innerHTML = `<path class="chart-playback-grid" d="M0 6H512M0 33H512M0 60H512"/>
            <path class="chart-playback-buttons" d="${path(density.buttons)}"/>
            <path class="chart-playback-lasers" d="${path(density.lasers)}"/>
            <line class="chart-playback-hover" y1="0" y2="64" visibility="hidden"/>
            <line class="chart-playback-head" y1="0" y2="64"/>`;
        playhead = svg.querySelector(".chart-playback-head");
        hoverLine = svg.querySelector(".chart-playback-hover");
        update(position);
    }
    function update(at) {
        position = at;
        if (!chart || !svg || !playhead) return;
        const x = clamp(at / record.duration) * 512;
        playhead.setAttribute("x1", x);
        playhead.setAttribute("x2", x);
        const info = playbackContext(chart, audioToChart(at));
        const label = `Measure ${info.measure} / ${info.totalMeasures} · ${rate(info.bpm)} BPM`;
        if (context.textContent !== label) context.textContent = label;
        const index = Math.min(
            density.buttons.length - 1,
            Math.floor(clamp(at / record.duration) * density.buttons.length),
        );
        seek.setAttribute(
            "aria-valuetext",
            `${clock(at)} of ${clock(record.duration)}, measure ${info.measure} of ${info.totalMeasures}, ${rate(info.bpm)} BPM, ${rate(density.buttons[index])} BT/FX starts and ${rate(density.lasers[index])} laser actions per second`,
        );
    }
    return {
        setOffset(value) {
            offset = value;
            hidePopup();
            render();
        },
        setChart(value) {
            chart = value;
            render();
        },
        update,
        mount(view) {
            ({ svg, seek, record } = view);
            wave = svg.parentElement;
            svg.setAttribute("viewBox", "0 0 512 64");
            seek.step = "any";
            seek.setAttribute("aria-label", "Seek by chart note density");
            if (!mounted) {
                mounted = true;
                view.host.classList.add("chart-playback");
                view.host.querySelector(
                    ".details-audio-heading > span",
                ).innerHTML =
                    `Note density <span class="details-density-legend"><span><i class="dot details-btfx-dot" aria-hidden="true"></i>BT/FX</span><span><i class="dot details-laser-dot" aria-hidden="true"></i>Laser</span></span>`;
                const readout = document.createElement("div");
                readout.className = "chart-playback-readout";
                const time = view.host.querySelector(".details-audio-time");
                time.replaceWith(readout);
                context = document.createElement("span");
                context.className = "chart-playback-context";
                readout.append(time, context);
                popup = document.createElement("div");
                popup.className =
                    "details-popup details-density-popup chart-playback-popup";
                popup.setAttribute("role", "tooltip");
                popup.innerHTML = `<strong></strong><div class="details-density-row"><span><i class="dot details-btfx-dot" aria-hidden="true"></i>BT/FX</span><b></b></div><div class="details-density-row"><span><i class="dot details-laser-dot" aria-hidden="true"></i>Laser</span><b></b></div><div class="details-density-row"><span>Total</span><b></b></div>`;
                wave.append(popup);
                wave.addEventListener(
                    "pointerdown",
                    (event) => {
                        if (!density || !event.isPrimary || event.button !== 0)
                            return;
                        event.preventDefault();
                        dragging = event.pointerId;
                        wave.setPointerCapture(dragging);
                        wave.classList.add("is-pointer-seeking");
                        seek.focus({ preventScroll: true });
                        scrub(fractionAt(event));
                    },
                    events,
                );
                wave.addEventListener(
                    "pointermove",
                    (event) => {
                        if (dragging === event.pointerId)
                            scrub(fractionAt(event));
                        else if (event.pointerType !== "touch")
                            inspect(fractionAt(event));
                    },
                    events,
                );
                for (const name of [
                    "pointerup",
                    "pointercancel",
                    "lostpointercapture",
                ])
                    wave.addEventListener(
                        name,
                        (event) => {
                            if (dragging !== event.pointerId) return;
                            dragging = null;
                            if (
                                event.pointerType === "touch" ||
                                name !== "pointerup"
                            )
                                hidePopup();
                        },
                        events,
                    );
                wave.addEventListener(
                    "pointerleave",
                    () => {
                        if (dragging === null) hidePopup();
                    },
                    events,
                );
                seek.addEventListener(
                    "keydown",
                    (event) => {
                        wave.classList.remove("is-pointer-seeking");
                        const steps = {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowDown: -1,
                            ArrowUp: 1,
                            PageDown: -5,
                            PageUp: 5,
                        };
                        if (
                            event.key in steps ||
                            event.key === "Home" ||
                            event.key === "End"
                        ) {
                            event.preventDefault();
                            const target =
                                event.key === "Home"
                                    ? 0
                                    : event.key === "End"
                                      ? record.duration
                                      : Number(seek.value) +
                                        steps[event.key] *
                                            (event.shiftKey ? 5 : 1);
                            scrub(clamp(target / record.duration));
                        }
                        if (
                            event.key === "Escape" &&
                            popup.classList.contains("is-visible")
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                            hidePopup();
                        }
                    },
                    events,
                );
                seek.addEventListener(
                    "blur",
                    () => {
                        wave.classList.remove("is-pointer-seeking");
                        hidePopup();
                    },
                    events,
                );
            }
            hidePopup();
            render();
        },
    };
}
