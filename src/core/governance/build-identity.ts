import { spawnSync } from "node:child_process";

export interface BuildIdentity {
    readonly commit: string;
    readonly buildId: string;
}

export function resolveCommitHash(): string {
    const command = process.platform === "win32" ? "cmd.exe" : "git";
    const args =
        process.platform === "win32"
            ? ["/d", "/s", "/c", "git rev-parse --short HEAD"]
            : ["rev-parse", "--short", "HEAD"];
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && typeof result.stdout === "string") {
        const value = result.stdout.trim();
        if (value.length > 0) return value;
    }
    return "unknown";
}

export function resolveBuildIdentity(environment: NodeJS.ProcessEnv = process.env): BuildIdentity {
    const commit = environment.PRISM_COMMIT ?? resolveCommitHash();
    return {
        commit,
        buildId: environment.PRISM_BUILD_ID ?? `build-${commit}`,
    };
}
