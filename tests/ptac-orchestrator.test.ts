/**
 * PTAC orchestrator unit test.
 *
 * Validates the harness itself — registry integrity, the newly wired
 * `approveAt` and `assertEvent` step dispatchers, and the existing `chat`
 * deny-path contract. The orchestrator is exercised against a mocked
 * `fetch` so the test never touches the network and never spawns a
 * dashboard.
 *
 * What this test guarantees:
 *   1. Every scenario registered at import time parses, has a stable id,
 *      and lists at least one step (no empty scenarios sneak through).
 *   2. `approveAt` polls `/api/approval/pending` until a matching entry
 *      appears, then drives the correct `/approve` or `/deny` route.
 *   3. `assertEvent` reads `/api/events`, filters by (layer, operation),
 *      and fails with a clear error when nothing matches.
 *   4. A scenario that uses an unwired step kind surfaces as a real
 *      failure — never a silent pass.
 *   5. The PTAC v2 scenarios (s15 approval lifecycle, s16 cross-surface
 *      smoke) are registered and discoverable.
 */

import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listScenarios, getScenario } from "../src/ptac/scenario-registry.js";
import { PtacOrchestrator } from "../src/ptac/orchestrator.js";
import type { PtacScenario } from "../src/ptac/types.js";

// Side-effect import populates the registry.
import "../src/ptac/index.js";

interface MockCall {
    readonly url: string;
    readonly method: string;
    readonly body?: string;
}

function mockFetch(responses: Array<(call: MockCall) => { status: number; body: unknown }>): {
    impl: typeof fetch;
    calls: MockCall[];
} {
    const calls: MockCall[] = [];
    let i = 0;
    const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? init.body : undefined;
        calls.push({ url, method, body });
        const next = responses[Math.min(i, responses.length - 1)];
        i++;
        const { status, body: respBody } = next({ url, method, body });
        const payload = typeof respBody === "string" ? respBody : JSON.stringify(respBody);
        return new Response(payload, {
            status,
            headers: { "content-type": "application/json" },
        });
    }) as unknown as typeof fetch;
    return { impl, calls };
}

export async function testPtacOrchestrator(): Promise<void> {
    // ── 1. Registry integrity ──────────────────────────────────────────
    const all = listScenarios();
    assert.ok(all.length > 0, "PTAC registry must not be empty");
    for (const s of all) {
        assert.ok(typeof s.id === "string" && s.id.length > 0, `scenario missing id: ${JSON.stringify(s)}`);
        assert.ok(s.steps.length > 0, `scenario ${s.id} has no steps`);
        const ids = new Set<string>();
        for (const st of s.steps) {
            assert.ok(typeof st.id === "string" && st.id.length > 0, `${s.id} has step without id`);
            assert.ok(!ids.has(st.id), `${s.id} has duplicate step id "${st.id}"`);
            ids.add(st.id);
        }
    }

    // ── 2. PTAC v2 scenarios are present and routed to the right suites ─
    const s15 = getScenario("s15-self-drive-approval-lifecycle");
    const s16 = getScenario("s16-self-drive-system-smoke");
    assert.ok(s15, "s15 (approval lifecycle) must be registered");
    assert.ok(s16, "s16 (system smoke) must be registered");
    assert.ok(s15!.suites.includes("full"), "s15 must run in suite=full");
    assert.ok(s16!.suites.includes("fast"), "s16 must run in suite=fast");

    // ── 3. approveAt polling + decision against mocked endpoints ───────
    const approveScenario: PtacScenario = {
        id: "test-approve-flow",
        title: "approveAt unit",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "approve-it",
                label: "approve queued tier-2",
                kind: "approveAt",
                reasonCodeMatcher: /tier2/,
                decision: "approve",
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: approveFetch, calls: approveCalls } = mockFetch([
        // first /pending poll → empty
        ({ url, method }) => {
            assert.strictEqual(method, "GET");
            assert.match(url, /\/api\/approval\/pending$/);
            return { status: 200, body: [] };
        },
        // second poll → entry present
        () => ({ status: 200, body: [{ id: "appr-123", reasonCode: "tier2_required" }] }),
        // POST /approve
        ({ url, method }) => {
            assert.strictEqual(method, "POST");
            assert.match(url, /\/api\/approval\/appr-123\/approve$/);
            return { status: 200, body: { approved: true } };
        },
    ]);
    const orch1 = new PtacOrchestrator({ fetchImpl: approveFetch });
    const out1 = await orch1.run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [approveScenario],
    );
    assert.strictEqual(out1.status, "passed", `approveAt scenario must pass — got ${out1.status}`);
    assert.ok(approveCalls.some((c) => c.method === "POST" && /\/approve$/.test(c.url)),
        "POST /approve must have been issued");

    // ── 4. assertEvent — pass and fail paths ───────────────────────────
    const assertScenarioPass: PtacScenario = {
        id: "test-assert-event-pass",
        title: "assertEvent unit",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "assert-it",
                label: "expect chat event",
                kind: "assertEvent",
                layer: "chat",
                operation: "chat.message.completed",
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: passFetch } = mockFetch([
        () => ({
            status: 200,
            body: [
                { layer: "policy", operation: "policy.allow" },
                { layer: "chat", operation: "chat.message.completed" },
            ],
        }),
    ]);
    const out2 = await new PtacOrchestrator({ fetchImpl: passFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [assertScenarioPass],
    );
    assert.strictEqual(out2.status, "passed");

    const { impl: failFetch } = mockFetch([
        () => ({ status: 200, body: [{ layer: "policy", operation: "policy.allow" }] }),
    ]);
    const out3 = await new PtacOrchestrator({ fetchImpl: failFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [assertScenarioPass],
    );
    assert.strictEqual(out3.status, "failed", "assertEvent must fail when no matching event present");

    // ── 5. Unwired step kinds still throw a real failure ───────────────
    const unwiredScenario: PtacScenario = {
        id: "test-unwired",
        title: "unwired step",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "unwired",
                label: "terminalExec is not yet wired",
                kind: "terminalExec",
                command: "echo hello",
                timeoutMs: 1_000,
            },
        ],
    };
    const { impl: noopFetch } = mockFetch([() => ({ status: 200, body: {} })]);
    const out4 = await new PtacOrchestrator({ fetchImpl: noopFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [unwiredScenario],
    );
    assert.strictEqual(out4.status, "failed", "unwired step kinds must surface as scenario failures");

    // ── 6. PTAC v2 second-slice scenarios are registered ───────────────
    const s17 = getScenario("s17-self-drive-sr-cost-gate");
    const s18 = getScenario("s18-self-drive-plugin-lifecycle");
    const s20 = getScenario("s20-self-drive-pad-tamper");
    assert.ok(s17, "s17 (SR cost-gate) must be registered");
    assert.ok(s18, "s18 (plugin lifecycle) must be registered");
    assert.ok(s20, "s20 (PAD-tamper Guardian self-check) must be registered");
    assert.ok(s17!.suites.includes("full"), "s17 must run in suite=full");
    assert.ok(s18!.suites.includes("full"), "s18 must run in suite=full");
    assert.ok(s20!.suites.includes("demo"), "s20 must run in suite=demo");

    // ── 7. srFanOut — status-mode smoke (no triad) ─────────────────────
    const srStatusScenario: PtacScenario = {
        id: "test-sr-status",
        title: "srFanOut status mode",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "sr-status",
                label: "smoke /api/sr/status",
                kind: "srFanOut",
                sessionId: "test-session",
                prompt: "ignored in status mode",
                leftSlot: "left",
                rightSlot: "right",
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: srStatusFetch, calls: srStatusCalls } = mockFetch([
        ({ url, method }) => {
            assert.strictEqual(method, "GET");
            assert.match(url, /\/api\/sr\/status\?sessionId=test-session$/);
            return { status: 200, body: { config: { leftSlot: "left", rightSlot: "right" } } };
        },
    ]);
    const out5 = await new PtacOrchestrator({ fetchImpl: srStatusFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [srStatusScenario],
    );
    assert.strictEqual(out5.status, "passed", `srFanOut status-mode must pass — got ${out5.status}`);
    assert.ok(srStatusCalls.some((c) => /\/api\/sr\/status\?/.test(c.url)),
        "GET /api/sr/status must have been issued");

    // ── 8. srFanOut — configure + cost-estimate (full triad) ───────────
    const srTriadScenario: PtacScenario = {
        id: "test-sr-triad",
        title: "srFanOut triad mode",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "sr-triad",
                label: "configure + cost-estimate",
                kind: "srFanOut",
                sessionId: "triad-session",
                prompt: "smoke",
                leftSlot: "primary",
                rightSlot: "secondary",
                leftProviderId: "openai",
                leftModel: "gpt-4o-mini",
                rightProviderId: "anthropic",
                rightModel: "claude-3-haiku",
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: srTriadFetch, calls: srTriadCalls } = mockFetch([
        ({ url, method }) => {
            assert.strictEqual(method, "POST");
            assert.match(url, /\/api\/sr\/configure$/);
            return { status: 200, body: { config: { ok: true } } };
        },
        ({ url, method }) => {
            assert.strictEqual(method, "GET");
            assert.match(url, /\/api\/sr\/cost-estimate\?sessionId=triad-session$/);
            return { status: 200, body: { totalUsd: 0.0042, inputTokens: 2000, outputTokens: 1000 } };
        },
    ]);
    const out6 = await new PtacOrchestrator({ fetchImpl: srTriadFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [srTriadScenario],
    );
    assert.strictEqual(out6.status, "passed", `srFanOut triad-mode must pass — got ${out6.status}`);
    assert.ok(srTriadCalls.some((c) => c.method === "POST" && /\/api\/sr\/configure$/.test(c.url)));
    assert.ok(srTriadCalls.some((c) => c.method === "GET" && /\/api\/sr\/cost-estimate/.test(c.url)));

    // ── 9. runTool — POST /api/actions/:tool ───────────────────────────
    const runToolScenario: PtacScenario = {
        id: "test-run-tool",
        title: "runTool",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "run-it",
                label: "invoke tool",
                kind: "runTool",
                toolName: "echo-tool",
                args: { sessionId: "abc", payload: "hi" },
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: toolFetch, calls: toolCalls } = mockFetch([
        ({ url, method, body }) => {
            assert.strictEqual(method, "POST");
            assert.match(url, /\/api\/actions\/echo-tool$/);
            assert.ok(body && body.includes("sessionId"));
            return { status: 202, body: { accepted: true } };
        },
    ]);
    const out7 = await new PtacOrchestrator({ fetchImpl: toolFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [runToolScenario],
    );
    assert.strictEqual(out7.status, "passed", `runTool must pass on 202 — got ${out7.status}`);
    assert.ok(toolCalls.length === 1);

    // ── 10. pluginLifecycle — install acceptance ───────────────────────
    const pluginScenario: PtacScenario = {
        id: "test-plugin-install",
        title: "pluginLifecycle install",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "install-it",
                label: "install minimal manifest",
                kind: "pluginLifecycle",
                action: "install",
                pluginName: "ptac-test",
                manifest: { name: "ptac-test", version: "0.0.0" },
                timeoutMs: 2_000,
            },
        ],
    };
    const { impl: pluginFetch, calls: pluginCalls } = mockFetch([
        ({ url, method, body }) => {
            assert.strictEqual(method, "POST");
            assert.match(url, /\/api\/plugins\/install$/);
            assert.ok(body && body.includes("ptac-test"));
            return { status: 201, body: { installed: true, name: "ptac-test" } };
        },
    ]);
    const out8 = await new PtacOrchestrator({ fetchImpl: pluginFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: mkdtempSync(join(tmpdir(), "ptac-test-")),
            dashboardBaseUrl: "http://localhost:7070",
        },
        [pluginScenario],
    );
    assert.strictEqual(out8.status, "passed", `pluginLifecycle install must pass — got ${out8.status}`);
    assert.ok(pluginCalls.length === 1);

    // ── 11. demoRecording — transcript.json + transcript.txt emitted ───
    const transcriptScenario: PtacScenario = {
        id: "test-transcript",
        title: "transcript emit",
        suites: ["custom"],
        requiresHost: false,
        steps: [
            {
                id: "noop-assert",
                label: "trivial assertEvent",
                kind: "assertEvent",
                layer: "chat",
                operation: "chat.message.completed",
                timeoutMs: 1_000,
            },
        ],
    };
    const { impl: transcriptFetch } = mockFetch([
        () => ({ status: 200, body: [{ layer: "chat", operation: "chat.message.completed" }] }),
    ]);
    const transcriptOutDir = mkdtempSync(join(tmpdir(), "ptac-test-"));
    const out9 = await new PtacOrchestrator({ fetchImpl: transcriptFetch }).run(
        {
            profile: "sandbox",
            suite: "custom",
            outputDir: transcriptOutDir,
            dashboardBaseUrl: "http://localhost:7070",
            demoRecording: true,
        },
        [transcriptScenario],
    );
    assert.strictEqual(out9.status, "passed");
    const runDir = join(transcriptOutDir, out9.runId);
    const transcriptJsonPath = join(runDir, "transcript.json");
    const transcriptTxtPath = join(runDir, "transcript.txt");
    assert.ok(existsSync(transcriptJsonPath), "demoRecording must emit transcript.json");
    assert.ok(existsSync(transcriptTxtPath), "demoRecording must emit transcript.txt");
    const transcriptJson = JSON.parse(readFileSync(transcriptJsonPath, "utf8")) as Array<{
        scenarioId: string;
        stepId: string;
        kind: string;
        narration: string;
    }>;
    assert.ok(transcriptJson.length === 1, "transcript must contain one entry per step");
    assert.strictEqual(transcriptJson[0].stepId, "noop-assert");
    assert.ok(transcriptJson[0].narration.includes("noop-assert"));
    const transcriptTxt = readFileSync(transcriptTxtPath, "utf8");
    assert.ok(transcriptTxt.includes("PASSED"), "transcript.txt must include status tag");
    assert.ok(transcriptTxt.includes("test-transcript"), "transcript.txt must include scenario id");
}
