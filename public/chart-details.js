import { SONG_CATEGORIES as CATEGORIES } from "./song-metadata.js";
import { DIFFS } from "./metrics.js";
import { mountAudioPlayer } from "./audio-player.js";

const VERSIONS = [
    "—",
    "BOOTH",
    "INFINITE INFECTION",
    "GRAVITY WARS",
    "HEAVENLY HAVEN",
    "VIVID WAVE",
    "EXCEED GEAR",
    "∇",
];
const LANES = [
    "VOL-L",
    "FX-L",
    "BT-A",
    "BT-B",
    "BT-C",
    "BT-D",
    "FX-R",
    "VOL-R",
];
const count = (value) =>
    Number.isFinite(value) ? value.toLocaleString() : "—";
const time = (value) =>
    Number.isFinite(value)
        ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`
        : "—";

function timeline(chart) {
    const density = chart.density.map((value) => value / (chart.duration / 64));
    const lasers =
        chart.laser_density_version === 2
            ? chart.laser_density?.map((value) => value / (chart.duration / 64))
            : null;
    const peak = Math.max(1, ...density, ...(lasers || []));
    const seriesPoints = (series) =>
        series
            .map(
                (value, i) =>
                    `${52 + ((i + 0.5) * 456) / 64},${76 - (value / peak) * 58}`,
            )
            .join(" ");
    const points = seriesPoints(density);
    const laserPoints = lasers ? seriesPoints(lasers) : null;
    const tempos = chart.bpm_changes.filter((p) => p[0] <= chart.duration);
    const low = Math.min(...tempos.map((p) => p[1])),
        high = Math.max(...tempos.map((p) => p[1]));
    let bpmPath = "";
    for (const [i, point] of tempos.entries()) {
        const x = 52 + (point[0] / chart.duration) * 456;
        const y =
            76 - (high === low ? 0.5 : (point[1] - low) / (high - low)) * 58;
        bpmPath += `${i ? "H" : "M"}${x} ${i ? "V" : ""}${y} `;
    }
    if (tempos.length) bpmPath += "H508";
    let cells = "";
    const maximum = Math.max(1, ...chart.lanes.flat());
    chart.lanes.forEach((lane, row) =>
        lane.forEach((value, column) => {
            if (value > 0)
                cells += `<rect class="${row === 0 || row === 7 ? "details-laser" : "details-note"}" x="${52 + column * 7.125}" y="${row * 14 + 2}" width="6.5" height="10" opacity="${0.25 + Math.sqrt(value / maximum) * 0.75}"/>`;
        }),
    );
    const ticks = (values) =>
        values
            .map(
                ([y, value]) =>
                    `<text x="44" y="${y + 3}" text-anchor="end">${Number(value.toFixed(1)).toLocaleString()}</text>`,
            )
            .join("");
    return `<section class="details-chart" data-plot="density"><h3>Note density <span>Actions per second</span></h3><div class="details-density-legend"><span><i class="dot details-btfx-dot" aria-hidden="true"></i>BT/FX</span><span><i class="dot details-laser-dot" aria-hidden="true"></i>Laser${lasers ? "" : " · awaiting sync"}</span></div><svg viewBox="0 0 520 96" role="img" aria-label="BT/FX and laser action density across the chart"><path class="details-grid" d="M52 18H508M52 47H508M52 76H508"/>${ticks(
        [
            [18, peak],
            [47, peak / 2],
            [76, 0],
        ],
    )}<polygon class="details-density-fill" points="52,76 ${points} 508,76"/><polyline class="details-density-line" points="${points}"/>${laserPoints ? `<polygon class="details-laser-density-fill" points="52,76 ${laserPoints} 508,76"/><polyline class="details-laser-density-line" points="${laserPoints}"/>` : ""}<text x="52" y="93">0:00</text><text x="508" y="93" text-anchor="end">${time(chart.duration)}</text></svg></section>
        <section class="details-chart" data-plot="tempo"><h3>Tempo <span>${count(low)}${high !== low ? `–${count(high)}` : ""} BPM</span></h3><svg viewBox="0 0 520 96" role="img" aria-label="BPM changes across the chart"><path class="details-grid" d="M52 18H508M52 47H508M52 76H508"/>${ticks(
            high === low
                ? [[47, low]]
                : [
                      [18, high],
                      [47, (high + low) / 2],
                      [76, low],
                  ],
        )}<path class="details-tempo" d="${bpmPath}"/><text x="52" y="93">0:00</text><text x="508" y="93" text-anchor="end">${time(chart.duration)}</text></svg></section>
        <section class="details-chart" data-plot="lanes"><h3>Lane activity <span>Chart overview · time →</span></h3><svg viewBox="0 0 520 132" role="img" aria-label="Activity for each button and laser lane across the chart">${LANES.map((label, i) => `<text x="0" y="${i * 14 + 10}">${label}</text>`).join("")}${cells}<text x="52" y="129">0:00</text><text x="508" y="129" text-anchor="end">${time(chart.duration)}</text></svg></section>`;
}

function inspectPlots(plots, chart) {
    const preciseTime = (seconds) =>
        `${time(seconds)}.${Math.floor((seconds % 1) * 10)}`;
    for (const section of plots.querySelectorAll(".details-chart")) {
        const svg = section.querySelector("svg");
        const popup = document.createElement("div");
        popup.className = "details-popup";
        popup.hidden = true;
        popup.setAttribute("role", "status");
        let densityHeading, densityValues;
        if (section.dataset.plot === "density") {
            popup.classList.add("details-density-popup");
            densityHeading = document.createElement("strong");
            popup.append(densityHeading);
            densityValues = ["BT/FX", "Laser", "Total"].map((label, i) => {
                const row = document.createElement("div");
                row.className = "details-density-row";
                const name = document.createElement("span");
                if (i < 2) {
                    const dot = document.createElement("i");
                    dot.className = `dot ${i === 0 ? "details-btfx-dot" : "details-laser-dot"}`;
                    dot.setAttribute("aria-hidden", "true");
                    name.append(dot);
                }
                name.append(label);
                const value = document.createElement("b");
                row.append(name, value);
                popup.append(row);
                return value;
            });
        }
        section.append(popup);
        const cursor = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
        );
        cursor.classList.add("details-cursor");
        cursor.setAttribute("y1", "18");
        cursor.setAttribute("y2", "76");
        cursor.style.display = "none";
        if (section.dataset.plot !== "lanes") svg.append(cursor);
        const columnHighlight = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
        );
        columnHighlight.classList.add("details-column-highlight");
        columnHighlight.setAttribute("y", "0");
        columnHighlight.setAttribute("width", "7.125");
        columnHighlight.setAttribute("height", "112");
        columnHighlight.style.display = "none";
        if (section.dataset.plot === "lanes") svg.append(columnHighlight);
        svg.setAttribute("tabindex", "0");
        svg.setAttribute(
            "aria-label",
            `${svg.getAttribute("aria-label")}. Hover, tap, or use arrow keys to inspect.`,
        );
        let index = 0;
        function show(fraction, event) {
            fraction = Math.max(0, Math.min(0.999999, fraction));
            index = Math.floor(fraction * 64);
            const start = (index * chart.duration) / 64;
            const end = ((index + 1) * chart.duration) / 64;
            const at = fraction * chart.duration;
            const kind = section.dataset.plot;
            if (kind === "tempo") {
                const point =
                    chart.bpm_changes.findLast(([t]) => t <= at) ||
                    chart.bpm_changes[0];
                popup.textContent = `${preciseTime(at)} · ${count(point[1])} BPM`;
            } else if (kind === "density") {
                const starts = chart.density[index];
                const laserActions =
                    chart.laser_density_version === 2
                        ? chart.laser_density?.[index]
                        : undefined;
                densityHeading.textContent = `${preciseTime(start)}–${preciseTime(end)}`;
                [
                    starts,
                    laserActions,
                    laserActions === undefined
                        ? undefined
                        : starts + laserActions,
                ].forEach((value, i) => {
                    densityValues[i].textContent =
                        value === undefined
                            ? "—"
                            : `${count(value)} ${i === 0 ? "starts" : "actions"} · ${(value / (end - start)).toFixed(2)}/s`;
                });
            } else {
                popup.textContent = `${preciseTime(start)}–${preciseTime(end)}\n${LANES.map(
                    (label, lane) => {
                        const value = chart.lanes[lane][index];
                        return `${label}: ${lane === 0 || lane === 7 ? (value ? "Laser active" : "No laser activity") : `${value} tap/hold overlaps`}`;
                    },
                ).join("\n")}`;
                columnHighlight.setAttribute("x", 52 + index * 7.125);
                columnHighlight.style.display = "";
            }
            popup.hidden = false;
            if (section.dataset.plot !== "lanes") {
                cursor.setAttribute("x1", 52 + fraction * 456);
                cursor.setAttribute("x2", 52 + fraction * 456);
                cursor.style.display = "";
            }
            // Follow the performance-history popup: prefer beside the pointer,
            // flip sides near an edge, and keep the popup inside the visible panel.
            const panel = plots.closest("dialog").getBoundingClientRect();
            const sectionBox = section.getBoundingClientRect();
            const graph = svg.getBoundingClientRect();
            const gap = 12,
                inset = 8;
            const left = Math.max(panel.left, 0) + inset;
            const right = Math.min(panel.right, innerWidth) - inset;
            const top = Math.max(panel.top, 0) + inset;
            const bottom = Math.min(panel.bottom, innerHeight) - inset;
            popup.style.maxWidth = `${Math.max(0, right - left)}px`;
            popup.style.maxHeight = `${Math.max(0, bottom - top)}px`;
            const x =
                event?.clientX ??
                graph.left + ((52 + fraction * 456) / 520) * graph.width;
            const y = event?.clientY ?? graph.top + graph.height / 2;
            const width = popup.offsetWidth,
                height = popup.offsetHeight;
            const rightSpace = right - x - gap,
                leftSpace = x - gap - left;
            const useRight =
                rightSpace >= width ||
                (leftSpace < width && rightSpace >= leftSpace);
            const targetX = useRight ? x + gap : x - gap - width;
            popup.style.left = `${Math.max(left, Math.min(targetX, right - width)) - sectionBox.left}px`;
            popup.style.top = `${Math.max(top, Math.min(y - height - gap, bottom - height)) - sectionBox.top}px`;
        }
        function hide() {
            popup.hidden = true;
            cursor.style.display = "none";
            columnHighlight.style.display = "none";
        }
        svg.addEventListener("pointermove", (event) => {
            const bounds = svg.getBoundingClientRect();
            show(
                (((event.clientX - bounds.left) / bounds.width) * 520 - 52) /
                    456,
                event,
            );
        });
        svg.addEventListener("pointerdown", (event) => {
            if (event.pointerType !== "mouse")
                svg.setPointerCapture(event.pointerId);
            const bounds = svg.getBoundingClientRect();
            show(
                (((event.clientX - bounds.left) / bounds.width) * 520 - 52) /
                    456,
                event,
            );
        });
        svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType !== "touch") hide();
        });
        svg.addEventListener("pointerup", (event) => {
            if (event.pointerType !== "mouse") hide();
        });
        svg.addEventListener("pointercancel", hide);
        svg.addEventListener("lostpointercapture", (event) => {
            if (event.pointerType !== "mouse") hide();
        });
        svg.addEventListener("focus", () => show((index + 0.5) / 64));
        svg.addEventListener("blur", hide);

        svg.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
            if (event.key === "ArrowRight") index = Math.min(63, index + 1);
            show((index + 0.5) / 64);
        });
    }
}

export function createChartDetails() {
    const dialog = document.getElementById("chart-details");
    const body = document.getElementById("chart-details-body");
    const closeButton = document.getElementById("chart-details-close");
    const cache = new Map();
    const cacheKey = "chart-details-cache-v4";
    try {
        for (const [key, entry] of JSON.parse(
            localStorage.getItem(cacheKey) || "[]",
        ).slice(-64)) {
            if (
                entry?.record &&
                Number.isFinite(entry.at) &&
                Date.now() - entry.at < 30 * 86400000
            )
                cache.set(key, entry);
        }
    } catch {
        /* Storage can be disabled or cleared. */
    }
    let disposeAudio,
        controller,
        trigger,
        previousOverflow = "",
        closing = false,
        current;

    function showDetails(record) {
        disposeAudio?.();
        body.replaceChildren();
        const subtitle = document.createElement("p");
        subtitle.className = "details-song";
        subtitle.textContent = `${record.title} · ${DIFFS[record.diff_idx]} ${record.level ?? "—"}`;
        const artist = document.createElement("p");
        artist.className = "details-artist";
        artist.textContent = record.artist;
        const chart = record.chart;
        const categories = CATEGORIES.filter(
            ([flag]) => (record.genre || 0) & flag,
        ).map(([, title]) => title);
        const date = record.distribution_date
            ? new Date(record.distribution_date + "T00:00:00")
            : null;
        const rows = [
            [
                "BPM",
                Number.isFinite(record.bpm_min)
                    ? `${count(record.bpm_min)}${record.bpm_min !== record.bpm_max ? `–${count(record.bpm_max)}` : ""}`
                    : "—",
            ],
            ["Chart length", time(chart?.duration)],
            ["Effector", record.effector || "—"],
            ["Illustrator", record.illustrator || "—"],
            ["Introduced in", VERSIONS[record.version] || "—"],
            [
                "Distribution date",
                date && !Number.isNaN(date.getTime())
                    ? date.toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                      })
                    : "—",
            ],
            [
                "Categories",
                record.is_custom
                    ? "Custom Map"
                    : categories.join(" · ") || "Other",
            ],
            ["Maximum EX score", count(record.max_exscore)],
            [
                "BT taps / holds",
                chart
                    ? `${count(chart.counts.bt_taps)} / ${count(chart.counts.bt_holds)}`
                    : "—",
            ],
            [
                "FX taps / holds",
                chart
                    ? `${count(chart.counts.fx_taps)} / ${count(chart.counts.fx_holds)}`
                    : "—",
            ],
            ["Laser sections", count(chart?.counts.laser_sections)],
            ["Tempo changes", count(chart?.bpm_change_count)],
        ];
        const list = document.createElement("dl");
        list.className = "details-values";
        for (const [label, value] of rows) {
            const cell = document.createElement("div"),
                dt = document.createElement("dt"),
                dd = document.createElement("dd");
            dt.textContent = label;
            dd.textContent = value;
            cell.append(dt, dd);
            list.append(cell);
        }
        body.append(subtitle, artist, list);
        const player = document.createElement("section");
        player.setAttribute("aria-label", "Song player");
        body.append(player);
        let plots;
        if (chart) {
            plots = document.createElement("div");
            plots.className = "details-plots";
            plots.innerHTML = timeline(chart);
            body.append(plots);
            inspectPlots(plots, chart);
        } else {
            const note = document.createElement("p");
            note.className = "details-message";
            note.textContent =
                "Chart statistics are unavailable for this difficulty.";
            body.append(note);
        }
        disposeAudio = mountAudioPlayer(player, record, plots);
    }

    async function load() {
        disposeAudio?.();
        disposeAudio = null;
        controller?.abort();
        controller = new AbortController();
        const request = controller;
        body.setAttribute("aria-busy", "true");
        body.innerHTML =
            '<p class="details-message" role="status">Loading details...</p>';
        const key = `${current.music_id}:${current.diff_idx}`;
        const fallback = cache.get(key);
        try {
            let saved = fallback;
            if (
                !saved ||
                Date.now() - saved.at > 3600000 ||
                (saved.record.chart &&
                    saved.record.chart.laser_density_version !== 2)
            ) {
                const response = await fetch(
                    `/api/chart?music=${current.music_id}&diff=${current.diff_idx}&schema=3`,
                    { signal: request.signal },
                );
                if (!response.ok)
                    throw new Error(
                        response.status === 404
                            ? "Details haven’t synced yet. Sync the updated tracker, then try again."
                            : "Could not load details. Try again shortly.",
                    );
                const record = await response.json();
                if (
                    record.music_id !== current.music_id ||
                    record.diff_idx !== current.diff_idx
                )
                    throw new Error("Could not load this chart’s details.");
                saved = { at: Date.now(), record };
                cache.set(key, saved);
                if (cache.size > 64) cache.delete(cache.keys().next().value);
                try {
                    localStorage.setItem(cacheKey, JSON.stringify([...cache]));
                } catch {
                    /* Memory caching still works. */
                }
            }
            if (!request.signal.aborted && dialog.open && !closing)
                showDetails(saved.record);
        } catch (error) {
            if (request.signal.aborted || !dialog.open || closing) return;
            if (fallback) {
                showDetails(fallback.record);
                const note = document.createElement("p");
                note.className = "details-message";
                note.textContent =
                    "Showing saved details; could not check for updates.";
                body.append(note);
                return;
            }
            const message = document.createElement("p"),
                retry = document.createElement("button");
            message.className = "details-message";
            message.textContent = error.message;
            retry.type = "button";
            retry.className = "text-button";
            retry.textContent = "Try again";
            retry.addEventListener("click", load);
            body.replaceChildren(message, retry);
        } finally {
            if (controller === request) body.setAttribute("aria-busy", "false");
        }
    }

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        disposeAudio?.();
        disposeAudio = null;
        controller?.abort();
        dialog.classList.remove("is-visible");
        await Promise.allSettled(
            dialog.getAnimations().map((animation) => animation.finished),
        );
        if (dialog.open) dialog.close();
    }
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void close();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void close();
        }
    });
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
        )
            void close();
    });
    dialog.addEventListener("close", () => {
        disposeAudio?.();
        disposeAudio = null;
        controller?.abort();
        closing = false;
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = previousOverflow;
        body.replaceChildren();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
    return {
        open(selection, button) {
            if (dialog.open || closing) return;
            current = { ...selection };
            trigger = button;
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "chart-details",
                }),
            );
            previousOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            closeButton.focus({ preventScroll: true });
            void load();
        },
    };
}
