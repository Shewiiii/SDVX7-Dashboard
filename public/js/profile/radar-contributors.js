import { createPagination } from "../core/pagination.js";
import { setDetailsExpanded } from "../core/expandable-rows.js";
import { motion } from "../core/motion.js";
import { paginate } from "./metrics.js";
import {
    RADAR_AXES,
    highlightRadarContribution,
    paintRadar,
    radarContributionPoints as points,
    radarMarkup,
    rankRadarContributors,
} from "./radar.js";

const number = (value) => value?.toLocaleString() ?? "—";

function contributorDetails(chart) {
    const level = Math.floor(chart.level);
    const multiplier = Math.min(2 * (level + 30), 100);
    const exFactor =
        chart.exscore === null
            ? 0
            : Math.max(
                  1000 +
                      2 *
                          2 ** Math.floor((21 - level) / 2) *
                          (chart.exscore - chart.max_exscore),
                  0,
              );
    const rows = RADAR_AXES.map((axis, index) => {
        const radar = chart.radar[index];
        const normal = Math.floor((3 * chart.score * radar) / 40000000);
        const extra = Math.floor((radar * exFactor) / 4000);
        const retained = chart.contributions[index];
        return `<tr${retained ? "" : ' class="radar-axis-muted"'}><th scope="row" data-axis="${axis.toLowerCase()}">${axis}</th><td class="right">${points(multiplier * normal)}</td><td class="right">${chart.exscore === null ? "—" : points(multiplier * extra)}</td><td class="right">${retained ? points(retained) : "0"}</td></tr>`;
    }).join("");

    return `<div class="radar-contributor-details">
        <div class="selected-song-actions radar-contributor-actions">
            <button type="button" class="calculator-link open-chart" data-music="${chart.music_id}" data-diff="${chart.diff_idx}">View in Search <span aria-hidden="true">→</span></button>
        </div>
        <div class="radar-contributor-breakdown">
            <div class="table-scroll"><table aria-label="Radar contribution by axis">
                <thead><tr><th scope="col">Axis</th><th scope="col" class="right">Score</th><th scope="col" class="right">EX</th><th scope="col" class="right">Total</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <dl class="judgement-counts">
                <div><dt>Best score</dt><dd>${number(chart.score)}</dd></div>
                <div><dt>EX score</dt><dd>${number(chart.exscore)} / ${number(chart.max_exscore)}</dd></div>
                <div><dt>Level multiplier</dt><dd>${multiplier}%</dd></div>
            </dl>
        </div>
        <div class="radar-contributor-chart">${radarMarkup(chart.radar)}</div>
    </div>`;
}

export function createRadarContributors(root, profileRoot, renderChart) {
    const body = root.querySelector("tbody");
    const empty = root.querySelector("[data-radar-contributors-empty]");
    const table = root.querySelector("[data-radar-contributors-table]");
    const pager = root.querySelector(".pagination");
    const filters = root.querySelector("[data-radar-filters]");
    const selectedAxes = new Set();
    let radar;
    let entries = [];
    let page = 0;
    let expanded = null;
    let hovered = null;

    const pagination = createPagination(pager, {
        onChange(requested) {
            page = requested;
            expanded = null;
            render();
        },
    });

    function highlight(chart = null) {
        if (!radar) return;
        if (!chart && !profileRoot.querySelector("[data-active-axes]")) return;
        motion.stop(profileRoot);
        highlightRadarContribution(
            profileRoot,
            radar.values,
            chart?.contributions,
        );
    }

    function updateHighlight() {
        const position = hovered ?? expanded;
        highlight(position === null ? null : entries[position]);
    }

    function renderFilters() {
        filters.hidden = selectedAxes.size === 0;
        filters.innerHTML = [...selectedAxes]
            .map(
                (axis) =>
                    `<div class="calculator-filter radar-axis-tag" data-axis="${RADAR_AXES[axis].toLowerCase()}"><span>${RADAR_AXES[axis]}</span><button type="button" data-remove-radar-axis="${axis}" aria-label="Remove ${RADAR_AXES[axis]} filter"><span aria-hidden="true">×</span></button></div>`,
            )
            .join("");
        profileRoot.querySelectorAll("[data-radar-axis]").forEach((label) => {
            label.setAttribute(
                "aria-pressed",
                String(selectedAxes.has(Number(label.dataset.radarAxis))),
            );
        });
    }

    function toggleAxis(axis) {
        if (selectedAxes.has(axis)) selectedAxes.delete(axis);
        else selectedAxes.add(axis);
        page = 0;
        expanded = null;
        render();
    }

    profileRoot.addEventListener("click", (event) => {
        const label = event.target.closest("[data-radar-axis]");
        if (label) toggleAxis(Number(label.dataset.radarAxis));
    });

    profileRoot.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const label = event.target.closest("[data-radar-axis]");
        if (!label) return;
        event.preventDefault();
        toggleAxis(Number(label.dataset.radarAxis));
    });

    filters.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-radar-axis]");
        if (!button) return;
        const axis = Number(button.dataset.removeRadarAxis);
        toggleAxis(axis);
        profileRoot
            .querySelector(`[data-radar-axis="${axis}"]`)
            ?.focus({ preventScroll: true });
    });

    function render() {
        hovered = null;
        const source = radar?.contributors;
        entries = rankRadarContributors(source ?? [], [...selectedAxes]);
        renderFilters();
        root.hidden = !radar;
        if (!radar) return;
        const available = entries.length > 0;
        empty.hidden = available;
        empty.textContent = Array.isArray(source)
            ? selectedAxes.size
                ? "No charts contribute to these axes"
                : "No contributing charts"
            : "Sync your saved scores to see radar contributors";
        table.hidden = pager.hidden = !available;
        body.replaceChildren();
        if (!available) {
            updateHighlight();
            return;
        }
        const result = paginate(entries, page, 10);
        page = result.page;
        pagination.update(page, result.pages);
        body.innerHTML = result.items
            .map((chart, index) => {
                const position = result.start + index;
                const controls = `radar-contributor-details-${position}`;
                const markup = renderChart(chart, controls);
                return `<tr class="radar-contributor-row" data-contributor="${position}">
                <td class="row-index">${String(position + 1).padStart(2, "0")}</td>
                <td class="radar-contributor-song">${markup.song}</td>
                <td class="radar-contributor-difficulty">${markup.difficulty}</td>
                <td class="radar-contributor-axes">${chart.axes}</td>
                <td class="right vf-cell">${points(chart.total)}</td>
            </tr><tr id="${controls}" class="judgement-row" hidden><td colspan="5">${contributorDetails(chart)}</td></tr>`;
            })
            .join("");
        updateHighlight();
    }

    body.addEventListener("pointerover", (event) => {
        if (event.pointerType === "touch") return;
        const row = event.target.closest("[data-contributor]");
        if (!row || row.contains(event.relatedTarget)) return;
        hovered = Number(row.dataset.contributor);
        updateHighlight();
    });

    body.addEventListener("pointerout", (event) => {
        if (event.pointerType === "touch") return;
        const row = event.target.closest("[data-contributor]");
        if (!row || row.contains(event.relatedTarget)) return;
        hovered = null;
        updateHighlight();
    });

    body.addEventListener("click", (event) => {
        const row = event.target.closest("[data-contributor]");
        if (!row || event.target.closest("a, input, select")) return;
        const position = Number(row.dataset.contributor);
        expanded = expanded === position ? null : position;
        for (const entry of body.querySelectorAll("[data-contributor]")) {
            const isExpanded = Number(entry.dataset.contributor) === expanded;
            setDetailsExpanded(
                entry,
                isExpanded,
                ".judgement-counts > div, .radar-contributor-chart, .radar-contributor-breakdown .table-scroll",
            );
            const button = entry.querySelector(".judgement-toggle");
            button.setAttribute(
                "aria-label",
                `${isExpanded ? "Hide" : "Show"} radar contribution details for ${button.textContent.trim()}`,
            );
        }
        const chart = expanded === null ? null : entries[expanded];
        updateHighlight();
        if (chart) {
            const details = document.getElementById(
                `radar-contributor-details-${expanded}`,
            );
            paintRadar(details, chart.radar, { animate: false });
        }
    });

    return {
        update(next) {
            radar = next;
            page = 0;
            expanded = null;
            render();
        },
    };
}
