/**
 * PTAC recorder.
 *
 * Captures a deterministic record of every step in a PTAC run:
 *
 *   - per-step screenshots (PNG) saved under `<outputDir>/<runId>/screenshots/`
 *   - per-step JSON lines under `<outputDir>/<runId>/steps.jsonl`
 *   - the activity-bus events observed during each step under `events.jsonl`
 *   - a final `report.html` rendered from the in-memory result tree, suitable
 *     for sharing as the demo asset or attaching as a CI artifact
 *
 * The recorder is content-addressed: each artifact's filename embeds a
 * sequence number plus the SHA-256 prefix of its bytes, making run output
 * trivially diffable across runs. No bytes are ever overwritten in place.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type {
    PtacRunResult,
    PtacScenarioResult,
    PtacStepResult,
} from "./types.js";

export class PtacRecorder {
    private readonly stepsLogPath: string;
    private readonly eventsLogPath: string;
    private readonly screenshotsDir: string;
    private screenshotSeq = 0;
    public readonly demoRecording: boolean;

    constructor(public readonly runDir: string, options: { demoRecording?: boolean } = {}) {
        mkdirSync(runDir, { recursive: true });
        this.screenshotsDir = join(runDir, "screenshots");
        mkdirSync(this.screenshotsDir, { recursive: true });
        this.stepsLogPath = join(runDir, "steps.jsonl");
        this.eventsLogPath = join(runDir, "events.jsonl");
        this.demoRecording = options.demoRecording === true;
    }

    /** Persist a single screenshot and return its relative path. */
    recordScreenshot(stepId: string, png: Buffer, label: string): string {
        const seq = String(this.screenshotSeq++).padStart(4, "0");
        const digest = createHash("sha256").update(png).digest("hex").slice(0, 12);
        const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
        const filename = `${seq}_${stepId}_${safeLabel}_${digest}.png`;
        const abs = join(this.screenshotsDir, filename);
        writeFileSync(abs, png);
        return `screenshots/${filename}`;
    }

    /** Append a step result to `steps.jsonl`. */
    recordStep(result: PtacStepResult): void {
        appendFileSync(this.stepsLogPath, JSON.stringify(result) + "\n", "utf8");
    }

    /** Append an activity-bus event observed during a step. */
    recordEvent(stepId: string, event: unknown): void {
        appendFileSync(
            this.eventsLogPath,
            JSON.stringify({ stepId, observedAt: new Date().toISOString(), event }) + "\n",
            "utf8",
        );
    }

    /** Emit `report.html` summarizing the run. */
    finalize(run: PtacRunResult): string {
        const html = renderReport(run);
        const path = join(this.runDir, "report.html");
        writeFileSync(path, html, "utf8");
        const summaryPath = join(this.runDir, "summary.json");
        writeFileSync(summaryPath, JSON.stringify(run, null, 2), "utf8");
        if (this.demoRecording) {
            const transcript = buildTranscript(run);
            writeFileSync(
                join(this.runDir, "transcript.json"),
                JSON.stringify(transcript, null, 2),
                "utf8",
            );
            writeFileSync(
                join(this.runDir, "transcript.txt"),
                transcript.map(formatTranscriptLine).join("\n") + "\n",
                "utf8",
            );
        }
        return path;
    }
}

/* ── Demo-recording transcript (deterministic narration) ─────────────── */

interface TranscriptEntry {
    readonly scenarioId: string;
    readonly stepId: string;
    readonly kind: string;
    readonly status: string;
    readonly durationMs: number;
    readonly narration: string;
}

function buildTranscript(run: PtacRunResult): readonly TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];
    for (const sc of run.scenarios) {
        for (const st of sc.steps) {
            entries.push({
                scenarioId: sc.scenarioId,
                stepId: st.stepId,
                kind: st.kind,
                status: st.status,
                durationMs: st.durationMs,
                narration: narrateStep(sc.scenarioId, st),
            });
        }
    }
    return entries;
}

function narrateStep(scenarioId: string, st: PtacStepResult): string {
    // Deterministic — derived only from kind + stepId + status.
    const verb: Record<string, string> = {
        navigate: "navigates to",
        click: "clicks",
        type: "types into",
        wait: "waits for",
        assertText: "asserts text on",
        assertEvent: "verifies event",
        approveAt: "approves the action gate at",
        runTool: "invokes tool",
        srFanOut: "drives a Spectrum-Refraction fan-out for",
        pluginLifecycle: "exercises plugin lifecycle on",
        padHashVerify: "verifies PAD hash for",
        browserDrive: "drives the browser action",
        computerUse: "exercises computer-use action",
        clickAt: "clicks at",
        typeText: "types text",
        screenshotDiff: "captures a screenshot diff",
        terminalExec: "runs a sandboxed command",
        containerExec: "runs a containerized command",
        oauthFlowCanary: "drives an OAuth canary",
    };
    const action = verb[st.kind] ?? `runs ${st.kind}`;
    const outcome = st.status === "passed"
        ? "and succeeds"
        : st.status === "failed"
            ? "and fails"
            : `(${st.status})`;
    return `In scenario ${scenarioId}, step ${st.stepId} ${action} the dashboard ${outcome}.`;
}

function formatTranscriptLine(e: TranscriptEntry): string {
    const tag = `[${e.status.toUpperCase().padEnd(7)}]`;
    return `${tag} ${e.scenarioId} · ${e.kind} · ${e.stepId} (${e.durationMs}ms) — ${e.narration}`;
}

/* ── Report renderer (intentionally dependency-free) ─────────────────── */

function renderReport(run: PtacRunResult): string {
    const escape = (s: string): string =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const statusClass = (s: string): string => `status-${s}`;
    const scenarios = run.scenarios.map((sc) => renderScenario(sc, escape, statusClass)).join("\n");
    const passCount = run.scenarios.filter((s) => s.status === "passed").length;
    const failCount = run.scenarios.filter((s) => s.status === "failed").length;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PTAC Run ${escape(run.runId)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;background:#0e1116;color:#e6edf3}
  h1{margin:0 0 8px}
  .meta{color:#8b949e;font-size:13px;margin-bottom:24px}
  .scenario{border:1px solid #30363d;border-radius:6px;margin-bottom:16px;overflow:hidden}
  .scenario-head{padding:12px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;background:#161b22}
  .scenario-body{padding:0 16px 12px}
  .step{padding:8px 0;border-bottom:1px solid #21262d;display:grid;grid-template-columns:80px 1fr 100px 80px;gap:12px;align-items:center}
  .step:last-child{border-bottom:none}
  .step-screens img{max-width:240px;max-height:160px;border:1px solid #30363d;border-radius:4px;margin-right:6px}
  .status-passed{color:#56d364}
  .status-failed{color:#f85149}
  .status-skipped{color:#8b949e}
  .status-aborted{color:#d29922}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;background:#21262d;font-size:12px}
  pre{background:#0d1117;border:1px solid #30363d;padding:8px;border-radius:4px;overflow:auto;font-size:12px}
</style>
</head>
<body>
<h1>PTAC Run <span class="${statusClass(run.status)}">${escape(run.status.toUpperCase())}</span></h1>
<div class="meta">
  Run ID: <code>${escape(run.runId)}</code> ·
  Profile: <span class="pill">${escape(run.profile)}</span> ·
  Suite: <span class="pill">${escape(run.suite)}</span> ·
  ${escape(run.startedAt)} → ${escape(run.endedAt)} ·
  ${passCount} passed / ${failCount} failed / ${run.scenarios.length} total
</div>
${scenarios}
</body>
</html>`;
}

function renderScenario(
    sc: PtacScenarioResult,
    escape: (s: string) => string,
    statusClass: (s: string) => string,
): string {
    const steps = sc.steps.map((st) => renderStep(st, escape, statusClass)).join("\n");
    return `<section class="scenario">
  <header class="scenario-head">
    <span>${escape(sc.title)} <span class="pill">${escape(sc.scenarioId)}</span></span>
    <span class="${statusClass(sc.status)}">${escape(sc.status.toUpperCase())}</span>
  </header>
  <div class="scenario-body">${steps}</div>
</section>`;
}

function renderStep(
    st: PtacStepResult,
    escape: (s: string) => string,
    statusClass: (s: string) => string,
): string {
    const screens = st.evidence.screenshots
        .map((p) => `<img src="${escape(p)}" alt="${escape(p)}">`)
        .join("");
    const err = st.error
        ? `<pre>${escape(st.error.message)}\n${escape(st.error.stack ?? "")}</pre>`
        : "";
    return `<div class="step">
    <span class="pill">${escape(st.kind)}</span>
    <div>
      <div><strong>${escape(st.stepId)}</strong></div>
      <div class="step-screens">${screens}</div>
      ${err}
    </div>
    <div>${st.durationMs} ms</div>
    <div class="${statusClass(st.status)}">${escape(st.status.toUpperCase())}</div>
  </div>`;
}
