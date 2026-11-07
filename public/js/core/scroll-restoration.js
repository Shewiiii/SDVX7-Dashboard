import { $ } from "./dom.js";

export function createScrollRestoration({ getData, getView }) {
    let pendingScroll = null;
    let scrollSaveTimer;
    history.scrollRestoration = "manual";

    function rememberScroll() {
        clearTimeout(scrollSaveTimer);
        if (pendingScroll) return;
        history.replaceState(
            {
                ...history.state,
                dashboardScroll: { x: scrollX, y: scrollY },
            },
            "",
        );
    }

    function restoreScroll(position) {
        if (!position) return;
        pendingScroll = position;
        if (!getData()) return;
        pendingScroll = null;
        const bounds = position.card
            ? $(position.card).getBoundingClientRect()
            : null;
        const top = bounds
            ? bounds.top +
              scrollY -
              (position.center ? (innerHeight - bounds.height) / 2 : 16)
            : position.y;
        const smooth =
            position.card &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({
            left: position.x ?? 0,
            top,
            behavior: smooth ? "smooth" : "instant",
        });
        rememberScroll();
    }

    function scrollToCard({ keyboardAware = false } = {}) {
        const view = getView();
        const card = $(view === "search" ? "song-search-view" : "records-view");
        const viewport = window.visualViewport;
        if (keyboardAware && card && viewport) {
            const bounds = card.getBoundingClientRect();
            window.scrollTo({
                left: 0,
                top: Math.max(
                    0,
                    bounds.top + scrollY - viewport.offsetTop - 16,
                ),
                behavior: "smooth",
            });
            rememberScroll();
            return;
        }
        restoreScroll({
            card: view === "search" ? "song-search-view" : "records-view",
        });
    }

    window.addEventListener(
        "scroll",
        () => {
            clearTimeout(scrollSaveTimer);
            scrollSaveTimer = setTimeout(rememberScroll, 120);
        },
        { passive: true },
    );

    return {
        rememberScroll,
        restoreScroll,
        scrollToCard,
        get pending() {
            return pendingScroll;
        },
        set pending(value) {
            pendingScroll = value;
        },
    };
}
