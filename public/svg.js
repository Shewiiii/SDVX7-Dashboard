const NS = "http://www.w3.org/2000/svg";

export function svgElement(tag, attrs = {}, content) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) =>
        element.setAttribute(key, value),
    );
    if (content !== undefined) element.textContent = content;
    return element;
}

export function pathData(points, x, y, step = false) {
    if (!points.length) return "";
    return points
        .map((point, index) => {
            const px = x(point[0]).toFixed(2),
                py = y(point[1]).toFixed(2);
            return index === 0
                ? `M${px},${py}`
                : step
                  ? `H${px}V${py}`
                  : `L${px},${py}`;
        })
        .join(" ");
}
