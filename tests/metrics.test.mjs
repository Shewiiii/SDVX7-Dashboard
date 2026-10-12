import test from "node:test";
import assert from "node:assert/strict";
import {
    performance,
    rolling,
    visibleObservations,
    summary,
    volforceClass,
    lineValue,
    playtimeText,
} from "../public/metrics.js";
import {
    authorized,
    cleanPlay,
    cleanObservation,
    cleanState,
    recordId,
} from "../lib/records.mjs";
import syncHandler from "../api/sync.js";
import dataHandler from "../api/data.js";

const base = {
    music_id: 12,
    diff_idx: 4,
    score: 9900000,
    clear_type: 2,
    received_at: "2026-10-01T12:00:00.000Z",
    play_vf: 0.38,
    level: 19,
    title: "Test",
    artist: "Artist",
};

test("playtime duration displays zero, minutes, and total hours without inventing missing data", () => {
    assert.equal(playtimeText(0), "0h 00m");
    assert.equal(playtimeText(1610), "0h 26m");
    assert.equal(playtimeText(45060), "12h 31m");
    assert.equal(playtimeText(90000), "25h 00m");
    for (const value of [undefined, null, -1, NaN, Infinity, "60", 1.5]) {
        assert.equal(playtimeText(value), "—");
    }
});

test("performance excludes failed plays and NOV, and honors the selected calendar window", () => {
    const plays = [
        base,
        { ...base, clear_type: 1 },
        { ...base, diff_idx: 0 },
        { ...base, received_at: "2026-09-01T12:00:00.000Z" },
    ];
    assert.deepEqual(
        performance(plays, {
            days: 7,
            now: Date.parse("2026-10-02T12:00:00Z"),
        }),
        [base],
    );
});
test("moving averages use the last N plays rather than all previous plays", () => {
    const plays = [1, 2, 3, 4].map((play_vf) => ({ ...base, play_vf }));
    assert.deepEqual(
        rolling(plays, 2).map((p) => p[1]),
        [1, 1.5, 2.5, 3.5],
    );
});

test("line hover interpolates averages and holds stepped values without looking ahead", () => {
    const points = [
        [1000, 0.2],
        [2000, 0.4],
        [3000, 0.5],
    ];
    assert.ok(Math.abs(lineValue(points, 1500) - 0.3) < 1e-12);
    assert.equal(lineValue(points, 1500, true), 0.2);
    assert.equal(lineValue(points, 2000, true), 0.4);
    assert.equal(lineValue(points, 3000), 0.5);
    assert.equal(lineValue(points, 999), null);
    assert.equal(lineValue(points, 3001), null);
    assert.equal(lineValue([], 1000), null);
    assert.equal(
        lineValue(
            [
                [1000, 0.2],
                [1000, 0.3],
                [2000, 0.4],
            ],
            1000,
            true,
        ),
        0.3,
    );
});

test("Top 50 hover leaves gaps empty rather than inventing a threshold", () => {
    const points = [
        [1000, 0.2],
        [2000, null],
        [3000, 0.3],
        [4000, 0.3],
    ];
    assert.equal(lineValue(points, 1500, true), 0.2);
    assert.equal(lineValue(points, 2000, true), null);
    assert.equal(lineValue(points, 2500, true), null);
    assert.equal(lineValue(points, 3500, true), 0.3);
    assert.equal(lineValue(points, 1500), null);
});
test("total VF history is carried forward and never invented before its first observation", () => {
    const observations = [{ timestamp: "2026-10-03T00:00:00Z", total_vf: 16 }];
    const start = Date.parse("2026-10-01T00:00:00Z"),
        end = Date.parse("2026-10-04T00:00:00Z");
    assert.equal(
        visibleObservations(observations, start, end)[0].time,
        Date.parse(observations[0].timestamp),
    );
    assert.deepEqual(
        visibleObservations(observations, end + 1, end + 100).map(
            (o) => o.time,
        ),
        [end + 1, end + 100],
    );
});
test("Top 50 uses saved chart bests; entry threshold is one integer thousandth above chart 50", () => {
    const charts = Array.from({ length: 51 }, (_, i) => ({
        music_id: i + 1,
        diff_idx: 4,
        vf: 0.4 - i / 1000,
    }));
    const result = summary({
        plays: [base],
        observations: [],
        state: { charts },
    });
    assert.equal(result.top.length, 50);
    assert.equal(result.entry, 0.352);
    assert.equal(result.best, 0.4);
    assert.equal(result.sessions.length, 1);
});
test("ingestion strips identifiers and stable IDs make enriched/retried plays idempotent", () => {
    const play = cleanPlay({
        ...base,
        profile_id: "private",
        token: "private",
    });
    assert.ok(!("profile_id" in play) && !("token" in play));
    assert.equal(recordId(play), recordId({ ...play, title: "New title" }));
    const state = cleanState({
        name: "Shewi",
        profile_id: "private",
        player: { card: "private" },
        charts: [],
    });
    assert.deepEqual(Object.keys(state).sort(), [
        "charts",
        "name",
        "updated_at",
        "version",
    ]);
    assert.throws(() => cleanPlay({ ...base, score: 10000001 }));
    assert.throws(() =>
        cleanObservation({
            timestamp: base.received_at,
            total_vf: Infinity,
            top_count: 50,
            minimum_vf: 0.3,
        }),
    );
});
test("VF class handles class/rank boundaries, rounding noise, and missing totals", () => {
    for (const [value, number, name] of [
        [0, 1, "Sienna I"],
        [9.999, 1, "Sienna IV"],
        [10, 2, "Cobalt I"],
        [12, 3, "Dandelion I"],
        [14, 4, "Cyan I"],
        [15, 5, "Scarlet I"],
        [16, 6, "Coral I"],
        [16.249, 6, "Coral I"],
        [16.249999999999996, 6, "Coral II"],
        [16.487, 6, "Coral II"],
        [16.5, 6, "Coral III"],
        [16.75, 6, "Coral IV"],
        [17, 7, "Argento I"],
        [18, 8, "Eldora I"],
        [19, 9, "Crimson I"],
        [20, 10, "Imperial I"],
        [23, 10, "Imperial IV"],
    ]) {
        assert.deepEqual(volforceClass(value), { number, name });
    }
    for (const value of [null, undefined, "16.487", -1, NaN, Infinity])
        assert.equal(volforceClass(value), null);
});

test("appeal artwork accepts only image hashes and preserves older snapshot compatibility", () => {
    assert.equal(
        cleanState({
            charts: [],
            appeal_card: "a".repeat(64),
            player: { appeal_id: 5535 },
        }).appeal_card,
        "a".repeat(64),
    );
    assert.equal(
        cleanState({ charts: [], appeal_card: "https://example.org/card.png" })
            .appeal_card,
        null,
    );
    assert.ok(!("appeal_card" in cleanState({ charts: [] })));
});

test("authentication rejects short, absent, wrong, and malformed secrets", () => {
    const secret = "a".repeat(64);
    assert.equal(authorized(`Bearer ${secret}`, secret), true);
    for (const header of [
        undefined,
        `Bearer ${"b".repeat(64)}`,
        secret,
        "Bearer a",
    ])
        assert.equal(authorized(header, secret), false);
    assert.equal(authorized("Bearer a", "a"), false);
});
function response() {
    return {
        code: 0,
        headers: {},
        body: null,
        setHeader(k, v) {
            this.headers[k] = v;
        },
        status(code) {
            this.code = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}
test("upload endpoint refuses unauthenticated writes before touching the database", async () => {
    const res = response();
    await syncHandler(
        {
            method: "POST",
            headers: {},
            body: { plays: [base], observations: [] },
        },
        res,
    );
    assert.equal(res.code, 401);
});
test("public endpoint reports missing database configuration without exposing credentials", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
        const res = response();
        await dataHandler({ method: "GET" }, res);
        assert.equal(res.code, 503);
        assert.deepEqual(res.body, { error: "Data is not connected yet" });
    } finally {
        if (saved) process.env.DATABASE_URL = saved;
    }
});
