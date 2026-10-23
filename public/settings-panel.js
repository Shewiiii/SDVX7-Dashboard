// Shared disclosure lifecycle for the appearance and chart settings panels.
export function createSettingsPanel({
    toggle,
    panel,
    backdrop,
    container = toggle.parentElement,
    canOpen = () => true,
    focus = "input, button",
    onOpen,
    onClosed,
    signal,
}) {
    let version = 0;
    const events = signal ? { signal } : undefined;
    panel.inert = true;
    function setOpen(open, immediate = false) {
        if (open && !canOpen()) return;
        if (
            open === (toggle.getAttribute("aria-expanded") === "true") &&
            (!immediate || panel.hidden)
        )
            return;
        const current = ++version;
        toggle.setAttribute("aria-expanded", String(open));
        panel.setAttribute("aria-hidden", String(!open));
        if (open) {
            container.classList.add("is-active");
            panel.hidden = false;
            panel.inert = false;
            if (backdrop) backdrop.hidden = false;
            onOpen?.();
            getComputedStyle(panel).opacity;
            if (backdrop) getComputedStyle(backdrop).opacity;
            panel.classList.add("is-visible");
            backdrop?.classList.add("is-visible");
            panel.querySelector(focus)?.focus({ preventScroll: true });
            return;
        }
        panel.inert = true;
        panel.classList.remove("is-visible");
        backdrop?.classList.remove("is-visible");
        const finish = () => {
            if (current !== version) return;
            panel.hidden = true;
            if (backdrop) backdrop.hidden = true;
            container.classList.remove("is-active");
            onClosed?.();
        };
        if (immediate) finish();
        else
            Promise.allSettled(
                [
                    ...panel.getAnimations(),
                    ...(backdrop?.getAnimations() || []),
                ].map((a) => a.finished),
            ).then(finish);
    }
    toggle.addEventListener(
        "click",
        () => setOpen(toggle.getAttribute("aria-expanded") !== "true"),
        events,
    );
    document.addEventListener(
        "pointerdown",
        (event) => {
            if (!container.contains(event.target)) setOpen(false);
        },
        events,
    );
    container.addEventListener(
        "focusout",
        (event) => {
            if (!container.contains(event.relatedTarget)) setOpen(false);
        },
        events,
    );
    document.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Escape" &&
                toggle.getAttribute("aria-expanded") === "true"
            ) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                toggle.focus({ preventScroll: true });
            }
        },
        events,
    );
    signal?.addEventListener("abort", () => setOpen(false, true), {
        once: true,
    });
    return { setOpen };
}
