const entries = new Map();
let current = null;
let traversing = false;
let listening = false;
let waiting = [];

export function afterPanelHistory(callback) {
    if (traversing) waiting.push(callback);
    else callback();
}

function back() {
    if (traversing) return;
    traversing = true;
    history.back();
}

function restore(event) {
    const previous = entries.get(current);
    current = history.state?.dashboardOverlay ?? null;
    const ancestors = new Set();
    for (let entry = entries.get(current); entry; entry = entries.get(entry.parent))
        ancestors.add(entry.id);

    // Same-page overlay traversal must not rerender the underlying route
    if (
        previous?.url === location.href &&
        (traversing || !ancestors.has(previous.id))
    )
        event.stopImmediatePropagation();
    for (const entry of entries.values()) {
        if (entry.closed || ancestors.has(entry.id)) continue;
        entry.closed = true;
        entry.close();
    }
    traversing = false;
    if (entries.get(current)?.closed) {
        back();
        return;
    }
    const callbacks = waiting;
    waiting = [];
    for (const callback of callbacks) afterPanelHistory(callback);
}

export function openPanelHistory(close) {
    if (!listening) {
        window.addEventListener("popstate", restore, true);
        listening = true;
    }
    const entry = { id: crypto.randomUUID(), close, closed: false };
    afterPanelHistory(() => {
        if (entry.closed) return;
        entry.parent = history.state?.dashboardOverlay ?? null;
        entry.url = location.href;
        entries.set(entry.id, entry);
        current = entry.id;
        history.pushState(
            { ...history.state, dashboardOverlay: entry.id },
            "",
            location.href,
        );
    });
    return entry;
}

export function closePanelHistory(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    if (
        history.state?.dashboardOverlay === entry.id &&
        location.href === entry.url
    )
        back();
}
