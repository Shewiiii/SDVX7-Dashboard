import { gzipSync, gunzipSync } from "node:zlib";
import { validTimeline } from "../public/chart-timeline.js";
import { createHash, timingSafeEqual } from "node:crypto";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const integer = (value, low, high) =>
    Number.isInteger(value) && value >= low && value <= high;
const timestamp = (value) =>
    typeof value === "string" &&
    value.length < 40 &&
    Number.isFinite(Date.parse(value));
const string = (value, limit = 200) =>
    typeof value === "string" ? value.slice(0, limit) : "";
export const recordId = (record) =>
    createHash("sha256")
        .update(
            JSON.stringify(
                record.received_at
                    ? [
                          record.received_at,
                          record.music_id,
                          record.diff_idx,
                          record.score,
                          record.clear_type,
                      ]
                    : [
                          record.timestamp,
                          record.total_vf,
                          record.minimum_vf,
                          record.top_count,
                      ],
            ),
        )
        .digest("hex");

export function authorized(header, token) {
    if (!token || token.length < 32 || typeof header !== "string") return false;
    const actual = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${token}`);
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}

export function cleanPlay(p) {
    if (
        !p ||
        !integer(p.music_id, 1, 10000000) ||
        !integer(p.diff_idx, 0, 5) ||
        !integer(p.score, 0, 10000000) ||
        !integer(p.clear_type, 0, 6) ||
        !timestamp(p.received_at) ||
        !finite(p.play_vf) ||
        p.play_vf < 0 ||
        p.play_vf > 2
    ) {
        throw new Error("Invalid play");
    }
    const histogram =
        Array.isArray(p.timing_histogram) &&
        p.timing_histogram.length === 7 &&
        p.timing_histogram.every((count) => integer(count, 0, 10000000))
            ? [...p.timing_histogram]
            : null;
    return {
        music_id: p.music_id,
        diff_idx: p.diff_idx,
        score: p.score,
        clear_type: p.clear_type,
        received_at: new Date(p.received_at).toISOString(),
        play_vf: p.play_vf,
        level: finite(p.level) && p.level >= 0 ? p.level : null,
        title: string(p.title),
        artist: string(p.artist),
        timing: finite(p.timing) && Math.abs(p.timing) <= 134 ? p.timing : null,
        timing_histogram: histogram,
        timing_eligible:
            p.timing_eligible === true &&
            histogram !== null &&
            histogram.some((count) => count > 0),
        judgments: cleanJudgments(p.judgments),
    };
}

function cleanJudgments(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const counts = Object.fromEntries(
        ["s_critical", "critical", "near", "error", "early_near", "late_near"]
            .filter((key) => integer(value[key], 0, 10000000))
            .map((key) => [key, value[key]]),
    );
    return Object.keys(counts).length ? counts : null;
}

export function cleanObservation(o) {
    if (
        !o ||
        !timestamp(o.timestamp) ||
        !finite(o.total_vf) ||
        o.total_vf < 0 ||
        o.total_vf > 100 ||
        !integer(o.top_count, 0, 50) ||
        !(
            o.minimum_vf === null ||
            (finite(o.minimum_vf) && o.minimum_vf >= 0 && o.minimum_vf <= 2)
        )
    )
        throw new Error("Invalid observation");
    return {
        timestamp: new Date(o.timestamp).toISOString(),
        total_vf: o.total_vf,
        minimum_vf: o.minimum_vf,
        top_count: o.top_count,
    };
}

export function cleanState(s) {
    if (!s || !Array.isArray(s.charts) || s.charts.length > 20000)
        throw new Error("Invalid snapshot");
    const charts = s.charts.map((c) => {
        if (
            !integer(c.music_id, 1, 10000000) ||
            !integer(c.diff_idx, 0, 5) ||
            !finite(c.vf) ||
            c.vf < 0 ||
            c.vf > 2
        )
            throw new Error("Invalid chart");
        return {
            music_id: c.music_id,
            diff_idx: c.diff_idx,
            vf: c.vf,
            title: string(c.title),
            artist: string(c.artist),
            level: finite(c.level) && c.level >= 0 ? c.level : null,
            score: integer(c.score, 0, 10000000) ? c.score : null,
            clear_type: integer(c.clear_type, 0, 6) ? c.clear_type : null,
        };
    });
    const result = {
        name: string(s.name || "Player", 40),
        currency: /^[A-Z]{3}$/.test(s.currency || "") ? s.currency : "EUR",
        updated_at: timestamp(s.updated_at) ? s.updated_at : null,
        charts,
        version: 1,
    };
    if (s.appeal_card !== undefined)
        result.appeal_card =
            typeof s.appeal_card === "string" &&
            /^[a-f0-9]{64}$/.test(s.appeal_card)
                ? s.appeal_card
                : null;
    if (s.appeal_cards !== undefined) {
        if (!Array.isArray(s.appeal_cards) || s.appeal_cards.length > 10000)
            throw new Error("Invalid appeal card catalog");
        const ids = new Set();
        result.appeal_cards = s.appeal_cards.map((card) => {
            if (
                !card ||
                !integer(card.id, 0, 10000000) ||
                ids.has(card.id) ||
                typeof card.title !== "string" ||
                !card.title.trim() ||
                typeof card.image !== "string" ||
                !/^[a-f0-9]{64}$/.test(card.image)
            )
                throw new Error("Invalid appeal card");
            ids.add(card.id);
            return {
                id: card.id,
                title: string(card.title),
                image: card.image,
            };
        });
    }
    if (s.skill_level !== undefined)
        result.skill_level = integer(s.skill_level, 1, 12)
            ? s.skill_level
            : null;
    if (s.profile_radar !== undefined) {
        const radar = s.profile_radar;
        if (radar === null) result.profile_radar = null;
        else {
            if (
                !radar ||
                !Array.isArray(radar.values) ||
                radar.values.length !== 6 ||
                !radar.values.every(
                    (value) => finite(value) && value >= 0 && value <= 100000,
                ) ||
                !Array.isArray(radar.song_counts) ||
                radar.song_counts.length !== 6 ||
                !radar.song_counts.every((value) => integer(value, 0, 50)) ||
                typeof radar.complete !== "boolean"
            )
                throw new Error("Invalid profile radar");
            result.profile_radar = {
                values: [...radar.values],
                song_counts: [...radar.song_counts],
                complete: radar.complete,
            };
        }
    }
    if (s.playtime !== undefined) {
        if (s.playtime === null) result.playtime = null;
        else {
            const keys = [
                "total_seconds",
                "initial_seconds",
                "local_seconds",
                "plays",
            ];
            if (
                !s.playtime ||
                keys.some(
                    (key) =>
                        !Number.isSafeInteger(s.playtime[key]) ||
                        s.playtime[key] < 0,
                ) ||
                s.playtime.total_seconds !==
                    s.playtime.initial_seconds + s.playtime.local_seconds
            )
                throw new Error("Invalid playtime");
            result.playtime = Object.fromEntries(
                keys.map((key) => [key, s.playtime[key]]),
            );
        }
    }
    if (s.catalog !== undefined) {
        if (!Array.isArray(s.catalog) || s.catalog.length > 8000)
            throw new Error("Invalid song catalog");
        result.catalog = s.catalog.map((song) => {
            if (
                !integer(song.music_id, 1, 10000000) ||
                !Array.isArray(song.difficulties) ||
                song.difficulties.length > 6
            )
                throw new Error("Invalid song");
            const difficulties = song.difficulties.map((d) => {
                if (
                    !integer(d.diff_idx, 0, 5) ||
                    !finite(d.level) ||
                    d.level <= 0
                )
                    throw new Error("Invalid difficulty");
                return {
                    diff_idx: d.diff_idx,
                    level: d.level,
                    cover: /^[a-f0-9]{64}$/.test(d.cover) ? d.cover : null,
                    radar:
                        Array.isArray(d.radar) &&
                        d.radar.length === 6 &&
                        d.radar.every((value) => integer(value, 0, 65535))
                            ? [...d.radar]
                            : null,
                };
            });
            const forms = Array.isArray(song.forms)
                ? song.forms.slice(0, 4).map((group) =>
                      Array.isArray(group)
                          ? group
                                .slice(0, 12)
                                .map((form) => string(form, 256))
                                .filter(Boolean)
                          : [],
                  )
                : [];
            return {
                music_id: song.music_id,
                title: string(song.title),
                title_ascii: string(song.title_ascii),
                artist: string(song.artist),
                release_date:
                    /^\d{4}-\d{2}-\d{2}$/.test(song.release_date || "") &&
                    timestamp(song.release_date)
                        ? song.release_date
                        : null,
                genre: integer(song.genre, 0, 65535) ? song.genre : null,
                is_custom: song.is_custom === true,
                release_year: integer(song.release_year, 1900, 2200)
                    ? song.release_year
                    : null,
                forms,
                difficulties,
            };
        });
    }
    return result;
}

export function cleanChartDetail(value) {
    if (
        !value ||
        !integer(value.music_id, 1, 10000000) ||
        !integer(value.diff_idx, 0, 5)
    )
        throw new Error("Invalid chart details");
    const result = {
        music_id: value.music_id,
        diff_idx: value.diff_idx,
        title: string(value.title),
        artist: string(value.artist),
        effector: string(value.effector),
        is_custom: value.is_custom === true,
        illustrator: string(value.illustrator),
        distribution_date:
            /^\d{4}-\d{2}-\d{2}$/.test(value.distribution_date || "") &&
            timestamp(value.distribution_date)
                ? value.distribution_date
                : null,
        chart: null,
    };
    for (const [key, maximum] of Object.entries({
        bpm_min: 100000,
        bpm_max: 100000,
        level: 100,
        version: 100,
        genre: 65535,
        max_exscore: 10000000,
    }))
        result[key] =
            finite(value[key]) && value[key] >= 0 && value[key] <= maximum
                ? value[key]
                : null;
    if (value.chart) {
        const c = value.chart;
        const bins = (array) =>
            Array.isArray(array) &&
            array.length === 64 &&
            array.every((v) => integer(v, 0, 10000000));
        if (
            !finite(c.duration) ||
            c.duration <= 0 ||
            c.duration > 7200 ||
            !bins(c.density) ||
            (c.laser_density !== undefined && !bins(c.laser_density)) ||
            (c.laser_density_version !== undefined &&
                (c.laser_density_version !== 2 || !bins(c.laser_density))) ||
            ((c.max_chain !== undefined ||
                c.max_chain_estimated !== undefined) &&
                (!integer(c.max_chain, 0, 10000000) ||
                    typeof c.max_chain_estimated !== "boolean")) ||
            (c.visual_gimmicks !== undefined &&
                typeof c.visual_gimmicks !== "boolean") ||
            (c.visual_gimmicks_version !== undefined &&
                (c.visual_gimmicks_version !== 2 ||
                    typeof c.visual_gimmicks !== "boolean")) ||
            !Array.isArray(c.lanes) ||
            c.lanes.length !== 8 ||
            !c.lanes.every(bins) ||
            !Array.isArray(c.bpm_changes) ||
            !c.bpm_changes.length ||
            c.bpm_changes.length > 128 ||
            !c.bpm_changes.every(
                (p) =>
                    Array.isArray(p) &&
                    p.length === 2 &&
                    finite(p[0]) &&
                    p[0] >= 0 &&
                    p[0] <= 7200 &&
                    finite(p[1]) &&
                    p[1] > 0 &&
                    p[1] <= 100000,
            ) ||
            !integer(c.bpm_change_count, 0, 1000000)
        )
            throw new Error("Invalid chart summary");
        const counts = {};
        for (const key of [
            "bt_taps",
            "bt_holds",
            "fx_taps",
            "fx_holds",
            "laser_sections",
        ]) {
            if (!integer(c.counts?.[key], 0, 10000000))
                throw new Error("Invalid note counts");
            counts[key] = c.counts[key];
        }
        result.chart = {
            duration: c.duration,
            counts,
            density: [...c.density],
            ...(c.laser_density !== undefined
                ? { laser_density: [...c.laser_density] }
                : {}),
            ...(c.laser_density_version === 2
                ? { laser_density_version: 2 }
                : {}),
            ...(c.max_chain !== undefined
                ? {
                      max_chain: c.max_chain,
                      max_chain_estimated: c.max_chain_estimated,
                  }
                : {}),
            lanes: c.lanes.map((l) => [...l]),
            ...(c.visual_gimmicks !== undefined
                ? { visual_gimmicks: c.visual_gimmicks }
                : {}),
            ...(c.visual_gimmicks_version !== undefined
                ? { visual_gimmicks_version: c.visual_gimmicks_version }
                : {}),
            bpm_changes: c.bpm_changes.map((p) => [...p]),
            bpm_change_count: c.bpm_change_count,
        };
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 24000)
        throw new Error("Chart details too large");
    if (value.timeline !== undefined && value.timeline !== null) {
        if (
            typeof value.timeline !== "string" ||
            value.timeline.length > 350000 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                value.timeline,
            )
        )
            throw Error("Invalid chart timeline");
        const raw = gunzipSync(Buffer.from(value.timeline, "base64"), {
            maxOutputLength: 8000000,
        });
        const timeline = JSON.parse(raw.toString("utf8"));
        if (!validTimeline(timeline, result))
            throw Error("Invalid chart timeline");
        // Keep visual geometry only. Audio effects and sample banks stay separate.
        const visual = Object.fromEntries(
            [
                "schema",
                "music_id",
                "diff_idx",
                "duration",
                "buttons",
                "lasers",
                "measures",
                "tempos",
            ].map((key) => [key, timeline[key]]),
        );
        result.timeline = gzipSync(JSON.stringify(visual)).toString("base64");
    }
    return result;
}

export function cleanCover(c) {
    if (
        !c ||
        !/^[a-f0-9]{64}$/.test(c.id) ||
        typeof c.data !== "string" ||
        c.data.length > 700000 ||
        !["image/webp", "image/png"].includes(c.type)
    )
        throw new Error("Invalid cover");
    const bytes = Buffer.from(c.data, "base64");
    const valid =
        c.type === "image/webp"
            ? bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP"
            : bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
        !valid ||
        bytes.length > 524288 ||
        createHash("sha256").update(bytes).digest("hex") !== c.id
    )
        throw new Error("Invalid cover content");
    return { id: c.id, type: c.type, data: bytes.toString("base64") };
}
