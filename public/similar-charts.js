import { paintRadar, radarMarkup, validRadar } from "./radar.js";
import { dismissSearchKeyboard } from "./search-tools.js";
import { mountAudioPlayer } from "./audio-player.js";
import { nextDifficulty } from "./difficulty.js";
import {
    UNLOCK_METHODS,
    chartUnlockFolder,
    loadUnlockMethods,
} from "./unlock-methods.js";

export function radarDistance(first, second) {
    if (!validRadar(first) || !validRadar(second)) return null;
    return (
        Math.hypot(...first.map((value, axis) => value - second[axis])) /
        Math.sqrt(first.length)
    );
}

function radarDifferenceColor(distance) {
    if (distance <= 0) return "var(--accent)";
    if (distance >= 30) return "var(--red)";
    const stops = ["--accent", "--yellow", "--orange", "--red"];
    const position = distance / 10;
    const index = Math.min(2, Math.floor(position));
    const percent = (position - index) * 100;
    return `color-mix(in srgb, var(${stops[index]}), var(${stops[index + 1]}) ${percent}%)`;
}

export function findSimilarCharts(
    catalog,
    selected,
    limit = 10,
    include = () => true,
) {
    if (!Number.isSafeInteger(limit) || limit <= 0) return [];
    const source = catalog
        .find((song) => song.music_id === selected.music_id)
        ?.difficulties.find((chart) => chart.diff_idx === selected.diff_idx);
    if (!validRadar(source?.radar)) return [];

    const matches = [];
    for (const song of catalog) {
        for (const chart of song.difficulties) {
            if (
                song.music_id === selected.music_id &&
                chart.diff_idx === selected.diff_idx
            )
                continue;
            const match = {
                ...song,
                ...chart,
                is_custom: Boolean(song.is_custom || chart.is_custom),
            };
            if (!include(match)) continue;
            const distance = radarDistance(source.radar, chart.radar);
            if (distance === null) continue;
            matches.push({ ...match, distance });
        }
    }
    matches.sort(
        (first, second) =>
            first.distance - second.distance ||
            first.music_id - second.music_id ||
            first.diff_idx - second.diff_idx,
    );
    return matches.slice(0, limit);
}

export function createSimilarCharts(
    getCatalog,
    renderChart,
    selectChart,
    renderSource,
) {
    const dialog = document.getElementById("similar-charts");
    const list = document.getElementById("similar-charts-list");
    const source = document.getElementById("similar-charts-source");
    const closeButton = document.getElementById("similar-charts-close");
    const filter = document.getElementById("similar-charts-filter");
    const level = document.getElementById("similar-charts-level");
    const players = new Map();
    let trigger,
        selection,
        unlockMethods,
        overflow = "",
        closing = false,
        levelAbove = 1,
        playerRevision = 0;

    for (const [value, label] of [
        ...Object.entries(UNLOCK_METHODS),
        ["custom", "Custom chart"],
    ].sort((first, second) => first[1].localeCompare(second[1]))) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        filter.append(option);
    }

    function needsUnlockMethods() {
        return !["all", "custom"].includes(filter.value);
    }

    function disposePlayers() {
        playerRevision++;
        for (const dispose of players.values()) dispose();
        players.clear();
    }

    async function preparePlayers(rows, revision) {
        const jackets = [...dialog.querySelectorAll(".cover-tile img")];
        for (const jacket of jackets) {
            jacket.loading = "eager";
            jacket.fetchPriority = "high";
        }

        // Finish jacket requests before starting audio metadata requests.
        await Promise.all(jackets.map((jacket) => jacket.decode().catch(() => {})));
        if (!dialog.open || closing || revision !== playerRevision) return;

        for (const [row, match] of rows) {
            players.set(
                row,
                mountAudioPlayer(
                    row.querySelector(".similar-chart-audio"),
                    match,
                    null,
                    {
                        compact: true,
                        onPlay() {
                            for (const [other, dispose] of players)
                                if (other !== row) dispose.pause();
                        },
                    },
                ),
            );
        }
    }

    function showMessage(text, retry = false) {
        disposePlayers();
        const message = document.createElement("li");
        message.className = "similar-charts-empty";
        message.textContent = text;
        if (retry) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "text-button";
            button.dataset.similarUnlockRetry = "";
            button.textContent = "Try again";
            message.append(" ", button);
        }
        list.replaceChildren(message);
    }

    function render() {
        if (!dialog.open || closing || !selection) return;
        if (needsUnlockMethods() && !unlockMethods) {
            showMessage("Loading unlock methods...");
            return;
        }
        const group =
            filter.value === "custom"
                ? "Custom chart"
                : UNLOCK_METHODS[filter.value];
        const matches = findSimilarCharts(
            getCatalog(),
            selection,
            10,
            (chart) =>
                Number.isFinite(chart.level) &&
                chart.level > levelAbove &&
                (filter.value === "all" ||
                    chartUnlockFolder(chart, unlockMethods) === group),
        );
        disposePlayers();
        list.replaceChildren();
        if (!matches.length) {
            showMessage("No similar charts match these filters.");
            return;
        }
        const rows = [];
        for (const match of matches) {
            const item = document.createElement("li");
            const row = document.createElement("article");
            row.className = "similar-chart";
            row.dataset.similarChart = "";
            row.dataset.music = match.music_id;
            row.dataset.diff = match.diff_idx;
            row.innerHTML = renderChart(match);
            const radar = document.createElement("div");
            radar.className = "similar-chart-radar";
            radar.innerHTML = radarMarkup(match.radar);
            const difference = document.createElement("p");
            difference.className = "similar-chart-distance";
            const value = document.createElement("span");
            value.className = "similar-chart-distance-value";
            value.textContent = match.distance.toFixed(1);
            value.style.color = radarDifferenceColor(match.distance);
            difference.append("Difference:", value);
            radar.append(difference);
            row.append(radar);
            item.append(row);
            list.append(item);
            paintRadar(item, match.radar, { animate: false });
            rows.push([row, match]);
        }
        void preparePlayers(rows, playerRevision);
    }

    async function refreshUnlockMethods() {
        if (!dialog.open || closing || !needsUnlockMethods()) return;
        try {
            const previous = unlockMethods;
            unlockMethods = await loadUnlockMethods();
            if (previous !== unlockMethods && needsUnlockMethods()) render();
        } catch {
            if (dialog.open && !closing && needsUnlockMethods() && !unlockMethods)
                showMessage("Unlock methods are unavailable.", true);
        }
    }

    filter.addEventListener("change", () => {
        render();
        void refreshUnlockMethods();
    });

    function updateLevel(event) {
        if (!level.validity.valid || !Number.isFinite(level.valueAsNumber)) {
            if (event.type !== "change") return;
            level.value = "1";
        }
        levelAbove = level.valueAsNumber;
        render();
    }

    level.addEventListener("input", updateLevel);
    level.addEventListener("change", updateLevel);

    function stepLevel(direction) {
        const current = Number.isFinite(level.valueAsNumber)
            ? level.valueAsNumber
            : levelAbove;
        level.value = nextDifficulty(current, direction);
        level.dispatchEvent(new Event("input", { bubbles: true }));
    }

    level.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            level.blur();
            return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        stepLevel(event.key === "ArrowUp" ? 1 : -1);
    });

    dialog.querySelectorAll("[data-similar-level-step]").forEach((button) => {
        button.addEventListener("click", () =>
            stepLevel(Number(button.dataset.similarLevelStep)),
        );
    });

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        disposePlayers();
        dialog.classList.remove("is-visible");
        await Promise.allSettled(
            dialog.getAnimations().map((animation) => animation.finished),
        );
        const closed = new Promise((resolve) =>
            dialog.addEventListener("close", resolve, { once: true }),
        );
        dialog.close();
        await closed;
    }

    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void close();
    });
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
        )
            void close();
    });
    dialog.addEventListener("close", () => {
        closing = false;
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = overflow;
        disposePlayers();
        list.replaceChildren();
        const focus = trigger?.isConnected
            ? trigger
            : document.querySelector("#selected-chart [data-similar-charts]");
        focus?.focus({ preventScroll: true });
    });
    list.addEventListener("click", async (event) => {
        if (event.target.closest("[data-similar-unlock-retry]")) {
            showMessage("Loading unlock methods...");
            void refreshUnlockMethods();
            return;
        }
        if (event.target.closest(".similar-chart-audio")) return;
        const link = event.target.closest("[data-similar-chart]");
        if (
            !link ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        if (closing) return;
        const musicId = Number(link.dataset.music);
        const diff = Number(link.dataset.diff);
        await close();
        selectChart(musicId, diff);
    });

    return {
        open(selected, button) {
            if (dialog.open || closing) return;
            const catalog = getCatalog();
            const song = catalog.find(
                (song) => song.music_id === selected.music_id,
            );
            const chart = song?.difficulties.find(
                (chart) => chart.diff_idx === selected.diff_idx,
            );
            if (!validRadar(chart?.radar)) return;
            dismissSearchKeyboard();
            trigger = button;
            selection = { ...selected };
            source.innerHTML = renderSource({ ...song, ...chart });
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "similar-charts",
                }),
            );
            overflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            render();
            void refreshUnlockMethods();
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            closeButton.focus({ preventScroll: true });
        },
    };
}
