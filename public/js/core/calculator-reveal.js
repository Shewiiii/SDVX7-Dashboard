export function createCalculatorReveal({
    queue,
    sweep,
    play,
    isPending,
    reducedMotion,
}) {
    const sweeps = new WeakMap();
    const nextFrame = () => new Promise(requestAnimationFrame);

    function time(svg) {
        const reveal = sweeps.get(svg);
        if (!reveal) return null;
        if (isPending(svg)) return reveal.startAt;
        const active = reveal.animations.filter(
            (animation) =>
                animation.playState === "running" ||
                animation.playState === "paused",
        );
        return active.length
            ? Math.max(...active.map((animation) => Number(animation.currentTime)))
            : null;
    }

    async function startAfterPaint(svg, reveal) {
        const { animations, startAt } = reveal;
        for (const animation of animations) {
            if (startAt >= animation.effect.getComputedTiming().endTime) {
                animation.cancel();
                continue;
            }
            animation.pause();
            animation.currentTime = startAt;
        }
        if (startAt === 0) {
            // Let the initial frame paint before the reveal clock starts
            await Promise.allSettled(
                animations.map((animation) => animation.ready),
            );
            await nextFrame();
            await nextFrame();
        }
        if (sweeps.get(svg) !== reveal || reducedMotion.matches) return;
        for (const animation of animations) {
            if (animation.playState === "paused") animation.play();
        }
    }

    function render(
        svg,
        animate = true,
        { guidesAlongCurve = false, resumeAt = null } = {},
    ) {
        const startAt = resumeAt ?? (animate ? 0 : null);
        if (startAt === null) return;
        const reveal = { startAt, animations: [] };
        sweeps.set(svg, reveal);
        queue(svg, () => {
            const { animations } = reveal;
            let curveEnd = 0;
            let curveReveal;
            svg.querySelectorAll(
                ".calculator-curve:not([hidden]), .calculator-chart-points, .calculator-reference",
            ).forEach((curve, index) => {
                const animation = sweep(svg, curve, index * 65);
                animations.push(animation);
                if (guidesAlongCurve && !curveReveal)
                    curveReveal = {
                        bounds: curve.getBBox(),
                        timing: animation.effect.getTiming(),
                    };
                curveEnd = Math.max(curveEnd, animation.effect.getComputedTiming().endTime);
            });
            for (const markers of svg.querySelectorAll(".calculator-markers, .calculator-guides")) {
                if (curveReveal && markers.matches(".calculator-guides")) {
                    const { bounds, timing } = curveReveal;
                    for (const guide of markers.children) {
                        const position = guide.querySelector("line").x1.baseVal.value;
                        const progress = Math.max(
                            0,
                            Math.min(1, (position - bounds.x) / bounds.width),
                        );
                        animations.push(
                            play(
                                svg,
                                guide,
                                [
                                    { opacity: 0, offset: 0 },
                                    { opacity: 0, offset: progress },
                                    { opacity: 1, offset: progress },
                                    { opacity: 1, offset: 1 },
                                ],
                                timing,
                            ),
                        );
                    }
                } else {
                    animations.push(
                        play(svg, markers, [{ opacity: 0 }, { opacity: 1 }], {
                            duration: 300,
                            delay: guidesAlongCurve ? curveEnd : 900,
                        }),
                    );
                }
            }
            void startAfterPaint(svg, reveal);
        }, 0.5);
    }

    return { render, time };
}
