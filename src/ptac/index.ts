/**
 * PTAC — Prism Testing & Active Control
 *
 * PTAC is a Prism-driven harness that uses Prism's own public HTTP and
 * WebSocket APIs to execute end-to-end test scenarios against a live Prism
 * dashboard. It serves three production purposes:
 *
 *   1. Self-test gate: passing the full PTAC suite is the entry criterion to
 *      "user testing ready" and "business deployment ready."
 *   2. Live demo asset: each run produces a deterministic recording (per-step
 *      screenshots, action log, accountability chain, optional video) that
 *      doubles as an investor / customer demo.
 *   3. Continuous regression cover: the GitHub Actions self-hosted Windows
 *      runner runs `--suite=fast` per PR and `--suite=full` nightly.
 *
 * Two safety profiles ship from day one:
 *
 *   - sandbox (default): runs inside Windows Sandbox / Hyper-V VM / Linux
 *     Xvfb container. Zero risk to the operator's host.
 *   - host: runs on the operator desktop, gated behind explicit confirmation,
 *     a global panic chord (`Ctrl+Alt+Shift+Escape` by default), a tray icon,
 *     a 60s focus-idle watchdog, and a Tier-3 approval requirement for every
 *     destructive action.
 *
 * This module exports the public surface; concrete pieces live alongside:
 *
 *   - types.ts            — typed step engine vocabulary
 *   - orchestrator.ts     — drives Prism via public APIs
 *   - kill-switch.ts      — global panic chord + tray + abort plumbing
 *   - recorder.ts         — per-step capture & report.html emission
 *   - scenario-registry.ts — registers scenarios shipped with the runtime
 *   - cli.ts              — `npm run ptac:sandbox|ptac:host|ptac:demo` entry
 *
 * Design rule: PTAC drives Prism through its **public** HTTP/WS surface, never
 * by reaching into internal modules. This guarantees that a passing PTAC run
 * exercises the same surface real users hit.
 */

export type {
    PtacProfile,
    PtacStep,
    PtacScenario,
    PtacRunRequest,
    PtacRunResult,
    PtacStepResult,
    PtacSuite,
} from "./types.js";
export { PtacOrchestrator } from "./orchestrator.js";
export { PtacKillSwitch } from "./kill-switch.js";
export { PtacRecorder } from "./recorder.js";
export { listScenarios, getScenario, registerScenario } from "./scenario-registry.js";

// Side-effect imports: each scenario file calls `registerScenario(...)` on
// load. Adding a new scenario requires exactly one line here so the registry
// remains the single source of truth.
import "./scenarios/s01-setup-individual.js";
import "./scenarios/s02-setup-business-cac-block.js";
import "./scenarios/s03-chat-tier1-capability.js";
import "./scenarios/s04-setup-individual-cac-block.js";
import "./scenarios/s05-chat-tier2-approval-required.js";
import "./scenarios/s06-chat-tier3-deny.js";
// Self-drive expansion (s07–s14) — drives the live POST /api/chat handler,
// the browser-control-tool, and (host-only) the computer-use-tool.
import "./scenarios/s07-self-drive-chat-tier1.js";
import "./scenarios/s08-self-drive-tier2-approval.js";
import "./scenarios/s09-self-drive-tier3-deny.js";
import "./scenarios/s10-self-drive-browser-shell.js";
import "./scenarios/s11-self-drive-wizard-render.js";
import "./scenarios/s12-self-drive-tab-smoke.js";
import "./scenarios/s13-self-drive-desktop-screenshot.js";
import "./scenarios/s14-self-drive-kill-switch-ui.js";
// PTAC v2 expansion — full approval lifecycle + cross-surface smoke. These
// scenarios exercise the newly wired `approveAt` and `assertEvent` step
// kinds and close the audit-flagged gap where PTAC could verify enqueue
// but not resolve.
import "./scenarios/s15-self-drive-approval-lifecycle.js";
import "./scenarios/s16-self-drive-system-smoke.js";
// PTAC v2 — second slice. Closes the SR cost-gate, plugin lifecycle, and
// Guardian PAD self-check coverage gaps flagged in the 2026-Q3 audit.
import "./scenarios/s17-self-drive-sr-cost-gate.js";
import "./scenarios/s18-self-drive-plugin-lifecycle.js";
import "./scenarios/s20-self-drive-pad-tamper.js";
