import { paintRadar, radarMarkup, validRadar } from "./radar.js";
import { motion } from "./motion.js";

export function createProfileRadar(root, note) {
    let signature;

    return {
        render(radar, { animate = true } = {}) {
            const next = JSON.stringify(radar ?? null);
            if (next === signature) return;
            signature = next;
            const first = !root.querySelector("svg");
            motion.stop(root);
            if (!validRadar(radar?.values)) {
                root.innerHTML =
                    '<p class="profile-radar-empty">Profile radar will appear after your saved scores sync.</p>';
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
