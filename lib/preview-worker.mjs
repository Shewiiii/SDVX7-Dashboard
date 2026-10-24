import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function createPreviewWorker(python, root) {
    let child, closed = false;
    const pending = [];
    function fail(error) {
        for (const call of pending.splice(0)) call.reject(error);
    }
    function start() {
        const process = child = spawn(python, ["-u", "-m", "scripts.preview"], {
            cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        });
        process.stderr.on("data", (data) => globalThis.process.stderr.write(data));
        const lines = createInterface({ input: process.stdout });
        lines.on("line", (line) => {
            const call = pending.shift();
            if (!call) return;
            try {
                const result = JSON.parse(line);
                if (!result.ok) throw Error(result.error || "Preview export failed");
                call.resolve();
            } catch (error) { call.reject(error); }
        });
        process.stdin.on("error", fail);
        process.on("error", fail);
        process.on("close", () => {
            lines.close();
            if (child === process) child = null;
            fail(Error("Preview worker stopped"));
        });
        return process;
    }
    return {
        export() {
            if (closed) return Promise.reject(Error("Preview worker is closed"));
            const process = child || start();
            return new Promise((resolve, reject) => {
                pending.push({ resolve, reject });
                process.stdin.write("export\n", (error) => { if (error) fail(error); });
            });
        },
        close() {
            closed = true;
            child?.stdin.end();
        },
    };
}
