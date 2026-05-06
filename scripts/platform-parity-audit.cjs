#!/usr/bin/env node
/*
 * Phase F-H — Linux/macOS Parity Audit
 *
 * Scans the codebase for Windows-only code paths and classifies each
 * finding so we can track elimination progress over time.
 *
 * Categories:
 *   gated           — wrapped in `process.platform === 'win32'` (intentional branch)
 *   cross-platform  — has a non-Windows branch nearby
 *   needs-fix       — windows-only with no fallback (regression risk)
 *
 * Output:  prism-output/parity/{run-id}.md + .json
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PATTERNS = [
    { id: "win32-platform-check", regex: /process\.platform\s*===\s*['"]win32['"]/ },
    { id: "os-platform-win32", regex: /platform\s*\(\s*\)\s*===\s*['"]win32['"]/ },
    { id: "cmd-exe", regex: /\bcmd\.exe\b/i },
    { id: "powershell-exe", regex: /\bpowershell\.exe\b/i },
    { id: "powershell-cmdlet-spawn", regex: /spawn\s*\(\s*['"]powershell['"]/ },
    { id: "userprofile-env", regex: /process\.env\.USERPROFILE/ },
    { id: "windir-env", regex: /process\.env\.(?:WINDIR|SystemRoot|ProgramFiles)/ },
    { id: "hardcoded-backslash-path", regex: /['"][A-Za-z]:\\[^'"]+['"]/ },
];

function listSourceFiles(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            const p = path.join(cur, e.name);
            if (e.isDirectory()) {
                if (/^(node_modules|dist|prism-output|\.venv|\.git|coverage)$/.test(e.name)) continue;
                stack.push(p);
            } else if (/\.(ts|js|cjs|mjs)$/.test(e.name)) {
                out.push(p);
            }
        }
    }
    return out;
}

/**
 * Classify a finding by inspecting the surrounding ±10-line window.
 *   - `gated` if a `process.platform === 'win32'` (or platform()==='win32')
 *      check appears in window.
 *   - `cross-platform` if a non-win32 branch indicator (`'darwin'`,
 *      `'linux'`, `else if`, `os === 'darwin'`) appears in window.
 *   - `needs-fix` otherwise.
 */
function classify(lines, idx) {
    const lo = Math.max(0, idx - 10);
    const hi = Math.min(lines.length, idx + 10);
    const window = lines.slice(lo, hi).join("\n");
    if (/process\.platform\s*===\s*['"]win32['"]|platform\s*\(\s*\)\s*===\s*['"]win32['"]/.test(window)) {
        if (/['"]darwin['"]|['"]linux['"]|else\b/.test(window)) return "cross-platform";
        return "gated";
    }
    if (/['"]darwin['"]|['"]linux['"]/.test(window)) return "cross-platform";
    return "needs-fix";
}

function scan(root) {
    const srcDir = path.join(root, "src");
    const files = listSourceFiles(srcDir);
    const findings = [];
    for (const file of files) {
        let content;
        try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (/@parity-allow\b/.test(line)) continue;
            for (const pat of PATTERNS) {
                if (pat.regex.test(line)) {
                    findings.push({
                        file: path.relative(root, file).replace(/\\/g, "/"),
                        line: i + 1,
                        pattern: pat.id,
                        classification: classify(lines, i),
                        snippet: line.trim().slice(0, 200),
                    });
                }
            }
        }
    }
    return { files: files.length, findings };
}

function summarize(findings) {
    const counts = { gated: 0, "cross-platform": 0, "needs-fix": 0 };
    for (const f of findings) counts[f.classification] += 1;
    return counts;
}

function main() {
    const root = process.cwd();
    const result = scan(root);
    const counts = summarize(result.findings);

    const runId = `parity-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const outDir = path.join(root, "prism-output", "parity");
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `${runId}.json`);
    const mdPath = path.join(outDir, `${runId}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ runId, scannedFiles: result.files, counts, findings: result.findings }, null, 2));

    const lines = [];
    lines.push(`# Linux/macOS Parity Audit — ${runId}`);
    lines.push("");
    lines.push(`Scanned files: ${result.files}`);
    lines.push("");
    lines.push("| Classification | Count |");
    lines.push("| --- | --- |");
    lines.push(`| gated (intentional win32 branch) | ${counts.gated} |`);
    lines.push(`| cross-platform | ${counts["cross-platform"]} |`);
    lines.push(`| **needs-fix** | **${counts["needs-fix"]}** |`);
    lines.push("");
    lines.push("## needs-fix findings");
    lines.push("");
    const nf = result.findings.filter((f) => f.classification === "needs-fix");
    if (nf.length === 0) {
        lines.push("_None — every Windows-specific reference is gated or has a cross-platform branch._");
    } else {
        for (const f of nf.slice(0, 100)) {
            lines.push(`- \`${f.file}:${f.line}\` (${f.pattern}) — ${f.snippet}`);
        }
        if (nf.length > 100) lines.push(`- _… ${nf.length - 100} more in ${path.basename(jsonPath)}_`);
    }
    lines.push("");
    fs.writeFileSync(mdPath, lines.join("\n"));
    console.log(`[parity-audit] needs-fix=${counts["needs-fix"]} gated=${counts.gated} cross-platform=${counts["cross-platform"]} -> ${mdPath}`);

    const strict = process.env.PRISM_PARITY_STRICT === "1";
    if (strict && counts["needs-fix"] > 0) process.exit(1);
    process.exit(0);
}

if (require.main === module) main();

module.exports = { scan, summarize, classify, listSourceFiles };
