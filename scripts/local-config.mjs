import {
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    rmdirSync,
    statSync,
} from "node:fs";
import path from "node:path";

function migrate(source, target, root) {
    const local = path.resolve(root, ".local");
    for (const candidate of [source, target]) {
        const relative = path.relative(local, path.resolve(candidate));
        if (
            relative === ".." ||
            relative.startsWith(".." + path.sep) ||
            path.isAbsolute(relative)
        ) {
            throw new Error(
                "Local data must stay inside the dashboard workspace",
            );
        }
    }
    if (!existsSync(source)) return;
    if (!existsSync(target)) {
        mkdirSync(path.dirname(target), { recursive: true });
        try {
            renameSync(source, target);
        } catch (error) {
            if (error.code !== "ENOENT" || !existsSync(target)) throw error;
        }
    } else if (
        statSync(source).isDirectory() &&
        statSync(target).isDirectory()
    ) {
        for (const name of readdirSync(source)) {
            migrate(path.join(source, name), path.join(target, name), root);
        }
        if (!readdirSync(source).length) rmdirSync(source);
    }
}

export function protectedPath(root, name) {
    const target = path.join(root, ".local/do-not-delete", name);
    migrate(path.join(root, ".local", name), target, root);
    return target;
}

export function localConfigPath(root, name) {
    const target = path.join(protectedPath(root, "config"), name);
    migrate(path.join(root, ".local", name), target, root);
    return target;
}
