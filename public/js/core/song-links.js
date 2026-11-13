import { panelUrl } from "./panel-links.js";

export function isPlainClick(event) {
    return (
        event.button === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey
    );
}

export function songPath(music, diff) {
    return `#search?song=${music}&diff=${diff}`;
}

export function chartPath(music, diff, panel) {
    return `${songPath(music, diff)}&panel=${panel}`;
}

export function calculatorPath(music, diff) {
    return `#calculator?song=${music}&diff=${diff}`;
}

export function cardPath(card) {
    return panelUrl({ panel: "card", card }).hash;
}

export function crewPath(crew) {
    return panelUrl({ panel: "crew", crew }).hash;
}
