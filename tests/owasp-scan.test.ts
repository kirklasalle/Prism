/**
 * Phase F-G — OWASP scan harness tests.
 *
 * Validates the static scan helpers (`scanCategory`, `listSourceFiles`)
 * against synthetic input written to a tmp dir.
 */

import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testOwaspScan(): Promise<void> {
    const require = createRequire(import.meta.url);
    const scan = require(resolve(process.cwd(), "scripts/owasp-scan.cjs")) as {
        listSourceFiles: (dir: string) => string[];
        scanCategory: (
            files: string[],
            category: string,
            regex: RegExp,
        ) => { file: string; line: number; snippet: string }[];
    };

    const tmp = mkdtempSync(join(tmpdir(), "prism-owasp-test-"));
    try {
        mkdirSync(join(tmp, "src"));
        // File with a finding.
        writeFileSync(
            join(tmp, "src", "bad.ts"),
            "const x = eval('1+1');\nconst y = 2;\n",
            "utf-8",
        );
        // File with allow-listed annotation.
        writeFileSync(
            join(tmp, "src", "allowed.ts"),
            "const x = eval('1+1'); // @owasp-allow A08\nconst y = 2;\n",
            "utf-8",
        );
        // node_modules must be excluded.
        mkdirSync(join(tmp, "node_modules", "pkg"), { recursive: true });
        writeFileSync(join(tmp, "node_modules", "pkg", "evil.ts"), "eval('boom')", "utf-8");

        const files = scan.listSourceFiles(join(tmp, "src"));
        assert(files.length === 2, `expected 2 files, got ${files.length}`);

        const findings = scan.scanCategory(files, "A08", /\b(?:eval|new Function)\s*\(/);
        // Only `bad.ts` should be flagged; `allowed.ts` is suppressed.
        assert(findings.length === 1, `expected 1 finding, got ${findings.length}`);
        assert(findings[0].file.endsWith("bad.ts"), "bad.ts flagged");
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
