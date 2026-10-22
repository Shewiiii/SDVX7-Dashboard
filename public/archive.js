export function createArchiveLoader() {
    let current, revision, catalog;
    const key = "dashboard-catalog-v1";
    try {
        catalog = JSON.parse(localStorage.getItem(key));
    } catch {
        /* Optional storage. */
    }
    async function read(url, fresh = false) {
        const response = await fetch(url, {
            cache: fresh ? "no-store" : "default",
        });
        if (!response.ok) {
            const failure = await response.json().catch(() => ({}));
            throw Object.assign(new Error("Archive unavailable"), {
                code: failure.code,
            });
        }
        return response.json();
    }
    return async ({ fresh = false } = {}) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const version = await read(
                `/api/data?section=revision${fresh && !attempt ? "&refresh=1" : attempt ? "&check=1" : ""}`,
                fresh || attempt > 0,
            );
            // Older preview servers may still return a complete archive.
            if (Array.isArray(version.plays)) return version;
            if (!version.revision || !version.catalog_revision)
                throw new Error("Invalid archive revision");
            if (
                current &&
                revision === version.revision &&
                catalog?.revision === version.catalog_revision
            )
                return current;
            try {
                const [archive, library] = await Promise.all([
                    current && revision === version.revision
                        ? current
                        : read(
                              `/api/data?section=archive&revision=${encodeURIComponent(version.revision)}`,
                          ),
                    catalog?.revision === version.catalog_revision &&
                    Array.isArray(catalog.state?.catalog) &&
                    Array.isArray(catalog.state?.appeal_cards)
                        ? catalog
                        : read(
                              `/api/data?section=catalog&revision=${encodeURIComponent(version.catalog_revision)}`,
                          ).then((value) => ({
                              revision: value.catalog_revision,
                              state: value.state,
                          })),
                ]);
                if (
                    archive.revision !== version.revision ||
                    library.revision !== version.catalog_revision
                )
                    throw Object.assign(new Error("Revision changed"), {
                        code: "REVISION_CHANGED",
                    });
                if (
                    !Array.isArray(archive.plays) ||
                    !Array.isArray(archive.observations) ||
                    !Array.isArray(archive.state?.charts) ||
                    !Array.isArray(library.state?.catalog) ||
                    !Array.isArray(library.state?.appeal_cards)
                )
                    throw new Error("Invalid archive");
                current = {
                    ...archive,
                    state: { ...archive.state, ...library.state },
                };
                revision = version.revision;
                catalog = library;
                try {
                    localStorage.setItem(key, JSON.stringify(catalog));
                } catch {
                    /* Memory cache still works. */
                }
                return current;
            } catch (error) {
                if (error.code !== "REVISION_CHANGED" || attempt === 2)
                    throw error;
            }
        }
    };
}
