import { VF_CLASSES, vf, volforceClass } from "./metrics.js";

export function createVolforceHelper(getTotal) {
    const dialog = document.getElementById("vf-helper");
    const closeButton = document.getElementById("vf-helper-close");
    const list = document.getElementById("vf-helper-list");
    let trigger,
        previousOverflow,
        closing = false;

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
            previousOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = "hidden";
            dialog.showModal();
            getComputedStyle(dialog).opacity;
            getComputedStyle(dialog, "::backdrop").opacity;
            dialog.classList.add("is-visible");
            dialog.scrollTop = 0;
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
        closing = false;
        dialog.classList.remove("is-visible");
        document.documentElement.style.overflow = previousOverflow;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
}
