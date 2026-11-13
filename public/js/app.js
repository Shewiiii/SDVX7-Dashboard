import { createScrollRestoration } from "./core/scroll-restoration.js";
import { isPlainClick } from "./core/song-links.js";
import { createRecords } from "./profile/records.js";
import { initChartActions } from "./charts/chart-actions.js";
import { createSongSearch } from "./search/song-search.js";
import {
    initSearchInputs,
    updateSearchClearButtons,
} from "./search/search-inputs.js";
import { $, setText } from "./core/dom.js";
import { escape } from "./core/format.js";
import { createPlayHighlightMarkup } from "./core/play-highlights.js";
import {
    createChartMarkup,
    badge,
    difficultyRange,
} from "./charts/chart-markup.js";
import { createProfileSummary } from "./profile/summary.js";
import { createPerformanceHistory } from "./profile/performance-history.js";
import { renderTimingHistogram } from "./profile/timing-histogram.js";
import {
    initChartPopups,
    hideSongReadingPopup,
    hideChartVfPopup,
} from "./search/chart-popups.js";
import { DETAILS_CHEVRON } from "./core/expandable-rows.js";
import { createArchiveLoader } from "./core/archive.js";
import { subscribeArchive } from "./core/live.js";
import { initSearchTools } from "./search/search-tools.js";
import { setSearchData } from "./search/search-query.js";
import { createLibrary } from "./library/library.js";
import { DIFFS, summary, songCatalog, chartPlays } from "./profile/metrics.js";
import { motion, initSegmentedControls } from "./core/motion.js";
import { createCalculator } from "./profile/calculator.js";
import { createAppealCardHelper } from "./crew/appeal-cards.js";
import { createVolforceHelper } from "./profile/volforce-helper.js";
import { createProfileRadar } from "./profile/profile-radar.js";
import { createSimilarCharts } from "./charts/similar-charts.js";
import { createChartViewer } from "./charts/chart-viewer.js";
import { createChartDetails } from "./charts/chart-details.js";
import { createJacketViewer } from "./search/jacket-viewer.js";
import {
    preparePanelHistory,
    readPanelLink,
    samePanelLink,
} from "./core/panel-links.js";

let data = null,
    stats = null,
    view = "overview",
    days = 0,
    difficulty = 1,
    loading = false;
let dataFingerprint = "";
const revealedViews = new Set();
const defaultRecordSorts = { top: "vf", history: "recent" };
const recordStates = {
    top: { query: "", page: 0, sort: defaultRecordSorts.top },
    history: { query: "", page: 0, sort: defaultRecordSorts.history },
};

let catalog = [];
let songs = new Map();

const scrollRestoration = createScrollRestoration({
    getData: () => data,
    getView: () => view,
});
const { rememberScroll, restoreScroll, scrollToCard } = scrollRestoration;

const shown = new Set([
    "plays",
    "best",
    "avg10",
    "avg100",
    "threshold",
    "total",
]);

const playHighlights = createPlayHighlightMarkup();
const { newPlayAttributes, clearExpiredHighlights } = playHighlights;
const {
    coverMarkup,
    chartInfo,
    chartSummaryMarkup,
    row,
    playAttributes,
    chartSongMarkup,
} = createChartMarkup({
    getData: () => data,
    getSongs: () => songs,
    newPlayAttributes,
});
const profileSummary = createProfileSummary({
    getData: () => data,
    getStats: () => stats,
    getSongs: () => songs,
    rankingOptions,
    row,
});
const performanceHistory = createPerformanceHistory({
    getData: () => data,
    getSongs: () => songs,
    rankingOptions,
    shown,
});

const profileRadar = createProfileRadar(
    $("profile-radar"),
    $("profile-radar-note"),
    (chart, controls) => {
        const song = songs.get(chart.music_id);
        const entry = {
            ...song,
            ...chart,
            title: song?.title || `Chart ${chart.music_id}`,
            artist: song?.artist || "",
        };
        const titleMarkup = `<button type="button" class="song-title judgement-toggle" aria-expanded="false" aria-controls="${controls}" aria-label="Show radar contribution details for ${escape(entry.title)}"><span>${escape(entry.title)}</span>${DETAILS_CHEVRON}</button>`;
        return {
            song: `<div class="table-song">${coverMarkup(entry)}${chartInfo(entry, { artist: true, titleMarkup, showClear: false, detailsClass: "record-details" })}</div>`,
            difficulty: badge(entry),
        };
    },
);

const appealHelper = createAppealCardHelper(() => data?.state);
createVolforceHelper(() => stats?.total);
const calculator = createCalculator(
    () => stats,
    row,
    (musicId, diff) => (data ? chartPlays(data, musicId, diff) : []),
);
const chartDetails = createChartDetails(
    () => data?.source === "local",
    chartSongMarkup,
);
const chartViewer = createChartViewer();

const records = createRecords({
    getData: () => data,
    getCatalog: () => catalog,
    getView: () => view,
    rankingOptions,
    revealOnce,
    coverMarkup,
    chartInfo,
    playAttributes,
    newPlayAttributes,
    rememberScroll,
    updateUrl,
    scrollToCard,
});

const songSearch = createSongSearch({
    getData: () => data,
    getCatalog: () => catalog,
    getSongs: () => songs,
    getView: () => view,
    chartViewer,
    coverMarkup,
    chartSummaryMarkup,
    newPlayAttributes,
    revealOnce,
    rememberScroll,
    restoreScroll,
    scrollToCard,
    switchView,
    updateUrl,
});

const jacketViewer = createJacketViewer();
let panelRestoreVersion = 0;
const songLibrary = createLibrary(
    () => data,
    () => catalog,
    (song) =>
        `${coverMarkup(song, "small", false)}<span class="option-song"><span>${escape(song.title)}</span><small>${escape(song.artist)}</small></span>${difficultyRange(song)}`,
    (mid, diff) => songSearch.selectChart(mid, diff),
    badge,
);
const similarCharts = createSimilarCharts(
    () => catalog,
    (chart) =>
        `<div class="similar-chart-main">${coverMarkup(chart)}<div class="similar-chart-info"><a class="similar-chart-title" href="#search?song=${chart.music_id}&diff=${chart.diff_idx}">${escape(chart.title)}</a><span class="similar-chart-artist">${escape(chart.artist)}</span><span>${badge(chart)}</span>${chartSummaryMarkup(chart)}</div><div class="similar-chart-audio"></div></div>`,
    (musicId, diff) => {
        songSearch.selectChart(musicId, diff);
        $("selected-chart")
            .querySelector("[data-similar-charts]")
            ?.focus({ preventScroll: true });
    },
    chartSongMarkup,
);

const searchTools = initSearchTools(() => {
    if (!data) return;
    if (view === "search" && !$("song-options").hidden)
        songSearch.renderMatches();
    if (["top", "history"].includes(view)) records.render({ animate: false });
    songLibrary.update();
});

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
    records.disablePagination();
    songSearch.disablePagination();
    if (view === "search") {
        $("selected-chart").hidden = !songSearch.selected;
        if (songSearch.selected)
            $("selected-chart").innerHTML =
                '<div class="selected-song" aria-hidden="true"><span class="cover-tile large skeleton-shape"></span><div class="selected-song-info"><div class="skeleton-shape skeleton-heading"></div><div class="skeleton-shape skeleton-detail"></div><div class="skeleton-shape skeleton-title"></div></div></div>';
        $("song-search-results").hidden = !songSearch.selected;
        $("song-search-empty").hidden = !!songSearch.selected;
    }
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    for (const [id, height] of [
        ["chart", mobile ? 300 : 380],
        ["timing-chart", mobile ? 250 : 260],
    ]) {
        const svg = $(id);
        const width = mobile
            ? Math.max(260, svg.getBoundingClientRect().width)
            : 1100;
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

function renderSummary(options) {
    stats = summary(data, rankingOptions());
    profileSummary.render(options);
}

function renderChart({ animate = true, transition = false } = {}) {
    if (!data) return;
    if (transition) {
        performanceHistory.clearHover();
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
        // Keep the first reveal queued until this graph actually comes into view
        for (const id of [
            "chart",
            "timing-chart",
            "chart-summary",
            "timing-summary",
        ])
            if (!motion.isPending($(id))) motion.stop($(id));
    }
    renderTimingHistogram(data.plays, { days, difficulty, animate });
    profileRadar.render(data.state.profile_radar, {
        animate,
        ...rankingOptions(),
    });
    performanceHistory.render({ days, difficulty, animate });
}

function updateUrl(replace = false) {
    const params = new URLSearchParams();
    const panelLink = replace ? readPanelLink() : null;
    if (view === "overview") {
        if (days) params.set("days", days);
        if (difficulty !== 1) params.set("difficulty", difficulty);
        const series = [...document.querySelectorAll("[data-series]")]
            .map((button) => button.dataset.series)
            .filter((name) => shown.has(name));
        if (series.length !== 6) params.set("series", series.join(","));
    } else if (view === "search") {
        if (songSearch.selected) {
            params.set("song", songSearch.selected.music_id);
            params.set("diff", songSearch.selected.diff_idx);
        }
        if (songSearch.page) params.set("page", songSearch.page + 1);
    } else if (view === "top" || view === "history") {
        if (records.page) params.set("page", records.page + 1);
        if ($("search").value) params.set("q", $("search").value);
        const defaultSort = defaultRecordSorts[view];
        if ($("sort").value !== defaultSort)
            params.set("sort", $("sort").value);
    }
    if (panelLink)
        for (const [name, value] of Object.entries(panelLink))
            params.set(name, value);
    const hash = `#${view}${params.size ? "?" + params.toString() : ""}`;
    if (location.hash !== hash)
        history[replace ? "replaceState" : "pushState"](
            {
                ...(replace ? history.state : {}),
                dashboardScroll: scrollRestoration.pending || {
                    x: scrollX,
                    y: scrollY,
                },
            },
            "",
            hash,
        );
}

function restoreUrl() {
    const savedScroll = history.state?.dashboardScroll;
    const previousSelection = songSearch.selected;
    const previousSongSearchPage = songSearch.page;
    const previousDays = days;
    const previousChart = JSON.stringify([difficulty, [...shown]]);
    const [route, query = ""] = location.hash.slice(1).split("?");
    // Keep previously shared song links working
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
    if (next === "calculator") restoreCalculatorLink(params);
    if (next === "search") {
        songSearch.selected =
            params.has("diff") &&
            Number.isSafeInteger(musicId) &&
            musicId > 0 &&
            Number.isInteger(diff) &&
            diff >= 0 &&
            diff < DIFFS.length
                ? { music_id: musicId, diff_idx: diff }
                : null;
        songSearch.page = restoredPage;
        $("song-query").value =
            songSearch.selected && songs.has(musicId)
                ? `${songs.get(musicId).title} ${DIFFS[diff]}`
                : "";
    }
    songSearch.closeMatches();
    const sameSongSearch =
        data &&
        next === "search" &&
        view === "search" &&
        songSearch.selected &&
        songSearch.selected.music_id === previousSelection?.music_id &&
        songSearch.selected.diff_idx === previousSelection?.diff_idx &&
        songSearch.page === previousSongSearchPage;
    if (data && next === "overview" && view === "overview") {
        if (days !== previousDays) renderChart({ transition: true });
        else if (previousChart !== JSON.stringify([difficulty, [...shown]]))
            renderChart();
    } else if (!sameSongSearch) switchView(next, false, { animate: false });
    if (["top", "history"].includes(next)) {
        records.page = restoredPage;
        $("search").value = params.get("q") || "";
        const sort = params.get("sort");
        $("sort").value = ["vf", "score", "recent", "plays"].includes(sort)
            ? sort
            : defaultRecordSorts[next];
        recordStates[next] = {
            query: $("search").value,
            page: records.page,
            sort: $("sort").value,
        };
        records.render({ animate: false });
    }
    restoreScroll(savedScroll);
    void restorePanelLink();
}

function restoreCalculatorLink(params) {
    if (!data || !params.has("song") || !params.has("diff")) return;
    const song = songs.get(Number(params.get("song")));
    const chart = song?.difficulties.find(
        (item) => item.diff_idx === Number(params.get("diff")),
    );
    if (chart) calculator.openChart({ ...song, ...chart });
}

async function restorePanelLink() {
    const version = ++panelRestoreVersion;
    const link = readPanelLink();
    const owner =
        link?.panel === "details"
            ? chartDetails
            : link?.panel === "chart"
              ? chartViewer
              : link
                ? appealHelper
                : null;
    for (const [id, controller] of [
        ["chart-details", chartDetails],
        ["chart-viewer", chartViewer],
        ["appeal-helper", appealHelper],
    ]) {
        if (
            $(id).open &&
            (controller !== owner ||
                (controller !== appealHelper &&
                    !samePanelLink(controller.link, link)))
        ) {
            const closed = new Promise((resolve) =>
                $(id).addEventListener("close", resolve, { once: true }),
            );
            await controller.close({ fromHistory: true });
            await closed;
        }
        if (version !== panelRestoreVersion) return;
    }
    if (
        !link ||
        !samePanelLink(readPanelLink(), link) ||
        samePanelLink(owner.link, link)
    )
        return;
    if (owner === appealHelper && appealHelper.restoreLink(link)) return;
    if (link.panel === "crew")
        appealHelper.open({
            crewKey: link.crew ?? null,
            tab: "crew",
            fromHistory: true,
        });
    else if (link.panel === "card" || link.panel === "cards") {
        if (data)
            appealHelper.open({ cardId: link.card ?? null, fromHistory: true });
    } else if (link.panel === "details" && data) {
        chartDetails.open({ music_id: link.song, diff_idx: link.diff });
    } else if (data) {
        const song = songs.get(link.song);
        const difficulty = song?.difficulties.find(
            (entry) => entry.diff_idx === link.diff,
        );
        void chartViewer.open({
            music_id: link.song,
            diff_idx: link.diff,
            title: song?.title,
            artist: song?.artist,
            level: difficulty?.level,
            cover: difficulty?.cover,
        });
    }
}

function switchView(
    next,
    recordHistory = true,
    { animate = true, scroll = false } = {},
) {
    hideSongReadingPopup();
    hideChartVfPopup();
    if (recordHistory) {
        scrollRestoration.pending = null;
        rememberScroll();
    }
    if (view in recordStates) {
        recordStates[view] = {
            query: $("search").value,
            page: records.page,
            sort: $("sort").value,
        };
    }
    if (next !== view) {
        songSearch.closeMatches();
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
        records.page = saved.page;
    }
    updateSearchClearButtons();
    if (view === "overview") renderChart({ animate });
    else if (view === "search")
        songSearch.render({ animate, restartRadar: true });
    else if (view === "calculator")
        calculator.render({ animate: revealOnce("calculator", animate) });
    else records.render({ animate });
    if (!data && loading) prepareLoading();
    if (recordHistory) {
        updateUrl();
        if (scroll && view !== "overview") scrollToCard();
    }
}

document.addEventListener(
    "error",
    (event) => {
        if (event.target.matches?.(".cover-tile img"))
            event.target.hidden = true;
    },
    true,
);

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
        const initial = !data;
        const animate = initial || (!live && fingerprint !== dataFingerprint);
        dataFingerprint = fingerprint;
        playHighlights.update(next.plays);
        data = next;
        setSearchData(data, rankingOptions());
        appealHelper.update();
        catalog = songCatalog(data);
        songs = new Map(catalog.map((song) => [song.music_id, song]));
        if (initial && view === "calculator")
            restoreCalculatorLink(
                new URLSearchParams(location.hash.split("?")[1] || ""),
            );
        songLibrary.update();
        if ($("song-query").value.trim() || $("search").value.trim())
            void searchTools.ensure();
        $("notice").hidden = true;
        renderSummary({ animate });
        void profileSummary.loadExchangeRate();
        renderChart({ animate });
        if (view === "search")
            songSearch.render({ animate, restartRadar: fresh });
        else if (view === "calculator") calculator.updateData({ animate });
        else if (["top", "history"].includes(view)) records.render({ animate });
        document.body.dataset.ready = "true";
        clearExpiredHighlights();
        restoreScroll(scrollRestoration.pending);
        if (
            readPanelLink() &&
            !chartDetails.link &&
            !chartViewer.link &&
            !$("appeal-helper").open
        )
            void restorePanelLink();
    } catch (error) {
        setText(
            "notice",
            error.code === "DATABASE_QUOTA_EXCEEDED"
                ? "Database quota exceeded. Check Neon usage to restore access. Your local records are still saved."
                : data
                  ? "Could not update. Showing the last loaded records. Retrying automatically"
                  : "No data available. Try again after syncing",
        );
        $("notice").hidden = false;
        if (!data) {
            setText("chart-summary", "No data available");
            for (const id of ["recent-plays", "top-plays"])
                $(id).innerHTML =
                    '<div class="empty-list">No data available</div>';
            $("records").innerHTML =
                '<tr><td class="empty-state" colspan="6">No data available</td></tr>';
            $("song-search-records").innerHTML =
                '<tr><td class="empty-state" colspan="5">No data available</td></tr>';
            $("selected-chart").hidden = true;
            setText("timing-summary", "No data available");
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

$("vf-percentile").addEventListener("click", (event) => {
    if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
    )
        return;

    event.preventDefault();
    if (view !== "overview") switchView("overview");
    profileSummary.renderVolforcePercentile();
    restoreScroll({ card: "vf-distribution", center: true });
});

document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", (event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        const next = button.dataset.view;
        if (next === view) {
            if (next in recordStates) {
                records.page = 0;
                $("search").value = "";
                $("sort").value = defaultRecordSorts[next];
            } else if (next === "search") {
                songSearch.selected = null;
                songSearch.page = 0;
                songSearch.clearJudgements();
                $("song-query").value = "";
                songSearch.closeMatches();
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

$("all-plays").addEventListener("click", () =>
    switchView("history", true, { scroll: true }),
);
$("all-top").addEventListener("click", () =>
    switchView("top", true, { scroll: true }),
);
function rankingOptions() {
    return {
        includeCustom:
            document.documentElement.dataset.includeCustom === "true",
    };
}

let rankingUpdateVersion = 0;
document.addEventListener("dashboard:ranking-change", async () => {
    const version = ++rankingUpdateVersion;
    if (!data) return;
    renderSummary({ animate: false });

    await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (version !== rankingUpdateVersion) return;

    const control = document.querySelector(".ranking-settings .segmented");
    await Promise.allSettled(
        (control?.getAnimations({ subtree: true }) || []).map(
            (animation) => animation.finished,
        ),
    );
    if (version !== rankingUpdateVersion) return;

    setSearchData(data, rankingOptions());
    renderChart({ animate: false });
    songLibrary.update();
    if (view === "calculator") calculator.updateData({ animate: false });
    else if (view === "search") songSearch.render({ animate: false });
    else if (["top", "history"].includes(view))
        records.render({ animate: false });
});

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
// Keep a fallback for an unavailable stream or an older deployment
setInterval(() => {
    if (!document.hidden && !liveUpdates.connected) load({ check: true });
}, 60000);
window.addEventListener("popstate", restoreUrl);
window.addEventListener("hashchange", restoreUrl);
initChartActions({
    getSelection: () => songSearch.selected,
    getSongs: () => songs,
    jacketViewer,
    similarCharts,
    chartViewer,
    chartDetails,
    calculator,
    switchView,
    selectChart: songSearch.selectChart,
    closeMatches: songSearch.closeMatches,
});
initSearchInputs();
initChartPopups();
initSegmentedControls();
preparePanelHistory();
restoreUrl();
updateUrl(true);
profileSummary.loadRanking();
// Show the saved cloud archive before waiting for the local sync worker
load().then(() => {
    if (data) void load({ fresh: true });
});
