import { dismissSearchKeyboard } from "./search-tools.js";
import { showPanel } from "./panels.js";
import { normalizeSearch } from "./metrics.js";
import { createCrewViewer } from "./crew-viewer.js";

const TARGET_PAGE_SIZE = 48;

export function createAppealCardHelper(getState) {
    const dialog = document.getElementById("appeal-helper");
    const browser = document.getElementById("appeal-helper-browser");
    const detail = document.getElementById("appeal-helper-detail");
    const grid = document.getElementById("appeal-helper-grid");
    const search = document.getElementById("appeal-helper-search");
    const sort = document.getElementById("appeal-helper-sort");
    const pageNumber = document.getElementById("appeal-helper-page-number");
    const pageInput = document.getElementById("appeal-helper-page-input");
    const count = document.getElementById("appeal-helper-count");
    const previous = document.getElementById("appeal-helper-previous");
    const next = document.getElementById("appeal-helper-next");
    const back = document.getElementById("appeal-helper-back");
    const crewViewer = createCrewViewer(dialog, getState);
    const tabs = [...dialog.querySelectorAll("[data-customize-tab]")];
    const tabList = dialog.querySelector(".customize-tabs");
    let view = "cards";

    function switchTab(next) {
        if (next === view) return;
        view = next;
        dialog.dataset.customizeView = view;
        for (const tab of tabs) {
            const selected = tab.dataset.customizeTab === view;
            tab.classList.toggle("selected", selected);
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
        if (view === "crew") {
            if (!detail.hidden) leaveDetailHistory();
            browser.hidden = true;
            detail.hidden = true;
            dialog.setAttribute("closedby", "closerequest");
            void crewViewer.show();
        } else {
            crewViewer.hide();
            renderBrowser();
        }
    }
    for (const [index, tab] of tabs.entries()) {
        tab.addEventListener("click", () =>
            switchTab(tab.dataset.customizeTab),
        );
        tab.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                return;
            event.preventDefault();
            const next =
                event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                        tabs.length;
            tabs[next].click();
            tabs[next].focus();
        });
    }
    let cards = [],
        signature,
        selectedId = null,
        page = 1,
        pageSize = TARGET_PAGE_SIZE,
        totalPages = 1;
    let scrollPosition = 0,
        closing = false;
    let detailHistoryActive = false,
        historyReturning = false,
        detailHistoryUrl = "";

    function image(card, lazy = true) {
        const frame = document.createElement("span");
        frame.className = "appeal-helper-image is-loading";
        frame.setAttribute("aria-busy", "true");
        const skeleton = document.createElement("span");
        skeleton.className = "skeleton-shape";
        skeleton.setAttribute("aria-hidden", "true");
        const error = document.createElement("span");
        error.className = "appeal-helper-image-error";
        error.textContent = "Image unavailable";
        error.hidden = true;
        const img = document.createElement("img");
        img.alt = card.title;
        img.loading = lazy ? "lazy" : "eager";
        img.decoding = "async";
        img.width = 128;
        img.height = 164;
        function failed() {
            frame.classList.remove("is-loading");
            frame.classList.add("has-error");
            frame.setAttribute("aria-busy", "false");
            img.hidden = true;
            error.hidden = false;
        }
        img.addEventListener("error", failed, { once: true });
        img.addEventListener(
            "load",
            async () => {
                try {
                    await img.decode();
                } catch {
                    failed();
                    return;
                }
                if (!frame.isConnected) return;
                frame.classList.remove("is-loading");
                frame.classList.add("is-loaded");
                frame.setAttribute("aria-busy", "false");
            },
            { once: true },
        );
        frame.append(skeleton, img, error);
        img.src = `/api/cover?id=${card.image}`;
        return frame;
    }

    function matchingCards() {
        const tokens = search.value
            .trim()
            .split(/\s+/)
            .map(normalizeSearch)
            .filter(Boolean);
        return cards
            .filter((card) =>
                tokens.every((token) => card.search.includes(token)),
            )
            .sort((a, b) =>
                sort.value === "oldest" ? a.id - b.id : b.id - a.id,
            );
    }

    function fitPageSize() {
        if (!grid.clientWidth) return false;
        const viewportHeight = window.visualViewport?.height || innerHeight;
        dialog.style.setProperty(
            "--card-browser-viewport-height",
            `${viewportHeight}px`,
        );
        const center =
            (window.visualViewport?.offsetTop || 0) + viewportHeight / 2;
        dialog.style.setProperty(
            "--card-browser-viewport-center",
            `${center}px`,
        );
        dialog.style.removeProperty("--card-browser-image-height");
        const gridStyle = getComputedStyle(grid);
        const columns = gridStyle.gridTemplateColumns.split(/\s+/).length;
        const gap = parseFloat(gridStyle.rowGap) || 0;
        let card = grid.querySelector(".appeal-helper-card"),
            probe;
        if (!card) {
            probe = card = document.createElement("button");
            card.className = "appeal-helper-card";
            card.setAttribute("aria-hidden", "true");
            card.style.visibility = "hidden";
            const image = document.createElement("span");
            image.className = "appeal-helper-image";
            card.append(image, document.createElement("span"));
            grid.append(card);
        }
        // Exclude the grid itself: headers, wrapped tools, count and padding
        // all consume part of the available viewport, including the keyboard.
        const chrome = dialog.scrollHeight - grid.offsetHeight;
        const available = Math.max(0, viewportHeight - 36 - chrome - 2);
        let cardHeight = card.offsetHeight;
        if (available < cardHeight) {
            const imageHeight = card.querySelector(
                ".appeal-helper-image",
            ).offsetHeight;
            const height = Math.max(0, imageHeight - (cardHeight - available));
            dialog.style.setProperty(
                "--card-browser-image-height",
                `${height}px`,
            );
            cardHeight = card.offsetHeight;
        }
        probe?.remove();
        const rows = Math.max(
            1,
            Math.floor((available + gap) / (cardHeight + gap)),
        );
        const fullRows = Math.min(rows, Math.floor(TARGET_PAGE_SIZE / columns));
        const nextSize = columns * Math.max(1, fullRows);
        if (nextSize === pageSize) return false;
        // Preserve the first visible card when viewport dimensions change.
        page = Math.floor(((page - 1) * pageSize) / nextSize) + 1;
        pageSize = nextSize;
        return true;
    }

    function renderBrowser({ anchorId = null } = {}) {
        dialog.setAttribute("closedby", "closerequest");
        browser.hidden = false;
        detail.hidden = true;
        const matches = matchingCards();
        count.textContent = `${matches.length.toLocaleString()} ${matches.length === 1 ? "card" : "cards"}`;
        fitPageSize();
        if (anchorId !== null) {
            const index = matches.findIndex((card) => card.id === anchorId);
            if (index >= 0) page = Math.floor(index / pageSize) + 1;
        }
        totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
        page = Math.max(1, Math.min(page, totalPages));
        previous.disabled = page === 1;
        next.disabled = page === totalPages;
        pageNumber.textContent = page;
        pageNumber.setAttribute(
            "aria-label",
            `Page ${page}. Enter page number`,
        );
        pageInput.max = totalPages;
        if (pageInput.hidden) pageInput.value = page;
        document.getElementById("appeal-helper-total-pages").textContent =
            totalPages;
        document.getElementById("appeal-helper-search-clear").hidden =
            !search.value;
        const fragment = document.createDocumentFragment();
        for (const card of matches.slice(
            (page - 1) * pageSize,
            page * pageSize,
        )) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "appeal-helper-card";
            button.dataset.appealId = card.id;
            const label = document.createElement("span");
            label.textContent = `${card.id} - ${card.title}`;
            button.title = label.textContent;
            if (card.image === getState()?.appeal_card) {
                button.classList.add("is-current");
                button.setAttribute("aria-current", "true");
            }
            button.append(image(card), label);
            fragment.append(button);
        }
        if (!matches.length) {
            const empty = document.createElement("p");
            empty.className = "appeal-helper-empty";
            empty.textContent = cards.length
                ? "No matching appeal cards."
                : "No appeal cards available yet.";
            fragment.append(empty);
        }
        grid.replaceChildren(fragment);
    }

    function showDetail(card) {
        // Let Back traverse the detail history entry instead of dismissing the modal.
        dialog.setAttribute("closedby", "none");
        selectedId = card.id;
        browser.hidden = true;
        detail.hidden = false;
        document
            .getElementById("appeal-helper-artwork")
            .replaceChildren(image(card, false));
        document.getElementById("appeal-helper-card-title").textContent =
            `${card.id} - ${card.title}`;
        dialog.scrollTop = 0;
    }

    function returnToBrowser() {
        restoreBrowser();
        leaveDetailHistory();
    }

    function restoreBrowser() {
        renderBrowser({ anchorId: selectedId });
        dialog.scrollTop = scrollPosition;
        grid.querySelector(`[data-appeal-id="${selectedId}"]`)?.focus({
            preventScroll: true,
        });
    }

    function leaveDetailHistory() {
        if (
            !detailHistoryActive ||
            historyReturning ||
            !history.state?.appealCardHelper
        )
            return;
        historyReturning = true;
        history.back();
    }

    function restoreHistory() {
        const cardId = history.state?.appealCardHelper;
        if (detailHistoryActive && !cardId) {
            const samePage = location.href === detailHistoryUrl;
            detailHistoryActive = false;
            historyReturning = false;
            if (dialog.open && !closing) {
                if (samePage) {
                    if (view === "cards") restoreBrowser();
                } else void closeDialog();
            }
            // Preserve the dashboard's filters and scroll when only the card changed.
            return samePage;
        }
        if (dialog.open && !closing && !historyReturning && cardId) {
            const card = cards.find((item) => item.id === cardId);
            if (card) {
                switchTab("cards");
                detailHistoryActive = true;
                detailHistoryUrl = location.href;
                if (detail.hidden) scrollPosition = dialog.scrollTop;
                showDetail(card);
                back.focus({ preventScroll: true });
                return true;
            }
        }
        return false;
    }

    function update() {
        const source = getState()?.appeal_cards || [];
        const nextSignature = JSON.stringify(source);
        if (nextSignature === signature) return;
        signature = nextSignature;
        cards = (Array.isArray(source) ? source : [])
            .filter(
                (card) =>
                    Number.isInteger(card?.id) &&
                    typeof card.title === "string" &&
                    typeof card.image === "string" &&
                    /^[a-f0-9]{64}$/.test(card.image),
            )
            .map((card) => ({
                ...card,
                search: normalizeSearch(`${card.id} ${card.title}`),
            }));
        if (!dialog.open || view !== "cards") return;
        const selected = cards.find((card) => card.id === selectedId);
        if (selected && !detail.hidden) showDetail(selected);
        else renderBrowser();
    }

    document
        .getElementById("appeal-helper-open")
        .addEventListener("click", () => {
            if (dialog.open || closing || historyReturning) return;
            if (history.state?.appealCardHelper) {
                const { appealCardHelper, ...state } = history.state;
                history.replaceState(state, "");
            }
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "appeal-helper",
                }),
            );
            update();
            search.value = "";
            const current = cards.find(
                (card) => card.image === getState()?.appeal_card,
            );
            page = 1;
            pageInput.hidden = true;
            pageNumber.hidden = false;
            selectedId = null;
            switchTab("cards");
            tabList.hidden = false;
            browser.hidden = false;
            detail.hidden = true;
            showPanel(dialog);
            renderBrowser({ anchorId: current?.id ?? null });
            // Establish both starting styles before fading the panel/backdrop in.
            getComputedStyle(dialog).opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            // Browsing on a phone should not immediately open its keyboard.
            const initialFocus = matchMedia(
                "(hover: hover) and (pointer: fine)",
            ).matches
                ? search
                : document.getElementById("appeal-helper-close");
            initialFocus.focus({ preventScroll: true });
        });
    async function closeDialog() {
        if (!dialog.open || closing) return;
        closing = true;
        crewViewer.hide();
        leaveDetailHistory();
        dialog.classList.remove("is-visible");
        // Only wait for the panel; its children may still have loading shimmers.
        await Promise.allSettled(
            dialog.getAnimations().map((animation) => animation.finished),
        );
        if (dialog.open) dialog.close();
    }
    document
        .getElementById("appeal-helper-close")
        .addEventListener("click", closeDialog);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (!detail.hidden) returnToBrowser();
        else void closeDialog();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (!detail.hidden) returnToBrowser();
        else void closeDialog();
    });
    dialog.addEventListener("close", () => {
        leaveDetailHistory();
        closing = false;
        crewViewer.hide();
        dialog.classList.remove("is-visible");
        // Release thumbnails after closing; reopening starts with the full catalog.
        grid.replaceChildren();
        document.getElementById("appeal-helper-artwork").replaceChildren();
        document
            .getElementById("appeal-helper-open")
            .focus({ preventScroll: true });
    });
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
        ) {
            if (!detail.hidden) returnToBrowser();
            else void closeDialog();
        }
    });
    grid.addEventListener("click", (event) => {
        if (historyReturning || closing) return;
        const button = event.target.closest("[data-appeal-id]");
        if (!button) return;
        const card = cards.find(
            (item) => item.id === Number(button.dataset.appealId),
        );
        if (!card) return;
        dismissSearchKeyboard();
        scrollPosition = dialog.scrollTop;
        detailHistoryUrl = location.href;
        history.pushState({ ...history.state, appealCardHelper: card.id }, "");
        detailHistoryActive = true;
        showDetail(card);
        back.focus({ preventScroll: true });
    });
    back.addEventListener("click", returnToBrowser);
    search.addEventListener("input", () => {
        page = 1;
        renderBrowser();
    });
    sort.addEventListener("change", () => {
        page = 1;
        renderBrowser();
        dialog.scrollTop = 0;
    });
    function finishPageEdit(cancel = false) {
        if (pageInput.hidden) return;
        const requested = Number(pageInput.value);
        pageInput.hidden = true;
        pageNumber.hidden = false;
        if (!cancel && pageInput.value.trim() && Number.isFinite(requested))
            page = Math.max(1, Math.min(totalPages, Math.trunc(requested)));
        renderBrowser();
        scrollToBrowserTop();
    }
    pageNumber.addEventListener("click", () => {
        pageNumber.hidden = true;
        pageInput.hidden = false;
        pageInput.value = page;
        pageInput.focus({ preventScroll: true });
        pageInput.select();
    });
    pageInput.addEventListener("blur", () => finishPageEdit());
    pageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            pageInput.blur();
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finishPageEdit(true);
            pageNumber.focus({ preventScroll: true });
        }
    });
    search.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            search.blur();
        }
    });
    for (const [button, direction] of [
        [previous, -1],
        [next, 1],
    ]) {
        button.addEventListener("click", () => {
            page += direction;
            renderBrowser();
            scrollToBrowserTop();
        });
    }
    function scrollToBrowserTop() {
        dialog.scrollTo({
            top: 0,
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
        });
    }
    function resizeBrowser() {
        if (dialog.open && view === "cards" && !browser.hidden && fitPageSize())
            renderBrowser();
    }
    const observer = new ResizeObserver(resizeBrowser);
    for (const element of [
        grid,
        browser.querySelector(".appeal-helper-tools"),
        dialog.querySelector(".appeal-helper-heading"),
    ])
        observer.observe(element);
    window.addEventListener("resize", resizeBrowser);
    window.visualViewport?.addEventListener("resize", resizeBrowser);
    window.visualViewport?.addEventListener("scroll", resizeBrowser);
    document.fonts?.ready.then(resizeBrowser);
    return { update, restoreHistory };
}
