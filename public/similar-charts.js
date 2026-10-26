import { paintRadar, radarMarkup, validRadar } from "./radar.js";
import { dismissSearchKeyboard } from "./search-tools.js";

export function radarDistance(first, second) {
    if (!validRadar(first) || !validRadar(second)) return null;
    return (
        Math.hypot(...first.map((value, axis) => value - second[axis])) /
        Math.sqrt(first.length)
    );
}

export function findSimilarCharts(catalog, selected, limit = 10) {
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
            const distance = radarDistance(source.radar, chart.radar);
            if (distance === null) continue;
            matches.push({ ...song, ...chart, distance });
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
    let trigger,
        overflow = "",
        closing = false;

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
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
        list.replaceChildren();
        const focus = trigger?.isConnected
            ? trigger
            : document.querySelector("#selected-chart [data-similar-charts]");
        focus?.focus({ preventScroll: true });
    });
    list.addEventListener("click", async (event) => {
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
            const matches = findSimilarCharts(catalog, selected);
            source.innerHTML = renderSource({ ...song, ...chart });
            list.replaceChildren();
            for (const match of matches) {
                const item = document.createElement("li");
                const link = document.createElement("a");
                link.className = "similar-chart";
                link.href = `#search?song=${match.music_id}&diff=${match.diff_idx}`;
                link.dataset.similarChart = "";
                link.dataset.music = match.music_id;
                link.dataset.diff = match.diff_idx;
                link.innerHTML = renderChart(match) + radarMarkup(match.radar);
                item.append(link);
                list.append(item);
            }
            if (!matches.length) {
                const message = document.createElement("li");
                message.className = "similar-charts-empty";
                message.textContent = "No other charts have radar data yet.";
                list.append(message);
            }
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "similar-charts",
                }),
            );
            overflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            for (const [index, item] of [...list.children].entries()) {
                if (matches[index])
                    paintRadar(item, matches[index].radar, { animate: false });
            }
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            closeButton.focus({ preventScroll: true });
        },
    };
}
