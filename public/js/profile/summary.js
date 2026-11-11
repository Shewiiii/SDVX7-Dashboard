import { $, setText } from "../core/dom.js";
import { number, date, shortDate, clock, chartTitle } from "../core/format.js";
import { svgElement, pathData } from "../core/svg.js";
import { motion } from "../core/motion.js";
import { DIFFS, vf, average, volforceClass, playtimeText } from "./metrics.js";
import {
    comparisonVolforce,
    loadVolforceRanking,
    loadVolforceOverrides,
    volforceTopPercent,
} from "./volforce-ranking.js";
import { createVolforceDistribution } from "./volforce-distribution.js";
import { rankingHistory } from "./ranking-history.js";
import { createSpending } from "./spending.js";

export function createProfileSummary({
    getData,
    getStats,
    getSongs,
    rankingOptions,
    row,
}) {
    const volforceDistribution = createVolforceDistribution(
        $("vf-distribution"),
    );
    const spending = createSpending(getData);

    function renderPlaytime() {
        const data = getData();
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

    let volforceRanking = [];
    let volforceOverrides = {};

    function renderVolforcePercentile() {
        const data = getData();
        const stats = getStats();
        const label = $("vf-percentile");
        const total = comparisonVolforce(
            data?.state,
            rankingOptions(),
            volforceOverrides,
        );
        const percent = volforceTopPercent(total, volforceRanking);
        label.hidden = percent === null;
        label.textContent =
            percent === null
                ? ""
                : percent < 0.01
                  ? "Top <0.01%"
                  : `Top ${percent.toFixed(2)}%`;
        volforceDistribution.render(volforceRanking, total, stats?.total);
    }

    function renderSummary({ animate = true } = {}) {
        const data = getData();
        const stats = getStats();
        const songs = getSongs();
        setText(
            "total-vf-label",
            rankingOptions().includeCustom
                ? "Total VolForce (+Custom)"
                : "Total VolForce",
        );
        const name = data.state.name || "Player";
        setText("player-name", name);
        document.title = `${name} - SOUND VOLTEX ∇`;
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
                `${vfClass.name} - View VolForce classes`,
            );
            $("vf-class-icon").src = `/assets/vf-classes/${vfClass.number}.png`;
        }
        renderVolforcePercentile();
        setText("best-vf", vf(stats.best));
        const bestChart = stats.bestChart;
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
        } else setText("best-title", "No data available");
        setText("play-count", number(data.plays.length));
        setText(
            "play-detail",
            `${number(data.plays.filter((p) => p.clear_type > 1).length)} clears`,
        );
        spending.render();
        renderPlaytime();
        setText("entry-vf", vf(stats.entry));
        setText(
            "entry-detail",
            stats.top.length === 50
                ? "in Top 50"
                : `${stats.top.length} / 50 charts recorded`,
        );
        const updated = data.state.updated_at || data.synced_at;
        setText(
            "updated",
            updated
                ? `Last update ${shortDate(updated)} ${clock(updated)}`
                : "Waiting for sync",
        );
        document.querySelector(".hero-meta").hidden = false;
        const latest = stats.sessions.at(-1) || [];
        setText(
            "session-meta",
            latest.length
                ? `${date(latest[0].received_at)} - ${clock(latest[0].received_at)}–${clock(latest.at(-1).received_at)} - ${latest.length} plays`
                : "No data available",
        );
        $("recent-plays").innerHTML = latest.length
            ? [...latest]
                  .reverse()
                  .slice(0, 5)
                  .map((p) => row(p))
                  .join("")
            : '<div class="empty-list">No data available</div>';
        $("top-plays").innerHTML = stats.top.length
            ? stats.top
                  .slice(0, 5)
                  .map((p, i) => row(p, i + 1))
                  .join("")
            : '<div class="empty-list">No data available</div>';
        setText(
            "top-foot",
            `Top ${stats.top.length} average: ${vf(average(stats.top.map((p) => p.vf)) ?? 0)} VF`,
        );
        renderSpark();
        if (animate) {
            motion.metrics(document.querySelector(".metrics"));
            motion.data(document.querySelector(".hero-meta"));
            for (const id of ["session-meta", "top-foot"]) motion.data($(id));
            motion.data($("recent-plays"), ".play-row, .empty-list");
            motion.data($("top-plays"), ".play-row, .empty-list");
        }
    }

    function renderSpark() {
        const data = getData();
        const points = rankingHistory(data, rankingOptions()).observations;
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

    function loadRanking() {
        return Promise.all([loadVolforceRanking(), loadVolforceOverrides()])
            .then(([ranking, overrides]) => {
                volforceRanking = ranking;
                volforceOverrides = overrides;
                renderVolforcePercentile();
            })
            .catch((error) => {
                volforceDistribution.unavailable();
                console.warn(error.message);
            });
    }

    return {
        render: renderSummary,
        renderVolforcePercentile,
        loadRanking,
        loadExchangeRate: spending.loadExchangeRate,
    };
}
