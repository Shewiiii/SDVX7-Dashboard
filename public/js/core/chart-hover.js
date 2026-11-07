export function positionChartPopup(popup, container, event) {
    popup.classList.remove("compact");
    popup.style.maxWidth = "";
    popup.hidden = false;

    const wrap = container.getBoundingClientRect();
    const cursorX = event.clientX - wrap.left;
    const cursorY = event.clientY - wrap.top;
    const gap = 12;
    const inset = 8;
    const rightSpace = wrap.width - cursorX - gap - inset;
    const leftSpace = cursorX - gap - inset;
    const useRight =
        rightSpace >= popup.offsetWidth ||
        (leftSpace < popup.offsetWidth && rightSpace >= leftSpace);
    const available = useRight ? rightSpace : leftSpace;

    if (available < popup.offsetWidth) {
        popup.classList.add("compact");
        popup.style.maxWidth = `${available}px`;
    }
    popup.style.left = `${useRight ? cursorX + gap : cursorX - gap - popup.offsetWidth}px`;
    popup.style.top = `${Math.max(inset, Math.min(cursorY - popup.offsetHeight - gap, wrap.height - popup.offsetHeight - inset))}px`;
}

export function bindChartHover(svg, wrap, { show, hide }) {
    svg.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "mouse")
            svg.setPointerCapture(event.pointerId);
        show(event);
    });
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "touch") hide();
    });
    svg.addEventListener("pointerup", (event) => {
        if (event.pointerType !== "mouse") hide();
    });
    svg.addEventListener("pointercancel", hide);
    svg.addEventListener("lostpointercapture", (event) => {
        if (event.pointerType !== "mouse") hide();
    });
    document.addEventListener("pointerdown", (event) => {
        if (!wrap.contains(event.target)) hide();
    });
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
}
