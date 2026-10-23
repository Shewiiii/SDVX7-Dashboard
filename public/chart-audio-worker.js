import { renderChartAudio, encodeWav } from "./chart-audio-dsp.js";

self.onmessage = ({ data }) => {
    try {
        const channels = renderChartAudio({
            ...data,
            progress: (value) => self.postMessage({ progress: value }),
        });
        const wav = encodeWav(channels, data.rate);
        self.postMessage({ wav }, [wav]);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
