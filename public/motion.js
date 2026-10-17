const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pending = new Map();
const running = new Set();
const owners = new WeakMap();
const swaps = new WeakMap();
const curveReveals = new WeakMap();
const ease = "cubic-bezier(.22, 1, .36, 1)";
// A lighter slowdown at the end of the graph sweeps.
const graphEase = "cubic-bezier(.25, .1, .155, 1)";

function cancel(root) {
    owners.get(root)?.forEach((animation) => animation.cancel());
    owners.delete(root);
}

function play(root, element, keyframes, options = {}) {
    const animation = element.animate(keyframes, {
        duration: 520,
        easing: ease,
        fill: "backwards",
        ...options,
    });
    if (!owners.has(root)) owners.set(root, new Set());
    owners.get(root).add(animation);
    running.add(animation);
    const cleanup = () => {
        running.delete(animation);
        owners.get(root)?.delete(animation);
    };
    animation.finished.then(cleanup, cleanup);
    return animation;
}

function clearTree(root) {
    cancel(root);
    for (const target of pending.keys()) {
        if (!root.contains(target)) continue;
        pending.delete(target);
        observer?.unobserve(target);
        target.classList.remove("reveal-pending");
    }
    for (const animation of running) {
        if (root.contains(animation.effect?.target)) animation.cancel();
    }
}

function visible(root, minimum = 0) {
    if (document.hidden) return false;
    let bounds = root.getBoundingClientRect();
    if (!bounds.height && root.ownerSVGElement)
        bounds = root.ownerSVGElement.getBoundingClientRect();
    const top = window.visualViewport?.offsetTop || 0;
    const bottom = top + (window.visualViewport?.height || innerHeight) - 16;
    const height = Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top);
    return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        height > 0 &&
        height >= Math.min(bounds.height * minimum, (bottom - top) * 0.5)
    );
}

function start(root) {
    const next = pending.get(root);
    if (next && !root.isConnected) {
        pending.delete(root);
        observer?.unobserve(root);
        return;
    }
    if (!next || !visible(root, next.minimum)) return;
    pending.delete(root);
    observer?.unobserve(root);
    root.classList.remove("reveal-pending");
    if (root.isConnected && !reducedMotion.matches) next.reveal();
}

const observer =
    "IntersectionObserver" in window
        ? new IntersectionObserver(
              (entries) => {
                  for (const entry of entries)
                      if (entry.isIntersecting) start(entry.target);
              },
              { threshold: [0, 0.5], rootMargin: "0px 0px -16px 0px" },
          )
        : null;

let visibilityFrame;
function checkVisibility() {
    cancelAnimationFrame(visibilityFrame);
    visibilityFrame = requestAnimationFrame(() => {
        for (const root of pending.keys()) start(root);
    });
}
window.addEventListener("scroll", checkVisibility, { passive: true });
window.addEventListener("resize", checkVisibility);
window.visualViewport?.addEventListener("scroll", checkVisibility);
window.visualViewport?.addEventListener("resize", checkVisibility);
document.addEventListener("visibilitychange", checkVisibility);

function queue(root, reveal, minimum = 0) {
    if (!root) return;
    cancel(root);
    pending.delete(root);
    observer?.unobserve(root);
    root.classList.remove("reveal-pending");
    if (reducedMotion.matches) return;
    pending.set(root, { reveal, minimum });
    root.classList.add("reveal-pending");
    if (visible(root, minimum)) start(root);
    else observer?.observe(root);
}

function fade(root, element, delay = 0) {
    const tableRow = element.tagName === "TR";
    play(
        root,
        element,
        tableRow
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                  {
                      opacity: 0,
                      transform: "translateY(8px)",
                      filter: "blur(2px)",
                  },
                  {
                      opacity: 1,
                      transform: "translateY(0)",
                      filter: "blur(0px)",
                  },
              ],
        { delay },
    );
}

function draw(root, path, delay = 0, duration = 950) {
    const length = path.getTotalLength();
    if (!(length > 0)) return;
    play(
        root,
        path,
        [
            {
                strokeDasharray: `${length} ${length}`,
                strokeDashoffset: length,
            },
            { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
        ],
        { delay, duration },
    );
}

function sweep(
    root,
    element,
    delay = 0,
    { from = { opacity: 0, clipPath: "inset(0 100% 0 0)" }, ...options } = {},
) {
    return play(
        root,
        element,
        [from, { opacity: 1, clipPath: "inset(0 0% 0 0)" }],
        { duration: 1100, delay, easing: graphEase, ...options },
    );
}

export const motion = {
    isPending(root) {
        return pending.has(root);
    },
    stop(root) {
        if (root) clearTree(root);
    },
    async swap(roots, render) {
        roots = roots.filter(Boolean);
        const version = {};
        const opacities = roots.map((root) => getComputedStyle(root).opacity);
        for (const root of roots) {
            swaps.set(root, version);
            clearTree(root);
        }
        if (reducedMotion.matches) {
            render();
            return;
        }
        const fadeOut = roots.map((root, index) =>
            play(root, root, [{ opacity: opacities[index] }, { opacity: 0 }], {
                duration: 120,
                easing: "ease-in",
                fill: "forwards",
            }),
        );
        await Promise.allSettled(
            fadeOut.map((animation) => animation.finished),
        );
        if (roots.some((root) => swaps.get(root) !== version)) {
            fadeOut.forEach((animation) => animation.cancel());
            return;
        }
        try {
            roots.forEach(clearTree);
            render();
        } finally {
            fadeOut.forEach((animation) => animation.cancel());
        }
        if (!reducedMotion.matches) {
            roots.forEach((root) =>
                play(root, root, [{ opacity: 0 }, { opacity: 1 }], {
                    duration: 800,
                }),
            );
        }
    },
    data(root, selector = null) {
        queue(root, () => {
            const elements = selector
                ? [...root.querySelectorAll(selector)].filter(
                      (el) => !el.hidden,
                  )
                : [root];
            elements.forEach((element, index) =>
                fade(root, element, Math.min(index, 12) * 24),
            );
        });
    },
    metrics(root) {
        queue(root, () => {
            root.querySelectorAll(".metric").forEach((metric, index) => {
                metric
                    .querySelectorAll(
                        ".metric-value, .metric-detail, .vf-class",
                    )
                    .forEach((element) => {
                        if (!element.hidden) fade(root, element, index * 55);
                    });
            });
            root.querySelectorAll(".metric-spark path").forEach((path) =>
                draw(root, path, 160),
            );
        });
    },
    history(svg, animate = true) {
        if (!animate && !pending.has(svg)) return;
        queue(
            svg,
            () => {
                play(svg, svg, [{ opacity: 0 }, { opacity: 1 }], {
                    duration: 400,
                });
                const series = svg.querySelector(".history-series");
                if (series)
                    play(
                        svg,
                        series,
                        [
                            { clipPath: "inset(0 100% 0 0)" },
                            { clipPath: "inset(0 0% 0 0)" },
                        ],
                        {
                            duration: 800, // Line tracing speed
                            delay: 100,
                            easing: graphEase,
                        },
                    );
            },
            0.5,
        );
    },
    histogram(svg, animate = true) {
        if (!animate && !pending.has(svg)) return;
        queue(
            svg,
            () => {
                play(svg, svg, [{ opacity: 0 }, { opacity: 1 }], {
                    duration: 400,
                });
                svg.querySelectorAll(".timing-bar").forEach((bar, index) => {
                    const bottom =
                        Number(bar.getAttribute("y")) +
                        Number(bar.getAttribute("height"));
                    play(
                        svg,
                        bar,
                        [
                            {
                                transform: `translateY(${bottom}px) scaleY(0) translateY(${-bottom}px)`,
                            },
                            {
                                transform: `translateY(${bottom}px) scaleY(1) translateY(${-bottom}px)`,
                            },
                        ],
                        { duration: 850, delay: 100 + index * 45 },
                    );
                });
                svg.querySelectorAll(".timing-count").forEach(
                    (label, index) => {
                        play(svg, label, [{ opacity: 0 }, { opacity: 1 }], {
                            duration: 350,
                            delay: 380 + index * 45,
                        });
                    },
                );
                const curve = svg.querySelector(".timing-curve");
                if (curve)
                    play(
                        svg,
                        curve,
                        [
                            { opacity: 0, clipPath: "inset(0 100% 0 0)" },
                            { opacity: 1, clipPath: "inset(0 0% 0 0)" },
                        ],
                        { duration: 1100, delay: 180, easing: graphEase },
                    );
            },
            0.5,
        );
    },
    calculator(svg, animate = true) {
        if (!animate && !pending.has(svg)) return;
        queue(
            svg,
            () => {
                svg.querySelectorAll(
                    ".calculator-curve:not([hidden]), .calculator-chart-points, .calculator-reference",
                ).forEach((curve, index) => sweep(svg, curve, index * 65));
                const markers = svg.querySelector(".calculator-markers");
                if (markers)
                    play(svg, markers, [{ opacity: 0 }, { opacity: 1 }], {
                        duration: 300,
                        delay: 900,
                    });
            },
            0.5,
        );
    },
    calculatorCurves(svg, showPuc, animate = true) {
        const shouldAnimate =
            animate &&
            !reducedMotion.matches &&
            !pending.has(svg) &&
            visible(svg);
        for (const curve of svg.querySelectorAll(".calculator-curve")) {
            const show = (curve.dataset.clear === "6") === showPuc;
            if (!shouldAnimate) {
                curveReveals.delete(curve);
                clearTree(curve);
                curve.toggleAttribute("hidden", !show);
                continue;
            }
            const active = curveReveals.get(curve);
            if (active?.show === show) continue;
            if (!active && curve.hasAttribute("hidden") === !show) continue;
            const style = getComputedStyle(curve);
            const from = curve.hasAttribute("hidden")
                ? { opacity: 0, clipPath: "inset(0 100% 0 0)" }
                : { opacity: style.opacity, clipPath: style.clipPath };
            curveReveals.delete(curve);
            clearTree(curve);
            curve.removeAttribute("hidden");
            const animation = show
                ? sweep(curve, curve, 0, { fill: "both", from })
                : play(curve, curve, [from, { ...from, opacity: 0 }], {
                      fill: "both",
                  });
            const reveal = { animation, show };
            curveReveals.set(curve, reveal);
            animation.addEventListener("finish", () => {
                if (
                    curveReveals.get(curve) !== reveal ||
                    animation.playState !== "finished"
                )
                    return;
                curve.toggleAttribute("hidden", !reveal.show);
                curveReveals.delete(curve);
                animation.cancel();
            });
            animation.addEventListener("cancel", () => {
                if (curveReveals.get(curve) !== reveal) return;
                curve.toggleAttribute("hidden", !reveal.show);
                curveReveals.delete(curve);
            });
        }
    },
    calculatorReferences(root) {
        queue(
            root,
            () => {
                root.querySelectorAll(".calculator-reference").forEach(
                    (reference, index) => sweep(root, reference, index * 65),
                );
            },
            0.5,
        );
    },
};

reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches) return;
    for (const root of pending.keys()) {
        root.classList.remove("reveal-pending");
        observer?.unobserve(root);
    }
    pending.clear();
    for (const animation of running) animation.cancel();
});
