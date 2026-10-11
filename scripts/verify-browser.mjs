import { chromium, firefox } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanPlay, cleanObservation, cleanState } from "../lib/records.mjs";
import {
    chartPlays,
    DIFFS,
    summary,
    volforceClass,
    grade,
} from "../public/metrics.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
await mkdir(path.join(root, ".local"), { recursive: true });
const useFirefox = process.env.DASHBOARD_BROWSER === "firefox";
const browser = await (useFirefox
    ? firefox.launch({ headless: true })
    : chromium.launch({ channel: "chrome", headless: true }));
const errors = [];
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1250 },
        deviceScaleFactor: 1,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const conversionRate = 0.00563;
    await page.route("https://api.frankfurter.dev/v2/rate/jpy/eur", (route) =>
        route.fulfill({
            headers: { "access-control-allow-origin": "*" },
            json: { base: "JPY", quote: "EUR", rate: conversionRate, date: "2026-10-11" },
        }),
    );
    const checkRow = async (selector) => {
        const row = page.locator(selector).first();
        const music = await row.getAttribute("data-music"),
            diff = await row.getAttribute("data-diff");
        const previousUrl = page.url();
        await row.hover();
        await page.waitForFunction(
            (selector) =>
                getComputedStyle(document.querySelector(selector))
                    .backgroundColor === "rgba(203, 166, 247, 0.016)",
            selector,
        );
        assert.equal(
            await row.evaluate((el) => getComputedStyle(el).backgroundColor),
            "rgba(203, 166, 247, 0.016)",
        );
        if (selector.includes("#records")) {
            assert.ok(
                (
                    await row
                        .locator("td")
                        .evaluateAll((cells) =>
                            cells.map(
                                (cell) =>
                                    getComputedStyle(cell).backgroundColor,
                            ),
                        )
                ).every((color) => color === "rgba(0, 0, 0, 0)"),
                "Highlight must be painted once on the whole row",
            );
        }
        // Click empty padding, outside the title, to exercise full-row navigation.
        await row.click({ position: { x: 2, y: 2 } });
        assert.match(
            page.url(),
            new RegExp(`#leaderboard\\?song=${music}&diff=${diff}`),
        );
        await page.goBack();
        await page.waitForFunction((url) => location.href === url, previousUrl);
    };
    const checkTooltip = async () => {
        await page.locator("#chart").scrollIntoViewIfNeeded();
        const chart = await page.locator("#chart").boundingBox();
        for (const fraction of [0.2, 0.5, 0.8]) {
            const cursor = {
                x: chart.x + chart.width * fraction,
                y: chart.y + chart.height * 0.7,
            };
            await page.mouse.move(cursor.x, cursor.y);
            assert.equal(await page.locator("#tooltip").isVisible(), true);
            const box = await page.locator("#tooltip").boundingBox();
            assert.ok(
                box.x >= cursor.x + 10 || box.x + box.width <= cursor.x - 10,
                "Tooltip covers the hovered graph column",
            );
            const wrap = await page.locator("#chart-wrap").boundingBox();
            assert.ok(
                box.x >= wrap.x && box.x + box.width <= wrap.x + wrap.width,
                "Tooltip leaves the graph container",
            );
            assert.equal(
                await page
                    .locator("#tooltip")
                    .evaluate((el) => el.scrollWidth > el.clientWidth),
                false,
                "Compact tooltip text overflows",
            );
        }
    };
    await page.goto(baseUrl);
    await page.locator('body[data-ready="true"]').waitFor();
    const background = () =>
        page.locator(".ambient").evaluate((el) => {
            const style = getComputedStyle(el),
                bounds = el.getBoundingClientRect();
            return {
                height: bounds.height,
                width: bounds.width,
                top: bounds.top,
                left: bounds.left,
                position: style.backgroundPosition.split(",").at(-1).trim(),
                bottom: style.bottom,
                filter: style.filter,
            };
        });
    const desktopBackground = await background();
    assert.equal(desktopBackground.position, "50% 50%");
    assert.equal(desktopBackground.bottom, "-25px");
    const actual = await (await page.request.get(`${baseUrl}/api/data`)).json();
    for (const p of actual.plays) cleanPlay(p);
    for (const o of actual.observations) cleanObservation(o);
    cleanState(actual.state);
    assert.ok(actual.state.appeal_card, "Current appeal artwork is missing");
    assert.equal(
        await page.locator("#appeal-card").getAttribute("src"),
        `/api/cover?id=${actual.state.appeal_card}`,
    );
    const expectedClass = volforceClass(summary(actual).total);
    assert.equal(
        await page.locator("#vf-class-name").innerText(),
        expectedClass.name,
    );
    assert.equal(
        await page.locator("#vf-class-icon").getAttribute("src"),
        `/assets/vf-classes/${expectedClass.number}.png`,
    );
    await page.waitForFunction(() =>
        ["appeal-card", "vf-class-icon"].every((id) => {
            const image = document.getElementById(id);
            return image?.complete && image.naturalWidth > 0;
        }),
    );
    const cardBounds = await page.locator("#appeal-card").boundingBox();
    const nameBounds = await page.locator("#player-name").boundingBox();
    assert.ok(
        cardBounds.x + cardBounds.width < nameBounds.x,
        "Appeal card must be left of the name",
    );
    assert.equal(
        await page.locator("#play-count").innerText(),
        actual.plays.length.toLocaleString(),
    );
    const spending = new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
    }).format((267 * actual.plays.length) / 4);
    const convertedSpending = new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: "EUR",
    }).format(267 * actual.plays.length / 4 * conversionRate);
    await page.waitForFunction(() => document.getElementById("play-detail").textContent.includes("€"));
    assert.equal(
        await page.locator("#play-detail").innerText(),
        `${actual.plays.filter((p) => p.clear_type > 1).length} clears · ${spending} (${convertedSpending})`,
    );
    const axes = await page
        .locator("#chart .axis-caption")
        .evaluateAll((labels) =>
            labels.map((label) => ({
                text: label.textContent,
                x: Number(label.getAttribute("x")),
            })),
        );
    assert.ok(
        axes.find((label) => label.text === "TOTAL VF").x <
            axes.find((label) => label.text === "CHART VF").x,
    );
    assert.equal(await page.locator("#chart .grid").count(), 13);
    assert.equal(
        await page.locator(".hero-subtitle").innerText(),
        "History of local plays",
    );
    assert.equal(await page.locator("#connection").count(), 0);
    assert.ok(
        !(await page.locator("body").innerText()).includes("Personal archive"),
    );
    assert.ok((await page.locator("#chart path").count()) >= 4);
    await page.locator('[data-series="avg100"]').click();
    assert.equal(
        await page
            .locator('[data-series="avg100"]')
            .getAttribute("aria-pressed"),
        "false",
    );
    await page.locator('[data-series="avg100"]').click();
    await page.locator('[data-days="7"]').click();
    await page.locator('[data-days="0"]').click();
    await page.locator("#difficulty").selectOption("4");
    await page.locator("#difficulty").selectOption("1");
    await page.locator("#chart").hover({ position: { x: 300, y: 100 } });
    assert.equal(await page.locator("#tooltip").isVisible(), true);
    assert.deepEqual(
        await page.locator("#tooltip .tooltip-line span").allTextContents(),
        ["Total VF", "Avg 100", "Avg 10", "Best VF", "Top 50"],
    );
    assert.equal(await page.locator("#tooltip .difficulty-badge").count(), 0);
    await checkTooltip();
    assert.equal(
        await page.locator('[data-series="threshold"]').innerText(),
        "Top 50",
    );
    await page.locator("h1").hover();
    await checkRow("#top-plays .chart-row");
    await checkRow("#recent-plays .chart-row");
    await page.screenshot({
        path: path.join(root, ".local/desktop.png"),
        fullPage: true,
    });
    await page.locator('[data-view="top"]').click();
    assert.equal(await page.locator("#records tr").count(), 50);
    assert.equal(new URL(page.url()).hash, "#top");
    assert.equal(await page.locator("#next").isDisabled(), true);
    await checkRow("#records .chart-row");
    await page.locator('[data-view="leaderboard"]').click();
    await page.goBack();
    await page.waitForFunction(() =>
        document
            .querySelector('[data-view="top"]')
            .classList.contains("active"),
    );
    assert.equal(new URL(page.url()).hash, "#top");
    await page.goForward();
    await page.waitForFunction(() =>
        document
            .querySelector('[data-view="leaderboard"]')
            .classList.contains("active"),
    );
    await page.locator('[data-view="top"]').click();
    await page.locator("#search").fill("no-such-chart-12345");
    assert.match(await page.locator("#records").innerText(), /No matching/);
    await page.locator("#search").fill("");
    await page.locator("#sort").selectOption("score");
    await page.locator('[data-view="history"]').click();
    assert.equal(await page.locator("#records tr").count(), 50);
    await checkRow("#records .chart-row");
    await page.locator("#next").click();
    assert.equal(new URL(page.url()).hash, "#history?page=2");
    await page.reload();
    await page.locator('body[data-ready="true"]').waitFor();
    assert.match(await page.locator("#page-info").innerText(), /PAGE 2/);
    await page.goBack();
    await page.waitForFunction(() =>
        document.querySelector("#page-info").textContent.startsWith("PAGE 1"),
    );
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    assert.match((await download).suggestedFilename(), /sdvx-history/);
    // Song and chart selection, image loading, score rank order, and empty history.
    await page.locator('[data-view="leaderboard"]').click();
    const grouped = new Map();
    actual.plays
        .filter((p) => p.score > 0)
        .forEach((p) => {
            const key = `${p.music_id}:${p.diff_idx}`;
            grouped.set(key, (grouped.get(key) || 0) + 1);
        });
    const [chartKey] = [...grouped].sort((a, b) => b[1] - a[1])[0];
    const [musicId, difficulty] = chartKey.split(":").map(Number);
    const song = actual.state.catalog.find((s) => s.music_id === musicId);
    await page
        .locator("#song-query")
        .fill(`${song.title} ${DIFFS[difficulty]}`);
    await page.locator("#song-query").press("ArrowDown");
    await page.locator("#song-query").press("Enter");
    const expected = chartPlays(actual, musicId, difficulty);
    const selectedUrl = page.url();
    assert.match(
        selectedUrl,
        new RegExp(`#leaderboard\\?song=${musicId}&diff=${difficulty}`),
    );
    await page.reload();
    await page.locator('body[data-ready="true"]').waitFor();
    assert.equal(page.url(), selectedUrl);
    assert.equal(
        await page.locator("#song-query").inputValue(),
        `${song.title} ${DIFFS[difficulty]}`,
    );
    assert.equal(
        await page.locator("#leaderboard-records tr[data-play-vf]").count(),
        Math.min(10, expected.length),
    );
    const values = await page
        .locator("#leaderboard-records tr[data-play-vf]")
        .evaluateAll((rows) => rows.map((row) => Number(row.dataset.playVf)));
    assert.deepEqual(
        values,
        expected.slice(0, 10).map((p) => p.play_vf),
    );
    const scores = await page
        .locator("#leaderboard-records .score-cell")
        .allTextContents();
    assert.deepEqual(
        scores.map((s) => Number(s.replace(/\D/g, ""))),
        expected.slice(0, 10).map((p) => p.score),
    );
    assert.deepEqual(
        await page
            .locator("#leaderboard-records .grade-icon")
            .evaluateAll((images) => images.map((image) => image.alt)),
        expected.slice(0, 10).map((p) => grade(p.score)),
    );
    await page.waitForFunction(() =>
        [
            ...document.querySelectorAll("#leaderboard-records .grade-icon"),
        ].every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.waitForFunction(() => {
        const img = document.querySelector("#selected-chart img");
        return img?.complete && img.naturalWidth > 0;
    });
    await page.screenshot({
        path: path.join(root, ".local/leaderboard-desktop.png"),
        fullPage: true,
    });
    if (expected.length > 10) {
        await page.locator("#leaderboard-next").click();
        assert.match(
            await page.locator("#leaderboard-page-info").innerText(),
            /Page 2/,
        );
    }
    const otherDifficulty = song.difficulties.find(
        (d) => d.diff_idx !== difficulty,
    );
    if (otherDifficulty) {
        await page
            .locator(`[data-chart-diff="${otherDifficulty.diff_idx}"]`)
            .click();
        assert.equal(
            await page
                .locator(`[data-chart-diff="${otherDifficulty.diff_idx}"]`)
                .getAttribute("aria-pressed"),
            "true",
        );
        assert.equal(
            await page.locator("#leaderboard-records tr[data-play-vf]").count(),
            Math.min(
                10,
                chartPlays(actual, musicId, otherDifficulty.diff_idx).length,
            ),
        );
        await page.goBack();
        await page.waitForFunction(
            (diff) =>
                document
                    .querySelector(`[data-chart-diff="${diff}"]`)
                    ?.getAttribute("aria-pressed") === "true",
            difficulty,
        );
    }
    await page.locator("#song-query").fill("no-such-song-abcdef12345");
    assert.match(
        await page.locator("#song-options").innerText(),
        /No matching song/,
    );
    await page.locator("#song-query").press("Escape");
    assert.equal(await page.locator("#song-options").isVisible(), false);
    await page.locator(`[data-chart-diff="${difficulty}"]`).click();
    await page
        .locator("#song-query")
        .fill(`${song.title} ${DIFFS[difficulty]}`);
    await page.locator("#song-query").press("Escape");
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const phoneBackground = await background();
        assert.equal(phoneBackground.position, "82% 50%");
        assert.equal(phoneBackground.height, 894);
        await page.evaluate(() => scrollTo(0, 450));
        assert.deepEqual(
            await background(),
            phoneBackground,
            "Scrolling moved or resized the wallpaper",
        );
        await page.evaluate(() => scrollTo(0, 0));
        for (const view of ["top", "history", "leaderboard"]) {
            if (view === "leaderboard") {
                await page.goto(selectedUrl);
                await page.locator('body[data-ready="true"]').waitFor();
            }
            await page.locator(`[data-view="${view}"]`).click();
            const panel =
                view === "leaderboard" ? "#leaderboard-view" : "#records-view";
            const sidewaysScroll = await page
                .locator(`${panel} .table-scroll`)
                .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
            assert.equal(
                sidewaysScroll,
                false,
                `${view} requires sideways scrolling at ${width}px`,
            );
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth,
                ),
                false,
            );
            const vfCells = page.locator(`${panel} tbody .vf-cell`);
            assert.ok((await vfCells.count()) > 0);
            const bounds = await vfCells.first().boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
            if (view !== "leaderboard") await checkRow("#records .chart-row");
            await page.screenshot({
                path: path.join(root, `.local/${view}-mobile-${width}.png`),
                fullPage: true,
            });
        }
    }
    if (!useFirefox) {
        // Emulate toolbar space through the browser's small/large viewport difference.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: 320,
            height: 844,
            deviceScaleFactor: 1,
            mobile: true,
        });
        const expanded = await background();
        await cdp.send("Emulation.setSmallViewportHeightDifferenceOverride", {
            difference: 84,
        });
        const smallHeight = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.height = "100svh";
            document.body.append(probe);
            const height = probe.getBoundingClientRect().height;
            probe.remove();
            return height;
        });
        assert.equal(
            smallHeight,
            760,
            "Toolbar emulation did not change the small viewport",
        );
        assert.deepEqual(
            await background(),
            expanded,
            "Toolbar space resized the wallpaper",
        );
        await cdp.send("Emulation.setSmallViewportHeightDifferenceOverride", {
            difference: 0,
        });
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await cdp.detach();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: path.join(root, ".local/leaderboard-mobile.png"),
        fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1250 });
    assert.deepEqual(
        await background(),
        desktopBackground,
        "Desktop wallpaper changed after mobile sizing",
    );
    await page.locator('[data-view="overview"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
        () =>
            document.getElementById("chart").getAttribute("viewBox") ===
            "0 0 400 300",
    );
    assert.equal(await page.locator("#chart .grid").count(), 9);
    assert.equal(await page.locator("#spark").isVisible(), true);
    assert.equal(await page.locator("#spark svg path").count(), 1);
    await checkTooltip();
    const previousChart = await page
        .locator("#chart .crosshair")
        .elementHandle();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForFunction(
        (previous) => !previous.isConnected,
        previousChart,
    );
    await page.waitForFunction(
        () =>
            document.getElementById("chart").getAttribute("viewBox") ===
            "0 0 400 300",
    );
    await checkTooltip();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
    );
    await page.screenshot({
        path: path.join(root, ".local/mobile.png"),
        fullPage: true,
    });
    // A network failure must retain the loaded records and show a recoverable status.
    await page.route("**/api/data", (route) =>
        route.fulfill({ status: 503, body: "{}" }),
    );
    await page.locator("#refresh").click();
    await page.locator("#notice").waitFor();
    assert.match(await page.locator("#notice").innerText(), /last loaded/);
    assert.equal(
        await page.locator("#play-count").innerText(),
        actual.plays.length.toLocaleString(),
    );
    assert.deepEqual(errors, []);
    console.log(
        `${useFirefox ? "Firefox" : "Chrome"} browser checks passed: ${actual.plays.length} real plays; desktop/mobile, fixed mobile wallpaper, song/difficulty search, cover loading, score ordering, leaderboard pagination, chart controls, export, offline recovery.`,
    );
} finally {
    await browser.close();
}
