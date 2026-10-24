export const playIdentity = (play) =>
    JSON.stringify([
        play.received_at,
        play.music_id,
        play.diff_idx,
        play.score,
        play.clear_type,
    ]);

export function createPlayHighlights({
    duration = 5000,
    clock = Date.now,
} = {}) {
    let known = null,
        newest = -Infinity;
    const active = new Map();
    return {
        duration,
        update(plays) {
            const now = clock();
            const next = new Set();
            let nextNewest = newest;
            for (const play of plays) {
                const key = playIdentity(play);
                const time = Date.parse(play.received_at);
                next.add(key);
                nextNewest = Math.max(nextNewest, time);
                // Initial data and older backfill should not flash as new plays.
                if (known && !known.has(key) && time >= newest)
                    active.set(key, now);
            }
            newest = nextNewest;
            known = next;
            for (const [key, started] of active)
                if (now - started >= duration) active.delete(key);
        },
        age(play) {
            const key = playIdentity(play);
            const started = active.get(key);
            if (started === undefined) return null;
            const age = clock() - started;
            if (age >= duration) {
                active.delete(key);
                return null;
            }
            return age;
        },
        nextExpiry() {
            for (const [key, started] of active)
                if (clock() - started >= duration) active.delete(key);
            return active.size ? Math.min(...active.values()) + duration : null;
        },
    };
}

export function subscribeArchive(
    onUpdate,
    {
        Source = globalThis.EventSource,
        page = globalThis.document,
        lifecycle = globalThis.window,
    } = {},
) {
    let source,
        retry,
        retryDelay = 1000,
        connected = false,
        stopped = false;
    const close = () => {
        clearTimeout(retry);
        source?.close();
        source = null;
        connected = false;
    };
    const visibility = () => {
        if (page.hidden || stopped || !Source) return close();
        if (source) return;
        const current = (source = new Source("/api/events"));
        const update = () => {
            if (source !== current) return;
            connected = true;
            retryDelay = 1000;
            onUpdate();
        };
        current.addEventListener("connected", update);
        current.addEventListener("archive", update);
        current.addEventListener("error", () => {
            if (source !== current) return;
            close();
            if (!page.hidden && !stopped) {
                retry = setTimeout(visibility, retryDelay);
                retryDelay = Math.min(30000, retryDelay * 2);
            }
        });
    };
    page.addEventListener("visibilitychange", visibility);
    lifecycle?.addEventListener("pagehide", close);
    lifecycle?.addEventListener("pageshow", visibility);
    visibility();
    return {
        get connected() {
            return connected;
        },
        stop() {
            stopped = true;
            close();
            page.removeEventListener("visibilitychange", visibility);
            lifecycle?.removeEventListener("pagehide", close);
            lifecycle?.removeEventListener("pageshow", visibility);
        },
    };
}
