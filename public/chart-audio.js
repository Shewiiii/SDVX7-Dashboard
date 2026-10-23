import { validEffects, incompleteEffects } from "./chart-audio-dsp.js";

// The song is fetched only on Play. Rendering stays off the UI thread, and the
// resulting local WAV uses the same media clock and seek controls as dry audio.
export function createChartAudio({ getChart, signal }) {
    let cached,
        worker,
        blobUrl,
        enabled = true;
    const stop = () => {
        worker?.terminate();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = undefined;
    };
    signal.addEventListener("abort", stop, { once: true });

    async function decode(context, url) {
        const response = await fetch(url, { signal, credentials: "omit" });
        if (!response.ok) throw Error("Could not load audio for effects");
        const decoded = await context.decodeAudioData(
            await response.arrayBuffer(),
        );
        signal.throwIfAborted();
        return Array.from(
            { length: Math.min(2, decoded.numberOfChannels) },
            (_, ch) => new Float32Array(decoded.getChannelData(ch)),
        );
    }

    async function render(record, chart, report) {
        if (record.duration > 600)
            throw Error("Effects support songs up to ten minutes");
        report("Loading full song for effects...");
        const context = new OfflineAudioContext(2, 1, 44100);
        const channels = await decode(context, record.url);
        if (channels[0].length > 44100 * 600)
            throw Error("Song is too long for browser effects");
        let samples;
        const bank = chart.effects.sample_bank;
        const needsSamples =
            chart.effects.chips.length > 0 ||
            chart.lasers.some((laser) =>
                laser.points.some(
                    (p, i) =>
                        i > 0 &&
                        Math.abs(p[0] - laser.points[i - 1][0]) < 0.00001 &&
                        Math.abs(p[1] - laser.points[i - 1][1]) > 1e-6,
                ),
            );
        if (bank && needsSamples) {
            report("Loading chart sounds...");
            try {
                const url = new URL(record.url, location.href);
                url.pathname = `/effects/${bank.id}.wav`;
                url.search = "";
                samples = await decode(context, url.href);
            } catch (error) {
                signal.throwIfAborted();
                console.warn(
                    "[chart-audio] Shared hit sounds unavailable",
                    error,
                );
            }
        }
        signal.throwIfAborted();
        const wav = await new Promise((resolve, reject) => {
            worker = new Worker(
                new URL("./chart-audio-worker.js", import.meta.url),
                { type: "module" },
            );
            const active = worker;
            const finish = (error, value) => {
                clearTimeout(timeout);
                signal.removeEventListener("abort", abort);
                active.terminate();
                if (worker === active) worker = undefined;
                error ? reject(error) : resolve(value);
            };
            const abort = () =>
                finish(new DOMException("Aborted", "AbortError"));
            const timeout = setTimeout(
                () => finish(Error("Effect rendering timed out")),
                120000,
            );
            signal.addEventListener("abort", abort, { once: true });
            active.onerror = () =>
                finish(Error("Could not render chart effects"));
            active.onmessage = ({ data }) => {
                if (data.error) finish(Error(data.error));
                else if (data.wav) finish(null, data.wav);
                else if (Number.isFinite(data.progress))
                    report(
                        `Preparing effects... ${Math.round(data.progress * 100)}%`,
                    );
            };
            active.postMessage(
                { channels, rate: 44100, chart, record, samples },
                [...channels, ...(samples || [])].map((c) => c.buffer),
            );
        });
        signal.throwIfAborted();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
        return {
            url: blobUrl,
            label: incompleteEffects(chart)
                ? "Full song · FX (partial)"
                : samples || !needsSamples
                  ? "Full song · FX"
                  : "Full song · FX (no hit sounds)",
        };
    }

    return {
        set enabled(value) {
            enabled = value;
        },
        async prepare(record, report) {
            if (!enabled) return { url: record.url, label: "Full song" };
            const chart = await getChart();
            signal.throwIfAborted();
            if (record.variant !== "full" || !validEffects(chart))
                return { url: record.url, label: "Full song · FX not synced" };
            if (
                !chart.lasers.length &&
                !chart.effects.fx.length &&
                !chart.effects.auto.length &&
                !chart.effects.chips.length
            )
                return { url: record.url, label: "Full song" };
            const key = [
                record.id,
                record.chart_url,
                record.start,
                record.chart_offset,
            ].join(":");
            if (cached?.key !== key) {
                cached = { key, promise: render(record, chart, report) };
            }
            try {
                return await cached.promise;
            } catch (error) {
                cached = undefined;
                signal.throwIfAborted();
                console.warn(
                    "[chart-audio] Playing original audio; effect rendering failed",
                    error,
                );
                return { url: record.url, label: "Full song · FX unavailable" };
            }
        },
    };
}
