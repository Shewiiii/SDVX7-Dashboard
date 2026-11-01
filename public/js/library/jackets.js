export async function getJacketUrl(chart, fallback, signal) {
    if (!chart.music_id || !Number.isInteger(chart.diff_idx)) return fallback;
    try {
        const response = await fetch(
            `/api/jacket?music=${chart.music_id}&diff=${chart.diff_idx}`,
            { signal },
        );
        if (!response.ok) return fallback;
        const record = await response.json();
        const url = new URL(record.url, location.href);
        if (
            url.username ||
            url.password ||
            url.hash ||
            !(
                (url.origin === location.origin &&
                    url.pathname === "/api/jacket-file" &&
                    /^[a-f0-9]{64}$/.test(url.searchParams.get("id") || "")) ||
                (url.protocol === "https:" &&
                    !url.search &&
                    /\/jackets\/[a-f0-9]{64}\.jpg$/.test(url.pathname))
            )
        )
            return fallback;
        return url.href;
    } catch (error) {
        if (signal?.aborted) throw error;
        return fallback;
    }
}
