const vertexSource = `
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute float a_opacity;
    uniform vec2 u_scale;
    varying mediump vec2 v_uv;
    varying mediump float v_opacity;

    void main() {
        vec2 position = a_position.xy * u_scale;
        vec2 clip = vec2(position.x - 1.0, 1.0 - position.y);
        gl_Position = vec4(clip * a_position.z, 0.0, a_position.z);
        v_uv = a_uv;
        v_opacity = a_opacity;
    }
`;

const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_image;
    varying mediump vec2 v_uv;
    varying mediump float v_opacity;

    void main() {
        gl_FragColor = texture2D(u_image, v_uv) * v_opacity;
    }
`;

export function createAfpPerspectiveRenderer(canvas, onRestore) {
    if (!canvas.ownerDocument) return null;
    const gl = canvas.getContext("webgl", {
        depth: false,
        powerPreference: "high-performance",
    });
    if (!gl) return null;

    const textures = new Map();
    let program;
    let buffer;
    let scale;
    let width;
    let height;
    let activeImage;
    let activeBlend;
    let vertices = new Float32Array(1024);
    let length = 0;

    function initialize() {
        program = gl.createProgram();
        for (const [type, source] of [
            [gl.VERTEX_SHADER, vertexSource],
            [gl.FRAGMENT_SHADER, fragmentSource],
        ]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            gl.deleteShader(shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            throw Error("The AFP shaders could not load.");
        }

        buffer = gl.createBuffer();
        scale = gl.getUniformLocation(program, "u_scale");
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (const [name, size, offset] of [
            ["a_position", 3, 0],
            ["a_uv", 2, 12],
            ["a_opacity", 1, 20],
        ]) {
            const index = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(index);
            gl.vertexAttribPointer(index, size, gl.FLOAT, false, 24, offset);
        }
        gl.enable(gl.BLEND);
    }

    const contextLost = (event) => event.preventDefault();
    function contextRestored() {
        textures.clear();
        width = 0;
        initialize();
        onRestore();
    }
    initialize();
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);

    function bindImage(image) {
        let texture = textures.get(image);
        if (texture) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return;
        }

        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        textures.set(image, texture);
    }

    function flush() {
        if (!length) return;
        bindImage(activeImage);
        gl.blendFunc(gl.ONE, activeBlend ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            vertices.subarray(0, length),
            gl.STREAM_DRAW,
        );
        gl.drawArrays(gl.TRIANGLES, 0, length / 6);
        length = 0;
    }

    return {
        start() {
            if (gl.isContextLost()) return false;
            if (width !== canvas.width || height !== canvas.height) {
                width = canvas.width;
                height = canvas.height;
                gl.viewport(0, 0, width, height);
                gl.uniform2f(scale, 2 / width, 2 / height);
            }
            gl.clear(gl.COLOR_BUFFER_BIT);
            return true;
        },
        draw(image, target, source, alpha, blend) {
            if (image !== activeImage || blend !== activeBlend) {
                flush();
                activeImage = image;
                activeBlend = blend;
            }

            if (length + 18 > vertices.length) {
                const larger = new Float32Array(vertices.length * 2);
                larger.set(vertices);
                vertices = larger;
            }

            for (let corner = 0; corner < 3; corner++) {
                const { x, y, w } = target[corner];
                vertices[length++] = x;
                vertices[length++] = y;
                vertices[length++] = w ?? 1;
                vertices[length++] = source[corner].x / image.naturalWidth;
                vertices[length++] = source[corner].y / image.naturalHeight;
                vertices[length++] = alpha;
            }
        },
        finish: flush,
        destroy() {
            canvas.removeEventListener("webglcontextlost", contextLost);
            canvas.removeEventListener("webglcontextrestored", contextRestored);
            for (const texture of textures.values()) gl.deleteTexture(texture);
            textures.clear();
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
        },
    };
}
