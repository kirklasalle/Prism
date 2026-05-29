#!/usr/bin/env node
/**
 * PRISM Credentials & Secrets Static Scanner
 * 
 * Scans all workspace files (excluding common dependency and build folders) for
 * hardcoded API keys, private keys, authentication tokens, and credentials.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "prism-output");

// Heuristic secret detection regular expressions
const SECRET_PATTERNS = [
    { name: "PEM/DER Private Key", regex: /-----BEGIN\s+([A-Z0-9\s_]+)\s+PRIVATE\s+KEY-----/i },
    { name: "Generic API Key (sk-...) / OpenAI / Anthropic Key", regex: /\b(sk-[a-zA-Z0-9]{20,50})\b/ },
    { name: "Slack Token", regex: /\bxox[bapr]-[0-9]{12}-[a-zA-Z0-9]{12,24}\b/ },
    { name: "JWT Token Signature", regex: /\beyJhbGciOi[a-zA-Z0-9-_]+\.eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\b/ },
    { name: "Google API Key", regex: /\bAIza[yA-Z0-9_-]{35}\b/ },
    { name: "AWS Access Key ID", regex: /\bAKIA[A-Z0-9]{16}\b/ },
    { name: "GitHub OAuth Token / PAT", regex: /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,255}\b/ },
    { name: "Hardcoded Password / Key Assignment", regex: /(?:secret|password|passwd|privatekey|jwtsecret|authkey|api_key)\s*=\s*['"][a-zA-Z0-9]{16,80}['"]/i }
];

function listFiles(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (/^(node_modules|dist|prism-output|\.venv|\.git|coverage|state|logs|tmp)$/.test(e.name)) {
                continue;
            }
            files.push(...listFiles(p));
        } else if (e.isFile()) {
            // Only scan text-based files
            if (/\.(ts|tsx|js|jsx|cjs|mjs|json|md|txt|html|css|sh|bat|yml|yaml|ini|env|example)$/.test(e.name)) {
                files.push(p);
            }
        }
    }
    return files;
}

function scanFile(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch {
        return [];
    }

    const lines = content.split(/\r?\n/);
    const findings = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip check comments that explicitly suppress detections if any
        if (line.includes("@prism-secrets-allow")) continue;

        for (const pattern of SECRET_PATTERNS) {
            if (pattern.regex.test(line)) {
                // Avoid matching common false positives like import lines or env definitions
                if (line.includes("process.env") || line.includes("dotenv") || line.includes("config.env")) {
                    continue;
                }
                
                findings.push({
                    file: path.relative(REPO_ROOT, filePath).replaceAll("\\", "/"),
                    line: i + 1,
                    patternName: pattern.name,
                    snippet: line.trim().slice(0, 100)
                });
            }
        }
    }
    return findings;
}

function main() {
    console.log("==================================================");
    console.log("  PRISM CREDENTIALS & SECRETS STATIC SCANNER      ");
    console.log("==================================================");

    const files = listFiles(REPO_ROOT);
    console.log(`[secrets-scan] Scanning ${files.length} text files in the workspace...`);

    const allFindings = [];
    for (const file of files) {
        const fileFindings = scanFile(file);
        if (fileFindings.length > 0) {
            allFindings.push(...fileFindings);
        }
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const summaryPath = path.join(OUTPUT_DIR, "secrets-scan-summary.json");
    
    const summary = {
        timestamp: new Date().toISOString(),
        scannedFiles: files.length,
        clean: allFindings.length === 0,
        findingsCount: allFindings.length,
        findings: allFindings
    };

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    if (allFindings.length === 0) {
        console.log("\n\x1b[32m[SUCCESS] No hardcoded secrets or credential signatures found.\x1b[0m");
        console.log(`[secrets-scan] Verified clean state. Saved summary to ${summaryPath}`);
        console.log("==================================================");
        process.exit(0);
    } else {
        console.warn(`\n\x1b[33m[WARNING] Found ${allFindings.length} potential secrets or key patterns:\x1b[0m`);
        for (const f of allFindings) {
            console.warn(`- \x1b[36m${f.file}:${f.line}\x1b[0m [${f.patternName}]`);
            console.warn(`    Snippet: \x1b[90m${f.snippet}\x1b[0m`);
        }
        console.warn(`\n[secrets-scan] Saved scan summary to ${summaryPath}`);
        console.warn("==================================================");
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
