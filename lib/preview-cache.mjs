import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { historyChanges } from "../public/history.js";

export async function previewSourceSignature(files, playtimePath) {
    return JSON.stringify(
        await Promise.all(
            files.map(async (file) => {
                try {
                    if (file === playtimePath) {
                        const state = JSON.parse(await readFile(file, "utf8"));
                        // Cursor checkpoints change while the game logs unrelated events.
                        // Only these counters affect the displayed playtime.
                        return [state.version, state.seconds, state.plays];
                    }
                    const info = await stat(file);
                    return [info.mtimeMs, info.size];
                } catch (error) {
                    if (error.code === "ENOENT") return null;
                    throw error;
                }
            }),
        ),
    );
}

export function createPreviewCache({
    signature,
    build,
    read,
    maxAge = 60000,
    keep = 3,
    clock = Date.now,
}) {
    let current,
        builtSignature,
        builtAt = 0,
        task;
    const epoch = randomBytes(16).toString("hex");
    let historyRevision = 0;
    const snapshots = new Map();
    return {
        get ready() {
            return !!current;
        },
        refresh() {
            if (task) return task;
            task = (async () => {
                const before = await signature();
                if (
                    current &&
                    before === builtSignature &&
                    clock() - builtAt < maxAge
                )
                    return false;
                await build();
                const data = await read();
                const {
                    catalog = [],
                    appeal_cards = [],
                    ...profile
                } = data.state;
                const library = { catalog, appeal_cards };
                const versions = {
                    revision: data.synced_at,
                    history_cursor: `${epoch}:${++historyRevision}`,
                    catalog_revision: createHash("md5")
                        .update(JSON.stringify(library))
                        .digest("hex"),
                };
                if (!versions.revision)
                    throw Error("Preview export has no revision");
                current = {
                    versions,
                    full: { ...data, ...versions },
                    archive: { ...data, ...versions, state: profile },
                    catalog: {
                        catalog_revision: versions.catalog_revision,
                        state: library,
                    },
                };
                snapshots.set(versions.revision, current);
                while (snapshots.size > keep)
                    snapshots.delete(snapshots.keys().next().value);
                // If inputs changed during export, keep the old signature so the
                // next queued refresh catches up. Completed revisions stay readable.
                builtSignature = before;
                builtAt = clock();
                return true;
            })().finally(() => {
                task = null;
            });
            return task;
        },
        get(section = "full", revision = null, since = null) {
            let snapshot = current;
            if (revision) {
                snapshot =
                    section === "catalog"
                        ? [...snapshots.values()].find(
                              (item) =>
                                  item.versions.catalog_revision === revision,
                          )
                        : snapshots.get(revision);
            }
            if (!snapshot) return null;
            if (section === "archive" && since) {
                const previous = [...snapshots.values()].find(
                    (item) => item.versions.history_cursor === since,
                );
                if (previous) {
                    const plays = historyChanges(
                        previous.archive.plays,
                        snapshot.archive.plays,
                        "plays",
                    );
                    const observations = historyChanges(
                        previous.archive.observations,
                        snapshot.archive.observations,
                        "observations",
                    );
                    if (plays && observations)
                        return {
                            ...snapshot.archive,
                            delta: true,
                            base_cursor: since,
                            plays,
                            observations,
                        };
                }
            }
            return section === "revision"
                ? snapshot.versions
                : snapshot[section] || null;
        },
    };
}
