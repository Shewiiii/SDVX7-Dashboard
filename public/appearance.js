(() => {
    const storageKey = "rasis-tracker-appearance";
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
        const stored = JSON.parse(localStorage.getItem(storageKey));
        if (stored && typeof stored === "object" && !Array.isArray(stored))
            saved = stored;
    } catch {
        // Malformed or unavailable storage must not prevent dashboard loading.
    }

    // Restore before the page renders to avoid flashing the default appearance.
    for (const control of controls) {
        const value = saved[control.name];
        control.value =
            typeof value === "number" && Number.isFinite(value)
                ? Math.max(0, Math.min(control.max, value))
                : control.defaultValue;
        root.style.setProperty(
            control.property,
            `${control.value}${control.unit}`,
        );
    }

    document.addEventListener("DOMContentLoaded", () => {
        const toggle = document.getElementById("appearance-toggle");
        const panel = document.getElementById("appearance-panel");
        const container = toggle.closest(".appearance-settings");

        function persist(reset = false) {
            try {
                if (reset) localStorage.removeItem(storageKey);
                else
                    localStorage.setItem(
                        storageKey,
                        JSON.stringify(
                            Object.fromEntries(
                                controls.map(({ name, value }) => [
                                    name,
                                    value,
                                ]),
                            ),
                        ),
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
                `appearance-${control.name}`,
            );
            control.output = document.getElementById(
                `appearance-${control.name}-value`,
            );
            update(control);
            control.input.addEventListener("input", () => {
                control.value = Number(control.input.value);
                update(control);
                persist();
            });
        }

        function setOpen(open) {
            panel.hidden = !open;
            toggle.setAttribute("aria-expanded", String(open));
            if (open) controls[0].input.focus();
        }

        toggle.addEventListener("click", () => setOpen(panel.hidden));
        document.addEventListener("pointerdown", (event) => {
            if (!container.contains(event.target)) setOpen(false);
        });
        container.addEventListener("focusout", (event) => {
            if (!container.contains(event.relatedTarget)) setOpen(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !panel.hidden) {
                setOpen(false);
                toggle.focus();
            }
        });
        document
            .getElementById("appearance-reset")
            .addEventListener("click", () => {
                for (const control of controls) {
                    control.value = control.defaultValue;
                    update(control);
                }
                persist(true);
            });
    });
})();
