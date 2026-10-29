import { createLive2dPlayer } from "./crew-live2d.js";
import { createAfpPlayer } from "./crew-afp.js";
import { initSegmentedControl } from "./motion.js";
import { createCrewVoices } from "./crew-voices.js";

const labels = {
    In: "Entrance",
    in: "Entrance",
    Idle: "Idle",
    neu_loop: "Idle",
    loop: "Idle",
    Ok: "Confirm",
    kettei: "Confirm",
    Out: "Exit",
    out: "Exit",
    R_Good: "Good result",
    R_Bad: "Bad result",
    R_Verygood: "Very good result",
    R_Good_Loop: "Good result pose",
    R_Bad_Loop: "Bad result pose",
    R_Verygood_Loop: "Very good result pose",
};

function toggle(name, label, enabled, live2d = false) {
    return `<div class="settings-row" ${live2d ? "data-live2d-control" : ""}><span id="crew-${name}-label">${label}</span><div id="crew-${name}" class="segmented" role="group" aria-labelledby="crew-${name}-label">${[true, false].map((value) => `<button type="button" data-crew-toggle="${name}" data-value="${value}" aria-pressed="${value === enabled}" class="${value === enabled ? "selected" : ""}">${value ? "On" : "Off"}</button>`).join("")}</div></div>`;
}

function isResultPose(group) {
    return /^r_(good|bad|verygood)_loop$/i.test(group);
}

function loops(group) {
    return /^(idle\d*|loop|neu_loop|moto_neu)$/i.test(group) || isResultPose(group);
}

export function createCrewViewer(dialog, getState) {
    const host = document.getElementById("nemsys-crew-view");
    host.innerHTML = `
        <div class="crew-heading"><div><h3 id="crew-name">Nemsys Crew</h3><p id="crew-subtitle" class="panel-subtitle"></p></div><span id="crew-current" class="crew-current" hidden>Current crew in-game</span></div>
        <div class="crew-stage"><p class="details-message" id="crew-status" role="status">Loading crew members...</p><img id="crew-artwork" alt="" draggable="false" hidden><canvas id="crew-canvas" aria-label="Animated character preview" hidden></canvas></div>
        <div class="crew-playback"><button type="button" id="crew-play" class="text-button" disabled>Pause</button><button type="button" id="crew-replay" class="text-button" disabled>Replay</button><button type="button" id="crew-jump" class="text-button crew-jump" aria-label="Scroll to crew members" aria-controls="crew-browser" hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
        <section id="crew-browser" class="crew-browser" aria-labelledby="crew-browser-title" hidden><h2 id="crew-browser-title" tabindex="-1">Crew members</h2><div class="crew-browser-tools"><label class="search-wrap"><span aria-hidden="true">⌕</span><input type="search" id="crew-search" placeholder="Type anything..." aria-label="Find a Nemsys Crew by name or ID"></label><div class="select-wrap"><select id="crew-sort" aria-label="Sort crew members"><option value="newest">Newest</option><option value="oldest">Oldest</option></select></div></div><p id="crew-count"></p><div class="crew-strip" id="crew-strip" aria-label="Crew members"></div></section>`;
    const browser = host.querySelector(".crew-browser");
    const settings = document.createElement("section");
    settings.id = "crew-settings";
    settings.className = "chart-viewer-settings crew-settings";
    settings.setAttribute("aria-labelledby", "crew-settings-title");
    settings.hidden = true;
    settings.innerHTML = `
        <h2 id="crew-settings-title" tabindex="-1">Crew settings</h2>
        <div class="settings-row"><label for="crew-motion">Animation</label><select id="crew-motion" disabled></select></div>
        <div class="settings-control"><span id="crew-speed-label">Playback speed</span><div class="segmented chart-viewer-rates" role="group" aria-labelledby="crew-speed-label">${[0.5, 0.75, 1, 1.5].map((rate) => `<button type="button" data-crew-rate="${rate}" aria-pressed="${rate === 1}" class="${rate === 1 ? "selected" : ""}">${rate}×</button>`).join("")}</div></div>
        <div class="settings-control crew-scale"><label for="crew-zoom">Scale</label><div class="crew-scale-value"><button type="button" class="text-button" id="crew-scale-reset" aria-label="Reset character scale">Reset</button><output for="crew-zoom">100%</output></div><input id="crew-zoom" type="range" min="50" max="1000" step="5" value="100"></div>
        <div class="settings-row crew-position"><span id="crew-position-value">Position (0, 0)</span><button type="button" class="text-button" id="crew-position-reset">Reset</button></div>
        ${toggle("tracking", "Follow pointer", false, true)}
        ${toggle("physics", "Physics", true, true)}
        <p id="crew-renderer-note" class="settings-hint" hidden>Some scripted effects may differ from the game.</p>
        <div class="settings-footer"><button type="button" class="text-button" id="crew-reset">Reset</button></div>`;
    const sidebar = document.createElement("div");
    sidebar.className = "crew-sidebar";
    sidebar.hidden = true;
    const voices = document.createElement("section");
    voices.className = "crew-voices";
    voices.id = "crew-voices";
    const voiceBank = createCrewVoices(voices);
    sidebar.append(settings, voices);
    dialog.append(sidebar, browser);
    const $ = (id) => document.getElementById(id);
    const status = $("crew-status");
    const strip = $("crew-strip");
    const image = $("crew-artwork");
    const stage = host.querySelector(".crew-stage");
    const motion = $("crew-motion");
    const jump = $("crew-jump");
    dialog.append(jump);
    const mobile = matchMedia("(max-width: 1199px)");
    let canvas = $("crew-canvas");
    let catalog;
    let catalogTask;
    let selected;
    let player;
    let request;
    let active = false;
    let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rate = 1;
    let frame;
    let previous = 0;
    let revision = 0;
    let currentId;
    let panX = 0;
    let panY = 0;
    let zoom = 1;
    let drag;
    let jumpTarget = null;
    let previewScrollFrame = 0;
    const options = { tracking: false, physics: true };
    for (const group of settings.querySelectorAll(".segmented"))
        initSegmentedControl(group);

    function panelScrollTarget(element) {
        const top =
            dialog.scrollTop +
            element.getBoundingClientRect().bottom -
            dialog.getBoundingClientRect().top -
            dialog.clientTop -
            dialog.clientHeight +
            16;
        return Math.max(
            0,
            Math.min(top, dialog.scrollHeight - dialog.clientHeight),
        );
    }

    function nextJump() {
        const position = Math.max(dialog.scrollTop, jumpTarget ?? 0);
        const panels = [
            { element: settings, label: "crew settings" },
            { element: voices, label: "voice bank" },
            { element: browser, label: "crew members" },
        ].filter(({ element }) => !element.hidden);
        const destinations = panels.map((panel) => ({
            ...panel,
            top:
                panel.element === browser
                    ? dialog.scrollHeight - dialog.clientHeight
                    : panelScrollTarget(panel.element),
        }));
        return (
            destinations.find(({ top }) => top > position + 1) ||
            destinations.at(-1)
        );
    }

    function updateJump() {
        jump.hidden =
            !active ||
            !mobile.matches ||
            browser.hidden ||
            dialog.scrollTop >= dialog.scrollHeight - dialog.clientHeight - 1;
        if (jump.hidden) return;
        const target = nextJump();
        jump.setAttribute("aria-label", `Scroll to ${target.label}`);
        jump.setAttribute("aria-controls", target.element.id);
    }

    dialog.addEventListener("scroll", updateJump, { passive: true });
    function clearJumpTarget() {
        jumpTarget = null;
        updateJump();
    }
    function clearPreviewScroll() {
        cancelAnimationFrame(previewScrollFrame);
        previewScrollFrame = 0;
        sidebar.style.minHeight = "";
    }

    function clearScrollIntent() {
        clearJumpTarget();
        clearPreviewScroll();
    }

    function scrollToPreview() {
        if (!mobile.matches) return;
        clearJumpTarget();
        cancelAnimationFrame(previewScrollFrame);
        // Keep loading states from shrinking the page beneath an active scroll.
        sidebar.style.minHeight = `${sidebar.getBoundingClientRect().height}px`;
        previewScrollFrame = requestAnimationFrame(() => {
            previewScrollFrame = 0;
            dialog.scrollTo({
                top: 0,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "instant"
                    : "smooth",
            });
            if (dialog.scrollTop <= 1) clearPreviewScroll();
        });
    }

    dialog.addEventListener("scrollend", () => {
        clearJumpTarget();
        if (dialog.scrollTop <= 1) clearPreviewScroll();
    });
    dialog.addEventListener("wheel", clearScrollIntent, { passive: true });
    dialog.addEventListener(
        "touchstart",
        (event) => {
            if (!jump.contains(event.target)) clearScrollIntent();
        },
        { passive: true },
    );
    dialog.addEventListener("keydown", (event) => {
        if (
            [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
            ].includes(event.key)
        )
            clearScrollIntent();
    });
    mobile.addEventListener("change", () => {
        if (!mobile.matches) clearPreviewScroll();
        updateJump();
    });
    const jumpObserver = new ResizeObserver(updateJump);
    for (const element of [dialog, browser, settings, voices])
        jumpObserver.observe(element);
    jump.addEventListener("click", () => {
        if (jump.hidden) return;
        clearPreviewScroll();
        const target = nextJump();
        jumpTarget = target.top;
        dialog.scrollTo({
            top: jumpTarget,
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
        });
        const heading = target.element.querySelector("h2");
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        updateJump();
    });

    function loadCatalog(refresh = false) {
        if (!catalogTask || refresh) {
            const task = fetch("/api/crews", { cache: "no-store" }).then(
                async (response) => {
                    if (!response.ok)
                        throw Error("Crew members are unavailable.");
                    const value = await response.json();
                    if (
                        value.available !== true ||
                        !Array.isArray(value.crews) ||
                        !value.crews.length
                    )
                        throw Error("Crew members are unavailable.");
                    value.base = new URL(
                        value.base || "/crew-assets/",
                        location.href,
                    ).href;
                    return value;
                },
            );
            catalogTask = task;
            void task.catch(() => {
                if (catalogTask === task) catalogTask = null;
            });
        }
        return catalogTask;
    }

    function setToggle(name, enabled) {
        options[name] = enabled;
        for (const button of settings.querySelectorAll(
            `[data-crew-toggle="${name}"]`,
        )) {
            const selected = (button.dataset.value === "true") === enabled;
            button.classList.toggle("selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        }
    }

    function setStatus(text) {
        status.textContent = text;
        status.hidden = !text;
    }

    function stop() {
        endDrag();
        stage.classList.remove("is-ready");
        revision++;
        request?.abort();
        request = null;
        cancelAnimationFrame(frame);
        previous = 0;
        player?.destroy();
        player = null;
        canvas.hidden = true;
        image.hidden = true;
        motion.disabled = true;
        $("crew-play").disabled = true;
        $("crew-replay").disabled = true;
    }

    function tick(now) {
        if (!active || !player) return;
        const delta = previous ? Math.min(100, now - previous) : 0;
        previous = now;
        player.render(playing && !document.hidden ? delta * rate : 0);
        frame = requestAnimationFrame(tick);
    }

    function updatePlayback() {
        $("crew-play").textContent = playing ? "Pause" : "Play";
        $("crew-play").setAttribute(
            "aria-label",
            playing ? "Pause character animation" : "Play character animation",
        );
    }

    async function playMotion() {
        const item = player?.motions[Number(motion.value)];
        if (!item) return;
        const currentPlayer = player;
        const version = revision;
        const returnsToIdle = /^(in\d*|moto_in|ok|kettei)$/i.test(item.group);
        const followup = returnsToIdle
            ? player.motions.find((entry) =>
                  ["Idle", "idle", "loop", "neu_loop", "moto_neu"].includes(
                      entry.group,
                  ),
              )
            : /^r_(good|bad|verygood)$/i.test(item.group)
              ? player.motions.find(
                    (entry) =>
                        entry.group.toLowerCase() ===
                        `${item.group}_loop`.toLowerCase(),
                )
              : null;
        const next = followup && {
            ...followup,
            loop: true,
            onStart() {
                if (player !== currentPlayer || version !== revision) return;
                if (!isResultPose(followup.group))
                    motion.value = player.motions.indexOf(followup);
            },
        };
        try {
            await player.motion(
                item.group,
                item.index,
                next,
                loops(item.group),
            );
        } catch {
            if (active && player === currentPlayer && version === revision)
                setStatus(
                    "This animation could not play. Try another animation.",
                );
        }
    }

    function applyView() {
        zoom = Number($("crew-zoom").value) / 100;
        player?.zoom(zoom);
        player?.pan(panX, panY);
        image.style.transform = `translate(${panX * 100}%, ${panY * 100}%) scale(${zoom})`;
        settings.querySelector('output[for="crew-zoom"]').textContent =
            `${$("crew-zoom").value}%`;
        updatePosition();
    }

    function zoomAt(value, x = 0, y = 0) {
        const slider = $("crew-zoom");
        slider.value = Math.max(
            Number(slider.min),
            Math.min(Number(slider.max), value),
        );
        const ratio = Number(slider.value) / (zoom * 100);
        if (ratio === 1) return;
        // Keep the chosen point fixed while changing scale.
        panX = x - (x - panX) * ratio;
        panY = y - (y - panY) * ratio;
        applyView();
    }

    function updatePosition() {
        const x = Math.round(panX * stage.clientWidth);
        const y = Math.round(panY * stage.clientHeight);
        $("crew-position-value").textContent = `Position (${x}, ${y})`;
    }

    new ResizeObserver(updatePosition).observe(stage);

    function applySettings() {
        applyView();
        player?.tracking(!drag && options.tracking);
        player?.physics(options.physics);
    }

    function endDrag() {
        if (!drag) return;
        const { pointerId } = drag;
        drag = null;
        stage.classList.remove("is-dragging");
        if (stage.hasPointerCapture(pointerId))
            stage.releasePointerCapture(pointerId);
        player?.tracking(options.tracking);
    }

    stage.addEventListener(
        "wheel",
        (event) => {
            if (
                event.ctrlKey ||
                !event.deltaY ||
                !stage.classList.contains("is-ready")
            )
                return;
            event.preventDefault();
            const slider = $("crew-zoom");
            const value = Number(slider.value);
            const next =
                event.deltaY < 0
                    ? (Math.floor(value / 20) + 1) * 20
                    : (Math.ceil(value / 20) - 1) * 20;
            const rect = stage.getBoundingClientRect();
            const x =
                (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
            const y =
                (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
            zoomAt(next, x, y);
        },
        { passive: false },
    );

    stage.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || drag || !stage.classList.contains("is-ready"))
            return;
        drag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        };
        stage.setPointerCapture(event.pointerId);
        stage.classList.add("is-dragging");
        player?.tracking(false);
        event.preventDefault();
    });
    stage.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const rect = stage.getBoundingClientRect();
        panX += (event.clientX - drag.x) / Math.max(1, rect.width);
        panY += (event.clientY - drag.y) / Math.max(1, rect.height);
        drag.x = event.clientX;
        drag.y = event.clientY;
        applyView();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        stage.addEventListener(type, (event) => {
            if (drag?.pointerId === event.pointerId) endDrag();
        });

    function renderStrip() {
        const tokens = $("crew-search")
            .value.trim()
            .toLocaleLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        const crews = catalog.crews.filter((entry) =>
            tokens.every((token) =>
                /^#?\d+$/.test(token)
                    ? entry.id === Number(token.replace(/^#/, ""))
                    : entry.name.toLocaleLowerCase().includes(token),
            ),
        );
        const direction = $("crew-sort").value === "oldest" ? 1 : -1;
        crews.sort((a, b) => direction * (a.id - b.id));
        const scrollTop = strip.scrollTop;
        strip.replaceChildren();
        for (const entry of crews) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "crew-option";
            button.dataset.crewKey = entry.key;
            button.classList.toggle("selected", selected?.key === entry.key);
            button.setAttribute(
                "aria-pressed",
                String(selected?.key === entry.key),
            );
            const icon = document.createElement("img");
            icon.src = new URL(entry.icon, catalog.base);
            icon.alt = "";
            icon.loading = "lazy";
            icon.width = 64;
            icon.height = 64;
            const name = document.createElement("span");
            name.textContent = entry.name;
            const detail = document.createElement("small");
            detail.textContent = `#${entry.id}${entry.id === currentId ? " · Current" : ""}`;
            button.append(icon, name, detail);
            button.addEventListener("click", () => void select(entry));
            strip.append(button);
        }
        $("crew-count").textContent =
            `${crews.length} ${crews.length === 1 ? "crew" : "crews"}`;
        if (!crews.length) {
            const empty = document.createElement("p");
            empty.className = "settings-hint";
            empty.textContent = "No matching crew members.";
            strip.append(empty);
        }
        strip.scrollTop = scrollTop;
    }

    function centerSelection(smooth = false) {
        const button = strip.querySelector(".selected");
        if (!button) return;
        const bounds = strip.getBoundingClientRect();
        const item = button.getBoundingClientRect();
        strip.scrollTo({
            top:
                strip.scrollTop +
                item.top -
                bounds.top -
                (bounds.height - item.height) / 2,
            behavior:
                smooth &&
                !matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "smooth"
                    : "instant",
        });
    }

    async function select(entry, scroll = null) {
        if (scroll === null) scrollToPreview();
        stop();
        voices.hidden = catalog.voices_enabled === false;
        if (voices.hidden) voiceBank.stop();
        else void voiceBank.show(entry, catalog.base);
        selected = entry;
        const version = revision;
        request = new AbortController();
        const { signal } = request;
        $("crew-name").textContent = entry.name;
        $("crew-subtitle").textContent = `Nemsys Crew · #${entry.id}`;
        const currentLabel = $("crew-current");
        const isCurrent = entry.id === currentId;
        currentLabel.hidden = false;
        currentLabel.textContent = isCurrent
            ? "Current crew in-game"
            : "To apply, select this crew in-game !";
        currentLabel.classList.toggle("is-preview", !isCurrent);
        $("crew-renderer-note").hidden = entry.type !== "afp";
        for (const row of settings.querySelectorAll("[data-live2d-control]"))
            row.hidden = entry.type !== "live2d";
        renderStrip();
        if (scroll) centerSelection(scroll === "smooth");
        setStatus("Loading character...");
        motion.replaceChildren();
        const fresh = document.createElement("canvas");
        fresh.id = "crew-canvas";
        fresh.setAttribute("aria-label", `Animated preview of ${entry.name}`);
        fresh.hidden = true;
        canvas.replaceWith(fresh);
        canvas = fresh;
        try {
            if (entry.type === "image") {
                const option = document.createElement("option");
                option.textContent = "Static artwork";
                motion.append(option);
                if (!entry.image)
                    throw Error(
                        "Full-size artwork is unavailable for this crew.",
                    );
                image.src = new URL(entry.image, catalog.base);
                image.alt = entry.name;
                await image.decode();
                if (signal.aborted) return;
                image.hidden = false;
                applySettings();
                stage.classList.add("is-ready");
                setStatus("");
                return;
            }
            canvas.hidden = false;
            const created =
                entry.type === "live2d"
                    ? await createLive2dPlayer(
                          canvas,
                          new URL(entry.model, catalog.base).href,
                          catalog.base,
                          signal,
                      )
                    : await createAfpPlayer(
                          canvas,
                          new URL(`afp/${entry.key}.json`, catalog.base),
                          catalog.base,
                          signal,
                      );
            if (version !== revision || !active) {
                created.destroy();
                return;
            }
            player = created;
            for (const [index, item] of player.motions.entries()) {
                if (isResultPose(item.group)) continue;
                const option = document.createElement("option");
                option.value = index;
                option.textContent = `${labels[item.group] || item.group.replaceAll("_", " ")}${entry.type === "live2d" && item.index ? ` ${item.index + 1}` : ""}`;
                motion.append(option);
            }
            const idle = player.motions.findIndex((item) =>
                ["Idle", "idle", "loop", "neu_loop", "moto_neu"].includes(
                    item.group,
                ),
            );
            const entrance = player.motions.findIndex((item) =>
                /^(in\d*|moto_in)$/i.test(item.group),
            );
            motion.value =
                playing && entrance >= 0 ? entrance : Math.max(0, idle);
            motion.disabled = !motion.options.length;
            $("crew-play").disabled = false;
            $("crew-replay").disabled = !player.motions.length;
            applySettings();
            updatePlayback();
            await playMotion();
            if (version !== revision || !active) return;
            setStatus("");
            stage.classList.add("is-ready");
            frame = requestAnimationFrame(tick);
        } catch (error) {
            if (signal.aborted || version !== revision) return;
            canvas.hidden = true;
            setStatus(
                error.message ||
                    "This character could not load. Select another crew to try again.",
            );
        }
    }

    $("crew-search").addEventListener("input", renderStrip);
    $("crew-sort").addEventListener("change", () => {
        renderStrip();
        strip.scrollTop = 0;
    });
    $("crew-search").addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.target.blur();
    });
    $("crew-play").addEventListener("click", () => {
        playing = !playing;
        updatePlayback();
    });
    $("crew-replay").addEventListener("click", () => {
        playing = true;
        updatePlayback();
        void playMotion();
    });
    motion.addEventListener("change", () => {
        scrollToPreview();
        playing = true;
        updatePlayback();
        void playMotion();
    });
    $("crew-zoom").addEventListener("input", (event) => {
        zoomAt(Number(event.target.value));
    });
    $("crew-scale-reset").addEventListener("click", () => {
        endDrag();
        zoomAt(100);
    });
    $("crew-position-reset").addEventListener("click", () => {
        endDrag();
        panX = 0;
        panY = 0;
        applyView();
    });
    for (const button of settings.querySelectorAll("[data-crew-toggle]"))
        button.addEventListener("click", () => {
            const name = button.dataset.crewToggle;
            setToggle(name, button.dataset.value === "true");
            applySettings();
        });
    for (const button of settings.querySelectorAll("[data-crew-rate]"))
        button.addEventListener("click", () => {
            rate = Number(button.dataset.crewRate);
            for (const item of settings.querySelectorAll("[data-crew-rate]")) {
                item.classList.toggle("selected", item === button);
                item.setAttribute("aria-pressed", String(item === button));
            }
        });
    $("crew-reset").addEventListener("click", () => {
        endDrag();
        panX = 0;
        panY = 0;
        $("crew-zoom").value = 100;
        for (const [name, enabled] of Object.entries({
            tracking: false,
            physics: true,
        }))
            setToggle(name, enabled);
        settings.querySelector('[data-crew-rate="1"]').click();
        playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        updatePlayback();
        currentId = getState()?.crew_id ?? catalog?.selected;
        const current = catalog?.crews.find((entry) => entry.id === currentId);
        if (current) {
            $("crew-search").value = "";
            void select(current, "smooth");
            return;
        }
        applySettings();
        void playMotion();
    });
    return {
        async isAvailable() {
            try {
                await loadCatalog(true);
                return true;
            } catch {
                return false;
            }
        },
        async show() {
            active = true;
            host.hidden = false;
            browser.hidden = false;
            settings.hidden = false;
            sidebar.hidden = false;
            updateJump();
            try {
                catalog = await loadCatalog();
                if (!active) return;
                currentId = getState()?.crew_id ?? catalog.selected;
                const entry =
                    selected ||
                    catalog.crews.find((item) => item.id === currentId) ||
                    catalog.crews[0];
                await select(entry, "instant");
            } catch {
                if (active) setStatus("Nemsys crew preview is not available");
            }
        },
        hide() {
            active = false;
            clearPreviewScroll();
            voiceBank.stop();
            sidebar.hidden = true;
            jumpTarget = null;
            stop();
            settings.hidden = true;
            host.hidden = true;
            browser.hidden = true;
            updateJump();
        },
    };
}
