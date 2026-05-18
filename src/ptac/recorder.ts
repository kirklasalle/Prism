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
    public readonly recordVideo: boolean;
    public readonly recordVideoFps: number;
    private readonly videoFrames: Array<{ stepId: string; relPath: string; observedAt: string; bracket: string }> = [];

    constructor(public readonly runDir: string, options: { demoRecording?: boolean; recordVideo?: boolean; recordVideoFps?: number } = {}) {
        mkdirSync(runDir, { recursive: true });
        this.screenshotsDir = join(runDir, "screenshots");
        mkdirSync(this.screenshotsDir, { recursive: true });
        this.stepsLogPath = join(runDir, "steps.jsonl");
        this.eventsLogPath = join(runDir, "events.jsonl");
        this.demoRecording = options.demoRecording === true;
        this.recordVideo = options.recordVideo === true;
        this.recordVideoFps = Math.max(1, Math.min(8, options.recordVideoFps ?? 2));
    }

    /** Persist a single screenshot and return its relative path. */
    recordScreenshot(stepId: string, png: Buffer, label: string): string {
        const seq = String(this.screenshotSeq++).padStart(4, "0");
        const digest = createHash("sha256").update(png).digest("hex").slice(0, 12);
        const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
        const filename = `${seq}_${stepId}_${safeLabel}_${digest}.png`;
        const abs = join(this.screenshotsDir, filename);
        writeFileSync(abs, png);
        const rel = `screenshots/${filename}`;
        if (this.recordVideo) {
            this.videoFrames.push({
                stepId,
                relPath: rel,
                observedAt: new Date().toISOString(),
                bracket: label,
            });
        }
        return rel;
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
        if (this.recordVideo && this.videoFrames.length > 0) {
            const manifest = {
                runId: run.runId,
                fps: this.recordVideoFps,
                frameCount: this.videoFrames.length,
                durationSec: Math.round((this.videoFrames.length / this.recordVideoFps) * 100) / 100,
                frames: this.videoFrames,
            };
            writeFileSync(
                join(this.runDir, "video-manifest.json"),
                JSON.stringify(manifest, null, 2),
                "utf8",
            );
            writeFileSync(
                join(this.runDir, "video.html"),
                renderVideoSlideshow(run.runId, this.videoFrames, this.recordVideoFps),
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

/* ── Video slideshow renderer (zero-dep, browser-playable) ───────────── */

/**
 * Render a self-contained `video.html` that plays the captured per-step
 * screenshots back as a timed slideshow at the configured FPS. The
 * slideshow is a single static HTML page with no external assets — it
 * loads the screenshot files relative to its own location, so the entire
 * `<runDir>/` folder is portable as one demo asset.
 *
 * The slideshow is **not** an MP4/WebM. Encoding video would require
 * pulling in ffmpeg or a wasm encoder; both violate the
 * zero-new-runtime-deps invariant. A timed-slideshow page is a valid
 * "demo recording" artifact — recordable to MP4 by any screen recorder
 * pointed at the page if a true video file is needed downstream.
 */
function renderVideoSlideshow(
    runId: string,
    frames: ReadonlyArray<{ stepId: string; relPath: string; observedAt: string; bracket: string }>,
    fps: number,
): string {
    const intervalMs = Math.max(1, Math.round(1000 / fps));
    const json = JSON.stringify(frames);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PTAC Demo — ${escapeHtml(runId)}</title>
<style>
  body{margin:0;background:#0e1116;color:#e6edf3;font-family:system-ui,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:16px}
  h1{margin:0 0 12px;font-size:16px}
  #stage{max-width:100%;max-height:80vh;border:1px solid #30363d;border-radius:6px;background:#000}
  #caption{margin-top:8px;font-size:13px;color:#8b949e;font-family:monospace}
  #controls{margin-top:12px;display:flex;gap:8px}
  button{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:13px}
  button:hover{background:#30363d}
  #progress{margin-top:6px;font-size:11px;color:#6e7681}
</style>
</head>
<body>
<h1>PTAC Demo Recording — ${escapeHtml(runId)} @ ${fps} fps</h1>
<img id="stage" alt="frame">
<div id="caption">—</div>
<div id="progress">—</div>
<div id="controls">
  <button id="play">▶ Play</button>
  <button id="pause">⏸ Pause</button>
  <button id="prev">◀ Prev</button>
  <button id="next">Next ▶</button>
  <button id="restart">↻ Restart</button>
</div>
<script>
const FRAMES = ${json};
const INTERVAL_MS = ${intervalMs};
let idx = 0;
let timer = null;
const stage = document.getElementById('stage');
const cap = document.getElementById('caption');
const prog = document.getElementById('progress');
function show(i){
  if (i < 0) i = 0;
  if (i >= FRAMES.length) i = FRAMES.length - 1;
  idx = i;
  const f = FRAMES[i];
  stage.src = f.relPath;
  cap.textContent = '[' + f.bracket + '] ' + f.stepId + ' — ' + f.observedAt;
  prog.textContent = 'frame ' + (i + 1) + ' / ' + FRAMES.length;
}
function tick(){
  if (idx + 1 >= FRAMES.length){ stop(); return; }
  show(idx + 1);
}
function play(){ if (!timer) timer = setInterval(tick, INTERVAL_MS); }
function stop(){ if (timer){ clearInterval(timer); timer = null; } }
document.getElementById('play').onclick = play;
document.getElementById('pause').onclick = stop;
document.getElementById('prev').onclick = () => { stop(); show(idx - 1); };
document.getElementById('next').onclick = () => { stop(); show(idx + 1); };
document.getElementById('restart').onclick = () => { stop(); show(0); play(); };
show(0);
play();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
