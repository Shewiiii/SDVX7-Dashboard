import { showPanel } from "../core/panels.js";
import { getJacketUrl } from "./jackets.js";

export function createJacketViewer() {
    const dialog = document.createElement("dialog");
    dialog.className = "jacket-viewer";
    dialog.setAttribute("closedby", "none");
    const image = document.createElement("img");
    image.draggable = true;
    dialog.append(image);
    document.body.append(dialog);
    let request;
    let closing = false;

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        request?.abort();
        dialog.classList.remove("is-visible");
        await Promise.allSettled(
            [
                ...dialog.getAnimations(),
                ...dialog.parentElement.getAnimations(),
            ].map((animation) => animation.finished),
        );
        if (dialog.open) dialog.close();
    }

    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) void close();
    });
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void close();
    });
    dialog.addEventListener("close", () => {
        request?.abort();
        image.removeAttribute("src");
        closing = false;
    });
    window.addEventListener("pagehide", () => {
        request?.abort();
        if (dialog.open) dialog.close();
    });

    return {
        close,
        async open(chart) {
            if (dialog.open || closing) return;
            request?.abort();
            request = new AbortController();
            const { signal } = request;
            try {
                const original = await getJacketUrl(chart, undefined, signal);
                if (signal.aborted || !original) return;
                image.alt = `${chart.title || "Song"} jacket`;
                image.src = original;
                await image.decode();
                if (signal.aborted) return;
                dialog.setAttribute("aria-label", image.alt);
                showPanel(dialog);
                getComputedStyle(dialog).opacity;
                dialog.classList.add("is-visible");
                dialog.focus({ preventScroll: true });
            } catch {
                // Leave the dashboard visible when the large jacket is unavailable
            }
        },
    };
}
