import {
    DIFFS,
    CLEARS,
    vf,
    average,
    performance,
    rolling,
    lineValue,
    visibleObservations,
    topCharts,
    summary,
    byTime,
    songCatalog,
    searchCharts,
    filterCharts,
    chartPlays,
    grade,
    volforceClass,
    playtimeText,
    timingText,
    timingHistogram,
    TIMING_OFFSETS,
} from "./metrics.js";
import { motion } from "./motion.js";

const $ = (id) => document.getElementById(id);
const STANDARD_START_YEN = 267;
const START_PRICES = [
    ["Light Start", 3, 206],
    ["Standard Start with EX-TRACK", 4, STANDARD_START_YEN],
    ["Premium Time (4 songs)", 4, 411],
];
const popupYen = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "JPY",
});
const yen = new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
});
let conversionCurrency = "EUR"; // Older deployed snapshots did not include currency.
let convertedMoney = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: conversionCurrency,
});
let exchangeRate = null,
    exchangeRateDate = "",
    rateLoading = false,
    rateAttempt = 0;

function renderSpending() {
    if (!data) return;
    const spending = (STANDARD_START_YEN * data.plays.length) / 4;
    const price = document.createElement("button");
    price.type = "button";
    price.className = "spending-price";
    price.textContent = yen.format(spending);
    price.setAttribute("aria-describedby", "spending-popup");
    price.setAttribute(
        "aria-label",
        `${yen.format(spending)} · View arcade spending estimates`,
    );
    price.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") showSpendingPopup();
    });
    price.addEventListener("pointerleave", scheduleSpendingHide);
    price.addEventListener("focus", showSpendingPopup);
    price.addEventListener("blur", scheduleSpendingHide);
    price.addEventListener("click", showSpendingPopup);
    $("spending-total").replaceChildren(price);
    setText(
        "spending-detail",
        `${exchangeRate === null ? "" : `≈ ${convertedMoney.format(spending * exchangeRate)} · `}Standard Start`,
    );
    $("spending-description").textContent =
        `${number(data.plays.length)} plays on an arcade cabinet corresponds to:`;
    $("spending-options").replaceChildren(
        ...START_PRICES.map(([label, songs, cost]) => {
            const amount = (data.plays.length / songs) * cost;
            const item = document.createElement("li");
            item.textContent = `${label}: ${popupYen.format(amount)}${exchangeRate === null ? "" : ` (≈ ${convertedMoney.format(amount * exchangeRate)})`}`;
            return item;
        }),
    );
}

function renderPlaytime() {
    const playtime = data.state.playtime;
    setText("playtime-total", playtimeText(playtime?.total_seconds));
    if (!playtime) {
        setText("playtime-detail", "Waiting for tracked gameplay");
        return;
    }
    setText(
        "playtime-detail",
        playtime.initial_seconds > 0
            ? `${playtimeText(playtime.initial_seconds)} + ${playtimeText(playtime.local_seconds)}`
            : `Based on ${number(playtime.plays)} ${playtime.plays === 1 ? "play" : "plays"}`,
    );
}

let spendingHideTimer,
    spendingCloseVersion = 0;
function hideSpendingPopup() {
    clearTimeout(spendingHideTimer);
    const popup = $("spending-popup");
    if (!popup.matches(":popover-open") || popup.classList.contains("closing"))
        return;
    const version = ++spendingCloseVersion;
    popup.classList.add("closing");
    Promise.allSettled(
        popup.getAnimations().map((animation) => animation.finished),
    ).then(() => {
        if (version !== spendingCloseVersion) return;
        popup.hidePopover();
        popup.classList.remove("closing");
    });
}
function scheduleSpendingHide() {
    clearTimeout(spendingHideTimer);
    spendingHideTimer = setTimeout(() => {
        if (!document.activeElement?.matches(".spending-price"))
            hideSpendingPopup();
    }, 150);
}
function showSpendingPopup() {
    clearTimeout(spendingHideTimer);
    const popup = $("spending-popup");
    const trigger = document.querySelector(".spending-price");
    if (!trigger) return;
    spendingCloseVersion++;
    popup.classList.remove("closing");
    popup.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, innerWidth - box.width - 12))}px`;
    const top =
        anchor.bottom + 10 + box.height <= innerHeight - 12
            ? anchor.bottom + 10
            : anchor.top - box.height - 10;
    popup.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`;
}

async function loadExchangeRate() {
    const requested = /^[A-Z]{3}$/.test(data?.state.currency || "")
        ? data.state.currency
        : "EUR";
    if (requested !== conversionCurrency) {
        conversionCurrency = requested;
        convertedMoney = new Intl.NumberFormat("en-IE", {
            style: "currency",
            currency: requested,
        });
        exchangeRate = null;
        exchangeRateDate = "";
        rateAttempt = 0;
        rateLoading = false;
        renderSpending();
    }
    if (requested === "JPY") {
        exchangeRate = null; // Yen spending is already displayed without conversion.
        renderSpending();
        return;
    }
    const retryAfter = exchangeRate === null ? 60000 : 3600000;
    if (rateLoading || Date.now() - rateAttempt < retryAfter) return;
    rateLoading = true;
    rateAttempt = Date.now();
    try {
        const response = await fetch(
            `https://api.frankfurter.dev/v2/rate/jpy/${requested.toLowerCase()}`,
            {
                signal: AbortSignal.timeout(5000),
            },
        );
        if (!response.ok) throw new Error("Rate unavailable");
        const result = await response.json();
        if (
            result.base !== "JPY" ||
            result.quote !== requested ||
            !Number.isFinite(result.rate) ||
            result.rate <= 0 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(result.date)
        )
            throw new Error("Invalid rate");
        if (requested !== conversionCurrency) return;
        exchangeRate = result.rate;
        exchangeRateDate = result.date;
        renderSpending();
    } catch {
        // Keep the yen amount (and any previously loaded conversion) available.
    } finally {
        if (requested === conversionCurrency) rateLoading = false;
    }
}
const escape = (value) =>
    String(value ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
const number = (value) => (value == null ? "—" : value.toLocaleString());
const date = (value) =>
    new Date(value).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
const shortDate = (value) =>
    new Date(value).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
    });
const clock = (value) =>
    new Date(value).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
const chartTitle = (p) => p.title || `Chart ${p.music_id}`;
const badge = (p) =>
    `<span class="difficulty-badge d${p.diff_idx}">${DIFFS[p.diff_idx]}${p.level ? " " + escape(p.level) : ""}</span>`;
const clear = (p) =>
    `<span class="clear-label ${p.clear_type === 6 ? "puc" : ""}">${CLEARS[p.clear_type] || "—"}</span>`;
const gradeMarkup = (score) => {
    const label = grade(score);
    return label === "—"
        ? label
        : `<img class="grade-icon" src="/assets/grades/${label.toLowerCase().replace("+", "-plus")}.png" alt="${label}" title="${label}">`;
};
let data = null,
    stats = null,
    view = "overview",
    days = 0,
    difficulty = 1,
    page = 0,
    loading = false;
let dataFingerprint = "";
const revealedViews = new Set();
let pendingScroll = null,
    scrollSaveTimer;
history.scrollRestoration = "manual";
const shown = new Set([
    "plays",
    "best",
    "avg10",
    "avg100",
    "threshold",
    "total",
]);
let hover = null;
let catalog = [],
    songs = new Map(),
    selected = null,
    leaderboardPage = 0,
    matches = [],
    activeMatch = -1;

function coverMarkup(p, size = "small") {
    const song = songs.get(p.music_id);
    const id = song?.difficulties.find((d) => d.diff_idx === p.diff_idx)?.cover;
    return `<span class="cover-tile ${size}">${id && /^[a-f0-9]{64}$/.test(id) ? `<img src="/api/cover?id=${id}" alt="${escape(song.title)} cover" loading="lazy" decoding="async">` : '<span class="cover-missing" aria-label="Cover unavailable">—</span>'}</span>`;
}
const chartButton = (p) =>
    `<button class="song-title open-chart" data-music="${p.music_id}" data-diff="${p.diff_idx}" title="View plays for ${escape(chartTitle(p))}">${escape(chartTitle(p))}</button>`;

function setText(id, value) {
    $(id).textContent = value;
}
function row(p, rank = null) {
    return `<div class="play-row chart-row" data-music="${p.music_id}" data-diff="${p.diff_idx}"><span class="row-index ${rank === 1 ? "leading" : ""}">${rank ? String(rank).padStart(2, "0") : clock(p.received_at)}</span>${coverMarkup(p)}<div>${chartButton(p)}<div class="song-details">${badge(p)}${clear(p)}</div></div><div class="row-values"><div class="row-vf">${vf(p.vf ?? p.play_vf)}</div><div class="row-score">${number(p.score)}</div></div></div>`;
}

function prepareLoading() {
    const placeholders = Array.from(
        { length: 3 },
        () =>
            '<div class="play-row loading-entry" aria-hidden="true"><span class="skeleton-shape skeleton-position"></span><span class="skeleton-shape skeleton-cover"></span><div><span class="skeleton-shape skeleton-title"></span><span class="skeleton-shape skeleton-detail"></span></div><div><span class="skeleton-shape skeleton-value"></span><span class="skeleton-shape skeleton-score"></span></div></div>',
    ).join("");
    $("recent-plays").innerHTML = placeholders;
    $("top-plays").innerHTML = placeholders;
    $("top-foot").textContent = "";
    $("records").innerHTML =
        `<tr class="record-loading-row"><td colspan="6">${placeholders}</td></tr>`;
    $("leaderboard-records").innerHTML =
        `<tr class="record-loading-row"><td colspan="5">${placeholders}</td></tr>`;
    for (const id of [
        "previous",
        "next",
        "leaderboard-previous",
        "leaderboard-next",
    ])
        $(id).disabled = true;
    if (view === "leaderboard") {
        $("selected-chart").hidden = !selected;
        if (selected)
            $("selected-chart").innerHTML =
                '<div class="selected-song" aria-hidden="true"><span class="cover-tile large skeleton-shape"></span><div class="selected-song-info"><div class="skeleton-shape skeleton-heading"></div><div class="skeleton-shape skeleton-detail"></div><div class="skeleton-shape skeleton-title"></div></div></div>';
        $("leaderboard-results").hidden = !selected;
        $("leaderboard-empty").hidden = !!selected;
    }
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const width = mobile ? 400 : 1100;
    for (const [id, height] of [
        ["chart", mobile ? 300 : 380],
        ["timing-chart", mobile ? 250 : 260],
    ]) {
        const svg = $(id);
        svg.removeAttribute("hidden");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.replaceChildren();
    }
}

function revealOnce(key, animate) {
    const firstVisit = !revealedViews.has(key);
    revealedViews.add(key);
    return animate && firstVisit;
}

function renderSummary({ animate = true } = {}) {
    stats = summary(data);
    const name = data.state.name || "Player";
    setText("player-name", name);
    document.title = `${name} · SOUND VOLTEX`;
    const dan = data.state.skill_level;
    const danBanner = $("dan-banner");
    danBanner.hidden = !(Number.isInteger(dan) && dan >= 1 && dan <= 12);
    if (!danBanner.hidden) {
        danBanner.src = `/assets/dan/${dan}.png`;
        danBanner.alt =
            dan === 12
                ? "∞ Dan"
                : `${dan}${dan === 1 ? "st" : dan === 2 ? "nd" : dan === 3 ? "rd" : "th"} Dan`;
    } else {
        danBanner.removeAttribute("src");
        danBanner.alt = "";
    }
    setText("total-vf", vf(stats.total));
    const appeal = data.state.appeal_card;
    const card = $("appeal-card");
    card.hidden = !(
        typeof appeal === "string" && /^[a-f0-9]{64}$/.test(appeal)
    );
    if (!card.hidden) card.src = `/api/cover?id=${appeal}`;
    else card.removeAttribute("src");
    const vfClass = volforceClass(stats.total);
    $("vf-class").hidden = !vfClass;
    if (vfClass) {
        setText("vf-class-name", vfClass.name);
        $("vf-class-icon").src = `/assets/vf-classes/${vfClass.number}.png`;
    }
    setText("best-vf", vf(stats.best));
    setText(
        "best-title",
        stats.top.length ? chartTitle(stats.top[0]) : "No saved charts yet",
    );
    setText("play-count", number(data.plays.length));
    setText(
        "play-detail",
        `${number(data.plays.filter((p) => p.clear_type > 1).length)} clears`,
    );
    renderSpending();
    renderPlaytime();
    setText("entry-vf", vf(stats.entry));
    setText(
        "entry-detail",
        stats.top.length === 50
            ? "in Top 50"
            : `${stats.top.length} / 50 charts recorded`,
    );
    const sorted = [...data.plays].sort(byTime);
    setText(
        "archive-dates",
        sorted.length
            ? `${date(sorted[0].received_at)} — ${date(sorted.at(-1).received_at)}`
            : "No plays yet",
    );
    const updated = data.state.updated_at || data.synced_at;
    setText(
        "updated",
        updated
            ? `Updated ${shortDate(updated)} ${clock(updated)}`
            : "Waiting for sync",
    );
    const latest = stats.sessions.at(-1) || [];
    setText(
        "session-meta",
        latest.length
            ? `${date(latest[0].received_at)} · ${clock(latest[0].received_at)}–${clock(latest.at(-1).received_at)} · ${latest.length} plays`
            : "No sessions recorded yet",
    );
    $("recent-plays").innerHTML = latest.length
        ? [...latest]
              .reverse()
              .slice(0, 5)
              .map((p) => row(p))
              .join("")
        : '<div class="empty-list">No plays yet.</div>';
    $("top-plays").innerHTML = stats.top.length
        ? stats.top
              .slice(0, 5)
              .map((p, i) => row(p, i + 1))
              .join("")
        : '<div class="empty-list">No saved charts.</div>';
    setText(
        "top-foot",
        stats.top.length
            ? `Top ${stats.top.length} average · ${vf(average(stats.top.map((p) => p.vf)))} VF`
            : "Your strongest saved charts",
    );
    renderSpark();
    if (animate) {
        motion.metrics(document.querySelector(".metrics"));
        for (const id of [
            "archive-dates",
            "updated",
            "session-meta",
            "top-foot",
        ])
            motion.data($(id));
        motion.data($("recent-plays"), ".play-row, .empty-list");
        motion.data($("top-plays"), ".play-row, .empty-list");
    }
}

const NS = "http://www.w3.org/2000/svg";
function svgElement(tag, attrs = {}, content) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => element.setAttribute(k, v));
    if (content !== undefined) element.textContent = content;
    return element;
}
function pathData(points, x, y, step = false) {
    if (!points.length) return "";
    return points
        .map((p, index) =>
            index === 0
                ? `M${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`
                : step
                  ? `H${x(p[0]).toFixed(2)}V${y(p[1]).toFixed(2)}`
                  : `L${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`,
        )
        .join(" ");
}
function renderSpark() {
    const points = [...data.observations].sort(byTime);
    if (points.length < 2) {
        $("spark").replaceChildren();
        return;
    }
    const low = Math.min(...points.map((p) => p.total_vf)),
        high = Math.max(...points.map((p) => p.total_vf));
    const start = Date.parse(points[0].timestamp),
        end = Date.parse(points.at(-1).timestamp);
    const svg = svgElement("svg", { viewBox: "0 0 92 36" });
    svg.append(
        svgElement("path", {
            d: pathData(
                points.map((p) => [Date.parse(p.timestamp), p.total_vf]),
                (t) => ((t - start) / (end - start || 1)) * 92,
                (v) => 33 - ((v - low) / (high - low || 1)) * 28,
                true,
            ),
            fill: "none",
            stroke: "#cba6f7",
            "stroke-width": 1.5,
        }),
    );
    $("spark").replaceChildren(svg);
}

function smoothTimingPath(points) {
    // Keep the decorative curve within neighboring bucket values, without overshoot.
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

function renderTimingHistogram({ animate = true } = {}) {
    const stats = timingHistogram(data.plays, { days, difficulty });
    const svg = $("timing-chart");
    svg.replaceChildren();
    svg.removeAttribute("aria-hidden");
    svg.toggleAttribute("hidden", !stats.hits);
    $("timing-empty").hidden = !!stats.hits;
    if (!stats.hits) {
        setText("timing-summary", "No recorded timing in this range.");
        return;
    }
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const width = mobile ? 400 : 1100,
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
        [left, "EARLY", "start"],
        [right, "LATE", "end"],
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
        `<strong>${number(stats.plays)}</strong> plays · <strong>${number(stats.hits)}</strong> notes · Average <strong>${timingText(stats.average)}</strong>`;
    motion.histogram(svg, animate);
    if (animate) motion.data($("timing-summary"));
}

function renderChart({ animate = true, transition = false } = {}) {
    if (!data) return;
    if (transition) {
        hideTooltip();
        hover = null;
        return motion.swap(
            [
                $("chart-wrap"),
                document.querySelector(".timing-chart-wrap"),
                $("chart-summary"),
                $("timing-summary"),
            ],
            () => renderChart({ animate: false }),
        );
    }
    animate = view === "overview" ? revealOnce("overview", animate) : false;
    if (!animate) {
        for (const id of [
            "chart",
            "timing-chart",
            "chart-summary",
            "timing-summary",
        ])
            // Keep the first reveal queued until this graph actually comes into view.
            if (!motion.isPending($(id))) motion.stop($(id));
    }
    const plays = performance(data.plays, { days, difficulty });
    renderTimingHistogram({ animate });
    const svg = $("chart");
    svg.replaceChildren();
    svg.removeAttribute("aria-hidden");
    hover = null;
    $("tooltip").hidden = true;
    $("chart-empty").hidden = !!plays.length;
    if (!plays.length) {
        setText(
            "chart-summary",
            "No cleared plays in this range. Try another range or difficulty.",
        );
        return;
    }
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const width = mobile ? 400 : 1100,
        height = mobile ? 300 : 380;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const left = mobile ? 52 : 69,
        right = width - (mobile ? 46 : 72),
        top = 33,
        bottom = height - 50;
    let start = Date.parse(plays[0].received_at),
        end = Date.parse(plays.at(-1).received_at);
    const lastObservation = data.observations.length
        ? Math.max(...data.observations.map((o) => Date.parse(o.timestamp)))
        : end;
    end = Math.max(end, lastObservation);
    if (start === end) {
        start -= 30000;
        end += 30000;
    }
    const observations = visibleObservations(data.observations, start, end);
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
        bottom - ((value - totalLow) / (totalHigh - totalLow)) * (bottom - top);
    svg.append(
        svgElement(
            "text",
            { x: right, y: 17, "text-anchor": "end", class: "axis-caption" },
            "CHART VF",
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
                "TOTAL VF",
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
                    vf(totalHigh - (i / gridCount) * (totalHigh - totalLow)),
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
    // Keep separate threshold segments when the Top 50 was not full.
    let segment = [];
    for (const o of observations) {
        if (o.minimum_vf === null) {
            if (segment.length) segment.push([o.time, segment.at(-1)[1]]);
            line("threshold", segment, "#a3a1b8", 1.2, y, true, "4 5");
            segment = [];
        } else segment.push([o.time, o.minimum_vf]);
    }
    line("threshold", segment, "#a3a1b8", 1.2, y, true, "4 5");
    let best = 0;
    const bestPoints = plays.map((p) => {
        best = Math.max(best, p.play_vf);
        return [Date.parse(p.received_at), best];
    });
    const avg10Points = rolling(plays, 10),
        avg100Points = rolling(plays, 100);
    const totalPoints = observations.map((o) => [o.time, o.total_vf]);
    line("best", bestPoints, "#777095", 1.5, y, true);
    if (shown.has("plays")) {
        const group = svgElement("g", { fill: "#8a71a6", opacity: 0.58 });
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
    line("avg10", avg10Points, "#8e73ad", 1.8);
    line("avg100", avg100Points, "#cba6f7", 2.8);
    line("total", totalPoints, "#bc7bc5", 1.6, ty, true);
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
            color: "#bc7bc5",
            step: true,
            y: ty,
        },
        {
            key: "avg100",
            label: "Avg 100",
            points: avg100Points,
            color: "#cba6f7",
            y,
        },
        {
            key: "avg10",
            label: "Avg 10",
            points: avg10Points,
            color: "#8e73ad",
            y,
        },
        {
            key: "best",
            label: "Best VF",
            points: bestPoints,
            color: "#777095",
            step: true,
            y,
        },
        {
            key: "threshold",
            label: "Top 50",
            points: observations.map((o) => [o.time, o.minimum_vf]),
            color: "#a3a1b8",
            step: true,
            y,
        },
    ];
    svg.append(crosshair, markers);
    hover = { series, x, start, end, left, right, crosshair, markers, width };
    $("chart-summary").innerHTML =
        `<strong>${number(plays.length)}</strong> plays · Best <strong>${vf(Math.max(...values))}</strong> · Average <strong>${vf(average(values))}</strong>`;
    motion.history(svg, animate);
    if (animate) motion.data($("chart-summary"));
}

$("chart").addEventListener("pointermove", (event) => {
    if (!hover) return;
    const bounds = $("chart").getBoundingClientRect();
    const px = ((event.clientX - bounds.left) / bounds.width) * hover.width;
    if (px < hover.left || px > hover.right) {
        hideTooltip();
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
                        stroke: "#1b1b29",
                        "stroke-width": 1.5,
                        "data-line": series.key,
                    }),
                );
            return `<div class="tooltip-line"><span><i class="dot ${series.key}"></i>${series.label}</span><b>${vf(value)}</b></div>`;
        });
    if (!lines.length) {
        hideTooltip();
        return;
    }
    const tooltip = $("tooltip");
    tooltip.innerHTML = `<strong>${date(time)} · ${clock(time)}</strong>${lines.join("")}`;
    tooltip.classList.remove("compact");
    tooltip.style.maxWidth = "";
    tooltip.hidden = false;
    const wrap = $("chart-wrap").getBoundingClientRect();
    const cursorX = event.clientX - wrap.left,
        cursorY = event.clientY - wrap.top;
    const gap = 12,
        inset = 8;
    const rightSpace = wrap.width - cursorX - gap - inset;
    const leftSpace = cursorX - gap - inset;
    const useRight =
        rightSpace >= tooltip.offsetWidth ||
        (leftSpace < tooltip.offsetWidth && rightSpace >= leftSpace);
    const available = useRight ? rightSpace : leftSpace;
    if (available < tooltip.offsetWidth) {
        tooltip.classList.add("compact");
        tooltip.style.maxWidth = `${available}px`;
    }
    tooltip.style.left = `${useRight ? cursorX + gap : cursorX - gap - tooltip.offsetWidth}px`;
    tooltip.style.top = `${Math.max(inset, Math.min(cursorY - tooltip.offsetHeight - gap, wrap.height - tooltip.offsetHeight - inset))}px`;
});
function hideTooltip() {
    $("tooltip").hidden = true;
    if (hover) {
        hover.crosshair.setAttribute("visibility", "hidden");
        hover.markers.replaceChildren();
    }
}
$("chart").addEventListener("pointerleave", hideTooltip);

function rememberScroll() {
    clearTimeout(scrollSaveTimer);
    if (pendingScroll) return;
    history.replaceState(
        {
            ...history.state,
            dashboardScroll: { x: scrollX, y: scrollY },
        },
        "",
    );
}

function restoreScroll(position) {
    if (!position) return;
    pendingScroll = position;
    if (!data) return;
    pendingScroll = null;
    window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
    rememberScroll();
}

function updateUrl(replace = false) {
    const params = new URLSearchParams();
    if (view === "overview") {
        if (days) params.set("days", days);
        if (difficulty !== 1) params.set("difficulty", difficulty);
        const series = [...document.querySelectorAll("[data-series]")]
            .map((button) => button.dataset.series)
            .filter((name) => shown.has(name));
        if (series.length !== 6) params.set("series", series.join(","));
    } else if (view === "leaderboard") {
        if (selected) {
            params.set("song", selected.music_id);
            params.set("diff", selected.diff_idx);
        }
        if (leaderboardPage) params.set("page", leaderboardPage + 1);
    } else {
        if (page) params.set("page", page + 1);
        if ($("search").value) params.set("q", $("search").value);
        const defaultSort = view === "top" ? "vf" : "recent";
        if ($("sort").value !== defaultSort)
            params.set("sort", $("sort").value);
    }
    const hash = `#${view}${params.size ? "?" + params.toString() : ""}`;
    if (location.hash !== hash)
        history[replace ? "replaceState" : "pushState"](
            { dashboardScroll: pendingScroll || { x: scrollX, y: scrollY } },
            "",
            hash,
        );
}

function restoreUrl() {
    const savedScroll = history.state?.dashboardScroll;
    const previousDays = days;
    const previousChart = JSON.stringify([difficulty, [...shown]]);
    const [route, query = ""] = location.hash.slice(1).split("?");
    const next = ["overview", "top", "history", "leaderboard"].includes(route)
        ? route
        : "overview";
    const params = new URLSearchParams(query);
    const pageNumber = Number(params.get("page"));
    const restoredPage =
        Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : 0;
    days = [0, 7, 30, 90].includes(Number(params.get("days")))
        ? Number(params.get("days"))
        : 0;
    difficulty =
        params.has("difficulty") &&
        [0, 1, 2, 4].includes(Number(params.get("difficulty")))
            ? Number(params.get("difficulty"))
            : 1;
    shown.clear();
    const series = params.has("series")
        ? params.get("series").split(",")
        : ["plays", "best", "avg10", "avg100", "threshold", "total"];
    document.querySelectorAll("[data-series]").forEach((button) => {
        if (series.includes(button.dataset.series))
            shown.add(button.dataset.series);
        button.setAttribute(
            "aria-pressed",
            String(shown.has(button.dataset.series)),
        );
    });
    document
        .querySelectorAll("[data-days]")
        .forEach((button) =>
            button.classList.toggle(
                "selected",
                Number(button.dataset.days) === days,
            ),
        );
    $("difficulty").value = String(difficulty);
    const musicId = Number(params.get("song")),
        diff = Number(params.get("diff"));
    selected =
        next === "leaderboard" &&
        params.has("diff") &&
        Number.isSafeInteger(musicId) &&
        musicId > 0 &&
        Number.isInteger(diff) &&
        diff >= 0 &&
        diff < DIFFS.length
            ? { music_id: musicId, diff_idx: diff }
            : null;
    leaderboardPage = next === "leaderboard" ? restoredPage : 0;
    closeMatches();
    $("song-query").value =
        selected && songs.has(musicId)
            ? `${songs.get(musicId).title} ${DIFFS[diff]}`
            : "";
    if (data && next === "overview" && view === "overview") {
        if (days !== previousDays) renderChart({ transition: true });
        else if (previousChart !== JSON.stringify([difficulty, [...shown]]))
            renderChart();
    } else switchView(next, false, { animate: false });
    if (["top", "history"].includes(next)) {
        page = restoredPage;
        $("search").value = params.get("q") || "";
        const sort = params.get("sort");
        if (["vf", "score", "recent", "plays"].includes(sort))
            $("sort").value = sort;
        renderTable({ animate: false });
    }
    restoreScroll(savedScroll);
}

function switchView(next, recordHistory = true, { animate = true } = {}) {
    if (recordHistory) {
        pendingScroll = null;
        rememberScroll();
    }
    view = next;
    page = 0;
    document.querySelectorAll(".tab").forEach((button) => {
        const active = button.dataset.view === view;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    $("overview-view").hidden = view !== "overview";
    $("records-view").hidden = !["top", "history"].includes(view);
    $("leaderboard-view").hidden = view !== "leaderboard";
    $("search").value = "";
    $("sort").value = view === "top" ? "vf" : "recent";
    if (view === "overview") renderChart({ animate });
    else if (view === "leaderboard") renderLeaderboard({ animate });
    else renderTable({ animate });
    if (!data && loading) prepareLoading();
    if (recordHistory) updateUrl();
}

function renderTable({ animate = true } = {}) {
    const top = view === "top";
    setText("records-title", top ? "Top 50 charts" : "Play history");
    setText(
        "records-description",
        top ? "Ranked by VF." : "All tracked plays, including crashes.",
    );
    setText("first-column", top ? "Rank" : "Played");
    if (!data) return;
    animate = revealOnce(view, animate);
    if (!animate) {
        for (const id of ["records", "page-info", "result-count"])
            motion.stop($(id));
    }
    const query = $("search").value;
    const source = top
        ? topCharts(data.state).map((p, i) => ({ ...p, rank: i + 1 }))
        : data.plays;
    let records = filterCharts(source, catalog, query);
    const sort = $("sort").value;
    const playCounts = new Map();
    const chartKey = (p) => `${p.music_id}:${p.diff_idx}`;
    if (sort === "plays") {
        for (const play of data.plays) {
            const key = chartKey(play);
            playCounts.set(key, (playCounts.get(key) || 0) + 1);
        }
    }
    records = [...records].sort(
        sort === "vf"
            ? (a, b) => (b.vf ?? b.play_vf) - (a.vf ?? a.play_vf)
            : sort === "score"
              ? (a, b) => (b.score ?? -1) - (a.score ?? -1)
              : sort === "plays"
                ? (a, b) =>
                      (playCounts.get(chartKey(b)) || 0) -
                          (playCounts.get(chartKey(a)) || 0) ||
                      (top ? a.rank - b.rank : byTime(b, a))
                : (a, b) => (top ? a.rank - b.rank : byTime(b, a)),
    );
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(records.length / pageSize));
    page = Math.min(page, pages - 1);
    const chunk = records.slice(page * pageSize, (page + 1) * pageSize);
    $("records").innerHTML = chunk.length
        ? chunk
              .map(
                  (p) =>
                      `<tr class="chart-row" data-music="${p.music_id}" data-diff="${p.diff_idx}"><td class="row-index">${top ? String(p.rank).padStart(2, "0") : `${shortDate(p.received_at)}<br>${clock(p.received_at)}`}</td><td><div class="table-song">${coverMarkup(p)}<div>${chartButton(p)}<div class="artist">${escape(p.artist)}</div></div></div></td><td>${badge(p)}</td><td class="score-cell">${number(p.score)}</td><td>${clear(p)}</td><td class="right vf-cell">${vf(p.vf ?? p.play_vf)}</td></tr>`,
              )
              .join("")
        : '<tr><td colspan="6">No matching charts.</td></tr>';
    setText(
        "result-count",
        `${number(records.length)} ${top ? "charts" : "plays"}`,
    );
    setText("page-info", `PAGE ${page + 1} / ${pages}`);
    $("previous").disabled = page === 0;
    $("next").disabled = page + 1 >= pages;
    if (animate) {
        motion.data($("records"), ".chart-row, tr:not(.chart-row)");
        motion.data($("page-info"));
        motion.data($("result-count"));
    }
}

function closeMatches() {
    $("song-options").hidden = true;
    $("song-query").setAttribute("aria-expanded", "false");
    $("song-query").removeAttribute("aria-activedescendant");
    activeMatch = -1;
}

function renderMatches() {
    if (!data) return;
    matches = searchCharts(catalog, $("song-query").value);
    activeMatch = -1;
    const list = $("song-options");
    list.innerHTML = matches.length
        ? matches
              .map(
                  (p, index) =>
                      `<button type="button" role="option" id="song-option-${index}" aria-selected="false" tabindex="-1" class="song-option" data-option="${index}">${coverMarkup(p)}<span class="option-song"><span>${escape(chartTitle(p))}</span><small>${escape(p.artist)}</small></span>${badge(p)}</button>`,
              )
              .join("")
        : '<div class="search-empty">No matching song.</div>';
    list.hidden = false;
    $("song-query").setAttribute("aria-expanded", "true");
    $("song-query").removeAttribute("aria-activedescendant");
}

function selectChart(musicId, diff, { animate = true } = {}) {
    const song = songs.get(musicId);
    if (!song) return;
    rememberScroll();
    selected = { music_id: musicId, diff_idx: diff };
    leaderboardPage = 0;
    $("song-query").value = `${song.title} ${DIFFS[diff]}`;
    closeMatches();
    if (view !== "leaderboard") switchView("leaderboard", true, { animate });
    else {
        renderLeaderboard({ animate });
        updateUrl();
    }
}

const expandedJudgements = new Set();
const judgementKey = (play) =>
    JSON.stringify([
        play.received_at,
        play.music_id,
        play.diff_idx,
        play.score,
        play.clear_type,
    ]);

function judgementDetails(play) {
    const fields = [
        ["s_critical", "S-CRITICAL"],
        ["critical", "CRITICAL"],
        ["near", "NEAR"],
        ["error", "ERROR"],
        ["timing", "TIMING"],
    ];
    const count = (key) =>
        Number.isSafeInteger(play.judgments?.[key])
            ? number(play.judgments[key])
            : "—";
    if (
        ![...fields.map(([key]) => key), "early_near", "late_near"].some(
            (key) => Number.isSafeInteger(play.judgments?.[key]),
        ) &&
        !Number.isFinite(play.timing)
    )
        return '<p class="judgements-unavailable">Judgements weren’t recorded for this play.</p>';
    return `<dl class="judgement-counts">${fields
        .map(([key, label]) =>
            key === "timing"
                ? `<div class="judgement-timing"><dt>${label}</dt><dd title="Positive = early; negative = late">${timingText(play.timing)}</dd></div>`
                : key === "near"
                  ? `<div><dt>${label}</dt><dd title="Early · Late" aria-label="Early Near ${count("early_near")}, Late Near ${count("late_near")}">${count("early_near")} · ${count("late_near")}</dd></div>`
                  : `<div><dt>${label}</dt><dd>${count(key)}</dd></div>`,
        )
        .join("")}</dl>`;
}

function renderLeaderboard({ animate = true } = {}) {
    if (!data) return;
    if (selected) animate = revealOnce(`song:${selected.music_id}`, animate);
    if (!animate) {
        for (const id of [
            "selected-chart",
            "leaderboard-records",
            "leaderboard-page-info",
        ])
            motion.stop($(id));
    }
    $("selected-chart").hidden = !selected;
    $("leaderboard-empty").hidden = !!selected;
    $("leaderboard-results").hidden = !selected;
    if (!selected) return;
    const song = songs.get(selected.music_id);
    if (
        !song ||
        !song.difficulties.some((d) => d.diff_idx === selected.diff_idx)
    ) {
        $("selected-chart").hidden = true;
        $("leaderboard-results").hidden = true;
        $("leaderboard-empty").hidden = false;
        return;
    }
    if (!$("song-query").value)
        $("song-query").value = `${song.title} ${DIFFS[selected.diff_idx]}`;
    const plays = chartPlays(data, selected.music_id, selected.diff_idx);
    const saved = data.state.charts.find(
        (c) =>
            c.music_id === selected.music_id &&
            c.diff_idx === selected.diff_idx,
    );
    const mark =
        saved?.clear_type ??
        (plays.length ? Math.max(...plays.map((p) => p.clear_type)) : null);
    $("selected-chart").innerHTML =
        `<div class="selected-song">${coverMarkup(selected, "large")}<div class="selected-song-info"><h3>${escape(song.title)}</h3><p>${escape(song.artist)}</p><div class="selected-chart-details"><div class="difficulty-tabs" role="group" aria-label="Song difficulty">${song.difficulties.map((d) => `<button class="${d.diff_idx === selected.diff_idx ? "selected" : ""}" data-chart-diff="${d.diff_idx}" aria-pressed="${d.diff_idx === selected.diff_idx}">${DIFFS[d.diff_idx]} <span>${d.level ?? "—"}</span></button>`).join("")}</div><div class="selected-summary"><span>Clear mark: ${mark === null ? "—" : CLEARS[mark]}</span><span>${plays.length} ${plays.length === 1 ? "play" : "plays"}</span><span>Best VF: ${vf(plays.length ? Math.max(...plays.map((p) => p.play_vf)) : null)}</span></div></div></div></div>`;
    const pages = Math.max(1, Math.ceil(plays.length / 10));
    leaderboardPage = Math.min(leaderboardPage, pages - 1);
    const chunk = plays.slice(leaderboardPage * 10, (leaderboardPage + 1) * 10);
    $("leaderboard-records").innerHTML = chunk.length
        ? chunk
              .map((p, index) => {
                  const key = judgementKey(p);
                  const expanded = expandedJudgements.has(key);
                  return `<tr class="leaderboard-entry" data-judgements="${index}" data-judgement-key="${escape(key)}" data-play-vf="${p.play_vf}"><td class="row-index">${leaderboardPage * 10 + index + 1}</td><td class="score-cell"><button type="button" class="score-with-grade judgement-toggle" aria-expanded="${expanded}" aria-controls="judgements-${index}" aria-label="${expanded ? "Hide" : "Show"} judgements for score ${number(p.score)}">${gradeMarkup(p.score)}<span>${number(p.score)}</span><svg class="judgement-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></td><td>${clear(p)}</td><td class="played-date">${date(p.received_at)} <span>${clock(p.received_at)}</span></td><td class="right vf-cell">${vf(p.play_vf)}</td></tr><tr id="judgements-${index}" class="judgement-row" ${expanded ? "" : "hidden"}><td colspan="5">${judgementDetails(p)}</td></tr>`;
              })
              .join("")
        : '<tr><td colspan="5">No recorded nonzero plays for this chart yet.</td></tr>';
    setText(
        "leaderboard-page-info",
        `${plays.length} plays · Page ${leaderboardPage + 1} / ${pages}`,
    );
    $("leaderboard-previous").disabled = leaderboardPage === 0;
    $("leaderboard-next").disabled = leaderboardPage + 1 >= pages;
    if (animate) {
        motion.data(
            $("selected-chart"),
            ".cover-tile.large, .selected-song-info",
        );
        motion.data(
            $("leaderboard-records"),
            ".leaderboard-entry, .judgement-row:not([hidden])",
        );
        motion.data($("leaderboard-page-info"));
    }
}

$("leaderboard-records").addEventListener("click", (event) => {
    const row = event.target.closest(".leaderboard-entry");
    if (!row) return;
    const button = row.querySelector(".judgement-toggle");
    const details = $(button.getAttribute("aria-controls"));
    details.hidden = !details.hidden;
    if (details.hidden) expandedJudgements.delete(row.dataset.judgementKey);
    else {
        expandedJudgements.add(row.dataset.judgementKey);
        motion.data(
            details,
            ".judgement-counts > div, .judgements-unavailable",
        );
    }
    button.setAttribute("aria-expanded", String(!details.hidden));
    button.setAttribute(
        "aria-label",
        `${details.hidden ? "Show" : "Hide"} judgements for score ${row.querySelector(".score-with-grade span").textContent}`,
    );
});

$("song-query").addEventListener("input", renderMatches);
$("song-query").addEventListener("focus", renderMatches);
$("song-query").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        event.preventDefault();
        closeMatches();
        return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if ($("song-options").hidden) renderMatches();
        if (!matches.length) return;
        activeMatch =
            (activeMatch +
                (event.key === "ArrowDown" ? 1 : -1) +
                matches.length) %
            matches.length;
        $("song-options")
            .querySelectorAll('[role="option"]')
            .forEach((button, index) =>
                button.setAttribute(
                    "aria-selected",
                    String(index === activeMatch),
                ),
            );
        const option = $(`song-option-${activeMatch}`);
        $("song-query").setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
        event.preventDefault();
        if (!$("song-options").hidden && matches.length) {
            const match = matches[Math.max(0, activeMatch)];
            selectChart(match.music_id, match.diff_idx);
        }
    } else if (event.key === "Tab") closeMatches();
});
$("song-options").addEventListener("mousedown", (event) =>
    event.preventDefault(),
);
$("song-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-option]");
    if (button) {
        const match = matches[Number(button.dataset.option)];
        selectChart(match.music_id, match.diff_idx);
    }
});
document.addEventListener("click", (event) => {
    if (!event.target.closest(".song-search")) closeMatches();
    const button = event.target.closest(".open-chart, .chart-row");
    if (button)
        selectChart(Number(button.dataset.music), Number(button.dataset.diff));
    const diff = event.target.closest("[data-chart-diff]");
    if (
        diff &&
        selected &&
        Number(diff.dataset.chartDiff) !== selected.diff_idx
    )
        selectChart(selected.music_id, Number(diff.dataset.chartDiff), {
            animate: false,
        });
});
document.addEventListener(
    "error",
    (event) => {
        if (event.target.matches?.(".cover-tile img"))
            event.target.hidden = true;
    },
    true,
);
$("leaderboard-previous").addEventListener("click", () => {
    leaderboardPage--;
    renderLeaderboard();
    updateUrl();
});
$("leaderboard-next").addEventListener("click", () => {
    leaderboardPage++;
    renderLeaderboard();
    updateUrl();
});

async function load() {
    if (loading) return;
    loading = true;
    document.body.dataset.loading = data ? "refresh" : "initial";
    $("main").setAttribute("aria-busy", "true");
    setText("load-status-label", data ? "Updating…" : "Loading records…");
    if (!data) prepareLoading();
    try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const next = await response.json();
        if (
            !Array.isArray(next.plays) ||
            !Array.isArray(next.observations) ||
            !next.state ||
            !Array.isArray(next.state.charts)
        )
            throw new Error("Invalid data");
        const fingerprint = JSON.stringify([
            next.plays,
            next.observations,
            next.state,
        ]);
        const animate = !data || fingerprint !== dataFingerprint;
        dataFingerprint = fingerprint;
        data = next;
        catalog = songCatalog(data);
        songs = new Map(catalog.map((song) => [song.music_id, song]));
        $("notice").hidden = true;
        renderSummary({ animate });
        void loadExchangeRate();
        renderChart({ animate });
        if (view === "leaderboard") renderLeaderboard({ animate });
        else if (view !== "overview") renderTable({ animate });
        document.body.dataset.ready = "true";
        restoreScroll(pendingScroll);
    } catch {
        setText(
            "notice",
            data
                ? "Could not update. Showing the last loaded records. Retrying automatically."
                : "No data available. Try again after syncing.",
        );
        $("notice").hidden = false;
        if (!data) {
            setText("chart-summary", "Waiting for your archive.");
            setText("archive-dates", "No history loaded");
            for (const id of ["recent-plays", "top-plays"])
                $(id).innerHTML =
                    '<div class="empty-list">No data available yet.</div>';
            $("records").innerHTML =
                '<tr><td colspan="6">No data available yet.</td></tr>';
            $("leaderboard-records").innerHTML =
                '<tr><td colspan="5">No data available yet.</td></tr>';
            $("selected-chart").hidden = true;
            setText("timing-summary", "Waiting for timing data.");
            for (const id of ["chart", "timing-chart"]) $(id).replaceChildren();
        }
    } finally {
        loading = false;
        delete document.body.dataset.loading;
        $("main").setAttribute("aria-busy", "false");
    }
}

document.querySelector(".brand").addEventListener("click", (event) => {
    if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    event.preventDefault();
    switchView("overview");
});

document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
        if (button.dataset.view === "leaderboard") {
            selected = null;
            leaderboardPage = 0;
            $("song-query").value = "";
            closeMatches();
        }
        switchView(button.dataset.view);
    }),
);
document.querySelectorAll("[data-days]").forEach((button) =>
    button.addEventListener("click", () => {
        const nextDays = Number(button.dataset.days);
        if (days === nextDays) return;
        days = nextDays;
        document
            .querySelectorAll("[data-days]")
            .forEach((b) => b.classList.toggle("selected", b === button));
        renderChart({ transition: true });
        updateUrl();
    }),
);
document.querySelectorAll("[data-series]").forEach((button) =>
    button.addEventListener("click", () => {
        const series = button.dataset.series;
        if (shown.has(series)) shown.delete(series);
        else shown.add(series);
        button.setAttribute("aria-pressed", String(shown.has(series)));
        renderChart();
        updateUrl();
    }),
);
$("difficulty").addEventListener("change", () => {
    difficulty = Number($("difficulty").value);
    renderChart();
    updateUrl();
});
$("search").addEventListener("input", () => {
    page = 0;
    renderTable({ animate: false });
    updateUrl(true);
});
$("sort").addEventListener("change", () => {
    rememberScroll();
    page = 0;
    renderTable();
    updateUrl();
});
$("previous").addEventListener("click", () => {
    rememberScroll();
    page--;
    renderTable();
    updateUrl();
});
$("next").addEventListener("click", () => {
    rememberScroll();
    page++;
    renderTable();
    updateUrl();
});
$("all-plays").addEventListener("click", () => switchView("history"));
$("all-top").addEventListener("click", () => switchView("top"));
$("export").addEventListener("click", () => {
    if (!data) return;
    const payload = view === "top" ? topCharts(data.state) : data.plays;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
        }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `sdvx-${view}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
});
let chartWidth = innerWidth;
window.addEventListener("resize", () => {
    if (innerWidth === chartWidth) return;
    chartWidth = innerWidth;
    renderChart({ animate: false });
});
setInterval(() => {
    if (!document.hidden) load();
}, 60000);
window.addEventListener("popstate", restoreUrl);
window.addEventListener("hashchange", restoreUrl);
window.addEventListener(
    "scroll",
    () => {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(rememberScroll, 120);
    },
    { passive: true },
);
$("spending-popup").addEventListener("pointerenter", () =>
    clearTimeout(spendingHideTimer),
);
$("spending-popup").addEventListener("pointerleave", scheduleSpendingHide);
document.addEventListener("click", (event) => {
    if (!event.target.closest(".spending-price, #spending-popup"))
        hideSpendingPopup();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSpendingPopup();
});
window.addEventListener(
    "scroll",
    (event) => {
        if (event.target !== $("spending-popup")) hideSpendingPopup();
    },
    { capture: true, passive: true },
);
window.addEventListener("resize", hideSpendingPopup);
restoreUrl();
updateUrl(true);
load();
