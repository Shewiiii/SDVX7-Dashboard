import { mountAudioPlayer } from "./audio-player.js";

export function createCrewVoices(panel) {
    panel.setAttribute("aria-labelledby", "crew-voices-title");
    panel.innerHTML = `<h2 id="crew-voices-title">Voice bank</h2>
        <p class="settings-hint crew-voice-message" role="status"></p>
        <fieldset class="crew-voice-list" aria-label="Voice lines" disabled></fieldset>
        <p class="crew-voice-label" hidden></p><div class="crew-voice-player" hidden></div>`;
    const message = panel.querySelector(".crew-voice-message");
    const list = panel.querySelector(".crew-voice-list");
    const label = panel.querySelector(".crew-voice-label");
    const playerHost = panel.querySelector(".crew-voice-player");
    let request;
    let disposePlayer;

    function stop() {
        request?.abort();
        disposePlayer?.();
        disposePlayer = null;
        playerHost.replaceChildren();
        playerHost.hidden = true;
        label.hidden = true;
    }

    async function show(entry, base) {
        stop();
        list.replaceChildren();
        list.disabled = true;
        message.hidden = false;
        message.textContent = entry.voice
            ? "Loading voice bank..."
            : "This crew does not have a system voice.";
        if (!entry.voice) return;
        request = new AbortController();
        const { signal } = request;
        try {
            const response = await fetch(new URL(entry.voice, base), {
                signal,
            });
            if (!response.ok) throw Error("Voice bank unavailable");
            const manifest = await response.json();
            if (signal.aborted) return;
            for (const bank of manifest.banks) {
                const heading = document.createElement("h3");
                heading.textContent = bank.label;
                list.append(heading);
                for (const clip of bank.clips) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "crew-voice-option";
                    button.textContent = clip.label;
                    button.disabled = clip.silent === true;
                    if (button.disabled) {
                        button.title = "Empty sample";
                        button.setAttribute(
                            "aria-label",
                            `${clip.label} (empty sample)`,
                        );
                    }
                    button.setAttribute("aria-pressed", "false");
                    button.addEventListener("click", () => {
                        if (button.disabled) return;
                        disposePlayer?.();
                        for (const item of list.querySelectorAll("button")) {
                            const selected = item === button;
                            item.classList.toggle("selected", selected);
                            item.setAttribute("aria-pressed", String(selected));
                        }
                        label.textContent = `${bank.label} · ${clip.label}`;
                        label.hidden = false;
                        playerHost.hidden = false;
                        disposePlayer = mountAudioPlayer(
                            playerHost,
                            { title: clip.label },
                            null,
                            {
                                autoplay: true,
                                mediaLabel: "voice line",
                                unavailableLabel:
                                    "Could not load this voice line.",
                                loadAudio: async () => {
                                    const response = await fetch(
                                        new URL(clip.metadata, base),
                                        { signal },
                                    );
                                    if (!response.ok)
                                        throw Error("Voice line unavailable");
                                    const record = await response.json();
                                    return {
                                        ...record,
                                        url: new URL(record.url, base).href,
                                    };
                                },
                            },
                        );
                    });
                    list.append(button);
                }
            }
            list.disabled = !list.querySelector("button:not([disabled])");
            message.textContent = list.disabled
                ? "This voice bank has no recorded lines."
                : "Select a voice line to preview.";
        } catch {
            if (!signal.aborted)
                message.textContent =
                    "The voice bank could not load. Select this crew again to retry.";
        }
    }

    return { show, stop };
}
