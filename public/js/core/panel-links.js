import { afterPanelHistory } from "./panel-history.js";
import { DIFFS } from "../profile/metrics.js";

const PANEL_PARAMS = ["panel", "card", "crew"];
let leavingHistory = false;

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

export function panelUrl(link) {
    const url = new URL(location.href);
    let [route, query = ""] = url.hash.slice(1).split("?");
    let params = new URLSearchParams(query);
    for (const name of PANEL_PARAMS) params.delete(name);
    if (link) {
        if (link.panel === "details" || link.panel === "chart") {
            route = "search";
            params = new URLSearchParams({ song: link.song, diff: link.diff });
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
    afterPanelHistory(() => pushPanelLink(link));
}

function pushPanelLink(link) {
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
