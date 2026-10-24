export const ARCHIVE_CHANNEL = "sdvx_dashboard_archive";

export function directDatabaseUrl(value) {
    const url = new URL(value);
    // LISTEN needs a session; the normal HTTP queries can keep using the pooler.
    if (url.hostname.endsWith(".neon.tech"))
        url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
    return url.toString();
}

export async function streamArchiveEvents(
    req,
    res,
    client,
    { duration = 45000, heartbeat = 15000 } = {},
) {
    let closed = false,
        finish,
        lifetime,
        keepalive;
    const close = () => {
        closed = true;
        finish?.();
    };
    const notify = (message) => {
        if (!closed && res.headersSent && message.channel === ARCHIVE_CHANNEL)
            res.write("event: archive\ndata: {}\n\n");
    };
    res.once("close", close);
    res.once("error", close);
    client.on("notification", notify);
    client.on("error", close);
    client.on("end", close);
    try {
        await client.connect();
        if (closed) return;
        await client.query(`LISTEN ${ARCHIVE_CHANNEL}`);
        if (closed) return;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        // Also catch commits missed while the browser was disconnected.
        res.write("retry: 1000\nevent: connected\ndata: {}\n\n");
        await new Promise((resolve) => {
            finish = resolve;
            lifetime = setTimeout(close, duration);
            keepalive = setInterval(
                () => res.write(": heartbeat\n\n"),
                heartbeat,
            );
        });
    } finally {
        closed = true;
        clearTimeout(lifetime);
        clearInterval(keepalive);
        res.removeListener("close", close);
        res.removeListener("error", close);
        client.removeListener("notification", notify);
        // Keep the error handler attached while ending a failed connection.
        await client.end().catch(() => {});
        client.removeListener("error", close);
        client.removeListener("end", close);
        if (res.headersSent && !res.writableEnded && !res.destroyed) res.end();
    }
}
