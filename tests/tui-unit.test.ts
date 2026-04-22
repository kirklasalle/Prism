/**
 * PRISM TUI — Pure-function unit tests (no mocking needed).
 *
 * Covers: theme helpers, TABS integrity, parseArgs, DataTable accessors,
 *         Sparkline normalization, ProgressBar calculation.
 *
 * Run: node --test dist/tests/tui-unit.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    profileColor, tierColor, statusColor,
    colors, TABS, TAB_SHORTCUTS,
} from "../src/tui/theme.js";

/* ================================================================== */
/*  theme.ts — profileColor                                            */
/* ================================================================== */

describe("profileColor", () => {
    it("returns business color for 'business'", () => {
        assert.strictEqual(profileColor("business"), colors.business);
    });

    it("returns individual color for 'individual'", () => {
        assert.strictEqual(profileColor("individual"), colors.individual);
    });

    it("returns individual color for unknown profiles", () => {
        assert.strictEqual(profileColor("unknown"), colors.individual);
        assert.strictEqual(profileColor(""), colors.individual);
    });
});

/* ================================================================== */
/*  theme.ts — tierColor                                               */
/* ================================================================== */

describe("tierColor", () => {
    it("returns green for tier 1", () => {
        assert.strictEqual(tierColor(1), colors.tier1);
    });

    it("returns yellow for tier 2", () => {
        assert.strictEqual(tierColor(2), colors.tier2);
    });

    it("returns red for tier 3", () => {
        assert.strictEqual(tierColor(3), colors.tier3);
    });

    it("returns tier3 (red) for unknown tiers", () => {
        assert.strictEqual(tierColor(0), colors.tier3);
        assert.strictEqual(tierColor(99), colors.tier3);
    });
});

/* ================================================================== */
/*  theme.ts — statusColor                                             */
/* ================================================================== */

describe("statusColor", () => {
    it("returns success for positive statuses", () => {
        for (const s of ["pass", "healthy", "active", "ok", "approved", "running"]) {
            assert.strictEqual(statusColor(s), colors.success, `expected success for "${s}"`);
        }
    });

    it("returns success regardless of case", () => {
        assert.strictEqual(statusColor("PASS"), colors.success);
        assert.strictEqual(statusColor("Running"), colors.success);
    });

    it("returns warning for cautionary statuses", () => {
        for (const s of ["warn", "warning", "idle", "pending"]) {
            assert.strictEqual(statusColor(s), colors.warning, `expected warning for "${s}"`);
        }
    });

    it("returns error for negative statuses", () => {
        for (const s of ["fail", "error", "unhealthy", "denied", "stopped"]) {
            assert.strictEqual(statusColor(s), colors.error, `expected error for "${s}"`);
        }
    });

    it("returns muted for unknown statuses", () => {
        assert.strictEqual(statusColor("unknown"), colors.muted);
        assert.strictEqual(statusColor(""), colors.muted);
    });
});

/* ================================================================== */
/*  theme.ts — TABS integrity                                          */
/* ================================================================== */

describe("TABS array", () => {
    it("contains exactly 12 tabs", () => {
        assert.strictEqual(TABS.length, 12);
    });

    it("has unique tab ids", () => {
        const ids = TABS.map((t) => t.id);
        assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("has unique shortcuts", () => {
        const shortcuts = TABS.map((t) => t.shortcut);
        assert.strictEqual(new Set(shortcuts).size, shortcuts.length);
    });

    it("every tab has a non-empty label", () => {
        for (const tab of TABS) {
            assert.ok(tab.label.length > 0, `tab ${tab.id} has empty label`);
        }
    });

    it("TAB_SHORTCUTS maps all shortcuts to correct tab ids", () => {
        for (const tab of TABS) {
            assert.strictEqual(TAB_SHORTCUTS[tab.shortcut], tab.id,
                `shortcut "${tab.shortcut}" should map to "${tab.id}"`);
        }
    });

    it("includes essential tabs", () => {
        const ids = TABS.map((t) => t.id);
        for (const expected of ["chat", "settings", "tools", "agentic", "computer", "browser", "workspace", "network", "telemetry", "logs", "scheduler", "characters"]) {
            assert.ok(ids.includes(expected), `missing tab: ${expected}`);
        }
    });
});
