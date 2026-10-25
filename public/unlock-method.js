const cache = new Map();

function getUnlockMethod(chart) {
    const key = `${chart.music_id}:${chart.diff_idx}`;
    const saved = cache.get(key);
    if (saved && (saved.pending || Date.now() - saved.at < 60000))
        return saved.task;
    const entry = { pending: true, at: Date.now() };
    entry.task = (async () => {
        const response = await fetch(
            `/api/unlocks?music=${chart.music_id}&diff=${chart.diff_idx}`,
        );
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Unlock information unavailable");
        const record = await response.json();
        if (
            record.music_id !== chart.music_id ||
            record.diff_idx !== chart.diff_idx ||
            typeof record.description !== "string"
        )
            throw new Error("Invalid unlock information");
        return record;
    })()
        .then((record) => {
            entry.pending = false;
            entry.at = Date.now();
            return record;
        })
        .catch((error) => {
            if (cache.get(key) === entry) cache.delete(key);
            throw error;
        });
    cache.set(key, entry);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return entry.task;
}

export function mountUnlockMethod(host, chart) {
    let active = true;
    host.classList.add("details-unlock");
    const heading = document.createElement("h3");
    heading.textContent = "Unlock method";
    const chartId = document.createElement("span");
    chartId.className = "details-unlock-meta";
    chartId.textContent = `${chart.music_id}:${chart.diff_idx}`;
    heading.append(chartId);
    const text = document.createElement("p");
    text.setAttribute("role", "status");
    host.replaceChildren(heading, text);
    if (chart.is_custom) {
        text.textContent = "Download the song from RyuNET's webUI.";
    } else {
        text.textContent = "Loading unlock information...";
        getUnlockMethod(chart)
            .then((record) => {
                if (!active) return;
                text.textContent = record?.description || "Unknown";
                if (record?.as_of) {
                    const date = document.createElement("time");
                    date.dateTime = record.as_of;
                    date.textContent = record.as_of;
                    chartId.append(", ", date);
                }
                for (const [index, url] of (record?.source || []).entries()) {
                    let sourceUrl;
                    try {
                        sourceUrl = new URL(url);
                    } catch {
                        continue;
                    }
                    if (!["http:", "https:"].includes(sourceUrl.protocol))
                        continue;
                    const link = document.createElement("a");
                    link.href = sourceUrl.href;
                    link.textContent = index ? `Source ${index + 1}` : "Source";
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    chartId.append(", ", link);
                }
            })
            .catch(() => {
                if (active) text.textContent = "Information Unavailable";
            });
    }
    return () => {
        active = false;
    };
}
