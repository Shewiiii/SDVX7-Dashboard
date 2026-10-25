// A real-time transport for charts without a full-song audio source.
export function mountSilentChartPlayer(host, chart, playback, onTime) {
    const request = new AbortController(), { signal } = request;
    let position = 0, rate = 1, playing = false, stamp = performance.now(), frame, disposed = false;
    const record = { duration: chart.duration, start: 0, chart_offset: 0 };
    const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    host.classList.add("details-audio");
    host.innerHTML = `<div class="details-audio-heading"><span>Chart playback</span><span class="details-audio-status" role="status">Full song audio unavailable</span></div><div class="details-audio-controls"><button type="button" class="details-audio-toggle" aria-label="Play chart" title="Play chart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button><div class="details-audio-track"><div class="details-audio-wave"><svg viewBox="0 0 512 64" preserveAspectRatio="none" aria-hidden="true"></svg><input class="details-audio-seek" type="range" min="0" step="any" value="0" aria-label="Seek in chart"></div><span class="details-audio-time"></span></div></div>`;
    const seek = host.querySelector(".details-audio-seek"), toggle = host.querySelector(".details-audio-toggle"), label = host.querySelector(".details-audio-time");
    seek.max = record.duration;
    playback.mount({ host, svg: host.querySelector(".details-audio-wave svg"), seek, record });
    function advance(now) {
        if (playing) position = Math.min(record.duration, position + Math.max(0, now - stamp) * rate / 1000);
        stamp = now;
        if (position >= record.duration) playing = false;
    }
    function update(force = false) {
        if (disposed) return;
        const now = performance.now();
        advance(now);
        onTime(position, { timestamp: now, force: force || !playing });
        seek.value = position;
        const text = `${clock(position)} / ${clock(record.duration)}`;
        if (label.textContent !== text) label.textContent = text;
        playback.update(position);
        toggle.setAttribute("aria-label", playing ? "Pause chart" : "Play chart");
        toggle.title = playing ? "Pause chart" : "Play chart";
        toggle.querySelector("path").setAttribute("d", playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M8 5v14l11-7z");
    }
    function tick() { update(); if (playing && !disposed) frame = requestAnimationFrame(tick); }
    function pause() { advance(performance.now()); playing = false; cancelAnimationFrame(frame); update(true); }
    toggle.addEventListener("click", () => {
        if (document.hidden) return;
        if (playing) { pause(); return; }
        if (position >= record.duration) position = 0;
        stamp = performance.now(); playing = true; tick();
    }, { signal });
    seek.addEventListener("input", () => {
        position = Math.max(0, Math.min(record.duration, Number(seek.value)));
        stamp = performance.now(); update(true);
    }, { signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); }, { signal });
    window.addEventListener("pagehide", pause, { signal });
    update(true);
    const dispose = () => { disposed = true; playing = false; request.abort(); cancelAnimationFrame(frame); };
    dispose.setPlaybackRate = value => {
        if (disposed || !Number.isFinite(value) || value < 0.25 || value > 4) return;
        advance(performance.now()); rate = value; update(true);
    };
    return dispose;
}
