import { createPlaybackClock } from "./playback-clock.js";

const metadata = new Map();
let playerSequence = 0;
const clock = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));

// Share the small metadata lookup between the chart action and both players.
// Pending requests are coalesced; an unsynced chart is checked again soon.
export function getAudioMetadata(chart, { force = false } = {}) {
    const key = `${chart.music_id}:${chart.diff_idx}`;
    const saved = metadata.get(key);
    if (
        saved &&
        (saved.pending || (!force && Date.now() - saved.at < saved.ttl))
    )
        return saved.task;
    const entry = { pending: true, at: Date.now(), ttl: 300000 };
    entry.task = (async () => {
        const response = await fetch(
            `/api/audio?music=${chart.music_id}&diff=${chart.diff_idx}`,
            {
                cache: force ? "reload" : "default",
            },
        );
        let value = null;
        if (response.status !== 404) {
            if (!response.ok) throw new Error("Audio metadata unavailable");
            value = await response.json();
            const url = new URL(value.url, location.href);
            if (
                !(
                    (url.origin === location.origin &&
                        url.pathname === "/api/audio-file") ||
                    /\.(opus|flac)$/.test(url.pathname)
                )
            )
                throw new Error("Unsupported audio format");
            if (
                value.music_id !== chart.music_id ||
                value.diff_idx !== chart.diff_idx ||
                !(value.duration > 0 && value.duration <= 7200) ||
                !Number.isFinite(value.start) ||
                !Number.isFinite(value.chart_offset) ||
                !["full", "preview"].includes(value.variant) ||
                !Array.isArray(value.peaks) ||
                value.peaks.length !== 128 ||
                !value.peaks.every(
                    (v) => Number.isInteger(v) && v >= 0 && v <= 255,
                ) ||
                !(url.protocol === "https:" || url.origin === location.origin)
            )
                throw new Error("Invalid audio metadata");
        }
        entry.pending = false;
        entry.at = Date.now();
        if (!value) entry.ttl = 10000;
        return value;
    })().catch((error) => {
        if (metadata.get(key) === entry) metadata.delete(key);
        throw error;
    });
    metadata.set(key, entry);
    if (metadata.size > 64) metadata.delete(metadata.keys().next().value);
    return entry.task;
}

// Waveforms are prepared alongside the audio; opening Details never downloads a track.
export function mountAudioPlayer(host, chart, plots, options = {}) {
    const request = new AbortController();
    const { signal } = request;
    const audio = new Audio();
    audio.preload = "none";
    audio.crossOrigin = "anonymous";
    let record,
        frame,
        disposed = false,
        pageHidden = false,
        position = 0,
        seeking = false,
        seekPointer,
        buffering = false,
        readyTask,
        sourceLabel,
        playRequest = 0,
        preparing = false;
    const playbackTime = createPlaybackClock();
    const downloadTooltipId = `audio-download-tooltip-${++playerSequence}`;

    host.classList.add("details-audio");
    host.classList.toggle("details-audio-compact", !!options.compact);
    host.innerHTML = `<div class="details-audio-heading"><span>Song audio</span><span class="details-audio-actions"><span class="details-audio-status" role="status">Loading audio...</span><span class="details-audio-download-action" hidden><span aria-hidden="true"> · </span><span class="details-audio-download-wrap"><button type="button" class="text-button details-audio-download" aria-describedby="${downloadTooltipId}">Download</button><span id="${downloadTooltipId}" class="details-audio-download-popup" role="tooltip">No lossy transcoding has been applied, but the audio is already compressed in-game, so the audio is not lossless !</span></span></span></span></div>
        <div class="details-audio-controls" hidden>
            <button type="button" class="details-audio-toggle" aria-label="Play song" title="Play song"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
            <div class="details-audio-track"><div class="details-audio-wave"><svg viewBox="0 0 512 48" preserveAspectRatio="none" aria-hidden="true"></svg><input class="details-audio-seek" type="range" min="0" step="0.01" value="0" aria-label="Seek in song"></div><span class="details-audio-time">0:00</span></div>
        </div><button type="button" class="text-button details-audio-retry" hidden>Try again</button>`;
    const status = host.querySelector(".details-audio-status");
    const controls = host.querySelector(".details-audio-controls");
    const toggle = host.querySelector(".details-audio-toggle");
    const wave = host.querySelector(".details-audio-wave");
    const svg = wave.querySelector("svg");
    const seek = host.querySelector(".details-audio-seek");
    if (options.compact)
        seek.setAttribute("aria-label", `Seek in ${chart.title || "song"}`);
    const time = host.querySelector(".details-audio-time");
    const retry = host.querySelector(".details-audio-retry");
    const downloadAction = host.querySelector(".details-audio-download-action");
    const download = host.querySelector(".details-audio-download");
    const downloadPopup = host.querySelector(".details-audio-download-popup");
    const fileFormat = () =>
        record?.format === "flac" ||
        (record &&
            (new URL(record.url, location.href).pathname.endsWith(".flac") ||
                new URL(record.url, location.href).searchParams.get(
                    "format",
                ) === "flac"))
            ? "flac"
            : "opus";
    const downloadLabel = () =>
        `Download (${fileFormat() === "flac" ? "FLAC" : `Opus${record?.bitrate ? ` · ${record.bitrate} kbps` : ""}`})`;

    download.addEventListener(
        "click",
        async () => {
            if (!record || download.disabled) return;
            download.disabled = true;
            download.textContent = "Downloading...";
            try {
                // A blob download works for CORS-enabled R2 URLs as well as preview.
                const response = await fetch(record.url, { signal });
                if (!response.ok) throw new Error("Download failed");
                const blob = await response.blob();
                if (disposed) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download =
                    `${chart.title || "Song"}${record.variant === "preview" ? " (preview)" : ""}`.replace(
                        /[<>:"/\\|?*\x00-\x1f]/g,
                        "_",
                    ) +
                    "." +
                    fileFormat();
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {
                if (!disposed) status.textContent = "Could not download audio.";
            } finally {
                download.disabled = false;
                download.textContent = downloadLabel();
            }
        },
        { signal },
    );
    const lines = [...(plots?.querySelectorAll(".details-chart") || [])].map(
        (section) => {
            const line = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "line",
            );
            line.classList.add("details-playhead");
            line.setAttribute(
                "y1",
                section.dataset.plot === "lanes" ? "0" : "18",
            );
            line.setAttribute(
                "y2",
                section.dataset.plot === "lanes" ? "112" : "76",
            );
            line.style.display = "none";
            section.querySelector("svg").append(line);
            return line;
        },
    );
    let progress,
        lastUiUpdate = -Infinity;
    function update(force = false, resetClock = false) {
        if (!record || disposed) return;
        const now = performance.now();
        if (audio.readyState && !seeking) {
            position = clamp(
                playbackTime(
                    audio.currentTime,
                    now,
                    !audio.paused && !audio.ended && !buffering,
                    audio.playbackRate,
                    resetClock,
                ),
                record.duration,
            );
        }
        const at = position + record.start - record.chart_offset;
        // Render before DOM writes, so canvas size reads do not force layout.
        if (record.variant === "full")
            options.onTime?.(at, {
                timestamp: now,
                force: force === true || audio.paused || seeking,
            });
        if (
            force !== true &&
            !audio.paused &&
            !seeking &&
            now - lastUiUpdate < 32
        )
            return;
        lastUiUpdate = now;
        // Prevent Firefox to reapply the pointer position on release
        // so it does not repeat audio.
        if (seekPointer === undefined) seek.value = position;
        if (!options.seekTimeline || record.variant !== "full")
            seek.setAttribute(
                "aria-valuetext",
                `${clock(position)} of ${clock(record.duration)}`,
            );
        const label = `${clock(position)} / ${clock(record.duration)}`;
        if (time.textContent !== label) time.textContent = label;
        progress?.setAttribute("width", (512 * position) / record.duration);
        if (record.variant === "full")
            options.seekTimeline?.update(position, at);
        const duration = chart.chart?.duration;
        for (const line of lines) {
            line.style.display =
                record.variant === "full" &&
                duration > 0 &&
                at >= 0 &&
                at <= duration
                    ? ""
                    : "none";
            if (record.variant !== "full") continue;
            const x = 52 + clamp(at / duration, 1) * 456;
            line.setAttribute("x1", x);
            line.setAttribute("x2", x);
        }
    }
    function tick() {
        update();
        if (!disposed && !audio.paused && !audio.ended)
            frame = requestAnimationFrame(tick);
    }
    function button() {
        const playing = preparing || !audio.paused;
        const song = options.compact ? chart.title || "song" : "song";
        const label = `${playing ? "Pause" : "Play"} ${song}`;
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        toggle
            .querySelector("path")
            .setAttribute(
                "d",
                playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M8 5v14l11-7z",
            );
    }
    seek.addEventListener(
        "pointerdown",
        (event) => {
            seekPointer = event.pointerId;
        },
        { signal },
    );
    for (const event of ["pointerup", "pointercancel"])
        window.addEventListener(
            event,
            ({ pointerId }) => {
                if (seekPointer === pointerId) seekPointer = undefined;
            },
            { signal },
        );
    seek.addEventListener(
        "input",
        () => {
            seeking = true;
            position = Number(seek.value);
            if (audio.readyState) audio.currentTime = position;
            playbackTime(
                position,
                performance.now(),
                false,
                audio.playbackRate,
                true,
            );
            update(true);
            seeking = false;
        },
        { signal },
    );

    function failed(error) {
        status.textContent = "Could not play this audio.";
        retry.hidden = false;
        button();
        if (error?.name !== "NotAllowedError") options.onPlaybackError?.();
    }
    async function togglePlayback() {
        if (disposed || pageHidden || !record) return;
        if (preparing) {
            playRequest++;
            preparing = false;
            status.textContent = "Paused";
            button();
            return;
        }
        if (!audio.paused) {
            audio.pause();
            return;
        }
        const attempt = ++playRequest;
        options.onPlay?.();
        retry.hidden = true;
        status.textContent = "Loading...";
        try {
            if (!audio.getAttribute("src") && options.prepareSource) {
                preparing = true;
                button();
                await readyTask;
                if (disposed || attempt !== playRequest) return;
                const source = await options.prepareSource(record, (label) => {
                    if (!disposed && attempt === playRequest)
                        status.textContent = label;
                });
                if (disposed || attempt !== playRequest) return;
                audio.src = source.url;
                sourceLabel = source.label;
            } else if (!audio.getAttribute("src")) audio.src = record.url;
            preparing = false;
            if (audio.ended) position = 0;
            await audio.play();
        } catch (error) {
            if (!disposed && attempt === playRequest) {
                preparing = false;
                failed(error);
            }
        } finally {
            if (!disposed && attempt === playRequest) button();
        }
    }
    toggle.addEventListener("click", togglePlayback, { signal });
    audio.addEventListener(
        "loadedmetadata",
        () => {
            audio.currentTime = clamp(position, audio.duration);
            update(true, true);
        },
        { signal },
    );
    audio.addEventListener(
        "playing",
        () => {
            buffering = false;
            update(true);
            status.textContent =
                sourceLabel ||
                (record.variant === "preview"
                    ? "In-game preview"
                    : "Full song");
            button();
            cancelAnimationFrame(frame);
            tick();
        },
        { signal },
    );
    audio.addEventListener(
        "waiting",
        () => {
            buffering = true;
            cancelAnimationFrame(frame);
            update(true);
            status.textContent = "Buffering...";
        },
        { signal },
    );
    for (const event of ["pause", "ended"])
        audio.addEventListener(
            event,
            () => {
                cancelAnimationFrame(frame);
                update(true, event === "ended");
                button();
            },
            { signal },
        );
    audio.addEventListener(
        "timeupdate",
        () => {
            // Playing already follows requestAnimationFrame. Media events can arrive
            // between repaints and would draw an extra, immediately replaced frame.
            if (audio.paused || seeking || buffering) update();
        },
        { signal },
    );
    audio.addEventListener("seeked", () => update(true, true), { signal });
    audio.addEventListener("ratechange", () => update(true), { signal });
    audio.addEventListener("error", failed, { signal });

    async function load(force = false) {
        status.textContent = "Loading audio...";
        controls.hidden = true;
        downloadAction.hidden = true;
        downloadPopup.hidden = true;
        download.removeAttribute("aria-describedby");
        retry.hidden = true;
        try {
            const value = await (!force && options.initialAudio
                ? options.initialAudio
                : getAudioMetadata(chart, { force }));
            if (disposed) return;
            record = value;
            if (!record) throw new Error("Audio unavailable");
            position = clamp(position, record.duration);
            readyTask = Promise.resolve(options.onReady?.(record));
            // Source preparation awaits this on Play. An unrelated player using
            // onReady still must not create an unhandled rejected promise.
            readyTask.catch(() => {});
            if (disposed) return;
            seek.max = record.duration;
            if (options.seekTimeline && record.variant === "full") {
                progress = undefined;
                options.seekTimeline.mount({ host, svg, seek, record });
            } else {
                // Each path is local to this SVG; no document-wide clip IDs to collide.
                const bars = Array.from({ length: 64 }, (_, i) => {
                    const height = Math.max(
                        2,
                        (Math.max(...record.peaks.slice(i * 2, i * 2 + 2)) /
                            255) *
                            44,
                    );
                    return `M${i * 8 + 2} ${24 - height / 2}h4v${height}h-4z`;
                }).join("");
                svg.innerHTML = `<path class="details-audio-bars" d="${bars}"/><svg class="details-audio-progress" x="0" y="0" width="0" height="48" overflow="hidden"><path d="${bars}"/></svg>`;
                progress = svg.querySelector(".details-audio-progress");
            }
            status.textContent =
                record.variant === "preview" ? "In-game preview" : "Full song";
            controls.hidden = false;
            download.textContent = downloadLabel();
            if (fileFormat() === "flac") {
                downloadPopup.hidden = false;
                download.setAttribute("aria-describedby", downloadPopup.id);
            }
            downloadAction.hidden = false;
            update();
        } catch {
            if (disposed) return;
            status.textContent = "Audio isn’t available for this chart yet.";
            options.onUnavailable?.();
            retry.hidden = false;
        }
    }
    retry.addEventListener(
        "click",
        () => {
            playRequest++;
            preparing = false;
            sourceLabel = undefined;
            if (record) {
                audio.pause();
                audio.removeAttribute("src");
                audio.load();
            }
            void load(true);
        },
        { signal },
    );
    void load();
    const dispose = () => {
        disposed = true;
        playRequest++;
        request.abort();
        cancelAnimationFrame(frame);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        lines.forEach((line) => line.remove());
    };
    dispose.pause = () => {
        if (disposed) return;
        playRequest++;
        preparing = false;
        audio.pause();
        cancelAnimationFrame(frame);
        status.textContent = "Paused";
        button();
    };
    dispose.refreshSource = () => {
        if (disposed || pageHidden) return;
        const resume = preparing || !audio.paused;
        playRequest++;
        preparing = false;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        sourceLabel = undefined;
        button();
        if (resume) void togglePlayback();
        else status.textContent = "Paused";
    };
    dispose.setPlaybackRate = (rate) => {
        if (disposed || !Number.isFinite(rate) || rate < 0.25 || rate > 4)
            return;
        update(true);
        // load() restores defaultPlaybackRate when switching dry/processed audio.
        audio.defaultPlaybackRate = rate;
        audio.playbackRate = rate;
        audio.preservesPitch = true;
        update(true);
    };
    // Navigation can leave an effect render or play() request pending.
    window.addEventListener(
        "pagehide",
        () => {
            pageHidden = true;
            playRequest++;
            preparing = false;
            audio.pause();
            cancelAnimationFrame(frame);
            audio.removeAttribute("src");
            audio.load();
            sourceLabel = undefined;
            status.textContent = "Paused";
            button();
        },
        { signal },
    );
    // A pageshow stays paused, but the user can explicitly play it again.
    window.addEventListener(
        "pageshow",
        () => {
            pageHidden = false;
        },
        { signal },
    );
    return dispose;
}
