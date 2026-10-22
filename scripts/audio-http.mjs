import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export async function sendAudioFile(req, res, file) {
    const { size } = await stat(file);
    const headers = {
        "Content-Type": file.endsWith(".flac") ? "audio/flac" : "audio/ogg",
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
    };
    let start = 0,
        end = size - 1,
        status = 200;
    if (req.headers.range) {
        const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (!match || (!match[1] && !match[2])) {
            res.writeHead(416, { "Content-Range": `bytes */${size}` });
            res.end();
            return;
        }
        if (!match[1]) start = Math.max(0, size - Number(match[2]));
        else {
            start = Number(match[1]);
            if (match[2]) end = Math.min(end, Number(match[2]));
        }
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            start >= size
        ) {
            res.writeHead(416, { "Content-Range": `bytes */${size}` });
            res.end();
            return;
        }
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        status = 206;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    try {
        await pipeline(createReadStream(file, { start, end }), res);
    } catch (error) {
        if (!res.destroyed) throw error;
    }
}
