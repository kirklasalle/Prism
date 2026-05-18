/**
 * PTAC type vocabulary.
 *
 * Every step in a PTAC scenario is typed by its `kind`. The orchestrator
 * dispatches on `kind` and produces a `PtacStepResult` per step, which the
 * recorder serializes into the run artifact bundle.
 */

/** Execution profile selected at run-time. */
export type PtacProfile = "sandbox" | "host";

/** Suite preset — controls which scenarios run. */
export type PtacSuite = "fast" | "full" | "demo" | "custom";

/* ── Step variants ─────────────────────────────────────────────────────── */

export interface StepBase {
    /** Stable ID for this step within its scenario. */
    readonly id: string;
    /** Human-readable label rendered in the report. */
    readonly label: string;
    /** Per-step timeout (ms). Default 30 000. */
    readonly timeoutMs?: number;
}

export interface SetupWizardStep extends StepBase {
    readonly kind: "setupWizard";
    readonly profile: "individual" | "business";
    readonly operatorEmail: string;
    /** When true, the wizard is expected to BLOCK at the CAC step. */
    readonly expectCacBlock?: boolean;
}

export interface ChatStep extends StepBase {
    readonly kind: "chat";
    readonly sessionId?: string;
    readonly prompt: string;
    /** Expected lowest tier required to satisfy this prompt (assertion). */
    readonly expectedTier?: 1 | 2 | 3;
    readonly expectApprovalRequired?: boolean;
    /**
     * When true, the orchestrator asserts the response body carries a
     * structured deny payload (`denied: true` plus a non-empty `reason_code`).
     * Used by Tier-3 deny scenarios where the policy engine must refuse the
     * prompt outright (no approval queue entry, no tool execution). Mutually
     * exclusive with `expectApprovalRequired` at the scenario level.
     */
    readonly expectDeny?: boolean;
}

export interface ApproveAtStep extends StepBase {
    readonly kind: "approveAt";
    /** Match against the queued approval's reasonCode. */
    readonly reasonCodeMatcher: string | RegExp;
    readonly decision: "approve" | "deny";
}

export interface RunToolStep extends StepBase {
    readonly kind: "runTool";
    readonly toolName: string;
    readonly args: Record<string, unknown>;
}

export interface AssertEventStep extends StepBase {
    readonly kind: "assertEvent";
    readonly layer: string;
    readonly operation: string;
    readonly within?: { sinceStepId: string };
}

export interface ClickAtStep extends StepBase {
    readonly kind: "clickAt";
    readonly x: number;
    readonly y: number;
    readonly button?: "left" | "right" | "double";
}

export interface TypeTextStep extends StepBase {
    readonly kind: "typeText";
    readonly text: string;
}

export interface ScreenshotDiffStep extends StepBase {
    readonly kind: "screenshotDiff";
    /** Path to a reference image relative to the scenario file. */
    readonly reference: string;
    /** Allowed pixel-difference ratio [0..1]. Default 0.02. */
    readonly tolerance?: number;
}

export interface TerminalExecStep extends StepBase {
    readonly kind: "terminalExec";
    readonly sessionId?: string;
    readonly command: string;
    readonly expectExitCode?: number;
}

export interface ContainerExecStep extends StepBase {
    readonly kind: "containerExec";
    readonly image: string;
    readonly command: string[];
    readonly expectExitCode?: number;
}

export interface OAuthFlowCanaryStep extends StepBase {
    readonly kind: "oauthFlowCanary";
    readonly provider: "gmail" | "outlook" | "google-calendar";
    readonly action: "send" | "list" | "read";
}

export interface SrFanOutStep extends StepBase {
    readonly kind: "srFanOut";
    /** Chat session id under which to configure SR. Required. */
    readonly sessionId: string;
    /**
     * Prompt used in the per-step report. SR is exercised as a smoke against
     * the live `/api/sr/configure` + `/api/sr/cost-estimate` (or `/status`)
     * surface; no real LLM call is dispatched in sandbox runs (no provider
     * keys are required).
     */
    readonly prompt: string;
    readonly leftSlot: string;
    readonly rightSlot: string;
    /**
     * Optional triad — when ALL FOUR provider+model fields are supplied, the
     * orchestrator drives `/api/sr/configure` then asserts
     * `/api/sr/cost-estimate` returns a numeric estimate. When omitted, the
     * orchestrator falls back to a `/api/sr/status` smoke that confirms the
     * endpoint is reachable and returns a structurally sound payload.
     */
    readonly leftProviderId?: string;
    readonly leftModel?: string;
    readonly rightProviderId?: string;
    readonly rightModel?: string;
}

/**
 * Plugin lifecycle step — drives `/api/plugins/{install|status}` (and the
 * existing `/api/plugins/:name/toggle` route) to verify the plugin
 * marketplace + activation surface end-to-end. Sandbox-safe: no real plugin
 * code is executed; the install path validates manifest acceptance.
 */
export interface PluginLifecycleStep extends StepBase {
    readonly kind: "pluginLifecycle";
    readonly action: "install" | "toggle" | "uninstall" | "status";
    /** Plugin id / name. Required for install / toggle / uninstall. */
    readonly pluginName: string;
    /**
     * Optional manifest payload for `action: "install"`. When omitted the
     * orchestrator posts a minimal `{ name }` body which the dashboard
     * accepts as a placeholder install.
     */
    readonly manifest?: Record<string, unknown>;
    /** Asserted substring in the response body. */
    readonly expectContains?: string;
}

export interface PadHashVerifyStep extends StepBase {
    readonly kind: "padHashVerify";
    /** When true, the step expects a tampered file → expects FAIL. */
    readonly expectTamper?: boolean;
}

/* ── Self-drive steps (Phase R PTAC self-drive expansion) ─────────────────
 *
 * `browserDrive` and `computerUse` lift PTAC out of the pure-HTTP era and
 * let it drive Prism's own UI through Prism's own automation primitives —
 * the same path real users hit. This is the harness that proves "Prism can
 * test Prism on the desktop" end-to-end.
 *
 * Safety:
 *   - `browserDrive` runs in headless Playwright by default and is safe in
 *     CI (the browser-control-tool ships its own kill switch and per-action
 *     governance). Scenarios that use it set `requiresHost: false`.
 *   - `computerUse` operates the real desktop (Win32 SendInput / mouse_event
 *     / framebuffer capture). It is gated behind the env var
 *     `PRISM_PTAC_SAFE=1` AND `requiresHost: true` so it never runs
 *     automatically in CI. The orchestrator refuses to dispatch a
 *     `computerUse` step unless both gates are satisfied and surfaces a
 *     clear "skipped: computer-use safety gate not satisfied" advisory.
 *
 * Self-drive steps are dispatched against the running dashboard the
 * orchestrator already targets, so a single PTAC run can interleave HTTP
 * verification and live UI verification in one ordered sequence.
 */

/**
 * Browser-drive step — invokes the dashboard's browser-control-tool via
 * `POST /api/browser/*` to drive a real Playwright session. The action is
 * one of the curated browser primitives (`launch`, `navigate`, `click`,
 * `type`, `screenshot`, `assertText`, `assertSelector`).
 */
export interface BrowserDriveStep extends StepBase {
    readonly kind: "browserDrive";
    /** Curated sub-action; mirrors browser-control-tool's governed surface. */
    readonly action:
    | "launch"
    | "close"
    | "navigate"
    | "click"
    | "type"
    | "screenshot"
    | "assertText"
    | "assertSelector"
    | "waitForSelector";
    /** Browser session id. `launch` allocates one; subsequent steps reuse it. */
    readonly sessionId?: string;
    /** Action-specific arguments — URL, selector, text, etc. */
    readonly args?: Record<string, unknown>;
    /** When set, the orchestrator asserts this exact value appears in the response body. */
    readonly expectContains?: string;
}

/**
 * Computer-use step — invokes the dashboard's computer-use-tool via
 * `POST /api/computer/*` to drive the real desktop input/output stack
 * (mouse, keyboard, screenshot). HOST-ONLY — gated behind `PRISM_PTAC_SAFE=1`.
 */
export interface ComputerUseStep extends StepBase {
    readonly kind: "computerUse";
    /** Curated sub-action; mirrors computer-use-tool's governed surface. */
    readonly action:
    | "screenshot"
    | "mouse_move"
    | "mouse_click"
    | "type"
    | "key";
    /** Action-specific arguments — coordinates, text, key chord, etc. */
    readonly args?: Record<string, unknown>;
    /** When set, the orchestrator asserts this exact value appears in the response body. */
    readonly expectContains?: string;
}

/**
 * Real-PTY lifecycle step (PTAC s26).
 *
 * Drives `TerminalSessionAdapter` IN-PROCESS — no HTTP round-trip — to
 * verify the v0.17 real-PTY pause/resume codepath end-to-end. Gated by
 * `PRISM_PTAC_SAFE=1` because it spawns a real OS child process. The
 * orchestrator instantiates the adapter once per step against a temp
 * SQLite database; nothing leaks across scenarios.
 */
export interface RealPtyLifecycleStep extends StepBase {
    readonly kind: "realPtyLifecycle";
    /** Shell to spawn for the verification (default: cmd.exe on Win32, /bin/sh otherwise). */
    readonly shell?: string;
    /** Smoke command to send before pause (default: `echo prism-ptac-s26`). */
    readonly probeCommand?: string;
}

/**
 * Real-Docker lifecycle step (PTAC s27).
 *
 * Drives `DockerContainerAdapter` IN-PROCESS to verify the v0.18
 * real-Docker codepath: ping → image-pull → create → start → exec →
 * snapshot → revert → stop → destroy. Gated by `PRISM_PTAC_SAFE=1` AND
 * Docker Engine reachability; if either is missing the step is recorded
 * as a structured skip (not a failure).
 */
export interface RealDockerLifecycleStep extends StepBase {
    readonly kind: "realDockerLifecycle";
    /** Image to pull (default: alpine:latest). */
    readonly image?: string;
}

export type PtacStep =
    | SetupWizardStep
    | ChatStep
    | ApproveAtStep
    | RunToolStep
    | AssertEventStep
    | ClickAtStep
    | TypeTextStep
    | ScreenshotDiffStep
    | TerminalExecStep
    | ContainerExecStep
    | OAuthFlowCanaryStep
    | SrFanOutStep
    | PluginLifecycleStep
    | PadHashVerifyStep
    | BrowserDriveStep
    | ComputerUseStep
    | RealPtyLifecycleStep
    | RealDockerLifecycleStep;

/* ── Scenario & run plumbing ───────────────────────────────────────────── */

export interface PtacScenario {
    readonly id: string;
    readonly title: string;
    /** Suites this scenario participates in (e.g. ["fast","full"]). */
    readonly suites: readonly PtacSuite[];
    /** When `true`, scenario must run on the host profile (e.g. real input injection). */
    readonly requiresHost?: boolean;
    /** Tags for filtering at the CLI (e.g. `--tag=oauth`). */
    readonly tags?: readonly string[];
    readonly steps: readonly PtacStep[];
}

export interface PtacRunRequest {
    readonly profile: PtacProfile;
    readonly suite: PtacSuite;
    readonly scenarioIds?: readonly string[];
    readonly outputDir: string;
    readonly dashboardBaseUrl: string;
    readonly authToken?: string;
    /** Skip the host-profile confirmation prompt (set by --i-understand-host-control). */
    readonly hostConfirmed?: boolean;
    /** Idle watchdog timeout in seconds (host profile). */
    readonly idleTimeoutS?: number;
    /**
     * When true, the recorder additionally emits `transcript.json` and
     * `transcript.txt` — a deterministic, voiceover-ready narration of every
     * step in the run, suitable for promo / customer demo asset capture.
     */
    readonly demoRecording?: boolean;
    /**
     * When true (and gated by both `PRISM_PTAC_SAFE=1` and
     * `PRISM_PTAC_RECORD_VIDEO=1` at the CLI), the recorder additionally
     * emits a self-contained `video.html` slideshow + `video-manifest.json`
     * built from the timestamped per-step screenshots. Zero new runtime
     * dependencies — the slideshow is plain HTML+JS that browsers play.
     */
    readonly recordVideo?: boolean;
    /** Frames-per-second for the video slideshow (default 2). */
    readonly recordVideoFps?: number;
}

export interface PtacStepResult {
    readonly stepId: string;
    readonly kind: PtacStep["kind"];
    readonly status: "passed" | "failed" | "skipped" | "aborted";
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
    readonly evidence: {
        readonly screenshots: readonly string[];
        readonly logs: readonly string[];
        readonly accountabilityHash?: string;
    };
    readonly error?: { readonly message: string; readonly stack?: string };
}

export interface PtacScenarioResult {
    readonly scenarioId: string;
    readonly title: string;
    readonly status: "passed" | "failed" | "aborted";
    readonly steps: readonly PtacStepResult[];
}

export interface PtacRunResult {
    readonly runId: string;
    readonly profile: PtacProfile;
    readonly suite: PtacSuite;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly status: "passed" | "failed" | "aborted";
    readonly scenarios: readonly PtacScenarioResult[];
    readonly reportHtmlPath: string;
    readonly outputDir: string;
}
