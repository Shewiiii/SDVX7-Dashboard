const panels = [];
const openings = new WeakMap();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let background = [];
let listening = false;
let previousOverflow = "";

const focusableSelector =
    'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

const nextFrame = () => new Promise(requestAnimationFrame);

async function prepareOpening(dialog, layer) {
    if (reducedMotion.matches) return;
    const cleanup = () => {
        if (openings.get(dialog) !== cleanup) return;
        dialog.classList.remove("panel-preparing", "panel-opening");
        openings.delete(dialog);
    };
    const active = () =>
        openings.get(dialog) === cleanup &&
        dialog.open &&
        dialog.classList.contains("is-visible");
    openings.set(dialog, cleanup);
    dialog.classList.add("panel-preparing", "panel-opening");

    try {
        // Let callers finish rendering and commit the hidden starting state.
        await nextFrame();
        await nextFrame();
        if (!active()) return;
        dialog.classList.remove("panel-preparing");
        const animations = [...dialog.getAnimations(), ...layer.getAnimations()];

        // Firefox needs a committed frame at time zero before playback starts.
        for (const animation of animations) {
            animation.pause();
            animation.currentTime = 0;
        }
        await Promise.allSettled(animations.map((animation) => animation.ready));
        await nextFrame();
        if (!active()) return;
        for (const animation of animations) animation.play();
        await Promise.allSettled(animations.map((animation) => animation.finished));
    } finally {
        cleanup();
    }
}

function focusableElements(dialog) {
    return [...dialog.querySelectorAll(focusableSelector)].filter(
        (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") &&
            element.getClientRects().length > 0,
    );
}

function syncPanels() {
    for (const [index, { layer }] of panels.entries()) {
        layer.style.setProperty("--panel-depth", index);
        layer.inert = index !== panels.length - 1;
    }
    for (const [element, inert] of background)
        element.inert = panels.length > 0 || inert;
    if (!panels.length) {
        document.documentElement.style.overflow = previousOverflow;
        background = [];
    }
}

function listen() {
    if (listening) return;
    listening = true;

    // Release the background before individual panels restore their focus.
    document.addEventListener(
        "close",
        (event) => {
            const index = panels.findIndex(
                ({ dialog }) => dialog === event.target,
            );
            if (index < 0 || event.target.open) return;
            const [{ dialog, layer, trigger }] = panels.splice(index, 1);
            openings.get(dialog)?.();
            layer.before(dialog);
            layer.remove();
            syncPanels();
            const top = panels.at(-1);
            if (trigger?.isConnected && (!top || top.dialog.contains(trigger)))
                trigger.focus({ preventScroll: true });
        },
        true,
    );

    document.addEventListener("keydown", (event) => {
        const top = panels.at(-1);
        if (!top || event.defaultPrevented) return;
        const { dialog } = top;
        // Extension popups outside the panel keep their own keyboard behavior.
        if (!dialog.contains(event.target)) return;

        if (event.key === "Escape") {
            event.preventDefault();
            const cancel = new Event("cancel", { cancelable: true });
            if (dialog.dispatchEvent(cancel)) dialog.close();
        } else if (event.key === "Tab") {
            const elements = focusableElements(dialog);
            const first = elements[0],
                last = elements.at(-1);
            if (!first) {
                event.preventDefault();
                dialog.focus({ preventScroll: true });
            } else if (
                (event.shiftKey &&
                    (event.target === first || !elements.includes(event.target))) ||
                (!event.shiftKey && event.target === last)
            ) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus({ preventScroll: true });
            }
        }
    });
}

// Use this for new dashboard dialogs so extension popups can remain above them
export function showPanel(dialog) {
    if (dialog.open) return;
    listen();
    if (!panels.length) {
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        // Only dashboard roots become inert, leaving extension DOM interactive
        background = [...document.querySelectorAll(".shell, .skip-link")].map(
            (element) => [element, element.inert],
        );
    }

    const layer = document.createElement("div");
    layer.className = "panel-layer";
    const trigger = document.activeElement;
    dialog.before(layer);
    layer.append(dialog);
    layer.addEventListener("click", (event) => {
        if (event.target !== layer || panels.at(-1)?.dialog !== dialog) return;
        dialog.dispatchEvent(
            new MouseEvent("click", {
                clientX: event.clientX,
                clientY: event.clientY,
            }),
        );
    });
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");
    panels.push({ dialog, layer, trigger });
    void prepareOpening(dialog, layer);
    dialog.show();
    syncPanels();
    getComputedStyle(layer, "::before").opacity;
}
