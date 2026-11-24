(() => {
    const storageKey = "rasis-tracker-settings";
    const legacyStorageKey = "rasis-tracker-appearance";
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const defaultParticlesEnabled = !matchMedia(
        "(max-width: 600px) and (pointer: coarse), (max-width: 1024px) and (max-height: 550px) and (pointer: coarse)",
    ).matches;
    const controls = [
        {
            name: "background-tint",
            type: "color",
            unit: "",
            property: "--background-tint",
        },
        {
            name: "background-edge",
            type: "color",
            unit: "",
            property: "--background-edge",
        },
        { name: "background-dim", unit: "", max: 1 },
        { name: "particle-density", unit: "", min: 0.25, max: 3 },
        { name: "particle-size", unit: "", min: 0.25, max: 2 },
        { name: "particle-speed", unit: "", min: 0.25, max: 3 },
        { name: "particle-fps", unit: "", suffix: " FPS", min: 5, max: 60 },
        { name: "background-black-lift", unit: "", max: 0.3 },
        { name: "panel-dim", unit: "", max: 1 },
        { name: "panel-blur", unit: "px", max: 100 },
        { name: "background-iris-feather", unit: "px", max: 1000 },
        { name: "background-iris-feather-mobile", unit: "px", max: 1000 },
        { name: "background-blur-strength", unit: "px", max: 60 },
        { name: "background-vignette", unit: "", max: 1 },
        { name: "background-iris-radius", unit: "", max: 1 },
        { name: "background-aberration", unit: "px", max: 12 },
    ].map((control) => {
        const property = control.property ?? `--performance-${control.name}`;
        const value = styles.getPropertyValue(property).trim();
        return {
            ...control,
            property,
            defaultValue: control.type === "color" ? value : parseFloat(value),
        };
    });
    let saved = {};
    let storageAvailable = true;
    try {
        const current = localStorage.getItem(storageKey);
        const stored = JSON.parse(
            current ?? localStorage.getItem(legacyStorageKey),
        );
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            saved = stored;
            if (current === null) {
                localStorage.setItem(storageKey, JSON.stringify(saved));
                localStorage.removeItem(legacyStorageKey);
            }
        }
    } catch {
        // Malformed or unavailable storage must not prevent dashboard loading.
    }

    const themeColors = [
        "--accent",
        "--chart-total",
        "--chart-plays",
        "--chart-play-points",
        "--chart-best",
        "--chart-avg10",
        "--chart-best50",
        "--timing-early-color",
        "--timing-late-color",
        "--timing-curve-color",
        "--notice-accent",
        "--notice-text",
        "--chart-summary-color",
    ];
    const animatedColors = [];
    // Typed color variables interpolate without overriding existing button animations.
    if (window.CSS?.registerProperty) {
        for (const name of themeColors) {
            try {
                CSS.registerProperty({
                    name,
                    syntax: "<color>",
                    inherits: true,
                    initialValue: styles.getPropertyValue(name).trim(),
                });
                animatedColors.push(name);
            } catch {
                // Theme colors still switch when typed properties are unavailable.
            }
        }
    }
    let theme = saved.theme === "exceed" ? "exceed" : "nabla";
    let includeCustom = saved.includeCustom === true;
    root.dataset.includeCustom = String(includeCustom);
    const themeSettings = Object.fromEntries(
        ["exceed", "nabla"].map((name) => {
            // Keep legacy shared settings for the theme they were saved with.
            const stored =
                saved.themes?.[name] ?? (name === theme ? saved : {});
            const particlesEnabled =
                stored["background-particles"] ?? stored["background-sparks"];
            const values = {
                "background-particles":
                    typeof particlesEnabled === "boolean"
                        ? particlesEnabled
                        : defaultParticlesEnabled,
                ...Object.fromEntries(
                    controls.map((control) => {
                        let value = stored[control.name];
                        if (
                            value === undefined &&
                            control.name.startsWith("particle-")
                        ) {
                            value =
                                stored[
                                    control.name.replace("particle-", "dust-")
                                ];
                        }
                        if (control.type === "color") {
                            return [
                                control.name,
                                typeof value === "string" &&
                                /^#[0-9a-f]{6}$/i.test(value)
                                    ? value.toLowerCase()
                                    : control.defaultValue,
                            ];
                        }
                        if (
                            control.name === "background-blur-strength" &&
                            saved.appearanceVersion !== 2
                        ) {
                            const legacyBlur = Math.max(
                                ...[
                                    "background-blur",
                                    "background-blur-mobile",
                                ].map((key) =>
                                    Number.isFinite(stored[key])
                                        ? Math.max(
                                              0,
                                              Math.min(200, stored[key]),
                                          )
                                        : 0,
                                ),
                            );
                            const blend = Number.isFinite(value)
                                ? Math.max(0, Math.min(1, value))
                                : 1;
                            value =
                                blend === 0
                                    ? 0
                                    : legacyBlur > 0
                                      ? legacyBlur * blend
                                      : control.defaultValue;
                        }
                        return [
                            control.name,
                            typeof value === "number" && Number.isFinite(value)
                                ? Math.max(
                                      control.min ?? 0,
                                      Math.min(control.max, value),
                                  )
                                : control.defaultValue,
                        ];
                    }),
                ),
            };
            return [name, values];
        }),
    );
    root.dataset.theme = theme;

    // Restore before the page renders to avoid flashing the default settings
    for (const control of controls) {
        control.value = themeSettings[theme][control.name];
        root.style.setProperty(
            control.property,
            `${control.value}${control.unit}`,
        );
    }

    document.addEventListener("DOMContentLoaded", async () => {
        const [
            { createSettingsPanel },
            { createParticleRenderer },
            { hasVisiblePanelBackdrop },
        ] = await Promise.all([
            import("/js/core/settings-panel.js"),
            import("/js/core/ambient-particles.js"),
            import("/js/core/panels.js"),
        ]);
        const toggle = document.getElementById("settings-toggle");
        const panel = document.getElementById("settings-panel");
        const backdrop = document.getElementById("settings-backdrop");
        const container = toggle.closest(".dashboard-settings");
        const themeButtons = panel.querySelectorAll("[data-theme-option]");
        const particleButtons = panel.querySelectorAll(
            "[data-particles-option]",
        );
        const particleLayer = document.querySelector(".ambient-particles");
        const particleRenderer = createParticleRenderer(
            particleLayer.querySelector("canvas"),
            hasVisiblePanelBackdrop,
        );
        const particleDensity = document.getElementById(
            "settings-particle-density",
        );
        const phone = matchMedia("(max-width: 900px)");
        const artworkCredit = document.getElementById("artwork-credit");
        const artworkCredits = {
            exceed: { artist: "蒼流リダ", url: "https://x.com/Lida_2617" },
            nabla: { artist: "ルト", url: "https://x.com/ruto_desu" },
        };
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
        const settingsPages = document.getElementById("settings-pages");
        const mainPage = document.getElementById("settings-main");
        const advancedPage = document.getElementById("settings-advanced");
        const advancedControls = document.getElementById(
            "settings-advanced-controls",
        );
        const advancedOpen = document.getElementById("settings-advanced-open");
        const advancedBack = document.getElementById("settings-advanced-back");
        let activePage = mainPage;
        let pageVersion = 0;
        let pageAnimations = [];

        function showSettingsPage(advanced, animate = true, moveFocus = true) {
            backdrop.classList.toggle("is-preview", advanced);
            const next = advanced ? advancedPage : mainPage;
            const previous = activePage;
            const version = ++pageVersion;

            for (const animation of pageAnimations) animation.cancel();
            pageAnimations = [];
            settingsPages.style.height = "";
            for (const page of [mainPage, advancedPage]) {
                page.hidden = page !== previous;
                page.inert = page !== previous;
            }

            const previousHeight = previous.offsetHeight;
            next.hidden = false;
            next.inert = false;
            next.scrollTop = 0;
            if (advanced) advancedControls.scrollTop = 0;
            activePage = next;
            advancedOpen.setAttribute("aria-expanded", String(advanced));
            if (moveFocus) {
                (advanced ? advancedBack : advancedOpen).focus({
                    preventScroll: true,
                });
            }
            previous.inert = previous !== next;

            const finish = () => {
                if (version !== pageVersion) return;
                previous.hidden = previous !== next;
                for (const animation of pageAnimations) animation.cancel();
                pageAnimations = [];
                settingsPages.style.height = "";
            };

            if (
                previous === next ||
                !animate ||
                reducedMotion.matches ||
                !panel.classList.contains("is-visible")
            ) {
                finish();
                return;
            }

            const nextHeight = next.offsetHeight;
            const direction = advanced ? 1 : -1;
            const options = {
                duration: 260,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                fill: "both",
            };
            settingsPages.style.height = `${previousHeight}px`;
            pageAnimations = [
                previous.animate(
                    [
                        { transform: "translateX(0)", opacity: 1 },
                        {
                            transform: `translateX(${-direction * 100}%)`,
                            opacity: 0,
                        },
                    ],
                    options,
                ),
                next.animate(
                    [
                        {
                            transform: `translateX(${direction * 100}%)`,
                            opacity: 0,
                        },
                        { transform: "translateX(0)", opacity: 1 },
                    ],
                    options,
                ),
                settingsPages.animate(
                    [
                        { height: `${previousHeight}px` },
                        { height: `${nextHeight}px` },
                    ],
                    options,
                ),
            ];
            Promise.allSettled(
                pageAnimations.map((animation) => animation.finished),
            ).then(finish);
        }

        advancedOpen.addEventListener("click", () => showSettingsPage(true));
        advancedBack.addEventListener("click", () => showSettingsPage(false));

        function updateThemeMotion() {
            root.style.transition =
                reducedMotion.matches || !animatedColors.length
                    ? "none"
                    : animatedColors
                          .map(
                              (name) =>
                                  `${name} var(--theme-transition-duration) var(--theme-transition-easing)`,
                          )
                          .join(", ");
        }
        updateThemeMotion();
        reducedMotion.addEventListener("change", updateThemeMotion);

        const particleFps = document.getElementById("settings-particle-fps");
        const particleSpeed = document.getElementById("settings-particle-speed");
        let particleFrame;
        let particleTime = 0;

        function syncParticles() {
            cancelAnimationFrame(particleFrame);
            particleLayer.hidden =
                !themeSettings[theme]["background-particles"] || document.hidden;
            if (
                !particleRenderer ||
                particleLayer.hidden ||
                hasVisiblePanelBackdrop()
            )
                return;
            particleRenderer.setCount(
                Math.round(192 * particleDensity.valueAsNumber),
            );
            if (reducedMotion.matches) {
                particleRenderer.draw(0, 1, true);
                return;
            }

            const initialTime = particleTime;
            const frameInterval = 1000 / particleFps.valueAsNumber;
            let start;
            let frameIndex = -1;

            function drawParticles(now) {
                particleFrame = requestAnimationFrame(drawParticles);
                start ??= now;
                const elapsed = now - start;
                const index = Math.floor((elapsed + 0.5) / frameInterval);
                if (index <= frameIndex) return;
                frameIndex = index;

                particleTime = initialTime + elapsed;
                particleRenderer.draw(
                    particleTime,
                    particleSpeed.valueAsNumber,
                    false,
                );
            }
            particleFrame = requestAnimationFrame(drawParticles);
        }

        function updateParticles() {
            const enabled = themeSettings[theme]["background-particles"];
            syncParticles();
            for (const button of particleButtons) {
                const selected =
                    (button.dataset.particlesOption === "on") === enabled;
                button.classList.toggle("selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            }
        }

        document.addEventListener("visibilitychange", syncParticles);
        document.addEventListener(
            "dashboard:panel-backdrop-change",
            syncParticles,
        );
        phone.addEventListener("change", syncParticles);
        reducedMotion.addEventListener("change", syncParticles);
        for (const button of particleButtons) {
            button.addEventListener("click", () => {
                themeSettings[theme]["background-particles"] =
                    button.dataset.particlesOption === "on";
                updateParticles();
                persist();
            });
        }

        function setTheme(value) {
            theme = value;
            root.dataset.theme = theme;
            const credit = artworkCredits[theme];
            artworkCredit.textContent = `Artwork by ${credit.artist}`;
            artworkCredit.href = credit.url;
            for (const button of themeButtons) {
                const selected = button.dataset.themeOption === theme;
                button.classList.toggle("selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            }
            for (const control of controls) {
                control.value = themeSettings[theme][control.name];
                update(control);
            }
            updateParticles();
        }

        function persist() {
            for (const { name, value } of controls) {
                themeSettings[theme][name] = value;
            }
            try {
                localStorage.setItem(
                    storageKey,
                    JSON.stringify({
                        appearanceVersion: 2,
                        theme,
                        themes: themeSettings,
                        includeCustom,
                    }),
                );
                storageAvailable = true;
            } catch {
                storageAvailable = false;
            }
        }

        function update(control) {
            control.input.value = control.value;
            // Range inputs normalize values to their supported step.
            control.value =
                control.type === "color"
                    ? control.input.value
                    : Number(control.input.value);
            const display =
                control.type === "color"
                    ? control.value
                    : control.suffix
                      ? `${control.value}${control.suffix}`
                      : control.unit
                        ? `${control.value}px`
                        : `${Math.round(control.value * 100)}%`;
            control.output.value = display;
            if (control.name === "particle-fps") {
                control.output.classList.toggle(
                    "above-default-fps",
                    control.value > 30,
                );
            }
            control.input.setAttribute("aria-valuetext", display);
            root.style.setProperty(
                control.property,
                `${control.value}${control.unit}`,
            );
            if (control.name === "panel-blur") {
                root.toggleAttribute("data-panel-blur", control.value > 0);
            }
            if (control.name === "background-blur-strength") {
                document
                    .querySelector("#ambient-iris-blur feGaussianBlur")
                    .setAttribute("stdDeviation", String(control.value));
                root.toggleAttribute("data-iris-blur", control.value > 0);
            }
            if (control.name === "background-black-lift") {
                // Lift shadows with a smooth curve that leaves white unchanged
                const table = Array.from({ length: 33 }, (_, index) => {
                    const tone = index / 32;
                    return (tone + control.value * (1 - tone) ** 3).toFixed(5);
                }).join(" ");
                for (const channel of document.querySelectorAll(
                    "#ambient-black-curve feComponentTransfer > *",
                )) {
                    channel.setAttribute("tableValues", table);
                }
                root.toggleAttribute("data-raised-blacks", control.value > 0);
            }
        }

        for (const control of controls) {
            control.input = document.getElementById(`settings-${control.name}`);
            control.output = document.getElementById(
                `settings-${control.name}-value`,
            );
            control.input.addEventListener("input", () => {
                control.value =
                    control.type === "color"
                        ? control.input.value
                        : Number(control.input.value);
                update(control);
                if (
                    control.name === "particle-density" ||
                    control.name === "particle-fps" ||
                    (control.name === "particle-size" && reducedMotion.matches)
                ) {
                    syncParticles();
                }
                persist();
            });
        }
        setTheme(theme);
        for (const scene of document.querySelectorAll(".ambient-scene")) {
            const background = getComputedStyle(scene).backgroundImage;
            if (!background.startsWith("url(")) continue;
            const artwork = new Image();
            artwork.src = background.slice(4, -1).replace(/^["']|["']$/g, "");
            artwork.decode().then(
                () => scene.setAttribute("data-artwork-ready", ""),
                () => {
                    // Keep the plain background when artwork cannot load
                },
            );
        }
        const customButtons = document.querySelectorAll("[data-custom-option]");
        function updateCustomButtons() {
            document.getElementById("ranking-status").textContent =
                includeCustom
                    ? "Custom charts ranked"
                    : "Custom charts not ranked";
            for (const button of customButtons) {
                const selected =
                    (button.dataset.customOption === "true") === includeCustom;
                button.classList.toggle("selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            }
        }

        updateCustomButtons();
        for (const button of customButtons) {
            button.addEventListener("click", () => {
                const value = button.dataset.customOption === "true";
                if (includeCustom === value) return;
                includeCustom = value;
                root.dataset.includeCustom = String(includeCustom);
                updateCustomButtons();
                persist();
                document.dispatchEvent(new Event("dashboard:ranking-change"));
            });
        }

        for (const button of themeButtons) {
            button.addEventListener("click", () => {
                if (theme === button.dataset.themeOption) return;
                setTheme(button.dataset.themeOption);
                persist();
            });
        }

        const { setOpen } = createSettingsPanel({
            toggle,
            panel,
            backdrop,
            container,
            canOpen: () => !document.querySelector("dialog[open]"),
            focus: "[data-theme-option].selected",
            onOpen: () => {
                showSettingsPage(false, false, false);
                root.classList.add("settings-open");
            },
            onClosed: () => {
                showSettingsPage(false, false, false);
                root.classList.remove("settings-open");
            },
        });
        document.addEventListener("dashboard:panel-open", (event) => {
            if (event.detail !== "settings") setOpen(false, true);
        });
        document
            .getElementById("settings-reset")
            .addEventListener("click", () => {
                for (const control of controls) {
                    control.value = control.defaultValue;
                    update(control);
                }
                syncParticles();
                persist();
            });
    });
})();
