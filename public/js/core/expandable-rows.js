import { motion } from "./motion.js";

export const DETAILS_CHEVRON =
    '<svg class="judgement-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

export function setDetailsExpanded(row, expanded, selector) {
    const button = row.querySelector(".judgement-toggle");
    const details = document.getElementById(
        button.getAttribute("aria-controls"),
    );
    if (details.hidden === !expanded) return false;
    details.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    if (expanded) motion.data(details, selector);
    else motion.stop(details);
    return true;
}
