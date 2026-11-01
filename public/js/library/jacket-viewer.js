import { showPanel } from "../core/panels.js";
import { getJacketUrl } from "./jackets.js";

export function createJacketViewer() {
    const dialog = document.createElement("dialog");
    dialog.className = "jacket-viewer";
    dialog.setAttribute("closedby", "none");
    const image = document.createElement("img");
    image.draggable = true;
    const loading = document.createElement("span");
    loading.className = "jacket-viewer-loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Loading...";
    loading.hidden = true;
    dialog.append(image, loading);
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
        loading.hidden = true;
        closing = false;
    });
    window.addEventListener("pagehide", () => {
        request?.abort();
        if (dialog.open) dialog.close();
    });

    return {
        close,
        async open(chart, fallback) {
            if (dialog.open || closing) return;
            request?.abort();
            request = new AbortController();
            const { signal } = request;
            image.alt = `${chart.title || "Song"} jacket`;
            image.hidden = true;
            loading.hidden = false;
            dialog.setAttribute("aria-label", image.alt);
            showPanel(dialog);
            getComputedStyle(dialog).opacity;
            dialog.classList.add("is-visible");
            dialog.focus({ preventScroll: true });

            try {
                const url = await getJacketUrl(chart, fallback, signal);
                if (signal.aborted || !url) return;
                const original = new Image();
                original.src = url;
                await original.decode();
                if (!signal.aborted && dialog.open) {
                    image.src = url;
                    image.hidden = false;
                }
            } catch {
                if (!signal.aborted && dialog.open && fallback) {
                    image.src = fallback;
                    image.hidden = false;
                }
            } finally {
                if (!signal.aborted) loading.hidden = true;
            }
        },
    };
}
