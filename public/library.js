import { dismissSearchKeyboard } from "./search-tools.js";
import { parseSearch, songVersion } from "./search-query.js";
import {
    CLEARS,
    SCORE_GRADES,
    grade,
    chartKey,
    searchSongs,
} from "./metrics.js";
import { SONG_GENRES, SONG_VERSIONS } from "./song-metadata.js";
import { SKILL_ANALYZER_COURSES } from "./game-data/skill-analyzer.js";
import {
    UNLOCK_METHODS,
    unlockFolder,
    loadUnlockMethods as fetchUnlockMethods,
} from "./unlock-methods.js";

// Song folders retain search's selection. Chart folders open the exact difficulty.
export const chartFolderMode = (mode) =>
    ["level", "clear", "grade", "skill"].includes(mode);

const versionNames = Object.values(SONG_VERSIONS);
const skillFolderOrder = new Map(
    [...SKILL_ANALYZER_COURSES]
        .sort(
            (a, b) =>
                (a.level || Infinity) - (b.level || Infinity) ||
                a.folder.localeCompare(b.folder, undefined, { numeric: true }),
        )
        .map((course, index) => [course.folder, index]),
);
const versionOrder = (name) => {
    const position = versionNames.indexOf(name);
    return position < 0 ? versionNames.length : position;
};

export function autoOpenLibraryFolders(query, entries) {
    const parsed = parseSearch(query);
    const nameSearch =
        parsed.tokens.length > 0 ||
        parsed.filters.some(
            ({ field, operator }) =>
                ["title", "artist"].includes(field) && operator === "=",
        );
    const songs = new Set(entries.map((entry) => entry.song.music_id)).size;
    return !parsed.errors.length && nameSearch && songs > 0 && songs <= 10;
}

export function libraryEntries(
    data,
    catalog,
    mode,
    query = "",
    unlockMethods = new Map(),
    skillCourses = SKILL_ANALYZER_COURSES,
) {
    const best = new Map();
    for (const chart of [...data.plays, ...(data.state.charts || [])]) {
        const key = chartKey(chart),
            previous = best.get(key) || { score: 0, clear_type: 0 };
        best.set(key, {
            score: Math.max(previous.score, chart.score || 0),
            clear_type: Math.max(previous.clear_type, chart.clear_type || 0),
        });
    }
    const entries = [];
    const searchQuery = mode === "boss" ? `${query} boss=true` : query;
    for (const song of searchSongs(catalog, searchQuery, data.plays, Infinity)) {
        if (mode === "skill") {
            for (const course of skillCourses) {
                for (const [position, track] of course.tracks.entries()) {
                    if (track.music_id !== song.music_id) continue;
                    const difficulty = song.difficulties.find(
                        (chart) => chart.diff_idx === track.diff_idx,
                    );
                    if (!difficulty) continue;
                    entries.push({
                        group: course.folder,
                        position,
                        song: {
                            ...song,
                            ...difficulty,
                            difficulties: [difficulty],
                        },
                    });
                }
            }
        } else if (mode === "unlock") {
            const grouped = new Map();
            for (const difficulty of song.difficulties) {
                const key = chartKey({ music_id: song.music_id, ...difficulty });
                const group =
                    song.is_custom || difficulty.is_custom
                        ? "Custom chart"
                        : unlockFolder(
                              unlockMethods.get(key) ||
                                  unlockMethods.get(`${song.music_id}:*`),
                          );
                if (!grouped.has(group)) grouped.set(group, []);
                grouped.get(group).push(difficulty);
            }
            for (const [group, difficulties] of grouped) {
                difficulties.sort((a, b) => a.diff_idx - b.diff_idx);
                const preferred =
                    difficulties.find((d) => d.diff_idx === song.diff_idx) ||
                    difficulties[0];
                entries.push({
                    group,
                    song: { ...song, ...preferred, difficulties },
                });
            }
        } else if (chartFolderMode(mode)) {
            for (const d of song.difficulties) {
                const key = chartKey({ music_id: song.music_id, ...d });
                const record = best.get(key);
                const group =
                    mode === "level"
                        ? `Level ${Math.floor(d.level)}`
                        : mode === "clear"
                          ? CLEARS[record?.clear_type || 0]
                          : record?.score
                            ? grade(record.score)
                            : "Unplayed";
                entries.push({
                    group,
                    song: { ...song, ...d, difficulties: [d] },
                });
            }
        } else {
            const groups =
                mode === "all" || mode === "boss"
                    ? ["All"]
                    : mode === "version"
                      ? [SONG_VERSIONS[songVersion(song)] || "Unknown version"]
                      : mode === "year"
                        ? [
                              song.release_year
                                  ? String(song.release_year)
                                  : "Unknown year",
                          ]
                        : song.is_custom
                          ? ["Custom chart"]
                          : SONG_GENRES.filter(
                                ([bit]) => (song.genre || 0) & bit,
                            ).map(([, label]) => label);
            for (const group of new Set(groups.length ? groups : ["Other"]))
                entries.push({ group, song });
        }
    }
    return entries.sort(
        (a, b) =>
            (mode === "version"
                ? versionOrder(a.group) - versionOrder(b.group)
                : mode === "skill"
                  ? skillFolderOrder.get(a.group) - skillFolderOrder.get(b.group)
                  : mode === "year"
                    ? b.group.localeCompare(a.group, undefined, { numeric: true })
                    : a.group.localeCompare(b.group, undefined, {
                          numeric: true,
                      })) ||
            a.song.title.localeCompare(b.song.title) ||
            a.song.music_id - b.song.music_id ||
            a.song.diff_idx - b.song.diff_idx,
    );
}

export function sortLibraryEntries(entries, order = "date-desc") {
    const name = (a, b) =>
        a.song.title.localeCompare(b.song.title, undefined, {
            numeric: true,
        }) ||
        a.song.music_id - b.song.music_id ||
        a.song.diff_idx - b.song.diff_idx;
    const max = (song, field) =>
        Math.max(...song.difficulties.map((d) => d[field]));
    const date = (song) =>
        song.release_date ||
        (song.release_year ? `${song.release_year}-01-01` : null);
    return [...entries].sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined)
            return a.position - b.position;
        if (order.startsWith("date-")) {
            const x = date(a.song),
                y = date(b.song);
            if (!x || !y) return (x ? -1 : y ? 1 : 0) || name(a, b);
            return (
                (order === "date-desc"
                    ? y.localeCompare(x)
                    : x.localeCompare(y)) || name(a, b)
            );
        }
        if (order.startsWith("level-")) {
            const direction = order.endsWith("desc") ? -1 : 1;
            return (
                direction * (max(a.song, "level") - max(b.song, "level")) ||
                name(a, b)
            );
        }
        if (order === "artist")
            return a.song.artist.localeCompare(b.song.artist) || name(a, b);
        return order === "name-desc" ? -name(a, b) : name(a, b);
    });
}

export function createLibrary(getData, getCatalog, renderSong, selectSong) {
    const dialog = document.getElementById("song-library");
    const query = document.getElementById("library-query");
    const mode = document.getElementById("library-group");
    const sort = document.getElementById("library-sort");
    const results = document.getElementById("library-results");
    const openButton = document.getElementById("open-library");
    const closeButton = document.getElementById("library-close");
    let entries = [],
        overflow = "",
        closing = false;
    let unlockMethods,
        unlockTask,
        unlockError,
        unlockLoadedAt = 0;
    const folderState = new Map();
    const searchFolderState = new Map();
    let folderQuery = "";

    function loadUnlockMethods() {
        if (unlockTask) return;
        unlockTask = fetchUnlockMethods()
            .then((methods) => {
                unlockMethods = methods;
                unlockLoadedAt = Date.now();
                unlockError = null;
            })
            .catch(() => {
                unlockError = "Unlock methods are unavailable. Try again.";
            })
            .finally(() => {
                unlockTask = null;
                if (dialog.open && !closing && mode.value === "unlock")
                    render(true);
            });
    }

    function folderNames() {
        const names = new Set(entries.map((entry) => entry.group));
        if (mode.value === "level")
            for (let i = 1; i <= 20; i++) names.add(`Level ${i}`);
        if (mode.value === "clear") for (const mark of CLEARS) names.add(mark);
        if (mode.value === "genre")
            for (const label of [
                ...SONG_GENRES.map(([, label]) => label),
                "Custom chart",
            ])
                names.add(label);
        if (mode.value === "unlock")
            for (const label of [...Object.values(UNLOCK_METHODS), "Custom chart"])
                names.add(label);
        if (mode.value === "version")
            for (const label of versionNames) names.add(label);
        const gradeOrder = [
            ...SCORE_GRADES.map(([, label]) => label),
            "Unplayed",
        ];
        return [...names].sort((a, b) =>
            mode.value === "version"
                ? versionOrder(a) - versionOrder(b)
                : mode.value === "skill"
                  ? skillFolderOrder.get(a) - skillFolderOrder.get(b)
                  : mode.value === "year"
                    ? b.localeCompare(a, undefined, { numeric: true })
                    : mode.value === "grade"
                      ? gradeOrder.indexOf(a) - gradeOrder.indexOf(b)
                      : mode.value === "clear"
                        ? CLEARS.indexOf(a) - CLEARS.indexOf(b)
                        : a.localeCompare(b, undefined, { numeric: true }),
        );
    }
    function render(rebuild = false) {
        sort.disabled = mode.value === "skill";
        const currentQuery = query.value.trim();
        if (currentQuery !== folderQuery) {
            folderQuery = currentQuery;
            searchFolderState.clear();
        }
        const data = getData();
        if (!data) {
            results.textContent = "Sync your archive to browse the library.";
            return;
        }
        if (
            mode.value === "unlock" &&
            (!unlockMethods || Date.now() - unlockLoadedAt >= 60000)
        ) {
            results.replaceChildren();
            document.getElementById("library-count").textContent = "";
            if (unlockError) {
                const message = document.createElement("p");
                message.textContent = unlockError;
                const retry = document.createElement("button");
                retry.type = "button";
                retry.className = "text-button";
                retry.textContent = "Retry";
                retry.addEventListener("click", () => {
                    unlockError = null;
                    render(true);
                });
                results.append(message, retry);
            } else {
                results.textContent = "Loading unlock methods...";
                loadUnlockMethods();
            }
            return;
        }
        if (rebuild) {
            entries = libraryEntries(
                data,
                getCatalog(),
                mode.value,
                query.value,
                unlockMethods,
            );
        }
        const grouped = new Map(folderNames().map((name) => [name, []]));
        for (const entry of entries) grouped.get(entry.group).push(entry);
        const shown = entries;
        const autoOpen = autoOpenLibraryFolders(currentQuery, entries);
        results.replaceChildren();
        let visibleGroups = 0;
        for (const [name, items] of grouped) {
            if (query.value.trim() && !items.length) continue;
            const key = `${mode.value}:${name}`;
            const state = folderState.get(key) || { open: false, page: 0 };
            folderState.set(key, state);
            const content = document.createElement("div");
            content.className = "library-folder-content";
            let folder,
                heading = content;
            if (["all", "boss"].includes(mode.value)) {
                results.append(content);
            } else {
                folder = document.createElement("details");
                folder.className = "library-folder";
                heading = document.createElement("summary");
                const title = document.createElement("span"),
                    count = document.createElement("small");
                title.textContent = name;
                count.textContent = `${items.length.toLocaleString()} ${chartFolderMode(mode.value) ? "charts" : "songs"}`;
                heading.append(title, count);
                folder.append(heading, content);
                results.append(folder);
            }
            visibleGroups++;
            let populated = false;
            function populate() {
                populated = true;
                content.replaceChildren();
                const pages = Math.max(1, Math.ceil(items.length / 48));
                state.page = Math.max(0, Math.min(state.page, pages - 1));
                const list = document.createElement("div");
                list.className = "library-song-grid";
                const sorted = sortLibraryEntries(items, sort.value);
                for (const entry of sorted.slice(
                    state.page * 48,
                    (state.page + 1) * 48,
                )) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "song-option library-song";
                    button.innerHTML = renderSong(entry.song);
                    button.addEventListener("click", async () => {
                        dismissSearchKeyboard();
                        await close();
                        selectSong(entry.song.music_id, entry.song.diff_idx);
                    });
                    list.append(button);
                }
                content.append(list);
                if (!items.length) {
                    const empty = document.createElement("p");
                    empty.className = "library-count";
                    empty.textContent = "No matching charts.";
                    content.append(empty);
                }
                const pager = document.createElement("div");
                pager.className = "pagination library-pagination";
                const info = document.createElement("span"),
                    number = document.createElement("button"),
                    input = document.createElement("input");
                number.type = "button";
                number.className = "pagination-page-number";
                number.textContent = state.page + 1;
                number.setAttribute(
                    "aria-label",
                    `Page ${state.page + 1} of ${pages} in ${name}. Enter page number`,
                );
                input.type = "number";
                input.className = "pagination-page-input";
                input.min = 1;
                input.max = pages;
                input.step = 1;
                input.inputMode = "numeric";
                input.hidden = true;
                input.setAttribute("aria-label", `Page number in ${name}`);
                info.append("Page ", number, input, ` / ${pages}`);
                const buttons = document.createElement("div"),
                    first = document.createElement("button"),
                    previous = document.createElement("button"),
                    next = document.createElement("button"),
                    last = document.createElement("button");
                first.type = previous.type = next.type = last.type = "button";
                first.textContent = "⇇";
                previous.textContent = "←";
                next.textContent = "→";
                last.textContent = "⇉";
                first.setAttribute("aria-label", `First page in ${name}`);
                previous.setAttribute("aria-label", `Previous page in ${name}`);
                next.setAttribute("aria-label", `Next page in ${name}`);
                last.setAttribute("aria-label", `Last page in ${name}`);
                first.disabled = previous.disabled = state.page === 0;
                last.disabled = next.disabled = state.page === pages - 1;
                const go = (value) => {
                    state.page = Math.max(
                        0,
                        Math.min(pages - 1, Math.trunc(value)),
                    );
                    populate();
                    dialog.scrollTo({
                        top: Math.max(
                            0,
                            dialog.scrollTop +
                                heading.getBoundingClientRect().top -
                                dialog.getBoundingClientRect().top -
                                12,
                        ),
                        behavior: matchMedia("(prefers-reduced-motion: reduce)")
                            .matches
                            ? "instant"
                            : "smooth",
                    });
                };
                first.addEventListener("click", () => go(0));
                previous.addEventListener("click", () => go(state.page - 1));
                next.addEventListener("click", () => go(state.page + 1));
                last.addEventListener("click", () => go(pages - 1));
                number.addEventListener("click", () => {
                    number.hidden = true;
                    input.hidden = false;
                    input.value = state.page + 1;
                    input.focus({ preventScroll: true });
                    input.select();
                });
                function finish(cancel = false) {
                    if (input.hidden) return;
                    input.hidden = true;
                    number.hidden = false;
                    if (
                        !cancel &&
                        input.value.trim() &&
                        Number.isFinite(Number(input.value))
                    )
                        go(Number(input.value) - 1);
                }
                input.addEventListener("blur", () => finish());
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        input.blur();
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        finish(true);
                        number.focus({ preventScroll: true });
                    }
                });
                buttons.append(first, previous, next, last);
                pager.append(info, buttons);
                content.append(pager);
            }
            if (folder) {
                const initialOpen =
                    searchFolderState.get(key) ?? (autoOpen || state.open);
                let observedOpen = initialOpen;
                folder.open = initialOpen;
                folder.addEventListener("toggle", () => {
                    if (!folder.isConnected || folder.open === observedOpen)
                        return;
                    observedOpen = folder.open;
                    if (autoOpen)
                        searchFolderState.set(key, folder.open);
                    else state.open = folder.open;
                    if (folder.open && !populated) populate();
                });
                if (folder.open) populate();
            } else {
                populate();
            }
        }
        if (!visibleGroups)
            results.textContent =
                parseSearch(query.value).errors[0] || "No matching songs.";
        document.getElementById("library-count").textContent = chartFolderMode(
            mode.value,
        )
            ? `${shown.length.toLocaleString()} charts · ${new Set(shown.map((entry) => entry.song.music_id)).size.toLocaleString()} songs`
            : `${new Set(shown.map((entry) => entry.song.music_id)).size.toLocaleString()} songs`;
    }
    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        dialog.classList.remove("is-visible");
        await Promise.allSettled(dialog.getAnimations().map((a) => a.finished));
        const closed = new Promise((resolve) =>
            dialog.addEventListener("close", resolve, { once: true }),
        );
        dialog.close();
        await closed;
    }
    openButton.addEventListener("click", () => {
        if (dialog.open || closing) return;
        document.dispatchEvent(
            new CustomEvent("dashboard:panel-open", { detail: "song-library" }),
        );
        overflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        dialog.showModal();
        getComputedStyle(dialog).opacity;
        getComputedStyle(dialog, "::backdrop").opacity;
        dialog.classList.add("is-visible");
        render(true);
        const initialFocus = matchMedia("(hover: hover) and (pointer: fine)")
            .matches
            ? query
            : closeButton;
        initialFocus.focus({ preventScroll: true });
    });
    dialog.addEventListener("close", () => {
        closing = false;
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = overflow;
        openButton.focus({ preventScroll: true });
    });
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        void close();
    });
    dialog.addEventListener("click", (e) => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
        )
            void close();
    });
    let queryTimer;
    function updateQuery() {
        for (const state of folderState.values()) state.page = 0;
        render(true);
    }
    query.addEventListener("input", () => {
        clearTimeout(queryTimer);
        queryTimer = setTimeout(updateQuery, 120);
    });
    query.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            clearTimeout(queryTimer);
            updateQuery();
            query.blur();
        }
    });
    mode.addEventListener("change", () => {
        render(true);
    });
    sort.addEventListener("change", () => {
        for (const state of folderState.values()) state.page = 0;
        render();
    });
    return {
        update() {
            if (dialog.open && !closing) render(true);
        },
    };
}
