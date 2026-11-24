export const calculatorCurveStart = {
    opacity: 0,
    // Let the sweep start moving before it reaches the plot origin
    clipPath: "inset(0 104% 0 0)",
};

export function createCalculatorReveal({ queue, sweep, play, isPending }) {
    const sweeps = new WeakMap();

    function time(svg) {
        const reveal = sweeps.get(svg);
        if (!reveal) return null;
        if (isPending(svg)) return reveal.startAt;
        const active = reveal.animations.findLast(
            (animation) => animation.playState === "running",
        );
        return active ? Number(active.currentTime) : null;
    }

    function render(
        svg,
        animate = true,
        { guidesAlongCurve = false, resumeAt = null } = {},
    ) {
        const startAt = resumeAt ?? (animate ? 0 : null);
        if (startAt === null) return;
        const animations = [];
        sweeps.set(svg, { startAt, animations });
        queue(
            svg,
            () => {
                const curves = svg.querySelectorAll(
                    ".calculator-curve:not([hidden]), .calculator-chart-points, .calculator-reference",
                );
                curves.forEach((curve, index) => {
                    const from =
                        !guidesAlongCurve && curve.matches(".calculator-curve")
                            ? calculatorCurveStart
                            : undefined;
                    animations.push(sweep(svg, curve, index * 65, { from }));
                });

                const curveEnd =
                    animations.at(-1)?.effect.getComputedTiming().endTime ??
                    0;
                const curve = guidesAlongCurve && animations[0]?.effect;
                for (const group of svg.querySelectorAll(
                    ".calculator-markers, .calculator-guides",
                )) {
                    if (curve && group.matches(".calculator-guides")) {
                        const bounds = curve.target.getBBox();
                        const timing = curve.getTiming();
                        for (const guide of group.children) {
                            const x = guide.querySelector("line").x1.baseVal.value;
                            const offset = Math.max(
                                0,
                                Math.min(1, (x - bounds.x) / bounds.width),
                            );
                            const keyframes = {
                                opacity: [0, 0, 1, 1],
                                offset: [0, offset, offset, 1],
                            };
                            animations.push(play(svg, guide, keyframes, timing));
                        }
                        continue;
                    }
                    animations.push(
                        play(svg, group, [{ opacity: 0 }, { opacity: 1 }], {
                            duration: 300,
                            delay: guidesAlongCurve ? curveEnd : 900,
                        }),
                    );
                }

                if (startAt > 0) {
                    for (const animation of animations) {
                        const endTime = animation.effect.getComputedTiming().endTime;
                        if (startAt < endTime) animation.currentTime = startAt;
                        else animation.cancel();
                    }
                }
            },
            0.5,
            { nextFrame: startAt === 0 },
        );
    }

    return { render, time };
}
