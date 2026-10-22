export function cleanAudio(value) {
    if (
        !value ||
        !Number.isSafeInteger(value.music_id) ||
        value.music_id < 1 ||
        value.music_id > 10000000 ||
        !Number.isInteger(value.diff_idx) ||
        value.diff_idx < 0 ||
        value.diff_idx > 5 ||
        !/^[a-f0-9]{64}$/.test(value.id || "")
    )
        throw Error("Invalid audio identity");
    const url = new URL(value.url);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !["opus", "flac"].some((format) =>
            url.pathname.endsWith(`/audio/${value.id}.${format}`),
        ) ||
        value.url.length > 2048
    )
        throw Error("Invalid audio URL");
    if (
        !Number.isFinite(value.duration) ||
        value.duration <= 0 ||
        value.duration > 7200 ||
        !Number.isFinite(value.start) ||
        value.start < 0 ||
        value.start > 7200 ||
        !Number.isFinite(value.chart_offset) ||
        Math.abs(value.chart_offset) > 600 ||
        !["preview", "full"].includes(value.variant) ||
        !Array.isArray(value.peaks) ||
        value.peaks.length !== 128 ||
        !value.peaks.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
        throw Error("Invalid audio metadata");
    const format = url.pathname.endsWith(".flac") ? "flac" : "opus";
    if (
        (value.format !== undefined && value.format !== format) ||
        (format === "opus" &&
            value.bitrate !== undefined &&
            (!Number.isInteger(value.bitrate) ||
                value.bitrate < 6 ||
                value.bitrate > 510))
    )
        throw Error("Invalid audio format");
    return {
        format,
        ...(format === "opus" && value.bitrate !== undefined
            ? { bitrate: value.bitrate }
            : {}),
        music_id: value.music_id,
        diff_idx: value.diff_idx,
        id: value.id,
        url: url.href,
        duration: value.duration,
        start: value.start,
        chart_offset: value.chart_offset,
        variant: value.variant,
        peaks: [...value.peaks],
    };
}
