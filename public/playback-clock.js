// Interpolate between media-clock observations. Some browsers round currentTime
// to 100ms; drawing that value directly produces a visibly stepped highway.
export function createPlaybackClock() {
    let position = 0,
        stamp = 0,
        running = false;
    return (mediaTime, now, playing, rate = 1, force = false) => {
        const predicted =
            position + (running ? ((now - stamp) * rate) / 1000 : 0);
        if (
            force ||
            !playing ||
            !running ||
            Math.abs(predicted - mediaTime) > 0.15
        ) {
            position = mediaTime;
            stamp = now;
        }
        running = playing;
        return position + (running ? ((now - stamp) * rate) / 1000 : 0);
    };
}
