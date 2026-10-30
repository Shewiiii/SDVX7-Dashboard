// Database order, clockwise from the top, matching the in-game effect radar.
const AXES = ["Notes", "Peak", "Tsumami", "Tricky", "Hand-Trip", "One-Hand"];

const transitions = new WeakMap();
const painters = new WeakMap();
let radarSequence = 0;

export function selectProfileRadar(radar, { includeCustom = false } = {}) {
    if (includeCustom || radar == null) return radar;
    return radar.without_custom;
}

export function validRadar(values) {
    return (
        Array.isArray(values) &&
        values.length === AXES.length &&
        AXES.every(
            (_, axis) => Number.isFinite(values[axis]) && values[axis] >= 0,
        )
    );
}

export function radarMarkup(
    values,
    { interactive = false, profile = false } = {},
) {
    if (!validRadar(values))
        return '<div class="song-radar song-radar-empty"><span>Effect radar unavailable</span></div>';

    // The reference hexagon is 100, so values above 100 extend beyond it.
    // Keep the reference geometry fixed and expand the viewBox for overflow.
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
        const value = profile ? values[axis].toFixed(2) : values[axis];
        return `<text x="${x}" y="${y - 3}" text-anchor="${anchor}" class="song-radar-label" data-axis="${label.toLowerCase()}"><tspan class="song-radar-label-name">${label}</tspan><tspan x="${x}" dy="14" class="song-radar-value">${value}</tspan></text>`;
    }).join("");
    const vertices = values.map((value, axis) => point(axis, value * unit));
    const left = Math.min(0, ...vertices.map(([x]) => Math.floor(x - 10)));
    const top = Math.min(0, ...vertices.map(([, y]) => Math.floor(y - 10)));
    const right = Math.max(300, ...vertices.map(([x]) => Math.ceil(x + 10)));
    const bottom = Math.max(238, ...vertices.map(([, y]) => Math.ceil(y + 10)));

    const clipId = `song-radar-clip-${++radarSequence}`;
    const tag = interactive ? "button" : "figure";
    const attributes = interactive
        ? 'class="song-radar radar-trigger" type="button" data-similar-charts aria-label="Show similar charts" aria-haspopup="dialog" aria-controls="similar-charts"'
        : `class="song-radar${profile ? " profile-radar" : ""}"`;

    return `<${tag} ${attributes}><svg viewBox="${left} ${top} ${right - left} ${bottom - top}" role="img" aria-label="${profile ? "Profile" : "Effect"} radar, reference hexagon at 100; higher values extend beyond it. ${description}">
        <defs><clipPath id="${clipId}"><polygon points="${polygon(values.map((value) => value * unit))}"/></clipPath></defs>
        <g class="song-radar-graphic">
        <g class="song-radar-grid"><polygon points="${outline}"/></g>
        <image class="song-radar-fill" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" clip-path="url(#${clipId})"/>
        <polygon class="song-radar-area" points="${polygon(values.map((value) => value * unit))}"/>
        <g class="song-radar-axes">${spokes}${ticks}</g>
        </g>
        ${labels}</svg>${interactive ? "<span>Similar charts</span>" : ""}</${tag}>`;
}

function drawRadar(svg, values, resolution) {
    const { x, y, width, height } = svg.viewBox.baseVal;
    const scale = resolution / Math.max(width, height);
    let painter = painters.get(svg);
    if (!painter) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const styles = getComputedStyle(svg);
        const color = (variable) => {
            context.fillStyle = styles.getPropertyValue(variable).trim();
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        painter = {
            canvas,
            context,
            profile: svg.closest(".profile-radar") !== null,
            centerColor: color("--radar-center-color"),
            blue: color("--radar-gradient-start"),
            purple: color("--radar-gradient-middle"),
            red: color("--radar-gradient-end"),
        };
        painters.set(svg, painter);
    }
    const { canvas, context, centerColor, blue, purple, red } = painter;
    const pixelWidth = Math.ceil(width * scale);
    const pixelHeight = Math.ceil(height * scale);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const mix = (a, b, amount) =>
        a.map((channel, i) => channel + (b[i] - channel) * amount);
    const vertexColor = (value) => {
        if (painter.profile) {
            if (value <= 100) return mix(blue, purple, value / 100);
            return mix(purple, red, Math.min(1, (value - 100) / 50));
        }
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

export function paintRadar(
    container,
    values,
    { restart = false, animate = true } = {},
) {
    const previous = transitions.get(container);
    if (previous) {
        cancelAnimationFrame(previous.frame);
    }
    const svg = container.querySelector(".song-radar svg");
    if (!svg) {
        transitions.delete(container);
        return;
    }
    delete svg.dataset.radarAnimating;
    const { x, y, width, height } = svg.viewBox.baseVal;
    const targetBox = [x, y, width, height];
    const keepShape =
        previous &&
        !(
            restart &&
            previous.values.every((value, axis) => value === values[axis])
        );
    const from = keepShape ? previous.values : values.map(() => 0);
    const fromBox = keepShape ? previous.box : targetBox;
    const timing = getComputedStyle(svg)
        .getPropertyValue("--radar-transition-duration")
        .trim();
    const duration = parseFloat(timing) * (timing.endsWith("ms") ? 1 : 1000);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const canAnimate = animate && duration > 0 && !reducedMotion.matches;
    const state = {
        values: [...from],
        box: [...fromBox],
        frame: 0,
    };
    transitions.set(container, state);
    const area = svg.querySelector(".song-radar-area");
    const clip = svg.querySelector("clipPath polygon");
    const fill = svg.querySelector(".song-radar-fill");
    const render = (progress) => {
        state.values = values.map(
            (value, axis) => from[axis] + (value - from[axis]) * progress,
        );
        state.box = targetBox.map(
            (value, index) =>
                fromBox[index] + (value - fromBox[index]) * progress,
        );
        const points = state.values
            .map((value, axis) => {
                const angle = (axis * Math.PI) / 3 - Math.PI / 2;
                return `${(150 + Math.cos(angle) * value * 0.68).toFixed(2)},${(116 + Math.sin(angle) * value * 0.68).toFixed(2)}`;
            })
            .join(" ");
        area.setAttribute("points", points);
        clip.setAttribute("points", points);
        svg.setAttribute("viewBox", state.box.join(" "));
        ["x", "y", "width", "height"].forEach((name, index) =>
            fill.setAttribute(name, state.box[index]),
        );
        // Match the displayed size during the morph; restore crisp static fill.
        drawRadar(svg, state.values, progress === 1 ? 600 : 300);
    };
    if (!canAnimate) {
        render(1);
        return;
    }
    const begin = () => {
        cancelAnimationFrame(state.frame);
        if (reducedMotion.matches) {
            render(1);
            delete svg.dataset.radarAnimating;
            return;
        }
        const start = performance.now();
        svg.dataset.radarAnimating = "true";
        render(0);
        const tick = (now) => {
            if (!svg.isConnected) return;
            const progress = reducedMotion.matches
                ? 1
                : Math.min(1, (now - start) / duration);
            // The recording eases quickly from the old shape into the new one.
            render(1 - (1 - progress) ** 3);
            if (progress < 1) state.frame = requestAnimationFrame(tick);
            else {
                state.frame = 0;
                delete svg.dataset.radarAnimating;
            }
        };
        state.frame = requestAnimationFrame(tick);
    };
    if (from.some((value, axis) => value !== values[axis])) begin();
    else render(1);
}
