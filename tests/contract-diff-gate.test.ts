/**
 * Contract Diff Release Gate — smoke test
 *
 * Verifies `scripts/contract-diff-gate.cjs`:
 *  1. exits 0 when the baseline and candidate snapshots are identical.
 *  2. exits 1 when the candidate removes a tool present in the baseline.
 *  3. exits 0 with --allow-breaking even when breaking changes exist.
 *  4. exits 2 when the baseline is missing.
 *  5. writes a markdown report when --report-out is provided.
 *
 * Pure JSON I/O — no DB, no network, no real tools.
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Contract Diff Gate (scripts/contract-diff-gate.cjs)", function () {
    this.timeout(20_000);
    let workDir: string;
    let baselinePath: string;
    let candidateSamePath: string;
    let candidateBreakingPath: string;
    const scriptPath = join(process.cwd(), "scripts", "contract-diff-gate.cjs");

    const baselineSnapshot = {
        generatedAt: "2024-01-01T00:00:00.000Z",
        toolCount: 2,
        tools: [
            { name: "alpha", version: "1.0.0", contractHash: "hash-alpha", args: { type: "object" } },
            { name: "bravo", version: "1.0.0", contractHash: "hash-bravo", args: { type: "object" } },
        ],
    };

    before(() => {
        workDir = mkdtempSync(join(tmpdir(), "prism-contract-gate-"));
        baselinePath = join(workDir, "baseline.json");
        candidateSamePath = join(workDir, "candidate-same.json");
        candidateBreakingPath = join(workDir, "candidate-breaking.json");

        writeFileSync(baselinePath, JSON.stringify(baselineSnapshot, null, 2), "utf8");
        // Identical (no change)
        writeFileSync(candidateSamePath, JSON.stringify(baselineSnapshot, null, 2), "utf8");
        // Breaking — drop "bravo", schema-change "alpha"
        writeFileSync(candidateBreakingPath, JSON.stringify({
            generatedAt: "2024-02-01T00:00:00.000Z",
            toolCount: 1,
            tools: [
                { name: "alpha", version: "1.0.0", contractHash: "hash-alpha-CHANGED", args: { type: "object" } },
            ],
        }, null, 2), "utf8");
    });

    after(() => {
        try { rmSync(workDir, { recursive: true, force: true }); } catch { /* noop */ }
    });

    function runGate(args: string[]): { status: number | null; stdout: string; stderr: string } {
        const r = spawnSync(process.execPath, [scriptPath, ...args], {
            cwd: process.cwd(),
            stdio: "pipe",
            encoding: "utf8",
        });
        return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    }

    it("exits 0 when baseline and candidate are identical", () => {
        const r = runGate(["--baseline", baselinePath, "--candidate", candidateSamePath]);
        assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
        assert.match(r.stdout, /breaking=0/);
        assert.match(r.stdout, /PASS/);
    });

    it("exits 1 when candidate has breaking changes", () => {
        const r = runGate(["--baseline", baselinePath, "--candidate", candidateBreakingPath]);
        assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}; stderr=${r.stderr}`);
        assert.match(r.stdout, /breaking=2/);
        assert.match(r.stderr, /FAIL/);
    });

    it("exits 0 with --allow-breaking even when breaking changes exist", () => {
        const r = runGate(["--baseline", baselinePath, "--candidate", candidateBreakingPath, "--allow-breaking"]);
        assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
        assert.match(r.stdout, /breaking=2/);
        assert.match(r.stderr + r.stdout, /OVERRIDDEN/);
    });

    it("exits 2 when baseline is missing", () => {
        const missing = join(workDir, "does-not-exist.json");
        const r = runGate(["--baseline", missing, "--candidate", candidateSamePath]);
        assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}`);
        assert.match(r.stderr, /baseline not found/);
    });

    it("writes a markdown report when --report-out is provided", () => {
        const reportPath = join(workDir, "diff-report.md");
        const r = runGate([
            "--baseline", baselinePath,
            "--candidate", candidateBreakingPath,
            "--report-out", reportPath,
            "--allow-breaking",
        ]);
        assert.strictEqual(r.status, 0);
        assert.ok(existsSync(reportPath), "report file should exist");
        const md = readFileSync(reportPath, "utf8");
        assert.match(md, /# Contract Diff Gate Report/);
        assert.match(md, /Breaking Changes \(BLOCKING\)/);
        assert.match(md, /OVERRIDDEN/);
    });
});
