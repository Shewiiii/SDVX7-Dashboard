import { $, setText } from "../core/dom.js";
import {
    escape,
    number,
    shortDate,
    clock,
    formatRank,
} from "../core/format.js";
import { createPagination } from "../core/pagination.js";
import { motion } from "../core/motion.js";
import { vf, recordList, chartKey, paginate } from "./metrics.js";
import { badge, clear } from "../charts/chart-markup.js";
import { parseSearch } from "../search/search-query.js";
import { updateSearchClearButtons } from "../search/search-inputs.js";

export function createRecords({
    getData,
    getCatalog,
    getView,
    rankingOptions,
    revealOnce,
    coverMarkup,
    chartInfo,
    playAttributes,
    newPlayAttributes,
    rememberScroll,
    updateUrl,
    scrollToCard,
}) {
    let page = 0;

    function recordPosition(record, { best50, grouped, playCounts }) {
        if (best50) return formatRank(record.rank);
        if (grouped) {
            const count = playCounts.get(chartKey(record));
            return `${number(count)}<br>${count === 1 ? "play" : "plays"}`;
        }
        return `${shortDate(record.received_at)}<br>${clock(record.received_at)}`;
    }

    function recordRow(record, options) {
        return `<tr class="chart-row" ${!options.best50 && !options.grouped ? newPlayAttributes(record) : ""} ${playAttributes(record)} data-music="${record.music_id}" data-diff="${record.diff_idx}">
            <td class="row-index record-position">${recordPosition(record, options)}</td>
            <td class="record-song"><div class="table-song">${coverMarkup(record)}${chartInfo(record, { artist: true, detailsClass: "record-details" })}</div></td>
            <td class="record-difficulty">${badge(record)}</td>
            <td class="score-cell record-score">${number(record.score)}</td>
            <td class="record-clear">${clear(record)}</td>
            <td class="right vf-cell record-vf">${vf(record.vf ?? record.play_vf)}</td>
        </tr>`;
    }

    function renderTable({ animate = true } = {}) {
        const data = getData();
        const catalog = getCatalog();
        const view = getView();
        const best50 = view === "best50";
        const sort = $("sort").value;
        const grouped = !best50 && sort === "plays";
        $("records-view").setAttribute(
            "aria-label",
            best50 ? "Best 50" : "Play history",
        );
        setText("first-column", best50 ? "Rank" : grouped ? "Plays" : "Played");
        setText("records-score-heading", grouped ? "Best score" : "Score");
        setText("records-vf-heading", best50 ? "Chart VF" : "Play VF");
        updateSearchClearButtons();
        if (!data) return;
        animate = revealOnce(view, animate);
        if (!animate) {
            for (const id of ["records", "page-info"]) motion.stop($(id));
        }
        const { records, playCounts } = recordList(data, catalog, {
            ...rankingOptions(),
            best50,
            sort,
            query: $("search").value,
        });
        const pagination = paginate(records, page);
        page = pagination.page;
        const { items: chunk, pages } = pagination;
        $("records").innerHTML = chunk.length
            ? chunk
                  .map((record) =>
                      recordRow(record, { best50, grouped, playCounts }),
                  )
                  .join("")
            : `<tr><td class="empty-state" colspan="6">${escape(parseSearch($("search").value).errors[0] || "No matching charts")}</td></tr>`;
        recordsPagination.update(page, pages);
        if (animate) {
            motion.data($("records"), ".chart-row, tr:not(.chart-row)");
            motion.data($("page-info"));
        }
    }

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
    const recordsPagination = createPagination(
        $("page-info").closest(".pagination"),
        {
            onChange(requested) {
                if (!getData() || !["best50", "history"].includes(getView()))
                    return;
                rememberScroll();
                page = requested;
                renderTable();
                updateUrl();
                scrollToCard();
            },
        },
    );

    return {
        render: renderTable,
        disablePagination: () => recordsPagination.disable(),
        get page() {
            return page;
        },
        set page(value) {
            page = value;
        },
    };
}
