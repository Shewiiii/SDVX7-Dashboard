const maxParticleWidth = 4.2;
const glowScale = 0.6;
const shapeCorners = [
    [
        [0.54, 0.29],
        [0.23, 0.44],
        [0.38, 0.25],
        [0.17, 0.47],
    ],
    [
        [0.17, 0.47],
        [0.58, 0.21],
        [0.22, 0.51],
        [0.39, 0.32],
    ],
];
const turn = (57 * Math.PI) / 180;

function createParticle(index) {
    const depth = Math.random();
    const duration = 13 + Math.random() * 5;
    const width = 1.2 + 3 * depth ** 2;
    const travel = duration * (13 + depth * 11);
    return {
        x: ((index % 4) + Math.random()) / 4,
        y: (((index + Math.floor(index / 4)) % 4) + Math.random()) / 4,
        width,
        height: width * (0.6 + Math.random() * 0.4),
        duration,
        age: Math.random() * duration,
        travel,
        drop: travel * (Math.random() * 0.1 - 0.01),
        tilt: Math.random() * Math.PI,
        opacity: 0.04 + (depth * 0.7) ** 1.2,
        diffusion: Math.random() ** 1.3,
    };
}

export function createParticleRenderer(canvas) {
    const context = canvas.getContext("2d");
    const atlas = document.createElement("canvas");
    const sprites = atlas.getContext("2d");
    if (!context || !sprites) return null;

    const particles = [];
    const styles = getComputedStyle(canvas);
    let width = 0;
    let height = 0;
    let scale;
    let color;
    let count;
    let cell;
    let columns;
    let still = false;

    function setCount(nextCount) {
        // Draw immediately when the layer becomes visible again
        ({ width, height } = canvas.getBoundingClientRect());
        particles.length = Math.min(particles.length, nextCount);
        while (particles.length < nextCount)
            particles.push(createParticle(particles.length));
    }

    function updateSprites(nextScale, nextColor) {
        if (
            scale === nextScale &&
            color === nextColor &&
            count === particles.length
        )
            return;

        scale = nextScale;
        color = nextColor;
        count = particles.length;
        // Leave room for the glow around each unrotated sprite
        cell = Math.ceil(maxParticleWidth * scale * (1 + 4 * glowScale)) + 4;
        columns = Math.ceil(Math.sqrt(count));
        atlas.width = cell * columns;
        atlas.height = cell * Math.ceil(count / columns);
        sprites.fillStyle = color;

        for (const [index, particle] of particles.entries()) {
            const x = ((index % columns) + 0.5) * cell;
            const y = (Math.floor(index / columns) + 0.5) * cell;
            const w = particle.width * scale;
            const h = particle.height * scale;
            const corners = shapeCorners[index % 3 === 2 ? 1 : 0];
            const shape = new Path2D();
            shape.roundRect(
                x - w / 2,
                y - h / 2,
                w,
                h,
                corners.map(([rx, ry]) => ({ x: w * rx, y: h * ry })),
            );

            // Offset the source outside the atlas to draw only the outer shadow
            sprites.save();
            sprites.shadowColor = color;
            sprites.shadowBlur = w * particle.diffusion * glowScale;
            sprites.shadowOffsetX = atlas.width;
            sprites.translate(-atlas.width, 0);
            sprites.globalAlpha = particle.diffusion;
            sprites.fill(shape);
            sprites.restore();

            sprites.globalCompositeOperation = "destination-out";
            sprites.fill(shape);
            sprites.globalCompositeOperation = "source-over";
            sprites.globalAlpha = 1 - 0.8 * particle.diffusion;
            sprites.fill(shape);
            sprites.globalAlpha = 1;
        }
    }

    function draw(time, speed, reducedMotion) {
        still = reducedMotion;
        if (!width || !height || !particles.length) return;
        const ratio = devicePixelRatio;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        updateSprites(parseFloat(styles.fontSize) * ratio, styles.color);

        context.resetTransform();
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        context.globalCompositeOperation = "screen";
        const clock = (time * speed) / 1000;
        for (const [index, particle] of particles.entries()) {
            const progress =
                ((clock + particle.age) % particle.duration) /
                particle.duration;
            const drift = still ? 0 : progress - 0.5;
            const x =
                particle.x * pixelWidth -
                drift * particle.travel * ratio +
                (particle.width * scale) / 2;
            const y =
                particle.y * pixelHeight +
                2 * drift * particle.drop * ratio +
                (particle.height * scale) / 2;
            if (
                x < -cell ||
                x > pixelWidth + cell ||
                y < -cell ||
                y > pixelHeight + cell
            )
                continue;

            const angle = particle.tilt + (still ? 0 : progress * turn);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            context.setTransform(cos, sin, -sin, cos, x, y);
            const fade = still
                ? 1
                : Math.min(1, progress / 0.15, (1 - progress) / 0.17);
            context.globalAlpha = particle.opacity * fade;
            context.drawImage(
                atlas,
                (index % columns) * cell,
                Math.floor(index / columns) * cell,
                cell,
                cell,
                -cell / 2,
                -cell / 2,
                cell,
                cell,
            );
        }
    }

    new ResizeObserver(([{ contentRect }]) => {
        width = contentRect.width;
        height = contentRect.height;
        if (still) draw(0, 1, true);
    }).observe(canvas);

    return { setCount, draw };
}
