export const escape = (value) =>
    String(value ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
export const number = (value) => (value == null ? "—" : value.toLocaleString());
export const date = (value) =>
    new Date(value).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
export const shortDate = (value) =>
    new Date(value).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
    });
export const clock = (value) =>
    new Date(value).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
export const chartTitle = (p) => p.title || `Chart ${p.music_id}`;
export const formatRank = (rank) => String(rank).padStart(2, "0");
