import { isPlainClick } from "../core/song-links.js";

export function initChartActions({
    getSelection,
    getSongs,
    jacketViewer,
    similarCharts,
    chartViewer,
    chartDetails,
    calculator,
    switchView,
    selectChart,
    closeMatches,
}) {
    document.addEventListener("keydown", (event) => {
        if (event.target.matches("[data-view-jacket]") && event.key === " ") {
            event.preventDefault();
            event.target.click();
        }
    });

    document.addEventListener("click", (event) => {
        if (!isPlainClick(event) || event.defaultPrevented) return;
        const selected = getSelection();
        const songs = getSongs();
        const jacket = event.target.closest("[data-view-jacket]");
        const jacketChart = jacket?.dataset.music
            ? {
                  music_id: Number(jacket.dataset.music),
                  diff_idx: Number(jacket.dataset.diff),
              }
            : selected;
        if (jacket && jacketChart) {
            event.preventDefault();
            void jacketViewer.open(
                {
                    ...jacketChart,
                    title: songs.get(jacketChart.music_id)?.title,
                },
                jacket.querySelector("img")?.src,
            );
            return;
        }
        if (!event.target.closest('.song-search, [data-view="search"]'))
            closeMatches();
        const radarButton = event.target.closest("[data-similar-charts]");
        if (radarButton && selected) {
            similarCharts.open(selected, radarButton);
            return;
        }
        const viewerButton = event.target.closest("[data-view-chart]");
        if (viewerButton && selected) {
            event.preventDefault();
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
            event.preventDefault();
            chartDetails.open(selected, detailsButton);
            return;
        }
        if (event.target.closest("[data-view-calculator]") && selected) {
            event.preventDefault();
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
            event.preventDefault();
            const play = button.closest(".chart-row")?.dataset.play;
            selectChart(
                Number(button.dataset.music),
                Number(button.dataset.diff),
                {
                    play: play ? JSON.parse(play) : null,
                },
            );
        }
        const diff = event.target.closest("[data-chart-diff]");
        if (
            diff &&
            selected &&
            Number(diff.dataset.chartDiff) !== selected.diff_idx
        ) {
            event.preventDefault();
            selectChart(selected.music_id, Number(diff.dataset.chartDiff), {
                animate: false,
                scroll: false,
            });
        } else if (diff) event.preventDefault();
    });
}
