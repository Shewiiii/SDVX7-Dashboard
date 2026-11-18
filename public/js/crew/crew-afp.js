import { createAfpPerspectiveRenderer } from "./crew-afp-perspective.js";
import { crewRenderResolution } from "./crew-resolution.js";

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function affineTransform({ a, b, c, d, a11, a12, a21, a22, tx, ty }) {
    return {
        a: a ?? a11 ?? 1,
        b: b ?? a12 ?? 0,
        c: c ?? a21 ?? 0,
        d: d ?? a22 ?? 1,
        tx: tx ?? 0,
        ty: ty ?? 0,
    };
}

function placementTransform(tag, previous) {
    const transform = tag.transform;
    if (tag.projection !== "perspective" || !tag.update) return transform;
    const old = { ...previous, ...affineTransform(previous) };
    if (tag.transform_update) {
        const update = tag.transform_update;
        return {
            ...old,
            ...update,
            a: update.a11 ?? old.a,
            b: update.a12 ?? old.b,
            c: update.a21 ?? old.c,
            d: update.a22 ?? old.d,
        };
    }

    // Older exports fill omitted perspective components with identity values
    const { tx, ty, tz } = transform;
    return {
        ...old,
        ...transform,
        ...affineTransform(transform),
        tx: tx || ty ? tx : old.tx,
        ty: tx || ty ? ty : old.ty,
        tz: tz || old.tz,
    };
}

function perspectiveProjector(transform, origin, { center, focal_length }) {
    const { a, b, c, d, tx, ty } = affineTransform(transform);
    const { a13 = 0, a23 = 0, a31 = 0, a32 = 0, a33 = 1, tz = 0 } = transform;
    const { x: originX = 0, y: originY = 0, z: originZ = 0 } = origin ?? {};

    return (point) => {
        const x = point.x - originX;
        const y = point.y - originY;
        const z = (point.z ?? 0) - originZ;
        const distance = a13 * x + a23 * y + a33 * z + tz - center.z;
        if (distance <= 0) return null;
        const scale = focal_length / distance;
        return {
            x: center.x + (a * x + c * y + a31 * z + tx - center.x) * scale,
            y: center.y + (b * x + d * y + a32 * z + ty - center.y) * scale,
            w: distance / focal_length,
        };
    };
}

function midpoint(a, b) {
    const first = a.w ?? 1;
    const second = b.w ?? 1;
    const sum = first + second;
    return {
        x: (a.x * first + b.x * second) / sum,
        y: (a.y * first + b.y * second) / sum,
        w: sum / 2,
    };
}

function midpointError(a, b) {
    return (
        (Math.hypot(a.x - b.x, a.y - b.y) * Math.abs(a.w - b.w)) /
        (2 * (a.w + b.w))
    );
}

function hasPerspective(tags) {
    return tags.some(
        (tag) =>
            tag.projection === "perspective" ||
            (tag.tags && hasPerspective(tag.tags)),
    );
}

export async function createAfpPlayer(canvas, url, base, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw Error("This character animation could not load.");
    const data = await response.json();
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
    const perspective = Object.values(movies).some((movie) =>
        hasPerspective(movie.tags),
    );
    let needsRedraw = true;
    const renderer = perspective
        ? createAfpPerspectiveRenderer(canvas, () => {
              needsRedraw = true;
          })
        : null;
    const context = renderer ? null : canvas.getContext("2d");
    const drawGroups = new Map();
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
        return { source, children: new Map(), frame: -1, camera: null };
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
            } else if (tag.type === "AP2PlaceCameraTag") {
                instance.camera = tag;
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
                if (tag.transform)
                    object.transform = placementTransform(
                        tag,
                        object.transform,
                    );
                if (tag.projection && tag.projection !== "none")
                    object.projection = tag.projection;
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
            instance.camera = null;
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
        needsRedraw = true;
    }
    function startMotion(group, index, loop = false) {
        currentMotion = { group, index, loop };
        const start = main.labels[group] || 0;
        end =
            main.labels[`${group}_end`] ??
            labels[index + 1]?.[1] ??
            main.frames.length;
        if (loop) {
            // AFP loops can jump back before cleanup frames preceding the next label
            for (let frame = start; frame < end; frame++) {
                const record = main.frames[frame];
                const tags = main.tags.slice(
                    record.start_tag_offset,
                    record.start_tag_offset + record.num_tags,
                );
                const jumpsToStart = tags.some((tag) => {
                    if (tag.type !== "AP2DoActionTag") return false;
                    const actions = tag.bytecode?.actions || [];
                    const objects = actions
                        .filter((action) => action.action === "PUSH")
                        .flatMap((action) => action.objects || []);
                    return (
                        objects.some((value) =>
                            [group, `'${group}'`, `"${group}"`].includes(value),
                        ) &&
                        objects.some((value) =>
                            /^(?:StringConstant\(0x[\da-f]+: )?deepGotoAndPlay\)?$/i.test(
                                value,
                            ),
                        ) &&
                        actions.some(
                            (action) => action.action === "CALL_METHOD",
                        )
                    );
                });
                if (jumpsToStart) {
                    end = frame + 1;
                    break;
                }
            }
        }
        frameTime = 0;
        seek(start);
    }
    function drawTriangle(image, [a, b, c], [p, q, r]) {
        const determinant =
            (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
        if (Math.abs(determinant) < 0.00001) return;
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
        context.drawImage(image, 0, 0);
        context.restore();
    }

    function drawSubdividedTriangle(image, target, source, remaining) {
        if (!remaining) {
            drawTriangle(image, target, source);
            return;
        }

        const [a, b, c] = target;
        const [p, q, r] = source;
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        const pq = midpoint(p, q);
        const qr = midpoint(q, r);
        const rp = midpoint(r, p);

        drawSubdividedTriangle(image, [a, ab, ca], [p, pq, rp], remaining - 1);
        drawSubdividedTriangle(image, [ab, b, bc], [pq, q, qr], remaining - 1);
        drawSubdividedTriangle(image, [ca, bc, c], [rp, qr, r], remaining - 1);
        drawSubdividedTriangle(
            image,
            [ab, bc, ca],
            [pq, qr, rp],
            remaining - 1,
        );
    }

    function shapeGroups(shape) {
        const groups = [];
        const uv = shape.tex_points;
        if (!uv.length) return groups;
        const minX = Math.min(...uv.map((point) => point.x));
        const maxX = Math.max(...uv.map((point) => point.x));
        const minY = Math.min(...uv.map((point) => point.y));
        const maxY = Math.max(...uv.map((point) => point.y));
        const scaleFor = (minimum, maximum, low, high) => {
            const error = (size) =>
                Math.abs(minimum * size - low - 0.5) +
                Math.abs(maximum * size - high + 0.5);
            return [128, 256, 512, 1024, 2048, 4096, 8192].reduce(
                (best, size) => (error(size) < error(best) ? size : best),
                1024,
            );
        };

        for (const draw of shape.draw_params) {
            const texture = textures.get(draw.region);
            if (!texture || !draw.vertexes.length) continue;
            const [left, right, top, bottom] = texture.rect;
            const sx = scaleFor(minX, maxX, left, right);
            const sy = scaleFor(minY, maxY, top, bottom);
            const triangles = [];
            for (let index = 0; index < draw.vertexes.length; index += 3) {
                const ids = draw.vertexes.slice(index, index + 3);
                const source = ids.map((id) => ({
                    x: uv[id].x * sx - left,
                    y: uv[id].y * sy - top,
                }));
                triangles.push({ ids, source });
            }
            groups.push({ image: texture.image, triangles });
        }
        return groups;
    }

    function drawShape(shape, transform, project, alpha, additive) {
        if (!shape) return;
        if (!drawGroups.has(shape)) drawGroups.set(shape, shapeGroups(shape));
        let points = project
            ? shape.vertex_points.map(project)
            : shape.vertex_points;
        const { a, b, c, d, tx, ty } = transform;
        if (renderer) {
            points = points.map(
                (point) =>
                    point && {
                        x: a * point.x + c * point.y + tx,
                        y: b * point.x + d * point.y + ty,
                        w: point.w,
                    },
            );
        } else {
            context.setTransform(a, b, c, d, tx, ty);
            context.globalAlpha = Math.min(1, alpha);
            context.globalCompositeOperation = additive
                ? "lighter"
                : "source-over";
        }

        for (const { image, triangles } of drawGroups.get(shape)) {
            for (const { ids, source } of triangles) {
                const target = ids.map((id) => points[id]);
                if (target.some((point) => !point)) continue;
                if (renderer)
                    renderer.draw(
                        image,
                        target,
                        source,
                        Math.min(1, alpha),
                        additive,
                    );
                else if (project) {
                    const [a, b, c] = target;
                    const error = Math.max(
                        midpointError(a, b),
                        midpointError(b, c),
                        midpointError(c, a),
                    );
                    const subdivisions = error > 4 ? 2 : error > 1 ? 1 : 0;
                    drawSubdividedTriangle(image, target, source, subdivisions);
                } else drawTriangle(image, target, source);
            }
        }
    }
    function draw(
        instance,
        parentTransform,
        parentAlpha = 1,
        parentBlend = false,
        project,
        camera = instance.camera,
    ) {
        for (const [, object] of [...instance.children].sort(
            (a, b) => a[0] - b[0],
        )) {
            if (object.alpha <= 0) continue;
            const alpha = parentAlpha * object.alpha;
            const additive = parentBlend || object.blend === 8;
            const { transform, origin } = object;
            let screen = parentTransform;
            let projectChild;
            if (object.projection === "perspective" && camera) {
                const projectObject = perspectiveProjector(
                    transform,
                    origin,
                    camera,
                );
                projectChild = project
                    ? (point) => {
                          const projected = projectObject(point);
                          if (!projected) return null;
                          const parent = project(projected);
                          return (
                              parent && { ...parent, w: projected.w * parent.w }
                          );
                      }
                    : projectObject;
            } else {
                const { a, b, c, d, tx, ty } = affineTransform(transform);
                const x = origin?.x ?? 0;
                const y = origin?.y ?? 0;
                const offsetX = tx - a * x - c * y;
                const offsetY = ty - b * x - d * y;
                if (project) {
                    projectChild = (point) =>
                        project({
                            ...point,
                            x: a * point.x + c * point.y + offsetX,
                            y: b * point.x + d * point.y + offsetY,
                        });
                } else {
                    screen = {
                        a: parentTransform.a * a + parentTransform.c * b,
                        b: parentTransform.b * a + parentTransform.d * b,
                        c: parentTransform.a * c + parentTransform.c * d,
                        d: parentTransform.b * c + parentTransform.d * d,
                        tx:
                            parentTransform.a * offsetX +
                            parentTransform.c * offsetY +
                            parentTransform.tx,
                        ty:
                            parentTransform.b * offsetX +
                            parentTransform.d * offsetY +
                            parentTransform.ty,
                    };
                }
            }
            if (object.clip)
                draw(
                    object.clip,
                    screen,
                    alpha,
                    additive,
                    projectChild,
                    object.clip.camera ?? camera,
                );
            else if (object.source.type === "AP2ShapeTag")
                drawShape(
                    data.shapes[object.source.reference],
                    screen,
                    projectChild,
                    alpha,
                    additive,
                );
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
                } else {
                    step(root);
                    needsRedraw = true;
                }
            }
            const rect = canvas.parentElement.getBoundingClientRect();
            const ratio = crewRenderResolution(rect.width, rect.height);
            const bufferWidth = Math.max(1, Math.round(rect.width * ratio));
            const bufferHeight = Math.max(1, Math.round(rect.height * ratio));
            if (
                canvas.width !== bufferWidth ||
                canvas.height !== bufferHeight
            ) {
                canvas.width = bufferWidth;
                canvas.height = bufferHeight;
                needsRedraw = true;
            }
            if (!needsRedraw) return;
            needsRedraw = false;

            if (renderer) {
                if (!renderer.start()) return;
            } else {
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = "high";
            }
            const width = main.location.right - main.location.left;
            const height = main.location.bottom - main.location.top;
            const scale =
                Math.min(canvas.width / width, canvas.height / height) * zoom;
            draw(root, {
                a: scale,
                b: 0,
                c: 0,
                d: scale,
                tx: (canvas.width - width * scale) / 2 + panX * canvas.width,
                ty: (canvas.height - height * scale) / 2 + panY * canvas.height,
            });
            renderer?.finish();
        },
        zoom(value) {
            if (zoom !== value) needsRedraw = true;
            zoom = value;
        },
        pan(x, y) {
            if (panX !== x || panY !== y) needsRedraw = true;
            panX = x;
            panY = y;
        },
        tracking() {},
        physics() {},
        destroy() {
            renderer?.destroy();
            drawGroups.clear();
            textures.clear();
        },
    };
}
