import { createArchiveLoader } from "./archive.js";
import { createPlayHighlights, subscribeArchive } from "./live.js";
import { initSearchTools, dismissSearchKeyboard } from "./search-tools.js";
import { setSearchData, parseSearch } from "./search-query.js";
import { createLibrary } from "./library.js";
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
    searchSongs,
    recordList,
    chartKey,
    paginate,
    PAGE_SIZE,
    chartPlays,
    grade,
    volforceClass,
    playtimeText,
    timingText,
    timingHistogram,
    TIMING_OFFSETS,
} from "./metrics.js";
import {
    motion,
    initSegmentedControl,
    initSegmentedControls,
} from "./motion.js";
import { svgElement, pathData } from "./svg.js";
import { createCalculator } from "./calculator.js";
import { createAppealCardHelper } from "./appeal-cards.js";
import { createVolforceHelper } from "./volforce-helper.js";
import { radarMarkup, paintRadar } from "./radar.js";
import { createSimilarCharts } from "./similar-charts.js";
import { createChartViewer } from "./chart-viewer.js";
import { createChartDetails } from "./chart-details.js";

const $ = (id) => document.getElementById(id);
const playHighlights = createPlayHighlights();
let highlightCleanup,
    highlightPending = false;
function newPlayAttributes(play) {
    const age = playHighlights.age(play);
    if (age === null) return "";
    if (!highlightPending) {
        highlightPending = true;
        queueMicrotask(() => {
            highlightPending = false;
            clearExpiredHighlights();
        });
    }
    return `data-new-play-until="${Date.now() + playHighlights.duration - age}"`;
}
function clearExpiredHighlights() {
    clearTimeout(highlightCleanup);
    for (const element of document.querySelectorAll("[data-new-play-until]")) {
        if (Number(element.dataset.newPlayUntil) <= Date.now()) {
            delete element.dataset.newPlayUntil;
            element.style.removeProperty("--new-play-age");
        } else {
            const age =
                playHighlights.duration -
                (Number(element.dataset.newPlayUntil) - Date.now());
            element.style.setProperty(
                "--new-play-age",
                `-${Math.max(0, age)}ms`,
            );
        }
    }
    const next = playHighlights.nextExpiry();
    if (next !== null && next > Date.now())
        highlightCleanup = setTimeout(
            clearExpiredHighlights,
            next - Date.now() + 10,
        );
}
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

const popupVersions = new WeakMap();
function hideAnimatedPopup(popup) {
    if (!popup.matches(":popover-open") || popup.classList.contains("closing"))
        return;
    const version = (popupVersions.get(popup) || 0) + 1;
    popupVersions.set(popup, version);
    popup.classList.add("closing");
    Promise.allSettled(
        popup.getAnimations().map((animation) => animation.finished),
    ).then(() => {
        if (version !== popupVersions.get(popup)) return;
        popup.hidePopover();
        popup.classList.remove("closing");
    });
}
function showAnimatedPopup(popup, trigger) {
    popupVersions.set(popup, (popupVersions.get(popup) || 0) + 1);
    popup.classList.remove("closing");
    popup.showPopover();
    positionPopup(popup, trigger);
}

let spendingHideTimer;
function hideSpendingPopup() {
    clearTimeout(spendingHideTimer);
    hideAnimatedPopup($("spending-popup"));
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
    showAnimatedPopup(popup, trigger);
}

function positionPopup(popup, trigger) {
    const anchor = trigger.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, innerWidth - box.width - 12))}px`;
    const top =
        anchor.bottom + 10 + box.height <= innerHeight - 12
            ? anchor.bottom + 10
            : anchor.top - box.height - 10;
    popup.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`;
}

let songReadingHideTimer;
function hideSongReadingPopup() {
    clearTimeout(songReadingHideTimer);
    hideAnimatedPopup($("song-reading-popup"));
}
function scheduleSongReadingHide() {
    clearTimeout(songReadingHideTimer);
    songReadingHideTimer = setTimeout(() => {
        if (!document.activeElement?.matches(".song-reading-title"))
            hideSongReadingPopup();
    }, 150);
}
function bindSongReadingPopup(reading) {
    const title = document.querySelector(".song-reading-title");
    if (!title || !reading) return;
    const show = () => {
        clearTimeout(songReadingHideTimer);
        const popup = $("song-reading-popup");
        popup.textContent = reading;
        showAnimatedPopup(popup, title);
    };
    title.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") show();
    });
    title.addEventListener("pointerleave", scheduleSongReadingHide);
    title.addEventListener("focus", show);
    title.addEventListener("blur", scheduleSongReadingHide);
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
const formatRank = (rank) => String(rank).padStart(2, "0");
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
const appealHelper = createAppealCardHelper(() => data?.state);
createVolforceHelper(() => stats?.total);
const revealedViews = new Set();
const defaultRecordSorts = { top: "vf", history: "recent" };
const recordStates = {
    top: { query: "", page: 0, sort: defaultRecordSorts.top },
    history: { query: "", page: 0, sort: defaultRecordSorts.history },
};
const calculator = createCalculator(
    () => stats,
    row,
    (musicId, diff) => (data ? chartPlays(data, musicId, diff) : []),
);
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
    songSearchPage = 0,
    matches = [],
    activeMatch = -1;
let cleanupDifficultyControl = null;
const chartDetails = createChartDetails(
    () => data?.source === "local",
    chartSongMarkup,
);
const chartViewer = createChartViewer();
const songLibrary = createLibrary(
    () => data,
    () => catalog,
    (song) =>
        `${coverMarkup(song)}<span class="option-song"><span>${escape(song.title)}</span><small>${escape(song.artist)}</small></span>${difficultyRange(song)}`,
    (mid, diff) => selectChart(mid, diff),
    badge,
);
const similarCharts = createSimilarCharts(
    () => catalog,
    (chart) =>
        `<div class="similar-chart-main">${coverMarkup(chart)}<div class="similar-chart-info"><a class="similar-chart-title" href="#search?song=${chart.music_id}&diff=${chart.diff_idx}">${escape(chart.title)}</a><span class="similar-chart-artist">${escape(chart.artist)}</span><span>${badge(chart)}</span>${chartSummaryMarkup(chart)}</div><div class="similar-chart-audio"></div></div>`,
    (musicId, diff) => {
        selectChart(musicId, diff);
        $("selected-chart")
            .querySelector("[data-similar-charts]")
            ?.focus({ preventScroll: true });
    },
    chartSongMarkup,
);

function chartSongMarkup(chart) {
    return `${coverMarkup(chart, "chart-viewer-jacket")}<div class="chart-viewer-song-info"><div class="chart-viewer-song-title">${escape(chart.title)}</div><div class="chart-viewer-song-artist">${escape(chart.artist)}</div>${badge(chart)}</div>`;
}

const searchTools = initSearchTools(() => {
    if (!data) return;
    if (view === "search" && !$("song-options").hidden) renderMatches();
    if (["top", "history"].includes(view)) renderTable({ animate: false });
    songLibrary.update();
});

function coverMarkup(p, size = "small") {
    const song = songs.get(p.music_id);
    const id = song?.difficulties.find((d) => d.diff_idx === p.diff_idx)?.cover;
    return `<span class="cover-tile ${size}">${id && /^[a-f0-9]{64}$/.test(id) ? `<img src="/api/cover?id=${id}" alt="${escape(song.title)} cover" loading="lazy" decoding="async">` : '<span class="cover-missing" aria-label="Cover unavailable">—</span>'}</span>`;
}
const chartButton = (p) =>
    `<button class="song-title open-chart" data-music="${p.music_id}" data-diff="${p.diff_idx}" title="View plays for ${escape(chartTitle(p))}">${escape(chartTitle(p))}</button>`;

function chartInfo(p, { artist = false, detailsClass = "" } = {}) {
    return `<div class="entry-song-info">${chartButton(p)}${artist ? `<div class="artist">${escape(p.artist)}</div>` : ""}<div class="song-details ${detailsClass}">${badge(p)}${clear(p)}</div></div>`;
}

function setText(id, value) {
    $(id).textContent = value;
}

function chartSummaryMarkup(
    chart,
    plays = chartPlays(data, chart.music_id, chart.diff_idx),
) {
    const saved = data.state.charts.find(
        (record) =>
            record.music_id === chart.music_id &&
            record.diff_idx === chart.diff_idx,
    );
    const mark =
        saved?.clear_type ??
        (plays.length ? Math.max(...plays.map((play) => play.clear_type)) : null);
    const averageTiming = average(
        data.plays
            .filter(
                (play) =>
                    play.music_id === chart.music_id &&
                    play.diff_idx === chart.diff_idx &&
                    Number.isFinite(play.timing),
            )
            .map((play) => play.timing),
    );
    return `<div class="selected-summary"><span>Clear mark: ${mark === null ? "—" : CLEARS[mark]}</span><span>${plays.length} ${plays.length === 1 ? "play" : "plays"}</span><span>Best VF: ${vf(plays.length ? Math.max(...plays.map((play) => play.play_vf)) : null)}</span><span>Timing: ${timingText(averageTiming)}</span></div>`;
}

function playAttributes(play) {
    return `data-play="${escape(
        JSON.stringify({
            received_at: play.received_at,
            score: play.score,
            clear_type: play.clear_type,
        }),
    )}"`;
}

function row(p, rank = null) {
    return `<div class="play-row chart-row" ${rank === null ? newPlayAttributes(p) : ""} ${playAttributes(p)} data-music="${p.music_id}" data-diff="${p.diff_idx}"><span class="row-index">${rank !== null ? formatRank(rank) : clock(p.received_at)}</span>${coverMarkup(p)}${chartInfo(p)}<div class="row-values"><div class="row-vf">${vf(p.vf ?? p.play_vf)}</div><div class="row-score">${number(p.score)}</div></div></div>`;
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
    $("song-search-records").innerHTML =
        `<tr class="record-loading-row"><td colspan="5">${placeholders}</td></tr>`;
    for (const id of [
        "previous",
        "next",
        "first-page",
        "last-page",
        "records-page-number",
        "song-search-previous",
        "song-search-next",
    ])
        $(id).disabled = true;
    if (view === "search") {
        $("selected-chart").hidden = !selected;
        if (selected)
            $("selected-chart").innerHTML =
                '<div class="selected-song" aria-hidden="true"><span class="cover-tile large skeleton-shape"></span><div class="selected-song-info"><div class="skeleton-shape skeleton-heading"></div><div class="skeleton-shape skeleton-detail"></div><div class="skeleton-shape skeleton-title"></div></div></div>';
        $("song-search-results").hidden = !selected;
        $("song-search-empty").hidden = !!selected;
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
    $("dan-library-open").hidden = danBanner.hidden;
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
    $("total-vf").setAttribute(
        "aria-label",
        `${vf(stats.total)} VolForce · View classes`,
    );
    const appeal = data.state.appeal_card;
    const card = $("appeal-card");
    card.hidden = !(
        typeof appeal === "string" && /^[a-f0-9]{64}$/.test(appeal)
    );
    if (!card.hidden) card.src = `/api/cover?id=${appeal}`;
    else card.removeAttribute("src");
    $("appeal-helper-open").hidden = card.hidden;
    const vfClass = volforceClass(stats.total);
    $("vf-class").hidden = !vfClass;
    if (vfClass) {
        setText("vf-class-name", vfClass.name);
        $("vf-class").setAttribute(
            "aria-label",
            `${vfClass.name} · View VolForce classes`,
        );
        $("vf-class-icon").src = `/assets/vf-classes/${vfClass.number}.png`;
    }
    setText("best-vf", vf(stats.best));
    const bestChart = stats.top[0];
    if (bestChart) {
        const song = songs.get(bestChart.music_id);
        const level =
            song?.difficulties.find(
                (chart) => chart.diff_idx === bestChart.diff_idx,
            )?.level ?? bestChart.level;
        const label = `${song?.artist ?? bestChart.artist ?? ""} - ${song?.title ?? chartTitle(bestChart)} (${DIFFS[bestChart.diff_idx]} ${level ?? "—"})`;
        const link = document.createElement("button");
        link.type = "button";
        link.className = "metric-chart-link open-chart";
        link.dataset.music = bestChart.music_id;
        link.dataset.diff = bestChart.diff_idx;
        link.textContent = label;
        link.title = label;
        $("best-title").replaceChildren(link);
    } else setText("best-title", "No saved charts yet");
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
            ? `Tracking since ${date(sorted[0].received_at)}`
            : "No plays yet",
    );
    const updated = data.state.updated_at || data.synced_at;
    setText(
        "updated",
        updated
            ? `Last update ${shortDate(updated)} ${clock(updated)}`
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
            stroke: "var(--accent)",
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
        `<strong>${number(stats.plays)}</strong> plays · <strong>${number(stats.hits)}</strong> notes · Average <strong>${timingText(stats.average)}</strong>`;
    motion.histogram(svg, animate);
    if (animate) motion.data($("timing-summary"));
}

function renderChart({ animate = true, transition = false } = {}) {
    if (!data) return;
    if (transition) {
        hidePopup();
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
    $("popup").hidden = true;
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
    const bestPoints = plays.map((p) => {
        best = Math.max(best, p.play_vf);
        return [Date.parse(p.received_at), best];
    });
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
    hover = { series, x, start, end, left, right, crosshair, markers, width };
    $("chart-summary").innerHTML =
        `<strong>${number(plays.length)}</strong> plays · Best <strong>${vf(Math.max(...values))}</strong> · Average <strong>${vf(average(values))}</strong>`;
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
    popup.classList.remove("compact");
    popup.style.maxWidth = "";
    popup.hidden = false;
    const wrap = $("chart-wrap").getBoundingClientRect();
    const cursorX = event.clientX - wrap.left,
        cursorY = event.clientY - wrap.top;
    const gap = 12,
        inset = 8;
    const rightSpace = wrap.width - cursorX - gap - inset;
    const leftSpace = cursorX - gap - inset;
    const useRight =
        rightSpace >= popup.offsetWidth ||
        (leftSpace < popup.offsetWidth && rightSpace >= leftSpace);
    const available = useRight ? rightSpace : leftSpace;
    if (available < popup.offsetWidth) {
        popup.classList.add("compact");
        popup.style.maxWidth = `${available}px`;
    }
    popup.style.left = `${useRight ? cursorX + gap : cursorX - gap - popup.offsetWidth}px`;
    popup.style.top = `${Math.max(inset, Math.min(cursorY - popup.offsetHeight - gap, wrap.height - popup.offsetHeight - inset))}px`;
}
$("chart").addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse")
        $("chart").setPointerCapture(event.pointerId);
    showChartPopup(event);
});
$("chart").addEventListener("pointermove", showChartPopup);
function hidePopup() {
    $("popup").hidden = true;
    if (hover) {
        hover.crosshair.setAttribute("visibility", "hidden");
        hover.markers.replaceChildren();
    }
}
$("chart").addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") hidePopup();
});
$("chart").addEventListener("pointerup", (event) => {
    if (event.pointerType !== "mouse") hidePopup();
});
$("chart").addEventListener("pointercancel", hidePopup);
$("chart").addEventListener("lostpointercapture", (event) => {
    if (event.pointerType !== "mouse") hidePopup();
});
document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#chart-wrap")) hidePopup();
});
window.addEventListener("scroll", hidePopup, { passive: true });

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
    const bounds = position.card
        ? $(position.card).getBoundingClientRect()
        : null;
    const top = bounds
        ? bounds.top +
          scrollY -
          (position.center ? (innerHeight - bounds.height) / 2 : 16)
        : position.y;
    const smooth =
        position.card &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
        left: position.x ?? 0,
        top,
        behavior: smooth ? "smooth" : "instant",
    });
    rememberScroll();
}

function scrollToCard({ keyboardAware = false } = {}) {
    const card = $(view === "search" ? "song-search-view" : "records-view");
    const viewport = window.visualViewport;
    if (keyboardAware && card && viewport) {
        const bounds = card.getBoundingClientRect();
        window.scrollTo({
            left: 0,
            top: Math.max(0, bounds.top + scrollY - viewport.offsetTop - 16),
            behavior: "smooth",
        });
        rememberScroll();
        return;
    }
    restoreScroll({
        card: view === "search" ? "song-search-view" : "records-view",
    });
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
    } else if (view === "search") {
        if (selected) {
            params.set("song", selected.music_id);
            params.set("diff", selected.diff_idx);
        }
        if (songSearchPage) params.set("page", songSearchPage + 1);
    } else if (view === "top" || view === "history") {
        if (page) params.set("page", page + 1);
        if ($("search").value) params.set("q", $("search").value);
        const defaultSort = defaultRecordSorts[view];
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
    if (appealHelper.restoreHistory()) return;
    const savedScroll = history.state?.dashboardScroll;
    const previousDays = days;
    const previousChart = JSON.stringify([difficulty, [...shown]]);
    const [route, query = ""] = location.hash.slice(1).split("?");
    // Keep previously shared song links working.
    const routeName = route === "leaderboard" ? "search" : route;
    if (routeName !== route)
        history.replaceState(
            history.state,
            "",
            `#${routeName}${query ? "?" + query : ""}`,
        );
    const next = [
        "overview",
        "top",
        "history",
        "search",
        "calculator",
    ].includes(routeName)
        ? routeName
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
    if (next === "search") {
        selected =
            params.has("diff") &&
            Number.isSafeInteger(musicId) &&
            musicId > 0 &&
            Number.isInteger(diff) &&
            diff >= 0 &&
            diff < DIFFS.length
                ? { music_id: musicId, diff_idx: diff }
                : null;
        songSearchPage = restoredPage;
        $("song-query").value =
            selected && songs.has(musicId)
                ? `${songs.get(musicId).title} ${DIFFS[diff]}`
                : "";
    }
    closeMatches();
    if (data && next === "overview" && view === "overview") {
        if (days !== previousDays) renderChart({ transition: true });
        else if (previousChart !== JSON.stringify([difficulty, [...shown]]))
            renderChart();
    } else switchView(next, false, { animate: false });
    if (["top", "history"].includes(next)) {
        page = restoredPage;
        $("search").value = params.get("q") || "";
        const sort = params.get("sort");
        $("sort").value = ["vf", "score", "recent", "plays"].includes(sort)
            ? sort
            : defaultRecordSorts[next];
        recordStates[next] = {
            query: $("search").value,
            page,
            sort: $("sort").value,
        };
        renderTable({ animate: false });
    }
    restoreScroll(savedScroll);
}

function switchView(
    next,
    recordHistory = true,
    { animate = true, scroll = false } = {},
) {
    hideSongReadingPopup();
    if (recordHistory) {
        pendingScroll = null;
        rememberScroll();
    }
    if (view in recordStates) {
        recordStates[view] = {
            query: $("search").value,
            page,
            sort: $("sort").value,
        };
    }
    if (next !== view) {
        closeMatches();
        if (view === "calculator") calculator.clearFilter();
    }
    view = next;
    document.querySelectorAll(".tab").forEach((button) => {
        const active = button.dataset.view === view;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    $("overview-view").hidden = view !== "overview";
    $("records-view").hidden = !["top", "history"].includes(view);
    $("song-search-view").hidden = view !== "search";
    $("calculator-view").hidden = view !== "calculator";
    if (view in recordStates) {
        const saved = recordStates[view];
        $("search").value = saved.query;
        $("sort").value = saved.sort;
        page = saved.page;
    }
    updateSearchClearButtons();
    if (view === "overview") renderChart({ animate });
    else if (view === "search")
        renderSongSearch({ animate, restartRadar: true });
    else if (view === "calculator")
        calculator.render({ animate: revealOnce("calculator", animate) });
    else renderTable({ animate });
    if (!data && loading) prepareLoading();
    if (recordHistory) {
        updateUrl();
        if (scroll && view !== "overview") scrollToCard();
    }
}

function recordPosition(record, { top, grouped, playCounts }) {
    if (top) return formatRank(record.rank);
    if (grouped) {
        const count = playCounts.get(chartKey(record));
        return `${number(count)}<br>${count === 1 ? "play" : "plays"}`;
    }
    return `${shortDate(record.received_at)}<br>${clock(record.received_at)}`;
}

function recordRow(record, options) {
    return `<tr class="chart-row" ${!options.top && !options.grouped ? newPlayAttributes(record) : ""} ${playAttributes(record)} data-music="${record.music_id}" data-diff="${record.diff_idx}">
        <td class="row-index record-position">${recordPosition(record, options)}</td>
        <td class="record-song"><div class="table-song">${coverMarkup(record)}${chartInfo(record, { artist: true, detailsClass: "record-details" })}</div></td>
        <td class="record-difficulty">${badge(record)}</td>
        <td class="score-cell record-score">${number(record.score)}</td>
        <td class="record-clear">${clear(record)}</td>
        <td class="right vf-cell record-vf">${vf(record.vf ?? record.play_vf)}</td>
    </tr>`;
}

function renderTable({ animate = true } = {}) {
    const top = view === "top";
    const sort = $("sort").value;
    const grouped = !top && sort === "plays";
    $("records-view").setAttribute(
        "aria-label",
        top ? "Top 50" : "Play history",
    );
    setText("first-column", top ? "Rank" : grouped ? "Plays" : "Played");
    setText("records-score-heading", grouped ? "Best score" : "Score");
    updateSearchClearButtons();
    if (!data) return;
    animate = revealOnce(view, animate);
    if (!animate) {
        for (const id of ["records", "page-info"]) motion.stop($(id));
    }
    const { records, totalPlays, playCounts } = recordList(data, catalog, {
        top,
        sort,
        query: $("search").value,
    });
    const pagination = paginate(records, page);
    page = pagination.page;
    const { items: chunk, pages } = pagination;
    $("records").innerHTML = chunk.length
        ? chunk
              .map((record) => recordRow(record, { top, grouped, playCounts }))
              .join("")
        : `<tr><td colspan="6">${escape(parseSearch($("search").value).errors[0] || "No matching charts.")}</td></tr>`;
    setText("records-page-number", page + 1);
    setText("records-total-pages", pages);
    $("records-page-number").disabled = false;
    $("records-page-number").setAttribute(
        "aria-label",
        `Page ${page + 1} of ${pages}. Enter page number`,
    );
    $("records-page-input").max = pages;
    if ($("records-page-input").hidden)
        $("records-page-input").value = page + 1;
    $("previous").disabled = page === 0;
    $("next").disabled = page + 1 >= pages;
    $("first-page").disabled = page === 0;
    $("last-page").disabled = page + 1 >= pages;
    if (animate) {
        motion.data($("records"), ".chart-row, tr:not(.chart-row)");
        motion.data($("page-info"));
    }
}

function updateSearchClearButtons() {
    document.querySelectorAll("[data-clear-input]").forEach((button) => {
        button.hidden = !$(button.dataset.clearInput).value;
    });
}

function updateSearchOptionsHeight() {
    const input = $("song-query");
    const options = $("song-options");
    if (
        document.activeElement !== input ||
        !matchMedia("(max-width: 700px)").matches
    ) {
        options.style.removeProperty("--search-options-max-height");
        return;
    }
    const viewport = window.visualViewport;
    const bottom =
        (viewport?.offsetTop || 0) + (viewport?.height || innerHeight);
    const field = input.closest(".search-wrap").getBoundingClientRect();
    options.style.setProperty(
        "--search-options-max-height",
        `${Math.max(80, bottom - field.bottom - 12)}px`,
    );
}

let searchRevealTimer;
let searchViewportHeight = window.visualViewport?.height || innerHeight;
function scheduleSearchReveal() {
    clearTimeout(searchRevealTimer);
    searchRevealTimer = setTimeout(() => {
        const input = document.activeElement;
        if (
            !input?.matches(".search-wrap input") ||
            input.closest("dialog") ||
            !matchMedia("(max-width: 700px)").matches
        )
            return;
        scrollToCard({ keyboardAware: true });
        updateSearchOptionsHeight();
    }, 180);
}

function closeMatches() {
    $("song-options").hidden = true;
    $("song-query").setAttribute("aria-expanded", "false");
    $("song-query").removeAttribute("aria-activedescendant");
    activeMatch = -1;
}

function renderMatches() {
    updateSearchClearButtons();
    if (!data || !$("song-query").value.trim()) {
        matches = [];
        $("song-options").replaceChildren();
        closeMatches();
        return;
    }
    matches = searchSongs(catalog, $("song-query").value, data.plays);
    activeMatch = -1;
    const list = $("song-options");
    list.innerHTML = matches.length
        ? matches
              .map(
                  (p, index) =>
                      `<button type="button" role="option" id="song-option-${index}" aria-selected="false" tabindex="-1" class="song-option" data-option="${index}">${coverMarkup(p)}<span class="option-song"><span>${escape(chartTitle(p))}</span><small>${escape(p.artist)}</small></span>${difficultyRange(p)}</button>`,
              )
              .join("")
        : `<div class="search-empty">${escape(parseSearch($("song-query").value).errors[0] || "No matching song.")}</div>`;
    list.scrollTop = 0;
    list.hidden = false;
    $("song-query").setAttribute("aria-expanded", "true");
    $("song-query").removeAttribute("aria-activedescendant");
    updateSearchOptionsHeight();
}

function difficultyRange(song) {
    const difficulties = [...song.difficulties].sort(
        (a, b) => a.diff_idx - b.diff_idx,
    );
    const first = difficulties[0],
        last = difficulties.at(-1);
    return `<span class="song-option-range">${badge(first)}${first.diff_idx === last.diff_idx ? "" : `<span aria-hidden="true">~</span>${badge(last)}`}</span>`;
}

function selectChart(
    musicId,
    diff,
    { animate = true, scroll = true, play = null } = {},
) {
    const song = songs.get(musicId);
    if (!song) return;
    dismissSearchKeyboard();
    clearTimeout(matchesTimer);
    matchesTimer = 0;
    rememberScroll();
    selected = { music_id: musicId, diff_idx: diff };
    if (play) expandedJudgements.clear();
    const plays = play && data ? chartPlays(data, musicId, diff) : [];
    let playIndex = play
        ? plays.findIndex(
              (p) =>
                  p.score === play.score &&
                  p.clear_type === play.clear_type &&
                  (!play.received_at || p.received_at === play.received_at),
          )
        : -1;

    // Saved chart scores and clear marks can come from different plays.
    if (play && !play.received_at && playIndex < 0)
        playIndex = plays.findIndex((p) => p.score === play.score);
    songSearchPage = playIndex < 0 ? 0 : Math.floor(playIndex / PAGE_SIZE);
    $("song-query").value = `${song.title} ${DIFFS[diff]}`;
    closeMatches();
    if (view !== "search") switchView("search", true, { animate });
    else {
        renderSongSearch({ animate, restartRadar: true });
        updateUrl();
    }
    const scoreRow =
        playIndex < 0 || $("song-search-results").hidden
            ? null
            : $(`song-score-${playIndex % PAGE_SIZE}`);
    if (scoreRow) {
        setJudgementsExpanded(scoreRow, true);
        motion.highlight(scoreRow);
    }
    if (scroll)
        restoreScroll({
            card: scoreRow?.id ?? "song-search-view",
            center: !!scoreRow,
        });
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
        ["timing", "Timing"],
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
                ? `<div class="judgement-timing"><dt>${label}</dt>${timingText(play.timing)}</div>`
                : key === "near"
                  ? `<div><dt>${label}</dt><dd title="Early · Late" aria-label="Early Near ${count("early_near")}, Late Near ${count("late_near")}">${count("early_near")} · ${count("late_near")}</dd></div>`
                  : `<div><dt>${label}</dt><dd>${count(key)}</dd></div>`,
        )
        .join("")}</dl>`;
}

function fitDifficultyButtons() {
    const tabs = $("selected-chart").querySelector(".difficulty-tabs");
    if (!tabs || !tabs.clientWidth) return;
    tabs.style.removeProperty("--difficulty-scale");
    const buttons = [...tabs.children];
    const gap = parseFloat(getComputedStyle(tabs).columnGap) || 0;
    const naturalWidth =
        buttons.reduce(
            (width, button) => width + button.getBoundingClientRect().width,
            0,
        ) +
        gap * Math.max(0, buttons.length - 1);
    const availableWidth = tabs.getBoundingClientRect().width;
    if (naturalWidth > availableWidth + 0.5)
        tabs.style.setProperty(
            "--difficulty-scale",
            (availableWidth - 1) / naturalWidth,
        );
}

function renderSongSearch({ animate = true, restartRadar = false } = {}) {
    hideSongReadingPopup();
    updateSearchClearButtons();
    if (!data) return;
    if (selected) animate = revealOnce(`song:${selected.music_id}`, animate);
    if (!animate) {
        for (const id of [
            "selected-chart",
            "song-search-records",
            "song-search-page-info",
        ])
            motion.stop($(id));
    }
    $("selected-chart").hidden = !selected;
    $("song-search-empty").hidden = !!selected;
    $("song-search-results").hidden = !selected;
    if (!selected) {
        if ($("song-query").value.trim()) renderMatches();
        else closeMatches();
        return;
    }
    const song = songs.get(selected.music_id);
    if (
        !song ||
        !song.difficulties.some((d) => d.diff_idx === selected.diff_idx)
    ) {
        $("selected-chart").hidden = true;
        $("song-search-results").hidden = true;
        $("song-search-empty").hidden = false;
        return;
    }
    if (!$("song-query").value)
        $("song-query").value = `${song.title} ${DIFFS[selected.diff_idx]}`;
    updateSearchClearButtons();
    const plays = chartPlays(data, selected.music_id, selected.diff_idx);
    const reading =
        typeof song.title_ascii === "string" ? song.title_ascii : "";
    const songTitle = `<h3 class="song-reading-title"${reading ? ' tabindex="0" aria-describedby="song-reading-popup"' : ""}>${escape(song.title)}</h3>`;
    const difficulty = song.difficulties.find(
        (d) => d.diff_idx === selected.diff_idx,
    );
    const songMarkup = `<div class="selected-song">${coverMarkup(selected, "large")}<div class="selected-song-info"><div class="selected-song-heading">${songTitle}</div><p>${escape(song.artist)}</p><div class="selected-chart-details"><div class="difficulty-tabs" role="group" aria-label="Song difficulty">${song.difficulties.map((d) => `<button class="${d.diff_idx === selected.diff_idx ? "selected" : ""}" data-chart-diff="${d.diff_idx}" aria-pressed="${d.diff_idx === selected.diff_idx}">${DIFFS[d.diff_idx]} <span>${d.level ?? "—"}</span></button>`).join("")}</div>${chartSummaryMarkup(selected, plays)}</div><div class="selected-song-actions"><button type="button" class="calculator-link" data-chart-details><span class="action-info-icon" aria-hidden="true">i</span> Details</button><button type="button" class="calculator-link" data-view-chart hidden>View chart</button><button type="button" class="calculator-link" data-view-calculator>View in VF Calculator <span aria-hidden="true">→</span></button></div></div>${radarMarkup(difficulty.radar, { interactive: true })}</div>`;
    const chart = $("selected-chart");
    const tabs = chart.querySelector(".difficulty-tabs");
    const buttons = [...(tabs?.querySelectorAll("button") || [])];
    const reuseTabs =
        chart.dataset.musicId === String(selected.music_id) &&
        buttons.length === song.difficulties.length &&
        buttons.every(
            (button, i) =>
                Number(button.dataset.chartDiff) ===
                song.difficulties[i].diff_idx,
        );
    if (reuseTabs) {
        // Keep the control connected so its highlight can transition and the
        // clicked button keeps keyboard focus while the chart data updates.
        const updated = document.createElement("div");
        updated.innerHTML = songMarkup;
        for (const selector of [
            ".cover-tile.large",
            ".selected-song-heading",
            ".selected-song-info > p",
            ".selected-summary",
            ".song-radar",
        ])
            chart
                .querySelector(selector)
                .replaceWith(updated.querySelector(selector));
        for (const [i, button] of buttons.entries()) {
            const active =
                Number(button.dataset.chartDiff) === selected.diff_idx;
            button.classList.toggle("selected", active);
            button.setAttribute("aria-pressed", String(active));
            button.querySelector("span").textContent =
                song.difficulties[i].level ?? "—";
        }
    } else {
        cleanupDifficultyControl?.();
        chart.innerHTML = songMarkup;
        chart.dataset.musicId = selected.music_id;
    }
    void chartViewer.updateButton(
        chart.querySelector("[data-view-chart]"),
        selected,
    );
    paintRadar($("selected-chart"), difficulty.radar, {
        restart: restartRadar,
    });
    bindSongReadingPopup(reading);
    fitDifficultyButtons();
    if (!reuseTabs)
        cleanupDifficultyControl = initSegmentedControl(
            chart.querySelector(".difficulty-tabs"),
        );
    const pagination = paginate(plays, songSearchPage);
    songSearchPage = pagination.page;
    const { items: chunk, pages, start } = pagination;
    $("song-search-records").innerHTML = chunk.length
        ? chunk
              .map((p, index) => {
                  const key = judgementKey(p);
                  const expanded = expandedJudgements.has(key);
                  return `<tr id="song-score-${index}" class="song-search-entry" ${newPlayAttributes(p)} data-judgements="${index}" data-judgement-key="${escape(key)}" data-play-vf="${p.play_vf}"><td class="row-index score-position">${formatRank(start + index + 1)}</td><td class="score-cell"><button type="button" class="score-with-grade judgement-toggle" aria-expanded="${expanded}" aria-controls="judgements-${index}" aria-label="${expanded ? "Hide" : "Show"} judgements for score ${number(p.score)}">${gradeMarkup(p.score)}<span>${number(p.score)}</span><svg class="judgement-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></td><td class="score-clear">${clear(p)}</td><td class="played-date">${date(p.received_at)} <span>${clock(p.received_at)}</span></td><td class="right vf-cell">${vf(p.play_vf)}</td></tr><tr id="judgements-${index}" class="judgement-row" ${expanded ? "" : "hidden"}><td colspan="5">${judgementDetails(p)}</td></tr>`;
              })
              .join("")
        : '<tr><td colspan="5">No recorded nonzero plays for this chart yet.</td></tr>';
    setText(
        "song-search-page-info",
        `${plays.length} plays · Page ${songSearchPage + 1} / ${pages}`,
    );
    $("song-search-previous").disabled = songSearchPage === 0;
    $("song-search-next").disabled = songSearchPage + 1 >= pages;
    if (animate) {
        motion.data(
            $("selected-chart"),
            ".cover-tile.large, .selected-song-info",
        );
        motion.data(
            $("song-search-records"),
            ".song-search-entry, .judgement-row:not([hidden])",
        );
        motion.data($("song-search-page-info"));
    }
}

function setJudgementsExpanded(row, expanded) {
    const button = row.querySelector(".judgement-toggle");
    const details = $(button.getAttribute("aria-controls"));
    if (details.hidden === !expanded) return;
    details.hidden = !expanded;
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
}

$("song-search-records").addEventListener("click", (event) => {
    const row = event.target.closest(".song-search-entry");
    if (!row) return;
    const expanded =
        row.querySelector(".judgement-toggle").getAttribute("aria-expanded") ===
        "true";
    expandedJudgements.clear();
    for (const entry of $("song-search-records").querySelectorAll(
        ".song-search-entry",
    ))
        setJudgementsExpanded(entry, entry === row && !expanded);
});

document.querySelectorAll("[data-clear-input]").forEach((button) => {
    const input = $(button.dataset.clearInput);
    input.addEventListener("input", () => {
        button.hidden = !input.value;
    });
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
        input.value = "";
        if (
            event.pointerType === "touch" ||
            matchMedia("(pointer: coarse)").matches
        ) {
            input.blur();
        } else {
            input.focus({ preventScroll: true });
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
});
document.addEventListener("focusin", (event) => {
    if (event.target.matches(".search-wrap input")) scheduleSearchReveal();
});
document.addEventListener("focusout", () =>
    setTimeout(updateSearchOptionsHeight, 0),
);
window.visualViewport?.addEventListener("resize", () => {
    const height = window.visualViewport.height;
    if (height < searchViewportHeight) scheduleSearchReveal();
    searchViewportHeight = height;
    updateSearchOptionsHeight();
});
window.visualViewport?.addEventListener("scroll", updateSearchOptionsHeight);
window.addEventListener("scroll", updateSearchOptionsHeight, { passive: true });

let matchesTimer = 0;
$("song-query").addEventListener("input", () => {
    if (!$("song-query").value.trim()) {
        selected = null;
        songSearchPage = 0;
        expandedJudgements.clear();
        renderSongSearch({ animate: false });
        updateUrl(true);
    }
    clearTimeout(matchesTimer);
    matchesTimer = setTimeout(() => {
        matchesTimer = 0;
        renderMatches();
    }, 120);
});
$("song-query").addEventListener("focus", renderMatches);
$("song-query").addEventListener("keydown", (event) => {
    if (matchesTimer && ["Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
        clearTimeout(matchesTimer);
        matchesTimer = 0;
        renderMatches();
    }
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
    if (!event.target.closest('.song-search, [data-view="search"]'))
        closeMatches();
    const radarButton = event.target.closest("[data-similar-charts]");
    if (radarButton && selected) {
        similarCharts.open(selected, radarButton);
        return;
    }
    const viewerButton = event.target.closest("[data-view-chart]");
    if (viewerButton && selected) {
        const song = songs.get(selected.music_id);
        const diff = song?.difficulties.find(
            (d) => d.diff_idx === selected.diff_idx,
        );
        chartViewer.open(
            {
                ...selected,
                title: song?.title,
                artist: song?.artist,
                level: diff?.level,
                cover: diff?.cover,
            },
            viewerButton,
        );
        return;
    }
    const detailsButton = event.target.closest("[data-chart-details]");
    if (detailsButton && selected) {
        chartDetails.open(selected, detailsButton);
        return;
    }
    if (event.target.closest("[data-view-calculator]") && selected) {
        const song = songs.get(selected.music_id);
        const difficulty = song?.difficulties.find(
            (chart) => chart.diff_idx === selected.diff_idx,
        );
        if (difficulty) {
            calculator.openChart({
                ...selected,
                title: song.title,
                artist: song.artist,
                level: difficulty.level,
            });
            switchView("calculator");
        }
        return;
    }
    const button = event.target.closest(".open-chart, .chart-row");
    if (button) {
        const play = button.closest(".chart-row")?.dataset.play;
        selectChart(Number(button.dataset.music), Number(button.dataset.diff), {
            play: play ? JSON.parse(play) : null,
        });
    }
    const diff = event.target.closest("[data-chart-diff]");
    if (
        diff &&
        selected &&
        Number(diff.dataset.chartDiff) !== selected.diff_idx
    )
        selectChart(selected.music_id, Number(diff.dataset.chartDiff), {
            animate: false,
            scroll: false,
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
$("song-search-previous").addEventListener("click", () => {
    rememberScroll();
    songSearchPage--;
    renderSongSearch();
    updateUrl();
    scrollToCard();
});
$("song-search-next").addEventListener("click", () => {
    rememberScroll();
    songSearchPage++;
    renderSongSearch();
    updateUrl();
    scrollToCard();
});

const readArchive = createArchiveLoader();
let pendingLiveUpdate = false;

async function load({ fresh = false, check = false, live = false } = {}) {
    if (loading) {
        if (live) pendingLiveUpdate = true;
        return;
    }
    loading = true;
    document.body.dataset.loading = data ? "refresh" : "initial";
    $("main").setAttribute("aria-busy", "true");
    setText("load-status-label", data ? "Updating..." : "Loading records...");
    if (!data) prepareLoading();
    try {
        const next = await readArchive({ fresh, check });
        if (data && next === data) {
            $("notice").hidden = true;
            return;
        }
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
        if (data && fingerprint === dataFingerprint) {
            $("notice").hidden = true;
            return;
        }
        const animate = !data || (!live && fingerprint !== dataFingerprint);
        dataFingerprint = fingerprint;
        playHighlights.update(next.plays);
        data = next;
        setSearchData(data);
        appealHelper.update();
        catalog = songCatalog(data);
        songs = new Map(catalog.map((song) => [song.music_id, song]));
        songLibrary.update();
        if ($("song-query").value.trim() || $("search").value.trim())
            void searchTools.ensure();
        $("notice").hidden = true;
        renderSummary({ animate });
        void loadExchangeRate();
        renderChart({ animate });
        if (view === "search")
            renderSongSearch({ animate, restartRadar: fresh });
        else if (view === "calculator") calculator.updateData({ animate });
        else if (["top", "history"].includes(view)) renderTable({ animate });
        document.body.dataset.ready = "true";
        clearExpiredHighlights();
        restoreScroll(pendingScroll);
    } catch (error) {
        setText(
            "notice",
            error.code === "DATABASE_QUOTA_EXCEEDED"
                ? "Database quota exceeded. Check Neon usage to restore access. Your local records are still saved."
                : data
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
            $("song-search-records").innerHTML =
                '<tr><td colspan="5">No data available yet.</td></tr>';
            $("selected-chart").hidden = true;
            setText("timing-summary", "Waiting for timing data.");
            for (const id of ["chart", "timing-chart"]) $(id).replaceChildren();
        }
    } finally {
        loading = false;
        delete document.body.dataset.loading;
        $("main").setAttribute("aria-busy", "false");
        if (pendingLiveUpdate) {
            pendingLiveUpdate = false;
            queueMicrotask(() => load({ check: true, live: true }));
        }
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

$("dan-library-open").addEventListener("click", () => {
    switchView("search");
    songLibrary.open("skill");
});

document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
        const next = button.dataset.view;
        if (next === view) {
            if (next in recordStates) {
                page = 0;
                $("search").value = "";
                $("sort").value = defaultRecordSorts[next];
            } else if (next === "search") {
                selected = null;
                songSearchPage = 0;
                expandedJudgements.clear();
                $("song-query").value = "";
                closeMatches();
            } else if (next === "calculator") calculator.reset();
        }
        switchView(next);
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
let recordsSearchTimer;
$("search").addEventListener("input", () => {
    page = 0;
    clearTimeout(recordsSearchTimer);
    recordsSearchTimer = setTimeout(() => {
        renderTable({ animate: false });
        updateUrl(true);
    }, 120);
});
$("sort").addEventListener("change", () => {
    rememberScroll();
    page = 0;
    renderTable();
    updateUrl();
});
function goToRecordsPage(requested) {
    if (!data || !["top", "history"].includes(view)) return;
    rememberScroll();
    page = Math.max(
        0,
        Math.min(
            Number($("records-total-pages").textContent) - 1,
            Math.trunc(requested),
        ),
    );
    renderTable();
    updateUrl();
    scrollToCard();
}
$("previous").addEventListener("click", () => goToRecordsPage(page - 1));
$("next").addEventListener("click", () => goToRecordsPage(page + 1));
$("first-page").addEventListener("click", () => goToRecordsPage(0));
$("last-page").addEventListener("click", () =>
    goToRecordsPage(Number($("records-total-pages").textContent) - 1),
);
function finishRecordsPageEdit(cancel = false) {
    const input = $("records-page-input");
    if (input.hidden) return;
    const requested = Number(input.value);
    input.hidden = true;
    $("records-page-number").hidden = false;
    if (!cancel && input.value.trim() && Number.isFinite(requested))
        goToRecordsPage(requested - 1);
}
$("records-page-number").addEventListener("click", () => {
    $("records-page-number").hidden = true;
    const input = $("records-page-input");
    input.hidden = false;
    input.value = page + 1;
    input.focus({ preventScroll: true });
    input.select();
});
$("records-page-input").addEventListener("blur", () => finishRecordsPageEdit());
$("records-page-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        $("records-page-input").blur();
    } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRecordsPageEdit(true);
        $("records-page-number").focus({ preventScroll: true });
    }
});
$("all-plays").addEventListener("click", () =>
    switchView("history", true, { scroll: true }),
);
$("all-top").addEventListener("click", () =>
    switchView("top", true, { scroll: true }),
);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load({ check: true });
});
let chartWidth = innerWidth;
window.addEventListener("resize", () => {
    if (innerWidth === chartWidth) return;
    chartWidth = innerWidth;
    renderChart({ animate: false });
    if (view === "calculator") calculator.render({ animate: false });
});
const liveUpdates = subscribeArchive(() => load({ check: true, live: true }));
// Keep a fallback for an unavailable stream or an older deployment.
setInterval(() => {
    if (!document.hidden && !liveUpdates.connected) load({ check: true });
}, 60000);
let difficultyContainerWidth = 0;
new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === difficultyContainerWidth) return;
    difficultyContainerWidth = entry.contentRect.width;
    fitDifficultyButtons();
}).observe($("selected-chart"));
document.fonts.ready.then(fitDifficultyButtons);
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
$("song-reading-popup").addEventListener("pointerenter", () =>
    clearTimeout(songReadingHideTimer),
);
$("song-reading-popup").addEventListener(
    "pointerleave",
    scheduleSongReadingHide,
);
document.addEventListener("click", (event) => {
    if (!event.target.closest(".spending-price, #spending-popup"))
        hideSpendingPopup();
    if (!event.target.closest(".song-reading-title, #song-reading-popup"))
        hideSongReadingPopup();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        hideSpendingPopup();
        hideSongReadingPopup();
    }
});
window.addEventListener(
    "scroll",
    (event) => {
        if (event.target !== $("spending-popup")) hideSpendingPopup();
        if (event.target !== $("song-reading-popup")) hideSongReadingPopup();
    },
    { capture: true, passive: true },
);
window.addEventListener("resize", hideSpendingPopup);
window.addEventListener("resize", hideSongReadingPopup);
initSegmentedControls();
restoreUrl();
updateUrl(true);
// Show the saved cloud archive before waiting for the local sync worker.
load().then(() => {
    if (data) void load({ fresh: true });
});
