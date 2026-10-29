let runtime;

function script(url) {
    return new Promise((resolve, reject) => {
        const element = document.createElement("script");
        element.src = url;
        element.onload = resolve;
        element.onerror = () => {
            element.remove();
            reject(Error("The character renderer could not load."));
        };
        document.head.append(element);
    });
}

export async function createLive2dPlayer(canvas, url, base, signal) {
    if (!runtime)
        runtime = (async () => {
            await script(new URL("runtime/pixi.min.js", base));
            await script(new URL("runtime/unsafe-eval.js", base));
            await script(new URL("runtime/live2dcubismcore.min.js", base));
            await script(new URL("runtime/cubism4.min.js", base));
        })().catch((error) => {
            runtime = null;
            throw error;
        });
    await runtime;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const PIXI = window.PIXI;
    const app = new PIXI.Application({
        view: canvas,
        autoStart: false,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(devicePixelRatio || 1, 3),
        autoDensity: true,
    });
    const model = await PIXI.live2d.Live2DModel.from(url, {
        autoInteract: false,
        autoUpdate: false,
    }).catch((error) => {
        app.destroy(false);
        throw error;
    });
    if (signal.aborted) {
        model.destroy({ children: true });
        app.destroy(false);
        throw new DOMException("Aborted", "AbortError");
    }
    const core = model.internalModel.coreModel._model;
    // Core 5.3 shares render ordering between drawables and offscreen objects.
    if (!core.drawables.renderOrders && core.renderOrders)
        core.drawables.renderOrders = core.renderOrders;
    app.stage.addChild(model);
    model.anchor.set(0.5, 0.5);
    const bounds = model.getLocalBounds();
    const physics = model.internalModel.physics;
    const renderer = model.internalModel.renderer;
    renderer.setClippingMaskBufferSize(1024);
    let zoom = 1;
    let tracking = false;
    let panX = 0;
    let panY = 0;
    let pointer;
    const focus = model.internalModel.focusController;
    const internal = model.internalModel;
    const eyeBlink = internal.eyeBlink;
    const heldEyeBlink = eyeBlink && {
        updateParameters(model, delta) {
            const ids = eyeBlink.getParameterIds();
            const openness = ids.map((id) => model.getParameterValueById(id));
            eyeBlink.updateParameters(model, delta);
            for (const [index, id] of ids.entries())
                model.setParameterValueById(
                    id,
                    openness[index] * model.getParameterValueById(id),
                );
        },
    };
    const eyeDrawables = [];
    // Find eye meshes once from their response to the eye parameter.
    const eyeParameter = core.parameters.ids.indexOf(internal.idParamEyeBallX);
    if (eyeParameter >= 0) {
        const saved = core.parameters.values[eyeParameter];
        const low = core.parameters.minimumValues[eyeParameter];
        const high = core.parameters.maximumValues[eyeParameter];
        core.parameters.values[eyeParameter] = low + (high - low) * 0.25;
        core.update();
        const vertices = core.drawables.vertexPositions.map((points) =>
            points.slice(),
        );
        core.parameters.values[eyeParameter] = low + (high - low) * 0.75;
        core.update();
        for (let index = 0; index < vertices.length; index++) {
            if (
                core.drawables.vertexPositions[index].some(
                    (value, offset) =>
                        Math.abs(value - vertices[index][offset]) > 0.0001,
                )
            )
                eyeDrawables.push(index);
        }
        const visible = eyeDrawables.filter(
            (index) => core.drawables.opacities[index] >= 0.1,
        );
        if (visible.length)
            eyeDrawables.splice(0, eyeDrawables.length, ...visible);
        core.parameters.values[eyeParameter] = saved;
        core.update();
    }
    const pointerPoint = new PIXI.Point();
    function updateFocus() {
        if (!tracking || !pointer) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        pointerPoint.set(
            ((pointer.x - rect.left) * app.screen.width) / rect.width,
            ((pointer.y - rect.top) * app.screen.height) / rect.height,
        );
        model.toModelPosition(pointerPoint, pointerPoint);
        let left = Infinity;
        let right = -Infinity;
        let top = -Infinity;
        let bottom = Infinity;
        for (const index of eyeDrawables) {
            const points = core.drawables.vertexPositions[index];
            for (let offset = 0; offset < points.length; offset += 2) {
                left = Math.min(left, points[offset]);
                right = Math.max(right, points[offset]);
                bottom = Math.min(bottom, points[offset + 1]);
                top = Math.max(top, points[offset + 1]);
            }
        }
        const eyeX = eyeDrawables.length
            ? ((left + right) / 2) * internal.pixelsPerUnit +
              internal.originalWidth / 2
            : internal.originalWidth / 2;
        const eyeY = eyeDrawables.length
            ? (-(top + bottom) / 2) * internal.pixelsPerUnit +
              internal.originalHeight / 2
            : internal.originalHeight / 2;
        focus.focus(
            (pointerPoint.x - eyeX) / (internal.originalWidth / 2),
            (eyeY - pointerPoint.y) / (internal.originalHeight / 2),
        );
    }
    function resetFocus() {
        pointer = null;
        focus.focus(0, 0, true);
        focus.vx = 0;
        focus.vy = 0;
    }
    resetFocus();
    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        if (app.screen.width !== width || app.screen.height !== height)
            app.renderer.resize(width, height);
        model.scale.set(
            Math.min(rect.width / bounds.width, rect.height / bounds.height) *
                0.94 *
                zoom,
        );
        model.position.set(
            rect.width * (0.5 + panX),
            rect.height * (0.5 + panY),
        );
        const maskSize = zoom >= 2 ? 2048 : 1024;
        if (renderer.getClippingMaskBufferSize() !== maskSize) {
            renderer.setClippingMaskBufferSize(maskSize);
            if (renderer.gl) renderer._clippingManager.setGL(renderer.gl);
        }
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    resize();
    window.addEventListener(
        "pointermove",
        (event) => {
            if (event.pointerType === "touch") return;
            pointer = { x: event.clientX, y: event.clientY };
            updateFocus();
        },
        { signal },
    );
    document.addEventListener("pointerleave", resetFocus, { signal });
    window.addEventListener("blur", resetFocus, { signal });
    const manager = model.internalModel.motionManager;
    // The viewer chooses follow-up motions instead of the adapter's automatic idle.
    manager.state.shouldRequestIdleMotion = () => false;
    let motionRevision = 0;
    let playback;
    let queuedEntry;
    // The bundled adapter clears the queue before Cubism can blend motions.
    manager._startMotion = (motion, onFinish) => {
        motion.setFinishedMotionHandler(onFinish);
        const handle = manager.queueManager.startMotion(
            motion,
            false,
            model.elapsedTime / 1000,
        );
        queuedEntry = manager.queueManager.getCubismMotionQueueEntry(handle);
        return handle;
    };
    return {
        motions: Object.entries(manager.definitions).flatMap(
            ([group, entries]) =>
                entries.map((entry, index) => ({
                    group,
                    index,
                    file: entry.File,
                })),
        ),
        async motion(group, index, next, loop = false) {
            const version = ++motionRevision;
            playback = null;
            const [motion, nextMotion] = await Promise.all([
                manager.loadMotion(group, index),
                next ? manager.loadMotion(next.group, next.index) : undefined,
            ]);
            if (signal.aborted || version !== motionRevision) return;
            if (!motion || (next && !nextMotion))
                throw Error("This character animation could not load.");
            motion.setIsLoop(loop);
            motion.setIsLoopFadeIn(false);
            motion.setFadeOutTime(0);
            if (nextMotion) {
                nextMotion.setIsLoop(next.loop === true);
                nextMotion.setIsLoopFadeIn(false);
                nextMotion.setFadeOutTime(0);
            }
            if (
                manager.state.currentGroup === group &&
                manager.state.currentIndex === index
            )
                manager.stopAllMotions();
            else manager.state.reset();
            internal.eyeBlink = eyeBlink;
            const started = await model.motion(group, index, 3);
            if (signal.aborted || version !== motionRevision) return;
            if (started)
                playback = {
                    next,
                    nextMotion,
                    loop,
                    entry: queuedEntry,
                    duration: motion.getLoopDuration(),
                    version,
                };
        },
        render(delta) {
            updateFocus();
            const pending = playback;
            let finished = false;
            if (pending && !pending.loop && pending.entry.isStarted()) {
                const remaining =
                    (pending.entry.getStartTime() + pending.duration) * 1000 -
                    model.elapsedTime;
                finished = delta > 0 && delta >= remaining;
                if (finished) delta = Math.max(0, remaining - 0.001);
            }
            model.update(delta);
            app.renderer.render(app.stage);
            if (finished) {
                playback = null;
                pending.entry.setIsFinished(true);
                const { next, nextMotion, version } = pending;
                if (!next) internal.eyeBlink = heldEyeBlink;
                if (next)
                    void manager
                        .startMotion(next.group, next.index, 3)
                        .then((started) => {
                            if (
                                started &&
                                !signal.aborted &&
                                version === motionRevision
                            ) {
                                playback = {
                                    entry: queuedEntry,
                                    duration: nextMotion.getLoopDuration(),
                                    loop: next.loop === true,
                                    version,
                                };
                                next.onStart();
                            }
                        });
            }
        },
        zoom(value) {
            zoom = value;
            resize();
        },
        pan(x, y) {
            panX = x;
            panY = y;
            resize();
        },
        tracking(value) {
            tracking = value;
            if (!tracking) resetFocus();
        },
        physics(value) {
            model.internalModel.physics = value ? physics : undefined;
        },
        destroy() {
            motionRevision++;
            playback = null;
            observer.disconnect();
            model.destroy({ children: true, texture: true, baseTexture: true });
            app.destroy(false);
        },
    };
}
