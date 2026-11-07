const popupVersions = new WeakMap();
export function hideAnimatedPopup(popup) {
    if (!popup.matches(":popover-open") || popup.classList.contains("closing"))
        return;
    const version = (popupVersions.get(popup) || 0) + 1;
    popupVersions.set(popup, version);
    popup.classList.add("closing");
    Promise.allSettled(
        popup.getAnimations().map((animation) => animation.finished),
    ).then(() => {
        if (version !== popupVersions.get(popup)) return;
        popup.hidePopover();
        popup.classList.remove("closing");
    });
}
export function showAnimatedPopup(popup, trigger) {
    popupVersions.set(popup, (popupVersions.get(popup) || 0) + 1);
    popup.classList.remove("closing");
    popup.showPopover();
    positionPopup(popup, trigger);
}

function positionPopup(popup, trigger) {
    const anchor = trigger.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, innerWidth - box.width - 12))}px`;
    const top =
        anchor.bottom + 10 + box.height <= innerHeight - 12
            ? anchor.bottom + 10
            : anchor.top - box.height - 10;
    popup.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`;
}
