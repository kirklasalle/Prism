/**
 * PTAC scenario s18 — self-drive: plugin lifecycle (status + install
 * acceptance).
 *
 * Sandbox-safe smoke against the live plugin marketplace surface. The
 * scenario:
 *   1. verifies PAD integrity at boot,
 *   2. queries `/api/plugins/status` to confirm the marketplace is reachable
 *      and structurally sound,
 *   3. posts a minimal manifest to `/api/plugins/install` to confirm the
 *      install path validates manifests.
 *
 * No real plugin code is executed — the install path validates manifest
 * acceptance only, and `uninstall` / `toggle` require operator-supplied
 * environments and are exercised in tier-2 scenarios.
 *
 * Suites: full. `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S18: PtacScenario = {
    id: "s18-self-drive-plugin-lifecycle",
    title: "Self-drive — plugin marketplace lifecycle (status + install)",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "plugins", "lifecycle", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "plugins-status",
            label: "Plugin marketplace status reachable",
            kind: "pluginLifecycle",
            action: "status",
            pluginName: "ptac-sentinel",
            timeoutMs: 5_000,
        },
        {
            id: "plugin-install-accept",
            label: "Plugin install path accepts a minimal manifest",
            kind: "pluginLifecycle",
            action: "install",
            pluginName: "ptac-sentinel",
            manifest: {
                name: "ptac-sentinel",
                version: "0.0.0-ptac",
                description: "PTAC sandbox sentinel — install acceptance only",
                kind: "noop",
            },
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S18);
