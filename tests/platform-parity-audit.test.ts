/**
 * Phase F-H — Linux/macOS parity audit tests.
 */

import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testPlatformParityAudit(): Promise<void> {
    const require = createRequire(import.meta.url);
    const audit = require(resolve(process.cwd(), "scripts/platform-parity-audit.cjs")) as {
        scan: (root: string) => { files: number; findings: { file: string; line: number; pattern: string; classification: "gated" | "cross-platform" | "needs-fix" }[] };
        summarize: (findings: { classification: string }[]) => Record<string, number>;
    };

    const tmp = mkdtempSync(join(tmpdir(), "prism-parity-test-"));
    try {
        mkdirSync(join(tmp, "src"));

        // Gated win32 branch — should classify as `gated` or `cross-platform`.
        writeFileSync(
            join(tmp, "src", "gated.ts"),
            [
                "if (process.platform === 'win32') {",
                "    require('cmd.exe');",
                "} else {",
                "    require('/bin/sh');",
                "}",
            ].join("\n"),
            "utf-8",
        );

        // Naked windows-only path — should be `needs-fix`.
        writeFileSync(
            join(tmp, "src", "naked.ts"),
            "const home = process.env.USERPROFILE;\n",
            "utf-8",
        );

        // Annotated (allowlisted) — must be skipped entirely.
        writeFileSync(
            join(tmp, "src", "allowed.ts"),
            "const x = process.env.USERPROFILE; // @parity-allow\n",
            "utf-8",
        );

        const result = audit.scan(tmp);
        const counts = audit.summarize(result.findings);
        assert(counts["needs-fix"] >= 1, `expected ≥1 needs-fix, got ${counts["needs-fix"]}`);
        // The gated finding from gated.ts should not be `needs-fix`.
        const naked = result.findings.find((f) => f.file.endsWith("naked.ts"));
        assert(naked && naked.classification === "needs-fix", "naked.ts classified needs-fix");
        const allowed = result.findings.find((f) => f.file.endsWith("allowed.ts"));
        assert(!allowed, "annotated finding suppressed");
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
