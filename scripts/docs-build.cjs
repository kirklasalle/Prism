#!/usr/bin/env node
/**
 * scripts/docs-build.cjs
 *
 * Phase G — invokes MkDocs to build the external documentation site.
 * Falls back to an actionable error if MkDocs is not installed.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const configPath = path.resolve(process.cwd(), "docs", "site", "mkdocs.yml");
if (!fs.existsSync(configPath)) {
    console.error(`[docs:build] mkdocs.yml not found at ${configPath}`);
    process.exit(2);
}

// Try `mkdocs build` directly; if missing, suggest the install path.
const result = spawnSync("mkdocs", ["build", "-f", configPath], {
    stdio: "inherit",
    shell: true,
});

if (result.error || result.status === 127 || result.status === 9009) {
    console.error("[docs:build] MkDocs not found. Install with:");
    console.error("    .venv\\Scripts\\Activate.ps1");
    console.error("    pip install mkdocs mkdocs-material");
    console.error("Then re-run: npm run docs:build");
    process.exit(1);
}

process.exit(result.status ?? 0);
