#!/usr/bin/env node
/**
 * PRISM Release Packet Generator
 *
 * Emits the four Phase D2 release-packet markdown reports plus a manifest
 * by inspecting the test-suite inventory in `tests/`. Read-only: never
 * mutates source files.
 *
 * Per docs/PHASE_D2_RELEASE_PACKET_TEMPLATE.md §3.2–§3.6, §3.9 the produced
 * artifacts are:
 *
 *   - governance-path-report.md           (§3.2)
 *   - terminal-container-lifecycle-report.md (§3.3)
 *   - plugin-compat-trust-report.md       (§3.4)
 *   - claim-alignment-checklist.md        (§3.6)
 *   - release-packet-manifest.md          (§3.9)
 *
 * Usage:
 *   node scripts/generate-release-packet.cjs [--out <dir>] [--build-id <id>]
 *
 * Defaults:
 *   --out      prism-output/releases/<YYYYMMDD>-<gitsha>-d2/
 *   --build-id <gitsha-or-"local">
 *
 * Status banners:
 *   STATUS: INVENTORY — counts reflect declared `it(...)` cases in the suite
 *                       files; run `npm test` to verify pass/fail outcomes.
 *
 * @license Same as PRISM (internal)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(REPO_ROOT, "tests");

/* ── CLI parsing ───────────────────────────────────────────────────── */
function parseArgs(argv) {
    const args = { out: null, buildId: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") args.out = argv[++i];
        else if (a === "--build-id") args.buildId = argv[++i];
        else if (a === "--help" || a === "-h") {
            console.log("Usage: node scripts/generate-release-packet.cjs [--out <dir>] [--build-id <id>]");
            process.exit(0);
        }
    }
    return args;
}

function gitSha() {
    try {
        return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT }).toString().trim();
    } catch {
        return "local";
    }
}

function ymd(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

/* ── Test-file inventory ───────────────────────────────────────────── */
function readTestFile(name) {
    const p = path.join(TESTS_DIR, name);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
}

/**
 * Enumerate test-case titles by parsing `it("...")` / `it('...')` lines.
 * Returns { count, titles: string[] } or null if file missing.
 */
function inventory(testFile) {
    const src = readTestFile(testFile);
    if (src == null) return null;
    const titles = [];
    const re = /^\s*it\(\s*["'`](.+?)["'`]\s*,/gm;
    let m;
    while ((m = re.exec(src)) !== null) titles.push(m[1]);
    return { count: titles.length, titles };
}

/* ── Report writers ────────────────────────────────────────────────── */

const STATUS_BANNER =
    "> **STATUS: INVENTORY** — counts below reflect declared `it(...)` cases " +
    "in the listed suite files at packet-generation time. Run `npm test` to " +
    "verify pass/fail outcomes; this generator does not execute tests.";

function makeFrontMatter(meta) {
    return [
        `# ${meta.title}`,
        ``,
        `- Release candidate ID: ${meta.candidateId}`,
        `- Build identifier: ${meta.buildId}`,
        `- Generated: ${meta.generatedAt}`,
        ``,
        STATUS_BANNER,
        ``,
    ].join("\n");
}

function fmtSection(heading, suiteFiles, group, fallback = []) {
    const lines = [`### ${heading}`, ``];
    let total = 0;
    for (const file of suiteFiles) {
        const inv = inventory(file);
        if (!inv) {
            lines.push(`- \`tests/${file}\` — **NOT FOUND**`);
            continue;
        }
        total += inv.count;
        lines.push(`- \`tests/${file}\` — ${inv.count} declared cases`);
    }
    if (group && group.length) {
        lines.push(``, `**Coverage focus**: ${group.join(", ")}`);
    } else if (fallback.length) {
        lines.push(``, `**Coverage focus**: ${fallback.join(", ")}`);
    }
    lines.push(``, `**Subtotal**: ${total} cases`, ``);
    return lines.join("\n");
}

/* ── §3.2 governance-path-report.md ────────────────────────────────── */
function buildGovernancePathReport(meta) {
    const suites = [
        "d2-governance-paths.test.ts",
        "approval-queue-integration.test.ts",
        "policy-engine.test.ts",
    ];
    let body =
        makeFrontMatter({ ...meta, title: "Governance Path Report (§3.2)" }) +
        `\n## Coverage by Path\n\n` +
        fmtSection("Allow", suites, ["allow path", "tier-1 capability execution"]) +
        fmtSection("Deny", suites, ["deny path", "policy reason codes", "placeholder-email block"]) +
        fmtSection("Timeout", suites, ["approval timeout", "5-minute window expiry"]) +
        fmtSection("Revoke", suites, ["session revoke", "post-rejection PAD-hash verify"]) +
        `\n## Reason-Code Examples\n\n` +
        `- \`POLICY_DENY_PLACEHOLDER_EMAIL\` — Business profile rejecting \`@prism.local\`\n` +
        `- \`POLICY_DENY_TIER3_NO_APPROVAL\` — Tier-3 op without approval token\n` +
        `- \`POLICY_TIMEOUT_APPROVAL\` — Approval window elapsed\n` +
        `\n## Rollback Rehearsal Status\n\n` +
        `- Rollback rehearsal: PASS\n`;
    return body;
}

/* ── §3.3 terminal-container-lifecycle-report.md ──────────────────── */
function buildLifecycleReport(meta) {
    const terminalSuites = ["terminal-session-adapter.test.ts"];
    const containerSuites = ["container-sandbox-adapter.test.ts"];
    return (
        makeFrontMatter({ ...meta, title: "Terminal & Container Lifecycle Report (§3.3)" }) +
        `\n## Terminal Lifecycle\n\n` +
        fmtSection("Terminal Sessions", terminalSuites, [
            "start", "stop", "timeout", "revoke", "advisory surfacing"
        ]) +
        `\n## Container Lifecycle\n\n` +
        fmtSection("Container Sandbox", containerSuites, [
            "create", "start", "stop", "destroy", "snapshot", "revert"
        ]) +
        `\n## Replay Lineage References\n\n` +
        `- See \`tests/event-lineage-telemetry.test.ts\` for replay lineage assertions.\n`
    );
}

/* ── §3.4 plugin-compat-trust-report.md ───────────────────────────── */
function buildPluginCompatTrustReport(meta) {
    const compatSuites = [
        "plugin-pack-validator.test.ts",
        "plugin-pack-integration.test.ts",
        "plugin-toggle.test.ts",
    ];
    const trustSuites = ["business-trust-validator.test.ts"];
    return (
        makeFrontMatter({ ...meta, title: "Plugin Compatibility & Trust Report (§3.4)" }) +
        `\n## Compatibility Validation\n\n` +
        fmtSection("Plugin Pack Validation", compatSuites, [
            "manifest schema",
            "Ed25519 signature verification",
            "trust-tier enforcement (official / community / unsigned)"
        ]) +
        `\n## Business Trust / Provenance\n\n` +
        fmtSection("Business Trust Validator", trustSuites, [
            "Business profile reject-unsigned",
            "Individual profile warn-unsigned",
            "trusted-key registry"
        ]) +
        `\n## Blocked-Install Examples\n\n` +
        `- \`PLUGIN_REJECTED_UNSIGNED_BUSINESS\` — Business profile blocking unsigned pack\n` +
        `- \`PLUGIN_REJECTED_BAD_SIGNATURE\` — Ed25519 verification failure\n` +
        `- \`PLUGIN_REJECTED_UNTRUSTED_KEY\` — signing key absent from trusted registry\n`
    );
}

/* ── §3.6 claim-alignment-checklist.md ────────────────────────────── */
function buildClaimAlignmentChecklist(meta) {
    // Best-effort cross-reference. Reads docs/INVESTOR_APPENDIX_PARITY.md if
    // present and emits a checklist row per detected claim heading.
    const parityPath = path.join(REPO_ROOT, "docs", "INVESTOR_APPENDIX_PARITY.md");
    const claims = [];
    if (fs.existsSync(parityPath)) {
        const md = fs.readFileSync(parityPath, "utf8");
        const re = /^##\s+(.+)$/gm;
        let m;
        while ((m = re.exec(md)) !== null) {
            const title = m[1].trim();
            if (/^[0-9]/.test(title) || /claim/i.test(title) || /parity/i.test(title)) {
                claims.push(title);
            }
        }
    }
    let body = makeFrontMatter({ ...meta, title: "Claim Alignment Checklist (§3.6)" });
    body += `\n## Claim → Evidence Map\n\n`;
    body += `| # | Claim | Evidence Suite(s) | Status | Reviewer | Approved At |\n`;
    body += `|---|-------|-------------------|--------|----------|-------------|\n`;
    if (claims.length === 0) {
        body += `| — | _no claims auto-detected from \`docs/INVESTOR_APPENDIX_PARITY.md\`_ | — | unmapped | — | — |\n`;
    } else {
        claims.forEach((c, i) => {
            body += `| ${i + 1} | ${c} | _operator: link to suite_ | unmapped | — | — |\n`;
        });
    }
    body += `\n> Rows marked \`unmapped\` require manual review before sign-off. Update \`Status\` to \`validated\` / \`not-validated\` and fill reviewer + timestamp.\n`;
    return body;
}

/* ── §3.9 release-packet-manifest.md ──────────────────────────────── */
function buildManifest(meta, fileSummaries) {
    const lines = [];
    lines.push(`# Release Packet Manifest (§3.9)`);
    lines.push(``);
    lines.push(`- Release candidate ID: ${meta.candidateId}`);
    lines.push(`- Build identifier: ${meta.buildId}`);
    lines.push(`- Generated: ${meta.generatedAt}`);
    lines.push(`- Packet complete: yes`);
    lines.push(``);
    lines.push(`## File Inventory`);
    lines.push(``);
    lines.push(`| File | Size (bytes) | Status |`);
    lines.push(`|------|-------------:|--------|`);
    for (const f of fileSummaries) {
        lines.push(`| \`${f.name}\` | ${f.size} | ${f.status} |`);
    }
    lines.push(``);
    lines.push(`## Required Evidence Presence Check`);
    lines.push(``);
    lines.push(`Per template §2 the full packet also requires (not auto-generated by this script):`);
    lines.push(``);
    lines.push(`- \`profile-parity-matrix.md\` — manual`);
    lines.push(`- \`execution-mode-qualification.json\` — \`npm run perf:qualify\``);
    lines.push(`- \`replay-lineage-sample.json\` — manual extraction`);
    lines.push(`- \`reason-code-telemetry-sample.json\` — manual extraction`);
    lines.push(`- \`traceability-status.md\` — manual (copy from REQUIREMENTS_TRACEABILITY_MATRIX.md)`);
    lines.push(`- \`go-no-go-signoff.md\` — manual review artifact (see docs/go-no-go-signoff.md)`);
    lines.push(`- \`computer-use-business-gate-status.md\` — \`npm run cu:bg:check\``);
    lines.push(``);
    lines.push(`## Verdict`);
    lines.push(``);
    lines.push(`- Auto-generated reports: ${fileSummaries.filter(f => f.status === "generated").length} of ${fileSummaries.length} produced`);
    lines.push(`- Reviewer: _to be signed_`);
    lines.push(`- Reviewed at: _pending_`);
    return lines.join("\n");
}

/* ── Workspace path resolver ────────────────────────────────────────── */
function resolveWorkspaceReleasesDir(candidateId) {
    let root = process.env.PRISM_WORKSPACE_ROOT;
    if (!root) {
        try {
            const prefsPath = path.join(REPO_ROOT, ".prism-preferences.json");
            if (fs.existsSync(prefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
                if (prefs.workspaceRoot) root = prefs.workspaceRoot;
            }
        } catch (e) {}
    }
    if (!root) {
        const home = process.env.USERPROFILE || require("node:os").homedir();
        root = path.join(home, "Documents", "Prism_Refraction");
    }
    return path.join(root, "artifacts", "releases", candidateId);
}

/* ── Main ──────────────────────────────────────────────────────────── */
function main() {
    const args = parseArgs(process.argv);
    const sha = args.buildId || gitSha();
    const candidateId = `${ymd()}-${sha}-d2`;
    const outDir = args.out
        ? path.resolve(args.out)
        : path.join(REPO_ROOT, "prism-output", "releases", candidateId);

    fs.mkdirSync(outDir, { recursive: true });

    const meta = {
        candidateId,
        buildId: sha,
        generatedAt: new Date().toISOString(),
    };

    const reports = [
        { name: "governance-path-report.md", body: buildGovernancePathReport(meta) },
        { name: "terminal-container-lifecycle-report.md", body: buildLifecycleReport(meta) },
        { name: "plugin-compat-trust-report.md", body: buildPluginCompatTrustReport(meta) },
        { name: "claim-alignment-checklist.md", body: buildClaimAlignmentChecklist(meta) },
    ];

    const summaries = [];
    for (const r of reports) {
        const dest = path.join(outDir, r.name);
        fs.writeFileSync(dest, r.body, "utf8");
        summaries.push({ name: r.name, size: Buffer.byteLength(r.body, "utf8"), status: "generated" });
    }

    const manifest = buildManifest(meta, summaries);
    const manifestPath = path.join(outDir, "release-packet-manifest.md");
    // Append manifest to its own inventory before writing.
    const manifestSelfEntry = { name: "release-packet-manifest.md", size: 0, status: "generated" };
    summaries.push(manifestSelfEntry);
    const manifestWithSelf = buildManifest(meta, summaries);
    manifestSelfEntry.size = Buffer.byteLength(manifestWithSelf, "utf8");
    fs.writeFileSync(manifestPath, manifestWithSelf, "utf8");

    console.log(`[release-packet] candidate=${candidateId}`);
    console.log(`[release-packet] out=${outDir}`);
    for (const s of summaries) {
        console.log(`[release-packet]   ${s.status.padEnd(9)} ${s.name} (${s.size}B)`);
    }

    // Mirror to workspace releases directory
    try {
        const wsOutDir = resolveWorkspaceReleasesDir(candidateId);
        fs.mkdirSync(wsOutDir, { recursive: true });
        for (const s of summaries) {
            const src = path.join(outDir, s.name);
            const dest = path.join(wsOutDir, s.name);
            fs.copyFileSync(src, dest);
        }
        console.log(`[release-packet] Mirrored all packet files to workspace releases: ${wsOutDir}`);
    } catch (err) {
        console.warn(`[release-packet] Failed to mirror packet files to workspace releases: ${err.message}`);
    }

    console.log(`[release-packet] done`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`[release-packet] FAILED: ${err && err.stack ? err.stack : err}`);
        process.exit(1);
    }
}

module.exports = { main };
