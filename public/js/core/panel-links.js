import { DIFFS } from "../profile/metrics.js";

const PANEL_PARAMS = ["panel", "card", "crew"];
let leavingHistory = false;
let shareSequence = 0;

export function readPanelLink(hash = location.hash) {
    const params = new URLSearchParams(hash.split("?")[1] || "");
    const panel = params.get("panel");
    if (panel === "cards") return { panel };
    const integer = (name, minimum = 0) => {
        const value = params.get(name);
        const number = Number(value);
        return value !== null &&
            /^\d+$/.test(value) &&
            Number.isSafeInteger(number) &&
            number >= minimum
            ? number
            : null;
    };
    if (panel === "card") {
        const card = integer("card");
        return card === null ? null : { panel, card };
    }
    if (panel === "crew") {
        if (!params.has("crew")) return { panel };
        const crew = params.get("crew");
        return crew && /^[a-z0-9_-]+$/i.test(crew) ? { panel, crew } : null;
    }
    if (panel === "details" || panel === "chart") {
        const song = integer("song", 1);
        const diff = integer("diff");
        return song !== null && diff !== null && diff < DIFFS.length
            ? { panel, song, diff }
            : null;
    }
    return null;
}

export function samePanelLink(first, second) {
    return (
        first?.panel === second?.panel &&
        first?.card === second?.card &&
        first?.crew === second?.crew &&
        first?.song === second?.song &&
        first?.diff === second?.diff
    );
}

export function panelUrl(link, { share = false } = {}) {
    const url = new URL(location.href);
    let [route, query = ""] = url.hash.slice(1).split("?");
    let params = new URLSearchParams(query);
    for (const name of PANEL_PARAMS) params.delete(name);
    if (link) {
        if (link.panel === "details" || link.panel === "chart") {
            route = "search";
            params = new URLSearchParams({ song: link.song, diff: link.diff });
        } else if (share) {
            route = "overview";
            params = new URLSearchParams();
        }
        for (const [name, value] of Object.entries(link))
            params.set(name, value);
    }
    url.hash = `#${route || "overview"}${params.size ? "?" + params : ""}`;
    return url;
}

export function setPanelLink(link) {
    const url = panelUrl(link);
    if (url.href !== location.href)
        history.replaceState(history.state, "", url);
}

export function openPanelLink(link) {
    if (samePanelLink(readPanelLink(), link)) return;
    const previous = readPanelLink() && history.state?.dashboardPanel;
    history.pushState(
        {
            ...history.state,
            dashboardPanel: {
                depth: previous ? previous.depth + 1 : 1,
            },
        },
        "",
        panelUrl(link),
    );
}

export function preparePanelHistory() {
    const link = readPanelLink();
    if (!link || history.state?.dashboardPanel) return;
    const { appealCardHelper, ...state } = history.state || {};
    history.replaceState(state, "", panelUrl(null));
    if (link.panel === "card") openPanelLink({ panel: "cards" });
    openPanelLink(link);
}

export function backToCardBrowser() {
    if (leavingHistory) return Promise.resolve();
    if (history.state?.dashboardPanel?.depth > 1) {
        leavingHistory = true;
        return new Promise((resolve) => {
            window.addEventListener(
                "popstate",
                () => {
                    leavingHistory = false;
                    resolve();
                },
                { once: true },
            );
            history.back();
        });
    }
    setPanelLink({ panel: "cards" });
    window.dispatchEvent(new PopStateEvent("popstate"));
    return Promise.resolve();
}

export function closePanelLink(link) {
    if (leavingHistory || !link || !samePanelLink(readPanelLink(), link)) return;
    const depth = history.state?.dashboardPanel?.depth;
    if (!depth) {
        clearPanelLink(link);
        return;
    }
    leavingHistory = true;
    window.addEventListener(
        "popstate",
        () => {
            leavingHistory = false;
        },
        { once: true },
    );
    history.go(-depth);
}

export function clearPanelLink(link) {
    if (!leavingHistory && link && samePanelLink(readPanelLink(), link))
        history.replaceState(history.state, "", panelUrl(null));
}

async function copyLink(text, button) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // Fall back when clipboard access is unavailable
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.className = "sr-only";
    input.setAttribute("aria-label", "Panel link");
    const focused = document.activeElement;
    (button.closest("dialog") || document.body).append(input);
    try {
        input.focus({ preventScroll: true });
        input.select();
        if (!document.execCommand("copy")) throw Error("Copy failed");
    } finally {
        input.remove();
        focused?.focus({ preventScroll: true });
    }
}

export function createPanelShareButton(getLink, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-share details-audio-download-wrap";
    button.setAttribute("aria-label", `Copy link to ${label}`);
    const tooltipId = `panel-share-tooltip-${++shareSequence}`;
    button.setAttribute("aria-describedby", tooltipId);
    button.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg><span id="${tooltipId}" class="details-audio-download-popup" role="tooltip">Copy link</span><span class="sr-only" role="status" aria-live="polite"></span>`;
    const feedback = button.querySelector('[role="status"]');
    const tooltip = button.querySelector('[role="tooltip"]');
    let timer;
    let pointerOutside = false;
    button.addEventListener("pointerenter", () => {
        pointerOutside = false;
    });
    button.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "touch") return;
        pointerOutside = true;
        button.removeAttribute("data-copy-feedback");
    });
    button.addEventListener("blur", () => {
        button.removeAttribute("data-copy-feedback");
    });
    button.addEventListener("click", async () => {
        const link = getLink();
        if (!link) return;
        clearTimeout(timer);
        try {
            await copyLink(panelUrl(link, { share: true }).href, button);
            feedback.textContent = "Link copied";
        } catch {
            feedback.textContent = "Could not copy link";
        }
        tooltip.textContent = feedback.textContent;
        button.toggleAttribute(
            "data-copy-feedback",
            !pointerOutside || button.matches(":focus-visible"),
        );
        timer = setTimeout(() => {
            feedback.textContent = "";
            tooltip.textContent = "Copy link";
            button.removeAttribute("data-copy-feedback");
        }, 2200);
    });
    return button;
}
