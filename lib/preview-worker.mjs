import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

export function createPreviewWorker(
    python,
    root,
    { module = "scripts.preview", signature } = {},
) {
    let child,
        closed = false;
    let revision,
        preparing = Promise.resolve();
    const children = new Set();

    function start() {
        const process = (child = spawn(python, ["-u", "-m", module], {
            cwd: root,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: {
                ...globalThis.process.env,
                ...(signature
                    ? {
                          SDVX_PREVIEW_REVISION: createHash("sha256")
                              .update(revision)
                              .digest("hex"),
                      }
                    : {}),
            },
        }));
        children.add(process);
        const pending = (process.pending = []);

        function fail(error) {
            for (const call of pending.splice(0)) call.reject(error);
        }

        process.stderr.on("data", (data) => globalThis.process.stderr.write(data));
        const lines = createInterface({ input: process.stdout });
        lines.on("line", (line) => {
            const call = pending.shift();
            if (!call) return;
            try {
                const result = JSON.parse(line);
                if (!result.ok)
                    throw Error(result.error || "Preview request failed");
                call.resolve(result.result);
            } catch (error) {
                call.reject(error);
            }
        });
        process.stdin.on("error", fail);
        process.on("error", fail);
        process.on("close", () => {
            lines.close();
            if (child === process) child = null;
            children.delete(process);
            fail(Error("Preview worker stopped"));
        });
        return process;
    }

    function request(command) {
        const ready = preparing.then(async () => {
            if (closed) throw Error("Preview worker is closed");
            const next = signature ? await signature() : null;
            if (closed) throw Error("Preview worker is closed");
            if (next !== revision) {
                child?.stdin.end();
                child = null;
                revision = next;
            }
            const process = child || start();
            return { process };
        });
        preparing = ready.then(
            () => {},
            () => {},
        );
        return ready.then(({ process }) => {
            return new Promise((resolve, reject) => {
                process.pending.push({ resolve, reject });
                process.stdin.write(command + "\n", (error) => {
                    if (error) {
                        for (const call of process.pending.splice(0))
                            call.reject(error);
                    }
                });
            });
        });
    }

    return {
        export: () => request("export"),
        request: (command) => request(JSON.stringify(command)),
        close() {
            closed = true;
            for (const process of children) process.stdin.end();
        },
    };
}
