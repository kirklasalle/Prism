# Demonstration Mode Refreshed Audit

**Date:** 2026-08-01  
**Scope:** Interactive dashboard Demonstration Mode, with emphasis on Browser Control execution  
**Status:** Browser execution defect corrected and verified; broader full-suite simulation debt remains

## Follow-up error review

The latest generated report at `prism-output/demo-scenario-report.json` initially contained one failure:

```text
C9 Autonomous System Control - Mouse & Perception
Uncaught error: Tool not found: computer
43 passed, 1 failed
```

`ComputerUseTool` existed and was registered by the live dashboard, but the standalone 44-scenario runner only registered `builtinTools()`. That collection intentionally omits `ComputerUseTool` because DashboardService supplies its framebuffer dependency. The runner now explicitly registers `ComputerUseTool(new FramebufferCapture())`.

Demo failure observability was also strengthened:

- Interactive step failures continue to append to `logs/demo-errors.log` and emit `demo.step.failed` ActivityBus events.
- Scenario-runner failures now append structured entries to `logs/demo-scenario-errors.log` while retaining `prism-output/demo-scenario-full.log` and the JSON report.
- Scenario errors now emit `demo_diagnostics_log` with scenario ID, title, failed steps, message, and log path.
- Logs & Debug now mirrors failed `demo_step_result` and `demo_diagnostics_log` events into its live console as `[DEMO][ERROR]` entries.

After correction, the full cross-profile suite produced:

```text
Total: 44
Passed: 44
Failed: 0
Skipped: 0
Duration: 8.06s
```

The focused Category C run also confirmed C9 executed a real framebuffer screenshot, mouse move, and vision capture with 3/3 steps passing.

### Accessibility snapshot follow-up

The next live dashboard run correctly exposed another real failure instead of reporting false success:

```text
Demo browser-1 Step b1-4
get_accessibility_tree failed: Cannot read properties of undefined (reading 'snapshot')
```

The failure was recorded in all intended observability surfaces:

- Configured workspace file: `C:\Users\kirkl\Documents\Prism_Refraction\logs\demo-errors.log`
- Repository trace: `logs/prism-trace.log`
- Logs & Debug console error stream
- ActivityBus event: `demo.step.failed`, severity `error`, with demo ID, step ID, narration, and full output

Root cause: Playwright 1.58 no longer exposes the legacy `page.accessibility.snapshot()` API used by `BrowserSessionManager`. The implementation now uses the supported locator API:

```text
page.locator("body").ariaSnapshot({ timeout: 10000 })
```

Verification after correction:

```text
Browser Integration: 32 passing
Headed Example Domain ARIA snapshot: 232 characters
Headless Example Domain ARIA snapshot: 232 characters
Both snapshots contain "Example Domain"
```

## Executive finding

The operator screenshot was accurate: the overlay reported that `example.com` had been visited even though no browser session or screenshot existed. This was not a display-only problem. The demonstration engine called an unsupported browser action, ignored rejected tool results, invented a fallback session ID, and reported success without execution evidence.

The browser demonstration now launches or verifies both a headed and a headless Playwright session, performs each browser action against both sessions, rejects any failed tool result, saves both returned PNGs, and displays a verified headed screenshot in the narration overlay. After every browser step succeeds, Demo Mode closes only its owned headed session at the browser-to-computer transition; the headless evidence session and any operator-owned sessions remain available.

## Documents reviewed

- `docs/Prism Demonstration Mode - Critical Audit & Enhancement Plan` (latest interactive Demo Mode audit, 2026-08-01)
- `docs/PTAC_OPERATOR_DEMO_GUIDE.md` (canonical PTAC recorded-demo guide)
- `docs/archive/walkthrough-DEMO-computer_control_browser_crontrol_052526`
- Current implementation in `demonstration-engine.ts`, `demo-mode.js`, `browser-control-tool.ts`, `browser-session-manager.ts`, and dashboard Demo Mode routes

PTAC Operator Demo and dashboard Demonstration Mode are separate systems. PTAC is a gated acceptance/recording harness. The sidebar Demonstration Mode is an in-process guided showcase. Evidence or guarantees from PTAC do not prove that the sidebar demo executed.

## Root causes confirmed

| Severity | Finding | Evidence before correction |
|---|---|---|
| Critical | Invalid launch action | Demo Mode called `create_session`; BrowserControlTool supports `launch_session`. |
| Critical | False-positive success | `{ ok: false }` tool results were ignored, and the step retained `succeeded` status. |
| Critical | Fabricated session | Failed launch could assign the literal fallback ID `demo-browser-1`. |
| Critical | Screenshot never persisted | The tool returned base64 PNG bytes, but Demo Mode passed an unsupported `path` argument and never wrote the bytes. |
| High | Only one browser mode attempted | The engine stored one session ID and did not execute both headed and headless paths. |
| High | Screenshot preview was inaccessible | The HTTP dashboard attempted to render a local `file:///` URL. |
| High | Interaction choice was ignored | Every interaction selection performed the same fixed scroll. |
| Medium | Evidence vanished at completion | The engine closed its browser session immediately in `finally`, preventing post-run inspection. |
| Medium | Generic tool failures also appeared successful | The generic `tool:*` path converted exceptions and rejected results into successful output text. |
| Medium | Stale workspace path | Batch inspection referenced `D:\Projects\Prism\start_web.bat` instead of the active workspace. |

## Corrections implemented

1. Replaced the invalid browser action with `launch_session`.
2. Required one headed and one headless active session, reusing a matching session only when it genuinely exists.
3. Executed navigation, accessibility extraction, selected interaction, and screenshot capture against both session IDs.
4. Converted every rejected browser or generic tool result into a failed demonstration step.
5. Decoded screenshot base64 and wrote separate headed/headless PNG evidence under `workspace/Demo_results/screenshots/`.
6. Broadcast a verified PNG data URL for the overlay preview instead of relying on `file:///` access.
7. Expanded narration and output with mode, session ID, loaded URL/title, operation result, screenshot path, and byte count.
8. Closes the Demo-owned headed session after all browser demonstrations succeed, while retaining the headless evidence session and never closing operator-owned sessions.
9. Mapped interaction choices to real operations: heading click, link extraction, page metadata, or full-page capture.
10. Resolved `start_web.bat` from the PRISM installation root instead of the configured user workspace.
11. Reworded completion text so it does not claim that every action succeeded when the report may contain failures.
12. Added an Operator Activity timeline that retains each section, action, arguments, result, tab transition, cleanup action, and report/session event.
13. Creates a `Demo Output Session`, automatically opens it, and renders the self-contained HTML report in a sandboxed preview with embedded screenshot data.

## Verification evidence

### Automated regression

Focused DemonstrationEngine suite:

```text
tests 6
pass 6
fail 0
```

Final focused dual-browser regression after ownership and failure-propagation changes:

```text
tests 1
pass 1
fail 0
duration_ms 251.251
```

The regression asserts two `launch_session` calls (`false`, then `true`), two navigations, two screenshots, a real persisted screenshot path, and an inline PNG preview.

### Real Playwright adapter smoke check

The built BrowserControlTool was exercised directly on this workstation:

```text
headed  browser-c18ffab4  https://example.com/  Example Domain  11803 screenshot bytes
headless browser-a96bb999 https://example.com/  Example Domain  10399 screenshot bytes
activeSessions: 2 (one headed, one headless)
```

Both smoke-test sessions were closed after verification. The project build and editor diagnostics completed with no errors.

## Remaining audit risks

These items do not block the corrected Browser Control path, but they prevent a claim that the entire Full 43-Scenario Suite is production-real:

1. Several non-browser `demo:*` actions still emit illustrative ActivityBus events instead of invoking production agent, swarm, Guardian, and healing subsystems.
2. Integrated benchmark scenarios construct an isolated execution context; they do not necessarily operate the dashboard's live production subsystem instances.
3. Markdown and HTML report links still use local `file:///` URLs. The screenshots are persisted, but authenticated HTTP artifact routes would provide more reliable report access.
4. Step timeout uses `Promise.race` without cancelling the underlying tool operation. A timed-out operation may continue in the background.
5. The Demo-owned headless evidence session remains visible after successful completion until Stop/error cleanup or operator closure.

## Acceptance check for the dashboard

For the Browser Control portion to pass operator acceptance, the live dashboard must show all of the following during a new run:

- One Headed and one Headless session in Browser Control.
- Both sessions at the narrated URL.
- Output naming both session IDs and loaded page title.
- A visible screenshot in the Demo Mode output panel.
- Two PNG files for each screenshot step under `workspace/Demo_results/screenshots/`.
- The Demo-owned headed session closes after the final successful browser step when Demo Mode advances to Computer Control.
- The Operator Activity timeline shows each step's action, arguments, result, and view transition.
- A `Demo Output Session` opens at completion with the HTML report embedded in the chat output.
- A failed step, not `SUCCEEDED`, if either browser operation is rejected.

The browser implementation satisfies these conditions in build, regression, and direct adapter verification. A fresh dashboard process is required to load the rebuilt server and client assets.
