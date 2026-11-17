const storageKey = "sdvx-dashboard-library-view";

export function initLibraryView() {
    const dialog = document.getElementById("song-library");
    const controls = document.getElementById("library-view");
    const buttons = [...controls.querySelectorAll("button[data-library-view]")];

    function applyView(view) {
        dialog.dataset.libraryView = view === "list" ? "list" : "grid";

        for (const button of buttons) {
            const selected =
                button.dataset.libraryView === dialog.dataset.libraryView;
            button.classList.toggle("selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        }
    }

    let savedView;
    try {
        savedView = localStorage.getItem(storageKey);
    } catch {
        // Keep the default view when browser storage is unavailable
    }
    applyView(savedView);

    for (const button of buttons) {
        button.addEventListener("click", () => {
            applyView(button.dataset.libraryView);

            try {
                localStorage.setItem(storageKey, dialog.dataset.libraryView);
            } catch {
                // Keep the selected view for this visit when storage is unavailable
            }
        });
    }
}
