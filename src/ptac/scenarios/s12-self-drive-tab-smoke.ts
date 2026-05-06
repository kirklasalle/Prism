/**
 * PTAC scenario s12 — self-drive: Tab smoke pass across dashboard surfaces.
 *
 * Drives every primary tab/route on the running dashboard via the live
 * Playwright session and asserts each surface mounts without error. This
 * is the broad "did anything regress visually" smoke pass; finer-grained
 * tab assertions live in dedicated scenarios.
 *
 * Strategy: use `evaluate` (the browser-control-tool's JS evaluator) to
 * read `location.hash`-style routes if the dashboard uses them, OR to
 * click each `[data-tab-id]` element in turn. Since the dashboard's
 * exact tab DOM contract is owned by the front-end team and the
 * Frontend Protection Guarantee forbids us mutating it from PTAC, this
 * scenario sticks to the safest contract: navigate to each top-level
 * route URL the dashboard exposes and assert `#app` remains mounted.
 *
 * Step plan:
 *
 *   1. PAD integrity                                       (padHashVerify)
 *   2. Launch browser                                      (browserDrive: launch)
 *   3. For each route: navigate + assert #app             (browserDrive: navigate / waitForSelector)
 *      - /
 *      - /#/dashboard
 *      - /#/wizard
 *      - /#/logs
 *      - /#/governance
 *   4. Close                                               (browserDrive: close)
 *
 * Suites: full. NOT in `fast` (multiple page loads) NOT in `demo`.
 * `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S12: PtacScenario = {
    id: "s12-self-drive-tab-smoke",
    title: "Self-drive — Browser smoke-tests every primary dashboard route",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "browser", "smoke", "regression"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "browser-launch",
            label: "Launch a headless browser session",
            kind: "browserDrive",
            action: "launch",
            args: { headless: true },
            timeoutMs: 30_000,
        },
        {
            id: "nav-root",
            label: "Navigate to /",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/" },
            timeoutMs: 15_000,
        },
        {
            id: "wait-root",
            label: "Assert #app mounted on /",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "nav-dashboard",
            label: "Navigate to /#/dashboard",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/#/dashboard" },
            timeoutMs: 15_000,
        },
        {
            id: "wait-dashboard",
            label: "Assert #app mounted on /#/dashboard",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "nav-wizard",
            label: "Navigate to /#/wizard",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/#/wizard" },
            timeoutMs: 15_000,
        },
        {
            id: "wait-wizard",
            label: "Assert #app mounted on /#/wizard",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "nav-logs",
            label: "Navigate to /#/logs",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/#/logs" },
            timeoutMs: 15_000,
        },
        {
            id: "wait-logs",
            label: "Assert #app mounted on /#/logs",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "nav-governance",
            label: "Navigate to /#/governance",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/#/governance" },
            timeoutMs: 15_000,
        },
        {
            id: "wait-governance",
            label: "Assert #app mounted on /#/governance",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "browser-close",
            label: "Close the browser session",
            kind: "browserDrive",
            action: "close",
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S12);
