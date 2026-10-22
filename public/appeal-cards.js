import { normalizeSearch } from "./metrics.js";

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
    let cards = [],
        signature,
        selectedId = null,
        page = 1,
        pageSize = TARGET_PAGE_SIZE,
        totalPages = 1;
    let scrollPosition = 0,
        previousOverflow = "",
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
        const columns =
            getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
        const nextSize = Math.max(
            columns,
            Math.round(TARGET_PAGE_SIZE / columns) * columns,
        );
        if (nextSize === pageSize) return false;
        // Keep the current range visible when the grid changes width.
        page = Math.floor(((page - 1) * pageSize) / nextSize) + 1;
        pageSize = nextSize;
        return true;
    }

    function renderBrowser({ anchorId = null } = {}) {
        dialog.setAttribute("closedby", "closerequest");
        browser.hidden = false;
        detail.hidden = true;
        fitPageSize();
        const matches = matchingCards();
        if (anchorId !== null) {
            const index = matches.findIndex((card) => card.id === anchorId);
            if (index >= 0) page = Math.floor(index / pageSize) + 1;
        }
        totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
        page = Math.max(1, Math.min(page, totalPages));
        count.textContent = `${matches.length.toLocaleString()} ${matches.length === 1 ? "card" : "cards"}`;
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
                if (samePage) restoreBrowser();
                else void closeDialog();
            }
            // Preserve the dashboard's filters and scroll when only the card changed.
            return samePage;
        }
        if (dialog.open && !closing && !historyReturning && cardId) {
            const card = cards.find((item) => item.id === cardId);
            if (card) {
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
        if (!dialog.open) return;
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
            browser.hidden = false;
            detail.hidden = true;
            previousOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            renderBrowser({ anchorId: current?.id ?? null });
            // Establish both starting styles before fading the panel/backdrop in.
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
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
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = previousOverflow;
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
    new ResizeObserver(() => {
        if (dialog.open && !browser.hidden && fitPageSize()) renderBrowser();
    }).observe(grid);
    return { update, restoreHistory };
}
