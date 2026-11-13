import { $ } from "../core/dom.js";
import {
    calculatorPath,
    chartPath,
    isPlainClick,
    songPath,
} from "../core/song-links.js";
import {
    escape,
    number,
    date,
    clock,
    chartTitle,
    formatRank,
} from "../core/format.js";
import { createPagination } from "../core/pagination.js";
import {
    DETAILS_CHEVRON,
    setDetailsExpanded,
} from "../core/expandable-rows.js";
import { motion, initSegmentedControl } from "../core/motion.js";
import {
    DIFFS,
    vf,
    chartPlays,
    searchSongs,
    paginate,
    PAGE_SIZE,
    timingText,
} from "../profile/metrics.js";
import { radarMarkup, paintRadar } from "../profile/radar.js";
import { clear, gradeMarkup, difficultyRange } from "../charts/chart-markup.js";
import { dismissSearchKeyboard } from "./search-tools.js";
import { parseSearch } from "./search-query.js";
import { updateSearchClearButtons } from "./search-inputs.js";
import {
    hideSongReadingPopup,
    hideChartVfPopup,
    bindSongReadingPopup,
} from "./chart-popups.js";

export function createSongSearch({
    getData,
    getCatalog,
    getSongs,
    getView,
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
}) {
    let selected = null;
    let songSearchPage = 0;
    let matches = [];
    let activeMatch = -1;
    let cleanupDifficultyControl = null;

    function updateSearchOptionsHeight() {
        const input = $("song-query");
        const options = $("song-options");
        if (
            document.activeElement !== input ||
            !matchMedia("(max-width: 900px)").matches
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
                !matchMedia("(max-width: 900px)").matches
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
        const data = getData();
        const catalog = getCatalog();
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
                          `<a href="${songPath(p.music_id, p.diff_idx)}" role="option" id="song-option-${index}" aria-selected="false" tabindex="-1" class="song-option" data-option="${index}">${coverMarkup(p, "small", false)}<span class="option-song"><span>${escape(chartTitle(p))}</span><small>${escape(p.artist)}</small></span>${difficultyRange(p)}</a>`,
                  )
                  .join("")
            : `<div class="search-empty">${escape(parseSearch($("song-query").value).errors[0] || "No matching song")}</div>`;
        list.scrollTop = 0;
        list.hidden = false;
        $("song-query").setAttribute("aria-expanded", "true");
        $("song-query").removeAttribute("aria-activedescendant");
        updateSearchOptionsHeight();
    }

    function selectChart(
        musicId,
        diff,
        { animate = true, scroll = true, play = null } = {},
    ) {
        const data = getData();
        const view = getView();
        const songs = getSongs();
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

        // Saved chart scores and clear marks can come from different plays
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
                      ? `<div><dt>${label}</dt><dd title="Early - Late" aria-label="Early Near ${count("early_near")}, Late Near ${count("late_near")}">${count("early_near")} - ${count("late_near")}</dd></div>`
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
        const data = getData();
        const songs = getSongs();
        hideSongReadingPopup();
        hideChartVfPopup();
        updateSearchClearButtons();
        if (!data) return;
        if (selected)
            animate = revealOnce(`song:${selected.music_id}`, animate);
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
        const songMarkup = `<div class="selected-song">${coverMarkup(selected, "large")}<div class="selected-song-info"><div class="selected-song-heading">${songTitle}</div><p>${escape(song.artist)}</p><div class="selected-chart-details"><div class="difficulty-tabs" role="group" aria-label="Song difficulty">${song.difficulties.map((d) => `<a href="${songPath(selected.music_id, d.diff_idx)}" class="${d.diff_idx === selected.diff_idx ? "selected" : ""}" data-chart-diff="${d.diff_idx}"${d.diff_idx === selected.diff_idx ? ' aria-current="page"' : ""}>${DIFFS[d.diff_idx]} <span>${d.level ?? "—"}</span></a>`).join("")}</div>${chartSummaryMarkup(selected, plays)}</div><div class="selected-song-actions"><a href="${chartPath(selected.music_id, selected.diff_idx, "details")}" class="calculator-link" data-chart-details><span class="action-info-icon" aria-hidden="true">i</span> Details</a><a href="${chartPath(selected.music_id, selected.diff_idx, "chart")}" class="calculator-link" data-view-chart hidden>View chart</a><a href="${calculatorPath(selected.music_id, selected.diff_idx)}" class="calculator-link" data-view-calculator>View in VF Calculator <span aria-hidden="true">→</span></a></div></div>${radarMarkup(difficulty.radar, { interactive: true })}</div>`;
        const chart = $("selected-chart");
        const tabs = chart.querySelector(".difficulty-tabs");
        const buttons = [
            ...(tabs?.querySelectorAll("[data-chart-diff]") || []),
        ];
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
            // clicked button keeps keyboard focus while the chart data updates
            const updated = document.createElement("div");
            updated.innerHTML = songMarkup;
            for (const selector of [
                ".cover-tile.large",
                ".selected-song-heading",
                ".selected-song-info > p",
                ".selected-song-actions",
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
                if (active) button.setAttribute("aria-current", "page");
                else button.removeAttribute("aria-current");
                button.querySelector("span").textContent =
                    song.difficulties[i].level ?? "—";
            }
        } else {
            cleanupDifficultyControl?.();
            chart.innerHTML = songMarkup;
            chart.dataset.musicId = selected.music_id;
        }
        const jacket = chart.querySelector(".cover-tile.large");
        if (jacket?.querySelector("img")) {
            jacket.href = jacket.querySelector("img").src;
            jacket.setAttribute("aria-label", `View ${song.title} jacket`);
            jacket.setAttribute("aria-haspopup", "dialog");
            jacket.dataset.viewJacket = "";
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
                      return `<tr id="song-score-${index}" class="song-search-entry" ${newPlayAttributes(p)} data-judgements="${index}" data-judgement-key="${escape(key)}" data-play-vf="${p.play_vf}"><td class="row-index score-position">${formatRank(start + index + 1)}</td><td class="score-cell"><button type="button" class="score-with-grade judgement-toggle" aria-expanded="${expanded}" aria-controls="judgements-${index}" aria-label="${expanded ? "Hide" : "Show"} judgements for score ${number(p.score)}">${gradeMarkup(p.score)}<span>${number(p.score)}</span>${DETAILS_CHEVRON}</button></td><td class="score-clear">${clear(p)}</td><td class="played-date">${date(p.received_at)} <span>${clock(p.received_at)}</span></td><td class="right vf-cell">${vf(p.play_vf)}</td></tr><tr id="judgements-${index}" class="judgement-row" ${expanded ? "" : "hidden"}><td colspan="5">${judgementDetails(p)}</td></tr>`;
                  })
                  .join("")
            : '<tr><td class="empty-state" colspan="5">No data available</td></tr>';
        songSearchPagination.update(songSearchPage, pages);
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
        if (
            !setDetailsExpanded(
                row,
                expanded,
                ".judgement-counts > div, .judgements-unavailable",
            )
        )
            return;
        if (details.hidden) expandedJudgements.delete(row.dataset.judgementKey);
        else expandedJudgements.add(row.dataset.judgementKey);
        button.setAttribute(
            "aria-label",
            `${details.hidden ? "Show" : "Hide"} judgements for score ${row.querySelector(".score-with-grade span").textContent}`,
        );
    }

    $("song-search-records").addEventListener("click", (event) => {
        const row = event.target.closest(".song-search-entry");
        if (!row) return;
        const expanded =
            row
                .querySelector(".judgement-toggle")
                .getAttribute("aria-expanded") === "true";
        expandedJudgements.clear();
        for (const entry of $("song-search-records").querySelectorAll(
            ".song-search-entry",
        ))
            setJudgementsExpanded(entry, entry === row && !expanded);
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
    window.visualViewport?.addEventListener(
        "scroll",
        updateSearchOptionsHeight,
    );
    window.addEventListener("scroll", updateSearchOptionsHeight, {
        passive: true,
    });

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
        if (
            matchesTimer &&
            ["Enter", "ArrowDown", "ArrowUp"].includes(event.key)
        ) {
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
    $("song-options").addEventListener("mousedown", (event) => {
        if (isPlainClick(event)) event.preventDefault();
    });
    $("song-options").addEventListener("click", (event) => {
        if (!isPlainClick(event)) return;
        const button = event.target.closest("[data-option]");
        if (button) {
            event.preventDefault();
            const match = matches[Number(button.dataset.option)];
            selectChart(match.music_id, match.diff_idx);
        }
    });

    const songSearchPagination = createPagination(
        $("song-search-page-info").closest(".pagination"),
        {
            onChange(requested) {
                if (!getData() || !selected) return;
                rememberScroll();
                songSearchPage = requested;
                renderSongSearch();
                updateUrl();
                scrollToCard();
            },
        },
    );

    let difficultyContainerWidth = 0;
    new ResizeObserver(([entry]) => {
        if (entry.contentRect.width === difficultyContainerWidth) return;
        difficultyContainerWidth = entry.contentRect.width;
        fitDifficultyButtons();
    }).observe($("selected-chart"));
    document.fonts.ready.then(fitDifficultyButtons);

    return {
        render: renderSongSearch,
        renderMatches,
        closeMatches,
        selectChart,
        disablePagination: () => songSearchPagination.disable(),
        clearJudgements: () => expandedJudgements.clear(),
        get selected() {
            return selected;
        },
        set selected(value) {
            selected = value;
        },
        get page() {
            return songSearchPage;
        },
        set page(value) {
            songSearchPage = value;
        },
    };
}
