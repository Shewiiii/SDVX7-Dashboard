export function crewRenderResolution(width, height) {
    // Supersample small details while bounding large canvas allocations
    return Math.min(
        Math.max(2, (globalThis.devicePixelRatio || 1) * 1.5),
        4,
        4096 / Math.max(1, width, height),
        Math.sqrt(12_000_000 / Math.max(1, width * height)),
    );
}
