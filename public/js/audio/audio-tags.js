const encoder = new TextEncoder();
const decoder = new TextDecoder();

function join(parts) {
    const result = new Uint8Array(
        parts.reduce((size, part) => size + part.length, 0),
    );
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function uint32(value, littleEndian = true) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, littleEndian);
    return bytes;
}

function comments(bytes, tags) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    function read() {
        if (offset + 4 > bytes.length) throw Error("Invalid audio comments");
        const size = view.getUint32(offset, true);
        offset += 4;
        if (size > bytes.length - offset) throw Error("Invalid audio comments");
        const value = bytes.subarray(offset, offset + size);
        offset += size;
        return value;
    }
    const vendor = read();
    if (offset + 4 > bytes.length) throw Error("Invalid audio comments");
    const count = view.getUint32(offset, true);
    offset += 4;
    const values = [];
    for (let index = 0; index < count; index++) {
        const value = read();
        const key = decoder.decode(value).split("=", 1)[0].toUpperCase();
        if (!Object.hasOwn(tags, key)) values.push(value);
    }
    for (const [key, value] of Object.entries(tags)) {
        if (value) values.push(encoder.encode(`${key}=${value}`));
    }
    const parts = [uint32(vendor.length), vendor, uint32(values.length)];
    for (const value of values) parts.push(uint32(value.length), value);
    // Preserve private Opus comment extensions while discarding padding
    if (bytes[offset] & 1) parts.push(bytes.subarray(offset));
    return join(parts);
}

function pictureBlock(picture) {
    const mime = encoder.encode(picture.type);
    const data = new Uint8Array(picture.data);
    const depth =
        picture.type === "image/png"
            ? data[24] * ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[25]] || 1)
            : 24;
    return join([
        uint32(3, false),
        uint32(mime.length, false),
        mime,
        uint32(0, false),
        uint32(picture.width, false),
        uint32(picture.height, false),
        uint32(depth, false),
        uint32(0, false),
        uint32(data.length, false),
        data,
    ]);
}

function tagFlac(bytes, tags, picture) {
    if (decoder.decode(bytes.subarray(0, 4)) !== "fLaC")
        throw Error("Invalid FLAC file");
    const blocks = [];
    let offset = 4;
    let last = false;
    let hasComments = false;
    while (!last) {
        if (offset + 4 > bytes.length) throw Error("Invalid FLAC metadata");
        last = !!(bytes[offset] & 128);
        const type = bytes[offset] & 127;
        const size =
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3];
        offset += 4;
        if (offset + size > bytes.length) throw Error("Invalid FLAC metadata");
        let data = bytes.subarray(offset, offset + size);
        offset += size;
        if (type === 1 || (type === 6 && picture)) continue;
        if (type === 4) {
            data = comments(data, tags);
            hasComments = true;
        }
        blocks.push({ type, data });
    }
    if (!hasComments)
        blocks.push({ type: 4, data: comments(new Uint8Array(8), tags) });
    if (picture) blocks.push({ type: 6, data: pictureBlock(picture) });
    const parts = [bytes.subarray(0, 4)];
    blocks.forEach(({ type, data }, index) => {
        if (data.length > 0xffffff) throw Error("FLAC metadata too large");
        parts.push(
            new Uint8Array([
                type | (index === blocks.length - 1 ? 128 : 0),
                data.length >>> 16,
                data.length >>> 8,
                data.length,
            ]),
            data,
        );
    });
    // Audio frames and their checksums remain byte for byte identical
    parts.push(bytes.subarray(offset));
    return join(parts);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++)
        value = (value << 1) ^ (value & 0x80000000 ? 0x04c11db7 : 0);
    return value >>> 0;
});

function checksum(page) {
    page.fill(0, 22, 26);
    let crc = 0;
    for (const byte of page)
        crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255];
    new DataView(page.buffer, page.byteOffset, page.byteLength).setUint32(
        22,
        crc >>> 0,
        true,
    );
}

function tagOpus(bytes, tags, picture) {
    const pages = [];
    let offset = 0;
    while (offset < bytes.length) {
        if (
            offset + 27 > bytes.length ||
            decoder.decode(bytes.subarray(offset, offset + 4)) !== "OggS" ||
            bytes[offset + 4] !== 0
        )
            throw Error("Invalid Ogg page");
        const start = offset;
        const count = bytes[offset + 26];
        offset += 27;
        if (offset + count > bytes.length) throw Error("Invalid Ogg segments");
        const segments = bytes.subarray(offset, offset + count);
        const size = segments.reduce((total, value) => total + value, 0);
        offset += count + size;
        if (offset > bytes.length) throw Error("Invalid Ogg payload");
        pages.push({
            bytes: bytes.subarray(start, offset),
            segments,
            body: bytes.subarray(start + 27 + count, offset),
        });
    }
    if (
        pages.length < 3 ||
        decoder.decode(pages[0].body.subarray(0, 8)) !== "OpusHead"
    )
        throw Error("Invalid Opus file");
    const serial = new DataView(
        pages[0].bytes.buffer,
        pages[0].bytes.byteOffset,
    ).getUint32(14, true);
    for (const page of pages) {
        const pageSerial = new DataView(
            page.bytes.buffer,
            page.bytes.byteOffset,
        ).getUint32(14, true);
        if (pageSerial !== serial)
            throw Error("Multiple Ogg streams are unsupported");
    }
    const old = [];
    let end = 1;
    for (; end < pages.length; end++) {
        const page = pages[end];
        if (
            !page.segments.length ||
            page.segments.subarray(0, -1).some((size) => size !== 255)
        )
            throw Error("Invalid Opus comment pages");
        old.push(page.body);
        if (page.segments.at(-1) < 255) break;
    }
    if (end === pages.length) throw Error("Incomplete Opus comments");
    const original = join(old);
    if (decoder.decode(original.subarray(0, 8)) !== "OpusTags")
        throw Error("Missing Opus comments");
    if (picture) {
        const data = pictureBlock(picture);
        const chunks = [];
        for (let index = 0; index < data.length; index += 8192)
            chunks.push(
                String.fromCharCode(...data.subarray(index, index + 8192)),
            );
        tags = { ...tags, METADATA_BLOCK_PICTURE: btoa(chunks.join("")) };
    }
    const packet = join([
        encoder.encode("OpusTags"),
        comments(original.subarray(8), tags),
    ]);
    const segments = Array(Math.floor(packet.length / 255)).fill(255);
    segments.push(packet.length % 255);
    const output = [pages[0].bytes];
    let sequence =
        new DataView(
            pages[0].bytes.buffer,
            pages[0].bytes.byteOffset,
        ).getUint32(18, true) + 1;
    let bodyOffset = 0;
    for (let index = 0; index < segments.length; index += 255) {
        const table = new Uint8Array(segments.slice(index, index + 255));
        const size = table.reduce((total, value) => total + value, 0);
        const header = new Uint8Array(27);
        header.set(encoder.encode("OggS"));
        header[5] = index ? 1 : 0;
        if (index + table.length < segments.length) header.fill(255, 6, 14);
        header.set(uint32(serial), 14);
        header.set(uint32(sequence++), 18);
        header[26] = table.length;
        const page = join([
            header,
            table,
            packet.subarray(bodyOffset, bodyOffset + size),
        ]);
        bodyOffset += size;
        checksum(page);
        output.push(page);
    }
    for (const originalPage of pages.slice(end + 1)) {
        const page = originalPage.bytes.slice();
        page.set(uint32(sequence++), 18);
        checksum(page);
        output.push(page);
    }
    return join(output);
}

export function tagAudio(buffer, format, tags, picture) {
    const bytes = new Uint8Array(buffer);
    if (format === "flac") return tagFlac(bytes, tags, picture);
    if (format === "opus") return tagOpus(bytes, tags, picture);
    throw Error("Unsupported audio format");
}
