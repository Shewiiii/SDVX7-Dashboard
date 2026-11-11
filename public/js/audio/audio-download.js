import { SONG_GENRES, SONG_VERSIONS } from "../library/song-metadata.js";
import { getJacketUrl } from "../library/jackets.js";

export function audioTags(chart) {
    const genres = SONG_GENRES.filter(
        ([flag]) => (chart.genre || 0) & flag,
    ).map(([, label]) => label);
    return {
        TITLE: chart.title || "",
        ARTIST: chart.artist || "",
        ...(chart.music_id
            ? {
                  GENRE: chart.is_custom
                      ? "Custom chart"
                      : genres.join(", ") || "Other",
                  DATE: chart.distribution_date || chart.release_date || "",
                  GAME: SONG_VERSIONS[chart.version] || "",
              }
            : {}),
    };
}

async function loadChart(chart, signal) {
    if (
        !chart.music_id ||
        (Object.hasOwn(chart, "distribution_date") &&
            Object.hasOwn(chart, "version"))
    )
        return chart;
    const response = await fetch(
        `/api/chart?music=${chart.music_id}&diff=${chart.diff_idx}&schema=6`,
        { signal },
    );
    if (!response.ok) throw Error("Could not load download tags");
    const detail = await response.json();
    if (
        detail.music_id !== chart.music_id ||
        detail.diff_idx !== chart.diff_idx
    )
        throw Error("Invalid chart metadata");
    return { ...chart, ...detail };
}

async function loadPicture(artwork, signal) {
    if (!artwork) return undefined;
    const response = await fetch(artwork, { signal });
    if (!response.ok) throw Error("Could not load download jacket");
    let blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
        // PNG and JPEG cover art work in more desktop music players than WebP
        if (!["image/png", "image/jpeg"].includes(blob.type)) {
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext("2d").drawImage(bitmap, 0, 0);
            blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (value) =>
                        value
                            ? resolve(value)
                            : reject(Error("Could not encode jacket")),
                    "image/png",
                );
            });
        }
        return {
            type: blob.type,
            width: bitmap.width,
            height: bitmap.height,
            data: await blob.arrayBuffer(),
        };
    } finally {
        bitmap.close();
    }
}

export async function prepareAudioDownload(
    record,
    chart,
    artwork,
    format,
    signal,
) {
    const pictureTask = (async () => {
        const original = await getJacketUrl(chart, artwork, signal);
        try {
            return await loadPicture(original, signal);
        } catch (error) {
            if (signal.aborted || original === artwork || !artwork) throw error;
            return loadPicture(artwork, signal);
        }
    })();
    const [buffer, detail, picture] = await Promise.all([
        fetch(record.url, { signal }).then((response) => {
            if (!response.ok) throw Error("Download failed");
            return response.arrayBuffer();
        }),
        loadChart(chart, signal),
        pictureTask,
    ]);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL("./audio-tags-worker.js", import.meta.url),
            { type: "module" },
        );
        function finish(error, result) {
            worker.terminate();
            signal.removeEventListener("abort", abort);
            if (error) reject(error);
            else
                resolve(
                    new Blob([result], {
                        type: format === "flac" ? "audio/flac" : "audio/ogg",
                    }),
                );
        }
        function abort() {
            finish(signal.reason || new DOMException("Aborted", "AbortError"));
        }
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }) =>
            finish(data.error ? Error(data.error) : null, data.buffer);
        worker.onerror = () => finish(Error("Could not prepare download tags"));
        const transfer = [buffer];
        if (picture) transfer.push(picture.data);
        worker.postMessage(
            { buffer, format, tags: audioTags(detail), picture },
            transfer,
        );
    });
}
