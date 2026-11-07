import { $ } from "../core/dom.js";

export function updateSearchClearButtons() {
    document.querySelectorAll("[data-clear-input]").forEach((button) => {
        button.hidden = !$(button.dataset.clearInput).value;
    });
}

export function initSearchInputs() {
    document.querySelectorAll("[data-clear-input]").forEach((button) => {
        const input = $(button.dataset.clearInput);
        input.addEventListener("input", () => {
            button.hidden = !input.value;
        });
        button.addEventListener("pointerdown", (event) =>
            event.preventDefault(),
        );
        button.addEventListener("click", (event) => {
            input.value = "";
            if (
                event.pointerType === "touch" ||
                matchMedia("(pointer: coarse)").matches
            ) {
                input.blur();
            } else {
                input.focus({ preventScroll: true });
            }
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    });
}
