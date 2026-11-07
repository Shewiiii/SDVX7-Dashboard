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
        if (
            event.target.matches("[data-view-jacket]") &&
            (event.key === "Enter" || event.key === " ")
        ) {
            event.preventDefault();
            event.target.click();
        }
    });

    document.addEventListener("click", (event) => {
        const selected = getSelection();
        const songs = getSongs();
        const jacket = event.target.closest("[data-view-jacket]");
        if (jacket && selected) {
            void jacketViewer.open(
                {
                    ...selected,
                    title: songs.get(selected.music_id)?.title,
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
        )
            selectChart(selected.music_id, Number(diff.dataset.chartDiff), {
                animate: false,
                scroll: false,
            });
    });
}
