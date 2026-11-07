import { createPlayHighlights } from "./live.js";

export function createPlayHighlightMarkup() {
    const playHighlights = createPlayHighlights();
    let highlightCleanup,
        highlightPending = false;
    function newPlayAttributes(play) {
        const age = playHighlights.age(play);
        if (age === null) return "";
        if (!highlightPending) {
            highlightPending = true;
            queueMicrotask(() => {
                highlightPending = false;
                clearExpiredHighlights();
            });
        }
        return `data-new-play-until="${Date.now() + playHighlights.duration - age}"`;
    }
    function clearExpiredHighlights() {
        clearTimeout(highlightCleanup);
        for (const element of document.querySelectorAll(
            "[data-new-play-until]",
        )) {
            if (Number(element.dataset.newPlayUntil) <= Date.now()) {
                delete element.dataset.newPlayUntil;
                element.style.removeProperty("--new-play-age");
            } else {
                const age =
                    playHighlights.duration -
                    (Number(element.dataset.newPlayUntil) - Date.now());
                element.style.setProperty(
                    "--new-play-age",
                    `-${Math.max(0, age)}ms`,
                );
            }
        }
        const next = playHighlights.nextExpiry();
        if (next !== null && next > Date.now())
            highlightCleanup = setTimeout(
                clearExpiredHighlights,
                next - Date.now() + 10,
            );
    }

    return {
        update: playHighlights.update,
        newPlayAttributes,
        clearExpiredHighlights,
    };
}
