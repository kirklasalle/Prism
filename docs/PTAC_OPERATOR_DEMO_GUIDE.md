# PTAC Operator Demo — Walkthrough & Reference

**Status**: canonical. Introduced in PRISM v0.20.0. Operator-facing UI panel + dashboard endpoints + slideshow viewer added in v0.20.1.

The **PTAC Operator Demo** is PRISM's headline self-drive demonstration. The platform exercises its own dashboard end-to-end — chat, approval queue, computer-use, browser, real PTY, real Docker — capturing every step as evidence and rendering the result as a portable, browser-playable HTML slideshow you can replay or share.

This document is the single source of truth for what the demo does, how to enable it, what artefacts it produces, and where each piece of the implementation lives.

---

## 1. What is "PTAC"?

**PTAC** = **PRISM Test & Acceptance Conductor**. It is the in-tree self-drive harness in [src/ptac/](../src/ptac/). PTAC scenarios are TypeScript files that declare a sequence of steps the orchestrator dispatches against a running dashboard or directly against in-process adapters. PTAC was originally built as a CI gating tool; the **Operator Demo** is a curated subset of PTAC scenarios with screen recording enabled, run through a one-click button on the Computer Control tab.

PTAC step kinds currently dispatched (excerpt — full list in [src/ptac/types.ts](../src/ptac/types.ts)):

- `chat` — drives `/api/chat/send` and asserts response shape.
- `approveAt` — polls `/api/approval/pending` and approves/denies on match.
- `assertEvent` — reads `/api/events`, filters by layer + operation.
- `browserDrive` — drives the BrowserControlTool.
- `computerUse` — synthesises mouse/keyboard input via the platform backend.
- `padHashVerify` — verifies the Permanent Active Directives hash on disk matches the embedded build hash.
- **`realPtyLifecycle`** *(v0.20)* — drives `TerminalSessionAdapter` through start → pause → resume → exec → stop against a real `node-pty` child.
- **`realDockerLifecycle`** *(v0.20)* — drives `DockerContainerAdapter` through pull → create → start → exec → snapshot → revert → stop → destroy against the local Docker Engine API.

---

## 2. The three gates

The demo endpoint is **triple-gated**. All three environment variables must be set to `1` before the demo button activates and POSTs are accepted by `/api/ptac/demo/run`. Each gate exists for a distinct reason and the layered defence is intentional:

| Gate | Purpose | Set when |
|------|---------|----------|
| `PRISM_PTAC_OPERATOR_DEMO=1` | Admin opt-in. The endpoint and UI panel are entirely disabled when this is unset, so no demo traffic is possible in default deployments. | Set in deployment config / `.env` for hosts the operator is allowed to demo from. |
| `PRISM_PTAC_SAFE=1` | Host-prepared confirmation. Asserts the operator has prepared the host for self-drive (browser tools blocked elsewhere, scratch session, kill switch armed). Same gate used by the computer-use safety pattern. | Set immediately before a recording session, unset afterwards. |
| `PRISM_PTAC_RECORD_VIDEO=1` | Recording opt-in. Asserts the operator has explicitly chosen to write recording artefacts to disk (screenshots, slideshow). | Set immediately before a recording session, unset afterwards. |

The dashboard panel calls `GET /api/ptac/demo/feature-flags` (no auth-bypass — uses the standard dashboard auth) and renders a live gate matrix:

```
✓ Operator demo opt-in       (PRISM_PTAC_OPERATOR_DEMO=1)
○ Host prepared (safe gate)  (PRISM_PTAC_SAFE=1)
○ Recording opt-in           (PRISM_PTAC_RECORD_VIDEO=1)
```

The "Start Recorded Run" button is disabled until all three are green.

---

## 3. Quick start — operator walkthrough

### 3.1 One-time admin setup

In your deployment's `.env` (or PowerShell session, or systemd unit, or however you configure environment for the dashboard):

```sh
PRISM_PTAC_OPERATOR_DEMO=1
```

This unhides the panel. The button stays disabled until the per-session gates are also set.

### 3.2 Per-recording session

Before each recording session, set the two per-session gates and start the dashboard:

**PowerShell**:

```pwsh
$env:PRISM_PTAC_OPERATOR_DEMO = "1"
$env:PRISM_PTAC_SAFE = "1"
$env:PRISM_PTAC_RECORD_VIDEO = "1"
.\start_web.bat
```

**bash / zsh**:

```sh
export PRISM_PTAC_OPERATOR_DEMO=1
export PRISM_PTAC_SAFE=1
export PRISM_PTAC_RECORD_VIDEO=1
./start_web.sh
```

Open the dashboard, navigate to the **Computer Control** tab, and scroll to the **🎬 PTAC Operator Demo** panel. The status pill should read `ready` and the Start button should be enabled.

### 3.3 Run it

1. Pick a suite from the dropdown:
   - **demo** *(default)* — curated showcase.
   - **fast** — smoke (~2 min).
   - **full** — every scenario incl. host-gated `s26` (real PTY) and `s27` (real Docker).
2. Click **▶ Start Recorded Run**. The dashboard POSTs to `/api/ptac/demo/run`, which spawns a detached `node dist/src/ptac/cli.js` child with `--demo-recording --record-video`. Returns `202` with the spawned `pid`.
3. The runs list polls every 5 seconds for two minutes. As soon as the recorder writes `summary.json` and `video-manifest.json`, your run appears at the top of the list.
4. Click **▶ Slideshow** on the run row to open the recording in a new tab. Click **📄 Report** for the full PTAC HTML report with per-step evidence.

### 3.4 Wind down

After the recording session, **unset the per-session gates** so the host returns to its safe default:

```pwsh
Remove-Item Env:PRISM_PTAC_SAFE
Remove-Item Env:PRISM_PTAC_RECORD_VIDEO
```

Or for bash:

```sh
unset PRISM_PTAC_SAFE PRISM_PTAC_RECORD_VIDEO
```

`PRISM_PTAC_OPERATOR_DEMO` can stay set on operator workstations; the per-session gates are the meaningful defence.

---

## 4. CLI alternative

The dashboard endpoint is a thin wrapper around the existing PTAC CLI. Anything the button does, you can do from a terminal:

```sh
# All three gates required for --record-video to be accepted.
PRISM_PTAC_SAFE=1 PRISM_PTAC_RECORD_VIDEO=1 \
  node dist/src/ptac/cli.js \
    --profile=sandbox \
    --suite=demo \
    --demo-recording \
    --record-video \
    --record-video-fps=2
```

Per-flag reference:

| Flag | Purpose |
|------|---------|
| `--profile=sandbox\|host` | `host` synthesises real input on your desktop and requires `--i-understand-host-control`. `sandbox` is safe by default. |
| `--suite=fast\|demo\|full\|custom` | Which scenarios to run. `custom` requires `--scenario=<id>` (repeatable). |
| `--scenario=<id>` | Run a specific scenario (repeatable). E.g. `--scenario=s26-real-pty-lifecycle`. |
| `--demo-recording` | Emit `transcript.json` + `transcript.txt` (deterministic narration). |
| `--record-video` | Emit `video-manifest.json` + `video.html` (slideshow). Dual-gated by `PRISM_PTAC_SAFE=1` + `PRISM_PTAC_RECORD_VIDEO=1`. |
| `--record-video-fps=<n>` | Slideshow FPS, clamped 1..8, default 2. |
| `--output=<path>` | Override output dir. Default: `$PRISM_PTAC_OUTPUT_DIR` or `prism-output/ptac/`. |

---

## 5. Artefacts produced

Each run lands in `<outputDir>/<runId>/` with a deterministic content-addressed layout. Files are never overwritten in place.

```
prism-output/ptac/<runId>/
├── summary.json            # Run-level result tree (PtacRunResult)
├── steps.jsonl             # One JSON line per step (PtacStepResult)
├── events.jsonl            # Activity-bus events observed during each step
├── report.html             # Self-contained HTML report with per-step evidence
├── transcript.json         # Demo narration (when --demo-recording)
├── transcript.txt          # Plain-text narration (when --demo-recording)
├── video-manifest.json     # Frame index (when --record-video)
├── video.html              # Browser-playable slideshow (when --record-video)
└── screenshots/
    └── <seq>_<stepId>_<label>_<sha>.png
```

### 5.1 Why slideshow and not MP4?

The slideshow is **deliberately not** an MP4 / WebM. Encoding video would require pulling in ffmpeg or a wasm encoder, both of which violate PRISM's zero-new-runtime-deps invariant. The slideshow is a single static HTML page with all frames inlined as JSON; it loads the screenshot PNGs relative to its own folder, so the entire `<runId>/` directory is **portable as one demo asset** — copy the folder anywhere and `video.html` plays back. Any screen recorder pointed at the page produces a true MP4 when one is needed downstream.

### 5.2 Slideshow controls

The slideshow auto-plays at `INTERVAL_MS = round(1000 / fps)`. Controls:

- **▶ Play** / **⏸ Pause** — toggle playback.
- **◀ Prev** / **Next ▶** — single-step.
- **↻ Restart** — rewind to frame 0 and play.

Each frame shows the `[bracket] stepId — observedAt` caption and the `frame N / total` progress.

---

## 6. Endpoint reference

All endpoints below live under the existing dashboard auth scope.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/ptac/demo/feature-flags` | Always 200. Reports `enabled`, per-gate booleans, `ready`, and an advisory string. The UI polls this every 30 s while the panel is visible. |
| `POST` | `/api/ptac/demo/run` | Triple-gated. Accepts `{ suite?: "fast"|"demo"|"full" }`. Spawns a detached PTAC CLI child with`--demo-recording --record-video`. Returns`202 { status, pid, suite, advisory }`. Each missing gate returns`403` with a precise advisory. |
| `GET`  | `/api/ptac/demo/runs` | Lists all runs in the output dir, newest first. Each entry: `{ runId, mtime, hasVideo, frameCount, durationSec, fps, status, scenarioCount }`. |
| `GET`  | `/api/ptac/demo/runs/:runId/video.html` | Serves the slideshow. |
| `GET`  | `/api/ptac/demo/runs/:runId/video-manifest.json` | Serves the manifest. |
| `GET`  | `/api/ptac/demo/runs/:runId/report.html` | Serves the full PTAC report. |
| `GET`  | `/api/ptac/demo/runs/:runId/summary.json` | Serves the summary. |
| `GET`  | `/api/ptac/demo/runs/:runId/screenshots/:filename` | Serves a single PNG frame. |

Path traversal defence: every path is normalised, every `..` segment rejected, the resolved path is required to start with the output directory, and the file suffix is whitelisted to the artefact list above. Anything else returns `400` or `403`.

---

## 7. Implementation map

If you need to extend or debug the demo, these are the files and what they do:

**Server-side**:

- [src/ptac/types.ts](../src/ptac/types.ts) — step kinds incl. `realPtyLifecycle`, `realDockerLifecycle`, `PtacRunRequest.recordVideo`.
- [src/ptac/orchestrator.ts](../src/ptac/orchestrator.ts) — dispatch table; constructs `PtacRecorder` with the video options.
- [src/ptac/recorder.ts](../src/ptac/recorder.ts) — artefact recorder; emits `video-manifest.json` + `video.html`.
- [src/ptac/scenarios/s26-real-pty-lifecycle.ts](../src/ptac/scenarios/s26-real-pty-lifecycle.ts) — real PTY pause/resume scenario.
- [src/ptac/scenarios/s27-real-docker-lifecycle.ts](../src/ptac/scenarios/s27-real-docker-lifecycle.ts) — real Docker lifecycle scenario.
- [src/ptac/cli.ts](../src/ptac/cli.ts) — `--record-video` + `--record-video-fps` flags with dual-env-gate.
- [src/core/operator/dashboard-service.ts](../src/core/operator/dashboard-service.ts) — feature-flags / runs list / artefact serving / spawn endpoint.

**Frontend**:

- [src/core/operator/public/tab-computer.html](../src/core/operator/public/tab-computer.html) — additive `<section id="ptac-demo-panel">` at the bottom of the Computer Control tab.
- [src/core/operator/public/tab-ptac-demo.js](../src/core/operator/public/tab-ptac-demo.js) — panel hydration, gate matrix renderer, run-list renderer, click handler.
- [src/core/operator/templates/dashboard.ts](../src/core/operator/templates/dashboard.ts) — adds the `<script src="/public/tab-ptac-demo.js">` tag.

**Tests**:

- [tests/ptac-recorder-video.test.ts](../tests/ptac-recorder-video.test.ts) — unit-level verification that the recorder emits `video-manifest.json` + `video.html` only when `recordVideo: true`, with correct frame count, duration, and `INTERVAL_MS`.
- [tests/ptac-orchestrator.test.ts](../tests/ptac-orchestrator.test.ts) — registry integrity + dispatch contract.

**Configuration**:

- [.env.example](../.env.example) — documents `PRISM_PTAC_OPERATOR_DEMO`, `PRISM_PTAC_SAFE`, `PRISM_PTAC_RECORD_VIDEO`, `PRISM_PTAC_OUTPUT_DIR`.

---

## 8. Frontend Protection compliance

The **Frontend Protection Guarantee** ([Permanent_Active_Directives.txt](../Permanent_Active_Directives.txt)) requires UI changes to be additive only — never remove, replace, or destructively modify existing components. The PTAC Operator Demo complies in full:

- The panel is appended to [tab-computer.html](../src/core/operator/public/tab-computer.html) as a new `<section>` at the end of the existing layout. No existing markup was touched.
- The controller [tab-ptac-demo.js](../src/core/operator/public/tab-ptac-demo.js) is loaded as a separate `<script>` tag added after the existing `dashboard-app.js`. It does not import or modify the dashboard-app module graph.
- All endpoints under `/api/ptac/demo/*` are net-new. No existing route handler was modified.
- When `PRISM_PTAC_OPERATOR_DEMO` is unset, the panel renders a single advisory line and the rest of the Computer Control tab is unaffected.

---

## 9. Security posture

| Concern | Mitigation |
|---------|------------|
| Endpoint reachable in default deployments | Triple env gate. Default deployment has zero gates set; endpoint returns 403. |
| Path traversal via `:runId` | Each segment must not be `..` or contain `\0`; resolved path must start with the output dir; filename suffix whitelisted. |
| Arbitrary file upload via spawn args | The endpoint accepts only `{ suite }` in the body; suite is whitelisted to `fast`/`demo`/`full`. CLI flags are constants. |
| Resource exhaustion via repeated spawns | UI button is disabled for 30 seconds after each spawn. Spawned children are detached + `unref`'d so they do not pin the dashboard event loop. |
| Recording leaks sensitive screen content | Operator opts in per-session via `PRISM_PTAC_RECORD_VIDEO=1`; recordings live under the operator-controlled output directory; nothing is uploaded anywhere by PRISM. |
| Untrusted recording playback | `video.html` is served with `Cache-Control: no-store` from the dashboard's authenticated origin; frames are static PNGs; the embedded JSON is content-addressed by SHA-256 prefix in the filename. |

---

## 10. FAQ

**Can I run the demo without the dashboard button?**
Yes. Use the CLI invocation in §4. The button is a convenience.

**Why is `s27` (real Docker) a separate scenario instead of replacing the simulated container scenario?**
Because the simulated `ContainerSandboxAdapter` ships in every PRISM build and is what most users exercise. `s27` is a verification scenario that runs only with `PRISM_PTAC_SAFE=1` on hosts that have a Docker socket. Both run side-by-side under `--suite=full`.

**The slideshow is too fast / too slow.**
Pass `--record-video-fps=<n>` (1..8). The dashboard does not yet expose this; use the CLI for now.

**Can I share a recording?**
Yes — copy the entire `<runId>/` folder. The slideshow is portable because all frame paths are relative.

**Where is the demo registered to play with `--suite=demo`?**
`PtacScenario.suites` arrays in each scenario file. See [src/ptac/scenarios/](../src/ptac/scenarios/).

---

*Last updated: v0.20.1, May 2026. Owner: PTAC team.*
