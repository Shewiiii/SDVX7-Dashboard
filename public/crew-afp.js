const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export async function createAfpPlayer(canvas, url, base, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw Error("This character animation could not load.");
    const data = await response.json();
    const context = canvas.getContext("2d");
    const textures = new Map();
    await Promise.all(
        Object.entries(data.textures).map(async ([name, value]) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.src = new URL(value.file, base);
            await image.decode();
            textures.set(name, { image, rect: value.rect });
        }),
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const movies = data.movies;
    const main = movies[data.main];
    const definitions = new Map();
    function register(movie, tags) {
        for (const tag of tags) {
            if (tag.id != null)
                definitions.set(`${movie}:${tag.id}`, { ...tag, movie });
            if (tag.tags) register(movie, tag.tags);
        }
    }
    for (const [name, movie] of Object.entries(movies))
        register(name, movie.tags);
    function definition(movie, id) {
        const found = definitions.get(`${movie}:${id}`);
        if (found) return found;
        const imported = movies[movie]?.imported_tags?.[id];
        if (imported && movies[imported.swf])
            return definitions.get(
                `${imported.swf}:${movies[imported.swf].exported_tags[imported.tag]}`,
            );
        return null;
    }
    function clip(source) {
        return { source, children: new Map(), frame: -1 };
    }
    function apply(instance, frame) {
        const source = instance.source;
        const record = source.frames[frame];
        if (!record) return;
        for (const tag of source.tags.slice(
            record.start_tag_offset,
            record.start_tag_offset + record.num_tags,
        )) {
            if (tag.type === "AP2RemoveObjectTag") {
                instance.children.delete(tag.depth);
            } else if (tag.type === "AP2PlaceObjectTag") {
                let object = instance.children.get(tag.depth);
                if (
                    !tag.update ||
                    !object ||
                    (tag.source_tag_id != null &&
                        object.source?.id !== tag.source_tag_id)
                ) {
                    const asset = definition(
                        source.movie || data.main,
                        tag.source_tag_id,
                    );
                    if (!asset) continue;
                    object = {
                        source: asset,
                        transform: identity,
                        alpha: 1,
                        blend: 0,
                    };
                    if (asset.type === "AP2DefineSpriteTag")
                        object.clip = clip(asset);
                    instance.children.set(tag.depth, object);
                }
                if (tag.transform) object.transform = tag.transform;
                if (tag.mult_color) object.alpha = tag.mult_color.a;
                if (tag.blend != null) object.blend = tag.blend;
                if (tag.rotation_origin) object.origin = tag.rotation_origin;
            }
        }
        instance.frame = frame;
    }
    function step(instance) {
        const next = instance.frame + 1;
        if (next >= instance.source.frames.length) {
            instance.children.clear();
            apply(instance, 0);
        } else apply(instance, next);
        for (const child of instance.children.values())
            if (child.clip) step(child.clip);
    }
    let root = clip({ ...main, movie: data.main });
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let frameTime = 0;
    let end = main.frames.length;
    let followup;
    let currentMotion;
    const fps = main.fps || 60;
    const labels = Object.entries(main.labels)
        .filter(([name]) => !name.endsWith("_end"))
        .sort((a, b) => a[1] - b[1]);
    function seek(frame) {
        root = clip({ ...main, movie: data.main });
        for (let index = 0; index <= frame; index++) step(root);
    }
    function startMotion(group, index, loop = false) {
        currentMotion = { group, index, loop };
        const start = main.labels[group] || 0;
        end =
            main.labels[`${group}_end`] ??
            labels[index + 1]?.[1] ??
            main.frames.length;
        frameTime = 0;
        seek(start);
    }
    function drawShape(shape) {
        if (!shape) return;
        for (const draw of shape.draw_params) {
            const texture = textures.get(draw.region);
            if (!texture || !draw.vertexes.length) continue;
            const points = shape.vertex_points;
            const uv = shape.tex_points;
            if (!uv.length) continue;
            const [left, right, top, bottom] = texture.rect;
            const scaleFor = (axis, low, high) => {
                const minimum = Math.min(...uv.map((point) => point[axis]));
                const maximum = Math.max(...uv.map((point) => point[axis]));
                const error = (size) =>
                    Math.abs(minimum * size - low - 0.5) +
                    Math.abs(maximum * size - high + 0.5);
                return [128, 256, 512, 1024, 2048, 4096, 8192].reduce(
                    (best, size) => (error(size) < error(best) ? size : best),
                    1024,
                );
            };
            const sx = scaleFor("x", left, right);
            const sy = scaleFor("y", top, bottom);
            for (let index = 0; index < draw.vertexes.length; index += 3) {
                const ids = draw.vertexes.slice(index, index + 3);
                const target = ids.map((id) => points[id]);
                const source = ids.map((id) => ({
                    x: uv[id].x * sx - left,
                    y: uv[id].y * sy - top,
                }));
                const [p, q, r] = source;
                const [a, b, c] = target;
                const determinant =
                    (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
                if (Math.abs(determinant) < 0.00001) continue;
                const aa =
                    ((b.x - a.x) * (r.y - p.y) - (c.x - a.x) * (q.y - p.y)) /
                    determinant;
                const cc =
                    ((c.x - a.x) * (q.x - p.x) - (b.x - a.x) * (r.x - p.x)) /
                    determinant;
                const bb =
                    ((b.y - a.y) * (r.y - p.y) - (c.y - a.y) * (q.y - p.y)) /
                    determinant;
                const dd =
                    ((c.y - a.y) * (q.x - p.x) - (b.y - a.y) * (r.x - p.x)) /
                    determinant;
                context.save();
                context.beginPath();
                context.moveTo(a.x, a.y);
                context.lineTo(b.x, b.y);
                context.lineTo(c.x, c.y);
                context.closePath();
                context.clip();
                context.transform(
                    aa,
                    bb,
                    cc,
                    dd,
                    a.x - aa * p.x - cc * p.y,
                    a.y - bb * p.x - dd * p.y,
                );
                context.drawImage(texture.image, 0, 0);
                context.restore();
            }
        }
    }
    function draw(instance) {
        for (const [, object] of [...instance.children].sort(
            (a, b) => a[0] - b[0],
        )) {
            if (object.alpha <= 0) continue;
            context.save();
            context.globalAlpha *= object.alpha;
            const t = object.transform;
            context.transform(
                t.a ?? t.a11 ?? 1,
                t.b ?? t.a12 ?? 0,
                t.c ?? t.a21 ?? 0,
                t.d ?? t.a22 ?? 1,
                t.tx || 0,
                t.ty || 0,
            );
            if (object.origin)
                context.translate(-object.origin.x, -object.origin.y);
            if (object.blend === 8)
                context.globalCompositeOperation = "lighter";
            if (object.clip) draw(object.clip);
            else if (object.source.type === "AP2ShapeTag")
                drawShape(data.shapes[object.source.reference]);
            context.restore();
        }
    }
    seek(0);
    return {
        motions: labels.map(([group], index) => ({ group, index })),
        motion(group, index, next, loop = false) {
            followup = next;
            startMotion(group, index, loop);
        },
        render(delta) {
            frameTime += delta;
            let steps = Math.min(12, Math.floor((frameTime * fps) / 1000));
            frameTime %= 1000 / fps;
            while (steps-- > 0) {
                if (root.frame + 1 >= end) {
                    if (followup) {
                        const next = followup;
                        followup = null;
                        startMotion(next.group, next.index, next.loop === true);
                        next.onStart();
                    } else if (currentMotion?.loop)
                        startMotion(
                            currentMotion.group,
                            currentMotion.index,
                            true,
                        );
                } else step(root);
            }
            const rect = canvas.parentElement.getBoundingClientRect();
            const ratio = Math.min(devicePixelRatio || 1, 2);
            if (
                canvas.width !== Math.round(rect.width * ratio) ||
                canvas.height !== Math.round(rect.height * ratio)
            ) {
                canvas.width = Math.max(1, Math.round(rect.width * ratio));
                canvas.height = Math.max(1, Math.round(rect.height * ratio));
            }
            const width = main.location.right - main.location.left;
            const height = main.location.bottom - main.location.top;
            const scale =
                Math.min(canvas.width / width, canvas.height / height) * zoom;
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.translate(
                (canvas.width - width * scale) / 2 + panX * canvas.width,
                (canvas.height - height * scale) / 2 + panY * canvas.height,
            );
            context.scale(scale, scale);
            draw(root);
        },
        zoom(value) {
            zoom = value;
        },
        pan(x, y) {
            panX = x;
            panY = y;
        },
        tracking() {},
        physics() {},
        destroy() {
            textures.clear();
        },
    };
}
