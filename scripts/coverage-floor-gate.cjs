#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const summaryPath = path.resolve(process.cwd(), "coverage", "coverage-summary.json");

const requireFloor = process.argv.includes("--require-floor");

const defaultFloors = {
    lines: 58.0,
    statements: 57.5,
    functions: 68.0,
    branches: 33.5,
};

const floors = {
    lines: Number.parseFloat(process.env.PRISM_COVERAGE_FLOOR_LINES ?? String(defaultFloors.lines)),
    statements: Number.parseFloat(process.env.PRISM_COVERAGE_FLOOR_STATEMENTS ?? String(defaultFloors.statements)),
    functions: Number.parseFloat(process.env.PRISM_COVERAGE_FLOOR_FUNCTIONS ?? String(defaultFloors.functions)),
    branches: Number.parseFloat(process.env.PRISM_COVERAGE_FLOOR_BRANCHES ?? String(defaultFloors.branches)),
};

function hasConfiguredFloor() {
    return Object.values(floors).some((v) => Number.isFinite(v) && v > 0);
}

function formatPct(n) {
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

if (!fs.existsSync(summaryPath)) {
    console.error(`[coverage-floor-gate] Missing summary: ${summaryPath}`);
    process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const total = summary.total || {};
const actual = {
    lines: Number(total.lines?.pct ?? 0),
    statements: Number(total.statements?.pct ?? 0),
    functions: Number(total.functions?.pct ?? 0),
    branches: Number(total.branches?.pct ?? 0),
};

const failures = [];
for (const metric of Object.keys(floors)) {
    const floor = floors[metric];
    if (!Number.isFinite(floor) || floor <= 0) {
        continue;
    }
    const value = actual[metric];
    if (value < floor) {
        failures.push(`${metric}: actual=${formatPct(value)} floor=${formatPct(floor)}`);
    }
}

console.log(`[coverage-floor-gate] Coverage totals: lines=${formatPct(actual.lines)}% statements=${formatPct(actual.statements)}% functions=${formatPct(actual.functions)}% branches=${formatPct(actual.branches)}%`);

if (failures.length > 0) {
    console.error("[coverage-floor-gate] FAILED");
    for (const failure of failures) {
        console.error(`  - ${failure}`);
    }
    process.exit(1);
}

console.log("[coverage-floor-gate] PASSED");
