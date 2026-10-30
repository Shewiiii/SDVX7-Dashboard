import {
    paintRadar,
    radarMarkup,
    validRadar,
    selectProfileRadar,
} from "./radar.js";
import { motion } from "./motion.js";

export function createProfileRadar(root, note) {
    let signature;

    return {
        render(source, { animate = true, includeCustom = false } = {}) {
            const radar = selectProfileRadar(source, { includeCustom });
            const pending = radar === undefined && Boolean(source);
            const next = JSON.stringify({ radar: radar ?? null, pending });
            if (next === signature) return;
            signature = next;
            const first = !root.querySelector("svg");
            motion.stop(root);
            if (!validRadar(radar?.values)) {
                const message = pending
                    ? "Sync your saved scores to load the radar without custom charts."
                    : source
                      ? "No eligible saved scores for the profile radar."
                      : "Profile radar will appear after your saved scores sync.";
                root.innerHTML = `<p class="profile-radar-empty">${message}</p>`;
                note.hidden = true;
                return;
            }
            root.innerHTML = radarMarkup(radar.values, { profile: true });
            note.hidden = radar.complete !== false;
            paintRadar(root, radar.values, { animate: animate && !first });
            if (first) {
                motion.profileRadar(
                    root,
                    () =>
                        paintRadar(root, radar.values, {
                            restart: true,
                            animate: true,
                        }),
                    animate,
                );
            }
        },
    };
}
