import { tagAudio } from "./audio-tags.js";

self.onmessage = ({ data }) => {
    try {
        const result = tagAudio(
            data.buffer,
            data.format,
            data.tags,
            data.picture,
        );
        self.postMessage({ buffer: result.buffer }, [result.buffer]);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
