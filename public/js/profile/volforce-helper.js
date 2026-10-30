import { VF_CLASSES, vf, volforceClass } from "./metrics.js";
import { showPanel } from "../core/panels.js";

export function createVolforceHelper(getTotal) {
    const dialog = document.getElementById("vf-helper");
    const closeButton = document.getElementById("vf-helper-close");
    const list = document.getElementById("vf-helper-list");
    const body = dialog.querySelector(".vf-helper-body");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set();
    let trigger,
        navigationFrame,
        locating = false,
        closing = false;

    function updateFades() {
        if (!dialog.open) return;
        const maximum = Math.max(0, body.scrollHeight - body.clientHeight);
        body.classList.toggle("can-scroll-up", body.scrollTop > 1);
        body.classList.toggle("can-scroll-down", body.scrollTop < maximum - 1);
    }
    const fadeObserver = new ResizeObserver(updateFades);
    body.addEventListener("scroll", updateFades, { passive: true });

    function stopMotion() {
        cancelAnimationFrame(navigationFrame);
        locating = false;
        animations.forEach((animation) => animation.cancel());
        animations.clear();
    }

    function animate(element, keyframes, options) {
        const animation = element.animate(keyframes, {
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            ...options,
        });
        animations.add(animation);
        const cleanup = () => animations.delete(animation);
        animation.finished.then(cleanup, cleanup);
    }

    function locateCurrent(smooth) {
        const tier = list.querySelector('[aria-current="step"]');
        if (!tier) return;
        const viewport = body.getBoundingClientRect();
        const bounds = tier.getBoundingClientRect();
        // The shared panel reveal may still be scaling the dialog when we start.
        const scale = viewport.height / body.offsetHeight || 1;
        const start = body.scrollTop;
        const destination = Math.max(
            0,
            Math.min(
                body.scrollHeight - body.clientHeight,
                start +
                    (bounds.top - viewport.top) / scale -
                    (body.clientHeight - bounds.height / scale) / 2,
            ),
        );
        if (!smooth || Math.abs(destination - start) < 2) {
            body.scrollTop = destination;
            locating = false;
            return;
        }
        const began = performance.now();
        function scroll(now) {
            const progress = Math.min(1, (now - began) / 850);
            // Smootherstep starts and ends with zero speed and acceleration.
            const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
            body.scrollTop = start + (destination - start) * eased;
            if (progress < 1) navigationFrame = requestAnimationFrame(scroll);
            else locating = false;
        }
        navigationFrame = requestAnimationFrame(scroll);
    }

    function reveal() {
        stopMotion();
        locating = !!list.querySelector('[aria-current="step"]');
        if (reducedMotion.matches) {
            locateCurrent(false);
            return;
        }
        if (locating) locateCurrent(true);
        animate(
            list,
            [
                { opacity: 0, transform: "translateY(8px)" },
                { opacity: 1, transform: "none" },
            ],
            { duration: 500, fill: "backwards" },
        );
    }

    // Manual navigation takes over immediately from the opening sequence.
    body.addEventListener("wheel", stopMotion, { passive: true });
    body.addEventListener("touchstart", stopMotion, { passive: true });
    body.addEventListener("pointerdown", stopMotion);
    dialog.addEventListener("keydown", (event) => {
        if (
            [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
                " ",
            ].includes(event.key)
        )
            stopMotion();
    });
    reducedMotion.addEventListener("change", () => {
        if (!reducedMotion.matches) return;
        const shouldLocate = locating;
        stopMotion();
        if (shouldLocate && dialog.open && !closing) locateCurrent(false);
    });

    function render() {
        const total = getTotal();
        const current = volforceClass(total);
        list.replaceChildren(
            ...VF_CLASSES.map(({ name, minimum, step }, index) => {
                const item = document.createElement("li");
                item.className = "vf-helper-class";
                const upper = VF_CLASSES[index + 1]?.minimum;
                // All markup comes from the shared, static class definitions.
                item.innerHTML = `
                <div class="vf-helper-class-heading">
                    <h3>${name}</h3>
                </div>
                <div class="vf-helper-emblem"><img src="/assets/vf-classes/${index + 1}.png" alt="" width="72" height="72" loading="lazy"></div>
                <ol class="vf-helper-tiers"></ol>
                <p class="vf-helper-range"><span class="sr-only">VolForce range: </span><span>${vf(minimum)}${upper === undefined ? "+" : ""}</span>${upper === undefined ? "" : `<span class="vf-helper-range-end">–${vf(upper - 0.001)}</span>`}</p>`;
                const tiers = item.querySelector(".vf-helper-tiers");
                for (let rank = 0; rank < 4; rank++) {
                    const threshold = minimum + rank * step;
                    const tier = document.createElement("li");
                    if (current?.name === volforceClass(threshold).name)
                        tier.setAttribute("aria-current", "step");
                    tier.innerHTML = `<span class="vf-helper-stars" aria-label="${rank + 1} ${rank ? "stars" : "star"}">${"★".repeat(rank + 1)}</span><span>${vf(threshold)}</span>`;
                    tiers.append(tier);
                }
                return item;
            }),
        );
    }

    async function close() {
        if (!dialog.open || closing) return;
        closing = true;
        stopMotion();
        dialog.classList.remove("is-visible");
        await Promise.allSettled(dialog.getAnimations().map((a) => a.finished));
        if (dialog.open) dialog.close();
    }
    document.querySelectorAll(".vf-helper-trigger").forEach((button) => {
        button.addEventListener("click", () => {
            if (dialog.open || closing) return;
            trigger = button;
            render();
            document.dispatchEvent(
                new CustomEvent("dashboard:panel-open", {
                    detail: "vf-helper",
                }),
            );
            showPanel(dialog);
            body.scrollTop = 0;
            getComputedStyle(dialog).opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
            reveal();
            updateFades();
            fadeObserver.observe(body);
            fadeObserver.observe(list);
            closeButton.focus({ preventScroll: true });
        });
    });
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
        fadeObserver.disconnect();
        stopMotion();
        closing = false;
        dialog.classList.remove("is-visible");
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
}
