import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const decompress = promisify(gunzip);
const MAX_WIRE_BYTES = 4_500_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

export async function readSyncBody(req) {
    const encoding = String(
        req.headers["content-encoding"] || "identity",
    ).toLowerCase();
    if (!["identity", "gzip"].includes(encoding))
        throw Object.assign(new Error("Unsupported upload encoding"), {
            status: 415,
        });
    let body = req.body;
    if (body === undefined) {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
            const bytes = Buffer.from(chunk);
            length += bytes.length;
            if (length > MAX_WIRE_BYTES)
                throw Object.assign(new Error("Upload too large"), {
                    status: 413,
                });
            chunks.push(bytes);
        }
        body = Buffer.concat(chunks);
    }
    if (Buffer.isBuffer(body)) {
        if (body.length > MAX_WIRE_BYTES)
            throw Object.assign(new Error("Upload too large"), { status: 413 });
        if (encoding === "gzip") {
            try {
                body = await decompress(body, {
                    maxOutputLength: MAX_JSON_BYTES,
                });
            } catch (error) {
                if (error.code === "ERR_BUFFER_TOO_LARGE")
                    throw Object.assign(new Error("Upload too large"), {
                        status: 413,
                    });
                throw error;
            }
        }
        body = body.toString("utf8");
    } else if (encoding === "gzip") {
        throw new Error("Invalid compressed upload");
    }
    return typeof body === "string" ? JSON.parse(body) : body;
}
