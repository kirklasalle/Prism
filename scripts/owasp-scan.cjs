#!/usr/bin/env node
/*
 * Phase F-G — OWASP Top 10 Scan Harness
 *
 * Combines `npm audit --audit-level=high --json` with an in-house static
 * checklist sweep across the codebase. Emits a per-category report at
 * prism-output/owasp/{run-id}.md plus a machine-readable .json sibling.
 *
 * This is a *signal collector*, not a remediation engine. Findings drive
 * a manual review tracked in docs/OWASP_TOP_10_CHECKLIST.md.
 *
 * Inline annotation: lines containing `// @owasp-allow A0X` are
 * suppressed from category A0X.
 *
 * Exit codes:
 *   0 — scan completed (regardless of findings; CI gating is opt-in via
 *       PRISM_OWASP_FAIL_ON=high|critical|none)
 *   1 — npm audit reported issues at or above PRISM_OWASP_FAIL_ON
 *   2 — invocation error
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

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

function scanCategory(files, category, regex) {
    const findings = [];
    for (const file of files) {
        let content;
        try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (line.includes(`@owasp-allow ${category}`)) continue;
            if (regex.test(line)) {
                findings.push({ file, line: i + 1, snippet: line.trim().slice(0, 200) });
            }
        }
    }
    return findings;
}

function runNpmAudit() {
    try {
        const out = execSync("npm audit --json --audit-level=low", { stdio: ["ignore", "pipe", "pipe"] }).toString();
        return JSON.parse(out);
    } catch (err) {
        // npm audit returns non-zero when vulns exist; stdout still contains JSON.
        const stdout = err.stdout?.toString() ?? "";
        try { return JSON.parse(stdout); } catch { return { error: err.message ?? "npm audit failed" }; }
    }
}

function severityRank(s) { return ["info", "low", "moderate", "high", "critical"].indexOf(s); }

function main() {
    const root = process.cwd();
    const srcDir = path.join(root, "src");
    if (!fs.existsSync(srcDir)) {
        console.error("[owasp-scan] src/ not found in cwd");
        process.exit(2);
    }
    const files = listSourceFiles(srcDir);

    // Heuristic categories — deliberately tuned for false-positive
    // tolerability; the inline @owasp-allow annotation suppresses known-safe.
    const categories = [
        // A01 — Broken Access Control: routes that look state-changing without auth gating nearby.
        { id: "A01", title: "Broken Access Control", regex: /(?:app|router)\.(?:post|put|delete|patch)\s*\(/ },
        // A02 — Cryptographic Failures: weak hashes / static IVs.
        { id: "A02", title: "Cryptographic Failures", regex: /(?:createHash\s*\(\s*['"]md5['"]|createHash\s*\(\s*['"]sha1['"]|createCipheriv\s*\([^,]+,\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*\))/ },
        // A03 — Injection: template-literal SQL string interpolation.
        { id: "A03", title: "Injection", regex: /(?:db|database|conn|client)\.(?:exec|prepare|query)\s*\(\s*`[^`]*\$\{/ },
        // A05 — Security Misconfiguration: secrets via process.env without default-deny.
        { id: "A05", title: "Security Misconfiguration", regex: /process\.env\.[A-Z_]+\s*\|\|\s*['"][^'"]{0,4}['"]/ },
        // A07 — Identification & Authentication Failures: hardcoded JWT secrets.
        { id: "A07", title: "Identification & Authentication Failures", regex: /jwt\.sign\s*\([^,]+,\s*['"][^'"]+['"]/ },
        // A08 — Software & Data Integrity Failures: dynamic eval / Function ctor.
        { id: "A08", title: "Software & Data Integrity Failures", regex: /\b(?:eval|new Function)\s*\(/ },
        // A09 — Security Logging & Monitoring Failures: caught errors silently swallowed.
        { id: "A09", title: "Security Logging & Monitoring Failures", regex: /catch\s*\([^)]*\)\s*\{\s*\}/ },
        // A10 — SSRF: outbound http(s).get with user-influenced URLs.
        { id: "A10", title: "Server-Side Request Forgery", regex: /https?\.(?:get|request)\s*\(\s*(?!['"`])(?:req\.|request\.|input\.|args\.|opts?\.)/ },
    ];

    const findings = {};
    for (const cat of categories) {
        findings[cat.id] = {
            id: cat.id,
            title: cat.title,
            count: 0,
            findings: scanCategory(files, cat.id, cat.regex),
        };
        findings[cat.id].count = findings[cat.id].findings.length;
    }

    const npmAudit = runNpmAudit();
    const auditSummary = npmAudit?.metadata?.vulnerabilities ?? {};

    const runId = `owasp-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const outDir = path.join(root, "prism-output", "owasp");
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, `${runId}.json`);
    const mdPath = path.join(outDir, `${runId}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ runId, scannedFiles: files.length, categories: findings, npmAudit: auditSummary }, null, 2));

    const lines = [];
    lines.push(`# OWASP Top 10 Scan — ${runId}`);
    lines.push("");
    lines.push(`Files scanned: ${files.length}`);
    lines.push("");
    lines.push("## npm audit summary");
    lines.push("");
    lines.push("| Severity | Count |");
    lines.push("| --- | --- |");
    for (const sev of ["info", "low", "moderate", "high", "critical"]) {
        lines.push(`| ${sev} | ${auditSummary[sev] ?? 0} |`);
    }
    lines.push("");
    lines.push("## Static heuristic findings");
    lines.push("");
    for (const cat of categories) {
        const c = findings[cat.id];
        lines.push(`### ${c.id} — ${c.title} (${c.count})`);
        if (c.count === 0) {
            lines.push("");
            lines.push("_No findings._");
            lines.push("");
            continue;
        }
        for (const f of c.findings.slice(0, 25)) {
            const rel = path.relative(root, f.file).replace(/\\/g, "/");
            lines.push(`- \`${rel}:${f.line}\` — ${f.snippet}`);
        }
        if (c.findings.length > 25) {
            lines.push(`- _… ${c.findings.length - 25} more (see ${path.basename(jsonPath)})_`);
        }
        lines.push("");
    }
    fs.writeFileSync(mdPath, lines.join("\n"));

    console.log(`[owasp-scan] wrote ${mdPath}`);
    console.log(`[owasp-scan] wrote ${jsonPath}`);

    const failOn = (process.env.PRISM_OWASP_FAIL_ON || "none").toLowerCase();
    if (failOn !== "none") {
        const threshold = severityRank(failOn);
        let exceeded = false;
        for (const sev of ["high", "critical"]) {
            if (severityRank(sev) >= threshold && (auditSummary[sev] ?? 0) > 0) exceeded = true;
        }
        if (exceeded) {
            console.error(`[owasp-scan] npm audit found vulnerabilities at or above '${failOn}'`);
            process.exit(1);
        }
    }
    process.exit(0);
}

if (require.main === module) main();

module.exports = { listSourceFiles, scanCategory };
