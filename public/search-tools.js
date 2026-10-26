import { installSearchIndex, parseSearch } from "./search-query.js";
import { loadBossCharts } from "./boss-charts.js";

export function dismissSearchKeyboard() {
    const input = document.activeElement;
    if (input?.matches(".search-wrap input")) input.blur();
}

export function initSearchTools(onReady) {
    const key = "song-search-index-v1";
    let task,
        installed = false,
        checkedAt = 0,
        retryAfter = 0,
        cached,
        searchMessage = "",
        bossMessage = "",
        bossTask,
        bossLoaded = false,
        bossRetryAfter = 0;
    const status = document.getElementById("search-metadata-status");
    function updateStatus() {
        const text = [searchMessage, bossMessage].filter(Boolean).join(" ");
        status.textContent = text;
        status.hidden = !text;
    }
    function message(text) {
        searchMessage = text;
        updateStatus();
    }
    async function ensureBossCharts() {
        if (bossTask) return bossTask;
        if (bossLoaded || Date.now() < bossRetryAfter) return;
        bossMessage = "Loading boss chart data...";
        updateStatus();
        bossTask = loadBossCharts()
            .then(() => {
                bossLoaded = true;
                bossMessage = "";
                onReady();
            })
            .catch(() => {
                bossRetryAfter = Date.now() + 60000;
                bossMessage = "Boss chart data unavailable.";
            })
            .finally(() => {
                bossTask = null;
                updateStatus();
            });
        return bossTask;
    }
    async function ensureSearchMetadata() {
        if (task) return task;
        if (Date.now() < retryAfter) return;
        if (installed && Date.now() - checkedAt < 300000) return;
        if (!installed) {
            try {
                cached = JSON.parse(localStorage.getItem(key));
                if (cached && Date.now() - cached.at < 30 * 86400000) {
                    installSearchIndex(cached.data);
                    installed = true;
                    checkedAt = cached.at;
                    onReady();
                    if (Date.now() - checkedAt < 300000) return;
                }
            } catch {
                cached = null;
            }
        }
        message(
            installed
                ? "Checking search metadata..."
                : "Loading additional search metadata...",
        );
        task = (async () => {
            try {
                const response = await fetch("/api/search");
                if (!response.ok) throw Error("Search unavailable");
                const data = await response.json();
                installSearchIndex(data);
                installed = true;
                checkedAt = Date.now();
                try {
                    localStorage.setItem(
                        key,
                        JSON.stringify({ at: checkedAt, data }),
                    );
                } catch {
                    /* Memory cache still works. */
                }
                message(
                    data.rows.length
                        ? ""
                        : "Additional search metadata hasn’t synced yet.",
                );
                onReady();
            } catch {
                retryAfter = Date.now() + 60000;
                checkedAt = Date.now() - 240000;
                message(
                    installed
                        ? "Using saved search metadata; could not check for updates."
                        : "Additional search metadata unavailable. Refocus search in a minute to retry.",
                );
            } finally {
                task = null;
            }
        })();
        return task;
    }
    const selector = "#song-query, #search, #library-query";
    function ensure() {
        const tasks = [ensureSearchMetadata()];
        if (
            document.getElementById("library-group").value === "boss" ||
            [...document.querySelectorAll(selector)].some((input) =>
                parseSearch(input.value).filters.some(
                    ({ field }) => field === "boss",
                ),
            )
        )
            tasks.push(ensureBossCharts());
        return Promise.all(tasks);
    }
    document.addEventListener("focusin", (event) => {
        if (event.target.matches(selector)) void ensure();
    });
    document.addEventListener("input", (event) => {
        if (!event.target.matches(selector)) return;
        void ensure();
        const error = parseSearch(event.target.value).errors[0];
        event.target.setAttribute("aria-invalid", String(!!error));
        event.target.title = error || "";
    });
    const ensureLibraryMetadata = () => {
        if (
            ["version", "boss"].includes(
                document.getElementById("library-group").value,
            )
        )
            void ensure();
    };
    document
        .getElementById("library-group")
        .addEventListener("change", ensureLibraryMetadata);
    document
        .getElementById("open-library")
        .addEventListener("click", ensureLibraryMetadata);

    const dialog = document.getElementById("search-help"),
        closeButton = document.getElementById("search-help-close");
    let trigger,
        overflow,
        closing = false;
    document.querySelectorAll("[data-search-help]").forEach((button) =>
        button.addEventListener("click", () => {
            if (dialog.open || closing) return;
            trigger = button;
            overflow = document.documentElement.style.overflow;
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "search-help",
                }),
            );
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            closeButton.focus({ preventScroll: true });
        }),
    );
    async function close() {
        if (closing || !dialog.open) return;
        closing = true;
        dialog.classList.remove("is-visible");
        await Promise.allSettled(dialog.getAnimations().map((a) => a.finished));
        dialog.close();
    }
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void close();
    });
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
        )
            void close();
    });
    dialog.addEventListener("close", () => {
        closing = false;
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = overflow;
        trigger?.focus({ preventScroll: true });
    });
    return { ensure };
}
