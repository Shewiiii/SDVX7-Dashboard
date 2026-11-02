export function createPagination(root, { onChange }) {
    const number = root.querySelector(".pagination-page-number");
    const input = root.querySelector(".pagination-page-input");
    const total = root.querySelector("[data-pagination-total]");
    const buttons = Object.fromEntries(
        [...root.querySelectorAll("[data-pagination-action]")].map((button) => [
            button.dataset.paginationAction,
            button,
        ]),
    );
    let page = 0;
    let pages = 1;

    function goTo(requested) {
        if (!Number.isFinite(requested)) return;
        onChange(Math.max(0, Math.min(pages - 1, Math.trunc(requested))));
    }

    function finishEdit(cancel = false) {
        if (input.hidden) return;
        const value = input.value.trim();
        input.hidden = true;
        number.hidden = false;
        if (!cancel && value) goTo(Number(value) - 1);
    }

    buttons.first.addEventListener("click", () => goTo(0));
    buttons.previous.addEventListener("click", () => goTo(page - 1));
    buttons.next.addEventListener("click", () => goTo(page + 1));
    buttons.last.addEventListener("click", () => goTo(pages - 1));
    number.addEventListener("click", () => {
        number.hidden = true;
        input.hidden = false;
        input.value = page + 1;
        input.focus({ preventScroll: true });
        input.select();
    });
    input.addEventListener("blur", () => finishEdit());
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            finishEdit();
            number.focus({ preventScroll: true });
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finishEdit(true);
            number.focus({ preventScroll: true });
        }
    });

    return {
        update(currentPage, totalPages) {
            page = currentPage;
            pages = totalPages;
            number.textContent = page + 1;
            total.textContent = pages;
            number.disabled = false;
            number.setAttribute(
                "aria-label",
                `Page ${page + 1} of ${pages}. Enter page number`,
            );
            input.max = pages;
            if (input.hidden) input.value = page + 1;
            buttons.first.disabled = buttons.previous.disabled = page === 0;
            buttons.last.disabled = buttons.next.disabled = page + 1 >= pages;
        },
        disable() {
            finishEdit(true);
            for (const button of [number, ...Object.values(buttons)])
                button.disabled = true;
        },
    };
}
