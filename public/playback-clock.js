// Media observations arrive less often than viewer frames (~20Hz). Interpolate
// between them, and observe when rate changes actually reach the media clock.
export function createPlaybackClock() {
    let position = 0,
        stamp = 0,
        running = false,
        effectiveRate = 1,
        requestedRate = 1,
        pendingRateUntil = 0,
        observedTime = 0,
        observedStamp = 0,
        phaseError = 0,
        initialized = false;
    return (mediaTime, now, playing, rate = 1, force = false) => {
        const elapsed = Math.max(0, now - stamp) / 1000;
        if (force || !initialized) {
            position = mediaTime;
            effectiveRate = rate;
            requestedRate = rate;
            pendingRateUntil = 0;
            observedTime = mediaTime;
            observedStamp = now;
            phaseError = 0;
        } else {
            const advance = running ? elapsed * effectiveRate : 0;
            position += advance;
            if (rate !== requestedRate) {
                requestedRate = rate;
                pendingRateUntil = running && playing ? now + 200 : 0;
                if (!pendingRateUntil) effectiveRate = rate;
            }
            if (mediaTime !== observedTime) {
                const sampleSeconds = (now - observedStamp) / 1000;
                const sampleRate =
                    sampleSeconds > 0
                        ? (mediaTime - observedTime) / sampleSeconds
                        : 0;
                if (
                    pendingRateUntil &&
                    Math.abs(sampleRate - requestedRate) <=
                        Math.max(0.05, requestedRate * 0.25)
                ) {
                    effectiveRate = requestedRate;
                    pendingRateUntil = 0;
                }
                observedTime = mediaTime;
                observedStamp = now;
                phaseError = mediaTime - position;
            }
            if (pendingRateUntil && now >= pendingRateUntil) {
                effectiveRate = requestedRate;
                pendingRateUntil = 0;
            }
            if (running && playing && elapsed > 0) {
                // Only fresh media samples update phase. Stale readings must not
                // pull every animation frame back to the same coarse timestamp.
                const limit = advance * 0.5;
                const correction = Math.max(
                    -limit,
                    Math.min(limit, phaseError * (1 - Math.exp(-elapsed / 0.08))),
                );
                position += correction;
                phaseError -= correction;
            }
            if (running !== playing) {
                observedTime = mediaTime;
                observedStamp = now;
                phaseError = 0;
                effectiveRate = requestedRate;
                pendingRateUntil = 0;
            }
        }
        stamp = now;
        running = playing;
        initialized = true;
        return position;
    };
}
