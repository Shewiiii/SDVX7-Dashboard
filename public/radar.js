// Database order, clockwise from the top, matching the in-game effect radar.
const AXES = ["NOTES", "PEAK", "TSUMAMI", "TRICKY", "HAND-TRIP", "ONE-HAND"];

export function radarMarkup(values) {
    if (
        !Array.isArray(values) ||
        values.length !== AXES.length ||
        !values.every((value) => Number.isFinite(value) && value >= 0)
    )
        return '<div class="song-radar song-radar-empty"><span>Effect radar unavailable</span></div>';

    // The reference hexagon is 100, so values above 100 extend beyond it.
    // Keep the reference geometry fixed; expand the viewBox for overflow.
    const gridRadius = 68;
    const unit = gridRadius / 100;
    const point = (axis, radius) => {
        const angle = (axis * Math.PI) / 3 - Math.PI / 2;
        return [150 + Math.cos(angle) * radius, 116 + Math.sin(angle) * radius];
    };
    const pair = (point) => point.map((value) => value.toFixed(2)).join(",");
    const polygon = (radii) =>
        radii.map((radius, axis) => pair(point(axis, radius))).join(" ");
    const description = AXES.map(
        (axis, index) => `${axis}: ${values[index]}`,
    ).join(", ");
    const outline = polygon(AXES.map(() => gridRadius));
    const spokes = AXES.map((_, axis) => {
        const [x, y] = point(axis, gridRadius);
        return `<line x1="150" y1="116" x2="${x}" y2="${y}"/>`;
    }).join("");
    const ticks = AXES.flatMap((_, axis) => {
        const angle = (axis * Math.PI) / 3;
        const dx = Math.cos(angle) * 2.5;
        const dy = Math.sin(angle) * 2.5;
        return [0.25, 0.5, 0.75].map((ratio) => {
            const [x, y] = point(axis, gridRadius * ratio);
            return `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}"/>`;
        });
    }).join("");
    const labels = AXES.map((label, axis) => {
        const [x, y] = point(axis, gridRadius + 20);
        const anchor =
            axis === 0 || axis === 3 ? "middle" : axis < 3 ? "start" : "end";
        return `<text x="${x}" y="${y - 3}" text-anchor="${anchor}" class="song-radar-label">${label}<tspan x="${x}" dy="14" class="song-radar-value">${values[axis]}</tspan></text>`;
    }).join("");
    const vertices = values.map((value, axis) => point(axis, value * unit));
    const left = Math.min(0, ...vertices.map(([x]) => Math.floor(x - 10)));
    const top = Math.min(0, ...vertices.map(([, y]) => Math.floor(y - 10)));
    const right = Math.max(300, ...vertices.map(([x]) => Math.ceil(x + 10)));
    const bottom = Math.max(238, ...vertices.map(([, y]) => Math.ceil(y + 10)));

    return `<figure class="song-radar"><svg viewBox="${left} ${top} ${right - left} ${bottom - top}" role="img" aria-label="Effect radar, reference hexagon at 100; higher values extend beyond it. ${description}">
        <defs><clipPath id="song-radar-clip"><polygon points="${polygon(values.map((value) => value * unit))}"/></clipPath></defs>
        <g class="song-radar-grid"><polygon points="${outline}"/></g>
        <image class="song-radar-fill" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" clip-path="url(#song-radar-clip)"/>
        <polygon class="song-radar-area" points="${polygon(values.map((value) => value * unit))}"/>
        <g class="song-radar-axes">${spokes}${ticks}</g>
        ${labels}
    </svg><figcaption>Effect radar <span>Grid edge: 100</span></figcaption></figure>`;
}

export function paintRadar(container, values) {
    const svg = container.querySelector(".song-radar svg");
    if (!svg) return;
    const { x, y, width, height } = svg.viewBox.baseVal;
    const scale = 600 / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    const styles = getComputedStyle(svg);
    const color = (variable) => {
        context.fillStyle = styles.getPropertyValue(variable).trim();
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const centerColor = color("--radar-center-color");
    const blue = color("--radar-gradient-start");
    const purple = color("--radar-gradient-middle");
    const red = color("--radar-gradient-end");
    const mix = (a, b, amount) =>
        a.map((channel, i) => channel + (b[i] - channel) * amount);
    const vertexColor = (value) => {
        if (value <= 100) return mix(centerColor, blue, value / 100);
        if (value <= 130) return mix(blue, purple, (value - 100) / 30);
        return mix(purple, red, Math.min(1, (value - 130) / 20));
    };
    const toPixel = (point) => [(point.x - x) * scale, (point.y - y) * scale];
    const center = toPixel({ x: 150, y: 116 });
    const points = [...svg.querySelector(".song-radar-area").points].map(
        toPixel,
    );
    const colors = values.map(vertexColor);
    const pixels = context.createImageData(canvas.width, canvas.height);

    // Interpolate the center and axis colors across six triangles. A single
    // vertical gradient gives a low NOTES value the same color as a high PEAK.
    for (let axis = 0; axis < AXES.length; axis++) {
        const next = (axis + 1) % AXES.length;
        const [ax, ay] = points[axis];
        const [bx, by] = points[next];
        const [cx, cy] = center;
        const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denominator) < 0.000001) continue;
        const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const maxX = Math.min(
            canvas.width - 1,
            Math.ceil(Math.max(ax, bx, cx)),
        );
        const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const maxY = Math.min(
            canvas.height - 1,
            Math.ceil(Math.max(ay, by, cy)),
        );
        for (let py = minY; py <= maxY; py++) {
            for (let px = minX; px <= maxX; px++) {
                const a =
                    ((by - cy) * (px + 0.5 - cx) +
                        (cx - bx) * (py + 0.5 - cy)) /
                    denominator;
                const b =
                    ((cy - ay) * (px + 0.5 - cx) +
                        (ax - cx) * (py + 0.5 - cy)) /
                    denominator;
                const c = 1 - a - b;
                if (Math.min(a, b, c) < -0.005) continue;
                const offset = (py * canvas.width + px) * 4;
                for (let channel = 0; channel < 3; channel++)
                    pixels.data[offset + channel] =
                        colors[axis][channel] * a +
                        colors[next][channel] * b +
                        centerColor[channel] * c;
                pixels.data[offset + 3] = 255;
            }
        }
    }
    context.putImageData(pixels, 0, 0);
    svg.querySelector(".song-radar-fill").setAttribute(
        "href",
        canvas.toDataURL(),
    );
}
