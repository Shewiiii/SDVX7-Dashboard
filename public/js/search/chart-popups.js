import { $ } from "../core/dom.js";
import { hideAnimatedPopup, showAnimatedPopup } from "../core/popovers.js";

let songReadingHideTimer;
export function hideSongReadingPopup() {
    clearTimeout(songReadingHideTimer);
    hideAnimatedPopup($("song-reading-popup"));
}
function scheduleSongReadingHide(event) {
    const pointerLeft = event?.pointerType === "mouse";
    clearTimeout(songReadingHideTimer);
    songReadingHideTimer = setTimeout(() => {
        if (
            pointerLeft ||
            !document.activeElement?.matches(".song-reading-title")
        )
            hideSongReadingPopup();
    }, 150);
}
export function bindSongReadingPopup(reading) {
    const title = document.querySelector(".song-reading-title");
    if (!title || !reading) return;
    const show = () => {
        hideChartVfPopup();
        clearTimeout(songReadingHideTimer);
        const popup = $("song-reading-popup");
        popup.textContent = reading;
        showAnimatedPopup(popup, title);
    };
    title.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") show();
    });
    title.addEventListener("pointerleave", scheduleSongReadingHide);
    title.addEventListener("focus", show);
    title.addEventListener("blur", scheduleSongReadingHide);
}

let chartVfHideTimer;
export function hideChartVfPopup() {
    clearTimeout(chartVfHideTimer);
    hideAnimatedPopup($("chart-vf-popup"));
}

function scheduleChartVfHide(event) {
    const pointerLeft = event?.pointerType === "mouse";
    clearTimeout(chartVfHideTimer);
    chartVfHideTimer = setTimeout(() => {
        if (
            pointerLeft ||
            !document.activeElement?.matches(".chart-vf-trigger")
        )
            hideChartVfPopup();
    }, 150);
}

function showChartVfPopup(trigger) {
    clearTimeout(chartVfHideTimer);
    hideSongReadingPopup();
    const popup = $("chart-vf-popup");
    popup.textContent = trigger.dataset.chartVfDescription;
    showAnimatedPopup(popup, trigger);
}

export function initChartPopups() {
    document.addEventListener("pointerover", (event) => {
        const trigger = event.target.closest(".chart-vf-trigger");
        if (
            trigger &&
            !trigger.contains(event.relatedTarget) &&
            event.pointerType === "mouse"
        )
            showChartVfPopup(trigger);
    });
    document.addEventListener("pointerout", (event) => {
        const trigger = event.target.closest(".chart-vf-trigger");
        if (trigger && !trigger.contains(event.relatedTarget))
            scheduleChartVfHide(event);
    });
    document.addEventListener("focusin", (event) => {
        if (event.target.matches(".chart-vf-trigger"))
            showChartVfPopup(event.target);
    });
    document.addEventListener("focusout", (event) => {
        if (event.target.matches(".chart-vf-trigger")) scheduleChartVfHide();
    });
    document.addEventListener("click", (event) => {
        const trigger = event.target.closest(".chart-vf-trigger");
        if (trigger) showChartVfPopup(trigger);
        else if (!event.target.closest("#chart-vf-popup")) hideChartVfPopup();
        if (!event.target.closest(".song-reading-title, #song-reading-popup"))
            hideSongReadingPopup();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hideSongReadingPopup();
            hideChartVfPopup();
        }
    });
    window.addEventListener(
        "scroll",
        (event) => {
            if (event.target !== $("song-reading-popup"))
                hideSongReadingPopup();
            if (event.target !== $("chart-vf-popup")) hideChartVfPopup();
        },
        { capture: true, passive: true },
    );
    window.addEventListener("resize", hideSongReadingPopup);
    window.addEventListener("resize", hideChartVfPopup);
}
