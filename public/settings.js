(() => {
    const storageKey = "rasis-tracker-settings";
    const legacyStorageKey = "rasis-tracker-appearance";
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const controls = [
        { name: "background-dim", unit: "", max: 1 },
        { name: "panel-dim", unit: "", max: 1 },
        { name: "background-blur", unit: "px", max: 30 },
        { name: "background-blur-mobile", unit: "px", max: 30 },
    ].map((control) => ({
        ...control,
        property: `--performance-${control.name}`,
        defaultValue: parseFloat(
            styles.getPropertyValue(`--performance-${control.name}`),
        ),
    }));
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
        "--chart-top50",
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
            return [
                name,
                Object.fromEntries(
                    controls.map((control) => {
                        const value = stored[control.name];
                        return [
                            control.name,
                            typeof value === "number" && Number.isFinite(value)
                                ? Math.max(0, Math.min(control.max, value))
                                : control.defaultValue,
                        ];
                    }),
                ),
            ];
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
        const { createSettingsPanel } = await import("./settings-panel.js");
        const toggle = document.getElementById("settings-toggle");
        const panel = document.getElementById("settings-panel");
        const backdrop = document.getElementById("settings-backdrop");
        const container = toggle.closest(".dashboard-settings");
        const themeButtons = panel.querySelectorAll("[data-theme-option]");
        const artworkCredit = document.getElementById("artwork-credit");
        const artworkCredits = {
            exceed: { artist: "蒼流リダ", url: "https://x.com/Lida_2617" },
            nabla: { artist: "ルト", url: "https://x.com/ruto_desu" },
        };
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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
        }

        function persist() {
            themeSettings[theme] = Object.fromEntries(
                controls.map(({ name, value }) => [name, value]),
            );
            try {
                localStorage.setItem(
                    storageKey,
                    JSON.stringify({
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
            control.value = Number(control.input.value);
            const display = control.unit
                ? `${control.value}px`
                : `${Math.round(control.value * 100)}%`;
            control.output.value = display;
            control.input.setAttribute("aria-valuetext", display);
            root.style.setProperty(
                control.property,
                `${control.value}${control.unit}`,
            );
        }

        for (const control of controls) {
            control.input = document.getElementById(
                `settings-${control.name}`,
            );
            control.output = document.getElementById(
                `settings-${control.name}-value`,
            );
            control.input.addEventListener("input", () => {
                control.value = Number(control.input.value);
                update(control);
                persist();
            });
        }
        setTheme(theme);
        const customButtons = document.querySelectorAll("[data-custom-option]");
        function updateCustomButtons() {
            document.getElementById("ranking-status").textContent = includeCustom
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
            onOpen: () => root.classList.add("settings-open"),
            onClosed: () => root.classList.remove("settings-open"),
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
                persist();
            });
    });
})();
