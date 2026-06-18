import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import {
    DashboardService,
    type TelemetrySummary,
} from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

export async function testDashboardService(): Promise<void> {
    // Isolate from host environment — provider API keys in env would cause
    // the "API key is missing" assertion to fail.
    const savedEnvKeys: Record<string, string | undefined> = {};
    const providerEnvVars = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
        "MISTRAL_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY",
        "XAI_API_KEY", "OPENROUTER_API_KEY",
    ];
    for (const key of providerEnvVars) {
        savedEnvKeys[key] = process.env[key];
        delete process.env[key];
    }
    // Disable auth gate for integration tests
    const savedAuthDisabled = process.env.PRISM_AUTH_DISABLED;
    process.env.PRISM_AUTH_DISABLED = "true";
    // Isolate from any persisted developer/host preferences (e.g. a
    // `.prism-preferences.json` with `defaultCharacterId: "aria-individual"`
    // would leak into in-memory test fixtures and trigger character_not_found
    // when the test creates a session without an explicit character).
    const savedPrefsPath = process.env.PRISM_PREFERENCES_PATH;
    const isolatedPrefsDir = mkdtempSync(join(tmpdir(), "prism-prefs-test-"));
    const isolatedPrefsFile = join(isolatedPrefsDir, "prefs.json");
    process.env.PRISM_PREFERENCES_PATH = isolatedPrefsFile;
    // Seed setupComplete=true so GET / serves the dashboard shell instead of
    // redirecting to the setup wizard. The test asserts on dashboard shell HTML.
    writeFileSync(isolatedPrefsFile, JSON.stringify({
        setupComplete: true,
        lastModified: new Date().toISOString(),
    }) + "\n", "utf-8");
    try {
        await _runDashboardServiceTests();
    } finally {
        // Restore preferences path and clean up
        if (savedPrefsPath !== undefined) {
            process.env.PRISM_PREFERENCES_PATH = savedPrefsPath;
        } else {
            delete process.env.PRISM_PREFERENCES_PATH;
        }
        try {
            rmSync(isolatedPrefsDir, { recursive: true, force: true });
        } catch { /* best-effort */ }
        // Restore auth setting
        if (savedAuthDisabled !== undefined) {
            process.env.PRISM_AUTH_DISABLED = savedAuthDisabled;
        } else {
            delete process.env.PRISM_AUTH_DISABLED;
        }
        for (const key of providerEnvVars) {
            if (savedEnvKeys[key] !== undefined) {
                process.env[key] = savedEnvKeys[key];
            } else {
                delete process.env[key];
            }
        }
    }
}

async function _runDashboardServiceTests(): Promise<void> {
    const activityBus = new ActivityBus();
    const approvalQueue = new ApprovalQueue();
    const chatSessionStore = new ChatSessionStore(":memory:");
    const providerSecretStore = new InMemoryProviderSecretStore();
    let resolveAction: ((value: { message: string }) => void) | undefined;
    const runPromise = new Promise<{ message: string }>((resolve) => {
        resolveAction = resolve;
    });

    const dashboardService = new DashboardService(
        approvalQueue,
        activityBus,
        {
            sessionId: "test-session",
            environmentProfile: "test",
            mode: "server",
            startedAt: new Date().toISOString(),
            executionProfileSegment: "individual",
        },
        chatSessionStore,
        [
            {
                name: "demo_action",
                label: "Demo Action",
                description: "Runs a deferred action.",
                run: () => runPromise,
            },
        ],
        0,
        undefined,
        undefined,
        providerSecretStore,
    );

    const initial = dashboardService.listActions();
    assert.strictEqual(initial.length, 1);
    assert.strictEqual(initial[0]!.status, "idle");
    assert.strictEqual(initial[0]!.lastMessage, null);

    const triggerResult = dashboardService.triggerAction("demo_action");
    assert.deepStrictEqual(triggerResult, { accepted: true, action: "demo_action" });

    const running = dashboardService.listActions()[0]!;
    assert.strictEqual(running.status, "running");
    assert.ok(running.lastStartedAt);
    assert.throws(() => dashboardService.triggerAction("demo_action"), /already running/i);

    const runningHistory = dashboardService.listActionHistory();
    assert.strictEqual(runningHistory.length, 1);
    assert.strictEqual(runningHistory[0]!.status, "running");
    assert.strictEqual(runningHistory[0]!.message, null);

    resolveAction!({ message: "Action completed." });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const completed = dashboardService.listActions()[0]!;
    assert.strictEqual(completed.status, "succeeded");
    assert.strictEqual(completed.lastMessage, "Action completed.");
    assert.ok(completed.lastCompletedAt);

    const completedHistory = dashboardService.listActionHistory();
    assert.strictEqual(completedHistory.length, 1);
    assert.strictEqual(completedHistory[0]!.status, "succeeded");
    assert.strictEqual(completedHistory[0]!.message, "Action completed.");
    assert.ok(completedHistory[0]!.completedAt);

    const actionEvents = activityBus.listEvents().filter((event) => event.operation === "dashboard.action.demo_action");
    assert.strictEqual(actionEvents.length, 1);
    assert.strictEqual(actionEvents[0]!.status, "succeeded");
    assert.ok(typeof actionEvents[0]!.details?.correlationId === "string");

    const session = dashboardService.createChatSession({ title: "Provider Session", allowUnbound: true });
    const initialCatalog = await dashboardService.getSessionLlmCatalog(session.sessionId);
    assert.ok(initialCatalog.providers.length > 0);

    await dashboardService.saveProviderSettings("ollama", {
        baseUrl: "http://127.0.0.1:11434",
        models: ["mistral:7b"],
        defaultModel: "mistral:7b",
    }, "test");

    const updatedCatalog = await dashboardService.setSessionLlmSelection(session.sessionId, "ollama");
    assert.strictEqual(updatedCatalog.activeProviderId, "ollama");

    await assert.rejects(
        () => dashboardService.setSessionLlmSelection(session.sessionId, "openai", "gpt-4.1"),
        /API key is missing/i,
    );

    const savedProviderSettings = await dashboardService.saveProviderSettings("openai", {
        baseUrl: "https://api.openai.com/v1",
        apiKeyHeader: "Authorization",
        models: ["gpt-4.1", "gpt-5-mini"],
        defaultModel: "gpt-5-mini",
    }, "test");
    assert.strictEqual(savedProviderSettings.providerId, "openai");
    assert.strictEqual(savedProviderSettings.defaultModel, "gpt-5-mini");
    assert.strictEqual(savedProviderSettings.hasApiKey, false);

    const secureProviderSettings = await dashboardService.saveProviderApiKey("openai", "sk-test-openai", "test");
    assert.strictEqual(secureProviderSettings.hasApiKey, true);

    const openAiCatalog = await dashboardService.setSessionLlmSelection(session.sessionId, "openai", "gpt-5-mini");
    assert.strictEqual(openAiCatalog.activeProviderId, "openai");
    assert.strictEqual(openAiCatalog.activeModel, "gpt-5-mini");

    const persistedSession = dashboardService.listChatSessions().find((entry) => entry.sessionId === session.sessionId);
    assert.ok(persistedSession);
    assert.strictEqual(persistedSession!.llmProviderId, "openai");
    assert.strictEqual(persistedSession!.llmModel, "gpt-5-mini");

    const deletable = dashboardService.createChatSession({ title: "Delete Me", allowUnbound: true });
    chatSessionStore.appendMessage(deletable.sessionId, "user", "Goodbye");
    assert.ok(dashboardService.listChatSessions().some((entry) => entry.sessionId === deletable.sessionId));

    dashboardService.deleteChatSession(deletable.sessionId);
    assert.ok(!dashboardService.listChatSessions().some((entry) => entry.sessionId === deletable.sessionId));
    assert.throws(() => chatSessionStore.getMessages(deletable.sessionId), /unknown chat session/i);
    assert.throws(() => dashboardService.deleteChatSession(deletable.sessionId), /unknown chat session/i);

    const llmSelectionEvents = activityBus
        .listEvents()
        .filter((event) => event.operation === "dashboard.llm_selection");
    assert.ok(llmSelectionEvents.length >= 3);
    const finalSelectionEvent = llmSelectionEvents[llmSelectionEvents.length - 1]!;
    assert.strictEqual(finalSelectionEvent.status, "succeeded");
    assert.strictEqual(finalSelectionEvent.details?.chatSessionId, session.sessionId);
    assert.strictEqual(finalSelectionEvent.details?.selectedProviderId, "openai");
    assert.ok(typeof finalSelectionEvent.details?.correlationId === "string");

    const draftSession = dashboardService.createChatSession({ title: "Draft Session", allowUnbound: true });
    const draftSaved = await dashboardService.saveSessionLlmConfigDraft(draftSession.sessionId, "ollama");
    assert.ok(draftSaved.draft);
    assert.strictEqual(draftSaved.draft!.providerId, "ollama");
    assert.ok(draftSaved.diff);
    assert.ok(draftSaved.diff!.changedFields.includes("llmProviderId"));

    const draftApplied = await dashboardService.applySessionLlmConfigDraft(draftSession.sessionId);
    assert.strictEqual(draftApplied.catalog.activeProviderId, "ollama");
    assert.strictEqual(draftApplied.config.draft, null);
    assert.ok(draftApplied.config.history.length >= 1);

    const redraft = await dashboardService.saveSessionLlmConfigDraft(draftSession.sessionId, "ollama");
    assert.ok(redraft.draft);
    const discarded = dashboardService.discardSessionLlmConfigDraft(draftSession.sessionId);
    assert.strictEqual(discarded.draft, null);

    const readinessBefore = await (dashboardService as unknown as {
        getReadinessSnapshot: (sessionId?: string) => Promise<{ ready: boolean; requirements: Array<{ id: string; passed: boolean }> }>;
    }).getReadinessSnapshot(session.sessionId);
    assert.ok(Array.isArray(readinessBefore.requirements));
    assert.ok(readinessBefore.requirements.length > 0);

    const unconfiguredSession = dashboardService.createChatSession({ title: "Onboarding Session", allowUnbound: true });
    const readinessAfter = await (dashboardService as unknown as {
        getReadinessSnapshot: (sessionId?: string) => Promise<{ ready: boolean; requirements: Array<{ id: string; passed: boolean }> }>;
        emitReadinessAudit: (source: string, snapshot: { ready: boolean }) => void;
    }).getReadinessSnapshot(unconfiguredSession.sessionId);
    assert.strictEqual(readinessAfter.ready, false);
    const bindingRequirement = readinessAfter.requirements.find((requirement) => requirement.id === "provider-model-selected");
    assert.ok(bindingRequirement);
    assert.strictEqual(bindingRequirement!.passed, false);

    (dashboardService as unknown as {
        emitReadinessAudit: (source: string, snapshot: { ready: boolean }) => void;
    }).emitReadinessAudit("test", readinessAfter);

    const readinessAuditEvents = activityBus
        .listEvents()
        .filter((event) => event.operation === "dashboard.readiness_check");
    assert.ok(readinessAuditEvents.length >= 1);
    assert.strictEqual(readinessAuditEvents[readinessAuditEvents.length - 1]!.details?.source, "test");

    const configAppliedEvents = activityBus
        .listEvents()
        .filter((event) => event.operation === "dashboard.llm_config_applied");
    assert.ok(configAppliedEvents.length >= 2);

    // Phase 4 — Telemetry signal quality
    // Emit some known events into the bus so the window can detect them
    activityBus.emit({ sessionId: "test-session", layer: "tool_execution", operation: "test.op_a", status: "succeeded", details: {} });
    activityBus.emit({ sessionId: "test-session", layer: "tool_execution", operation: "test.op_a", status: "failed", details: {} });
    activityBus.emit({ sessionId: "test-session", layer: "tool_execution", operation: "test.op_b", status: "succeeded", details: {} });

    // Validate telemetry summary via the service (start on ephemeral port, call API, stop)
    const telemetryBus = new ActivityBus();
    const telemetryStore = new ChatSessionStore(":memory:");
    const telemetrySecretStore = new InMemoryProviderSecretStore();
    const telemetryService = new DashboardService(
        new ApprovalQueue(),
        telemetryBus,
        { sessionId: "tel-session", environmentProfile: "test", mode: "server", startedAt: new Date().toISOString(), executionProfileSegment: "individual" },
        telemetryStore,
        [],
        0,
        undefined,
        undefined,
        telemetrySecretStore,
    );
    const initSession = telemetryService.createChatSession({ title: "Init Session", allowUnbound: true });
    telemetryService.createSessionPackage({
        title: "Initialization Certificate v1.0 — " + new Date().toISOString(),
        areaOfInterest: "setup",
        objective: "Workspace initialization",
        successCriteria: "Done",
        dependencies: [],
        sessionIds: [initSession.sessionId],
    });
    telemetryService.start();
    await new Promise((resolve) => setTimeout(resolve, 20)); // wait for listen
    const serverAddress = (telemetryService as unknown as { server: { address(): { port: number } | null } }).server.address();
    const telemetryPort = serverAddress ? serverAddress.port : 0;
    assert.ok(telemetryPort > 0, "server should bind to a real port");

    // Emit events into this isolated bus
    telemetryBus.emit({ sessionId: "tel-session", layer: "tool_execution", operation: "chat.send", status: "succeeded", details: {} });
    telemetryBus.emit({ sessionId: "tel-session", layer: "tool_execution", operation: "chat.send", status: "failed", details: {} });
    telemetryBus.emit({ sessionId: "tel-session", layer: "governance", operation: "approval.requested", status: "succeeded", details: {} });

    const { default: http } = await import("node:http");

    const fetchJson = (path: string): Promise<unknown> => new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port: telemetryPort, path }, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => { body += chunk; });
            res.on("end", () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        }).on("error", reject);
    });

    const fetchText = (path: string): Promise<string> => new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port: telemetryPort, path }, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => { body += chunk; });
            res.on("end", () => resolve(body));
        }).on("error", reject);
    });

    const requestJson = (method: string, path: string, body?: unknown): Promise<unknown> => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port: telemetryPort,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(payload || "{}"));
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on("error", reject);
        if (body != null) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });

    const shellHtml = await fetchText("/");
    assert.ok(shellHtml.includes('role="tablist" aria-label="Dashboard sections"'));
    // The progressive-enhancement tab CSS lives in the external stylesheet
    // (dashboard.css), not inlined in the HTML shell. Verify the shell links
    // to it and that the rules exist in that stylesheet.
    assert.ok(shellHtml.includes('href="/public/dashboard.css"'));
    const dashboardCss = await fetchText("/public/dashboard.css");
    assert.ok(dashboardCss.includes('body.js-ready .tab-panel'));
    assert.ok(dashboardCss.includes('body.js-ready .tab-panel.active'));

    const summary = await fetchJson("/api/telemetry/summary?window=1d") as TelemetrySummary;
    assert.ok(summary.generatedAt, "generatedAt present");
    assert.strictEqual(summary.window.windowLabel, "1d");
    assert.ok(typeof summary.window.eventsTotal === "number");
    assert.ok(typeof summary.delta.eventsTotal === "number");
    assert.ok(Array.isArray(summary.topOperations));
    assert.ok(summary.window.eventsTotal >= 3, "should include the 3 emitted events");

    // Failure rate calculation
    assert.ok(summary.window.failures >= 1);
    assert.ok(summary.window.failureRate > 0 && summary.window.failureRate <= 1);

    // Approvals counted
    assert.ok(summary.window.approvals >= 1);

    // Top ops includes our emitted operation
    const chatSendOp = summary.topOperations.find((op) => op.operation === "chat.send");
    assert.ok(chatSendOp, "chat.send should appear in top ops");
    assert.strictEqual(chatSendOp!.count, 2);
    assert.strictEqual(chatSendOp!.failures, 1);

    // Retrieval prioritized alerts — no collector → 501
    const prioritizedRaw = await fetchJson("/api/retrieval/prioritized-alerts") as { error: string };
    assert.ok(prioritizedRaw.error?.includes("not initialized"), "501 when no collector");

    // Runtime excellence snapshot
    const runtimeExcellence = await fetchJson("/api/runtime/excellence?window=1d") as {
        generatedAt: string;
        window: string;
        metrics: {
            eventsTotal: number;
            failures: number;
            failureRate: number;
            approvalFailures: number;
            traceFailureRate: number;
            retrievalAlertCount: number;
        };
        scores: { runtimeHealth: number; memoryConfidence: number };
        planner: { priority: "low" | "medium" | "high"; nextAction: string; rationale: string };
        selfHealingSuggestions: Array<{ id: string; title: string; trigger: string; action: string }>;
    };
    assert.ok(runtimeExcellence.generatedAt);
    assert.strictEqual(runtimeExcellence.window, "1d");
    assert.ok(runtimeExcellence.metrics.eventsTotal >= 3);
    assert.ok(runtimeExcellence.metrics.failures >= 1);
    assert.ok(runtimeExcellence.scores.runtimeHealth >= 0 && runtimeExcellence.scores.runtimeHealth <= 100);
    assert.ok(runtimeExcellence.scores.memoryConfidence >= 0 && runtimeExcellence.scores.memoryConfidence <= 100);
    assert.ok(runtimeExcellence.planner.nextAction.length > 0);
    assert.ok(runtimeExcellence.selfHealingSuggestions.length >= 1);

    // Release validation snapshot endpoint should always return a report envelope
    const releaseValidation = await fetchJson("/api/release/validation/latest") as {
        report: null | { generatedAt?: string; passed?: boolean; gates?: unknown[] };
    };
    assert.ok("report" in releaseValidation);
    if (releaseValidation.report) {
        assert.ok(typeof releaseValidation.report.passed === "boolean");
    }

    const releaseDecision = await fetchJson("/api/release/decision/latest") as {
        report: null | { recommendation?: string; riskLevel?: string };
    };
    assert.ok("report" in releaseDecision);
    if (releaseDecision.report) {
        assert.ok(["GO", "NO_GO"].includes(releaseDecision.report.recommendation ?? ""));
        assert.ok(["low", "medium", "high"].includes(releaseDecision.report.riskLevel ?? ""));
    }

    // Correlated traces API
    telemetryBus.emit({
        sessionId: "tel-session",
        layer: "causal",
        operation: "trace.step_one",
        status: "succeeded",
        details: {
            chatSessionId: "chat-a",
            correlationId: "trace-abc",
        },
    });
    telemetryBus.emit({
        sessionId: "tel-session",
        layer: "causal",
        operation: "trace.step_two",
        status: "failed",
        details: {
            chatSessionId: "chat-a",
            correlationId: "trace-abc",
        },
    });

    const traces = await fetchJson("/api/traces?limit=10") as {
        traces: Array<{
            correlationId: string;
            eventCount: number;
            failures: number;
            status: "succeeded" | "failed";
        }>;
    };
    assert.ok(traces.traces.length >= 1);
    const traceAbc = traces.traces.find((entry) => entry.correlationId === "trace-abc");
    assert.ok(traceAbc);
    assert.strictEqual(traceAbc!.eventCount, 2);
    assert.strictEqual(traceAbc!.failures, 1);
    assert.strictEqual(traceAbc!.status, "failed");

    const selectedTrace = await fetchJson("/api/traces?correlationId=trace-abc") as {
        selectedCorrelationId: string | null;
        selectedTraceEvents: Array<{ operation: string }>;
    };
    assert.strictEqual(selectedTrace.selectedCorrelationId, "trace-abc");
    assert.strictEqual(selectedTrace.selectedTraceEvents.length, 2);

    // ── Phase E3 + incubation route normalization regression guard ──────
    // The dashboard `handle()` rewrites `/api/v1/*` → `/api/*` before route
    // matching. Phase E3 routes were once authored against the un-normalized
    // form and silently 404'd; this block prevents a recurrence by exercising
    // each endpoint family through the real HTTP path.
    const utilitiesResp = await fetchJson("/api/v1/utilities") as { utilities?: unknown[] };
    assert.ok(Array.isArray(utilitiesResp.utilities), "GET /api/v1/utilities must return { utilities: [...] }");
    const riskResp = await fetchJson("/api/v1/tools/risk-overrides") as { overrides?: unknown[] };
    assert.ok(Array.isArray(riskResp.overrides), "GET /api/v1/tools/risk-overrides must return { overrides: [...] }");
    const cacResp = await fetchJson("/api/v1/cac/assignments") as { assignments?: unknown[] };
    assert.ok(Array.isArray(cacResp.assignments), "GET /api/v1/cac/assignments must return { assignments: [...] }");
    // Incubation gate is off by default → expect a structured 503, NOT a 404.
    const incResp = await fetchJson("/api/v1/incubation/dlma/weights") as { error?: string; prototype?: boolean };
    assert.ok(
        incResp && (incResp.error === "incubation_disabled" || incResp.prototype === true),
        "GET /api/v1/incubation/* must reach the incubation gate (503/200 with prototype:true), not the final 404",
    );

    const packageTempDir = mkdtempSync(join(tmpdir(), "prism-dashboard-packages-"));
    const packageDbPath = join(packageTempDir, "activity.db");
    const packageStorePath = join(packageTempDir, "dashboard-session-packages.json");
    const packageExportDir = join(packageTempDir, "exports");
    const packageBus = new ActivityBus();
    const packageSqlite = new SqliteActivityStore(packageDbPath);
    packageBus.subscribe(packageSqlite);
    const packageChatStore = new ChatSessionStore(":memory:");
    const packageService = new DashboardService(
        new ApprovalQueue(),
        packageBus,
        { sessionId: "pkg-session", environmentProfile: "test", mode: "server", startedAt: new Date().toISOString(), executionProfileSegment: "individual" },
        packageChatStore,
        [],
        0,
        undefined,
        undefined,
        new InMemoryProviderSecretStore(),
        packageSqlite,
        packageStorePath,
        packageExportDir,
    );
    packageService.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const packageAddress = (packageService as unknown as { server: { address(): { port: number } | null } }).server.address();
    const packagePort = packageAddress ? packageAddress.port : 0;
    assert.ok(packagePort > 0, "package service should bind to a real port");

    const packageRequestJson = (method: string, path: string, body?: unknown): Promise<unknown> => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port: packagePort,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(payload || "{}"));
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on("error", reject);
        if (body != null) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });

    const chapterOne = packageService.createChatSession({ title: "Chapter One", allowUnbound: true });
    const chapterTwo = packageService.createChatSession({ title: "Chapter Two", allowUnbound: true });
    packageChatStore.appendMessage(chapterOne.sessionId, "user", "chapter one input");
    packageChatStore.appendMessage(chapterOne.sessionId, "assistant", "chapter one output");
    packageChatStore.appendMessage(chapterTwo.sessionId, "user", "chapter two input");
    packageBus.emit({
        sessionId: chapterOne.sessionId,
        layer: "causal",
        operation: "pkg.chapter_one",
        status: "succeeded",
        policyDecision: "allow",
        details: { chatSessionId: chapterOne.sessionId },
    });
    packageBus.emit({
        sessionId: chapterTwo.sessionId,
        layer: "governance",
        operation: "pkg.chapter_two",
        status: "failed",
        policyDecision: "require_approval",
        details: { chatSessionId: chapterTwo.sessionId, reasonCode: "needs_approval" },
    });

    const createdPackage = await packageRequestJson("POST", "/api/session-packages", {
        title: "Release Binder",
        areaOfInterest: "release",
        objective: "Drive release evidence",
        successCriteria: "Binder exported",
        dependencies: ["release-validation"],
        sessionIds: [chapterOne.sessionId, chapterTwo.sessionId],
    }) as {
        package: {
            packageId: string;
            status: string;
            summary: { chapterCount: number; completedChapterCount: number; latestPolicyDecision: string | null };
        };
    };
    assert.ok(createdPackage.package.packageId);
    assert.strictEqual(createdPackage.package.status, "planned");
    assert.strictEqual(createdPackage.package.summary.chapterCount, 2);
    assert.strictEqual(createdPackage.package.summary.completedChapterCount, 1);
    assert.strictEqual(createdPackage.package.summary.latestPolicyDecision, "require_approval");

    const patchedPackage = await packageRequestJson("PATCH", "/api/session-packages/" + encodeURIComponent(createdPackage.package.packageId), {
        status: "blocked",
        historyAction: "workflow_blocked",
        message: "Blocked during dashboard test.",
    }) as {
        package: { status: string };
    };
    assert.strictEqual(patchedPackage.package.status, "blocked");

    const exportedPackage = await packageRequestJson("POST", "/api/session-packages/" + encodeURIComponent(createdPackage.package.packageId) + "/export", {}) as {
        artifactPath: string;
        package: { exportArtifactPath: string | null; lastExportAt: string | null };
        aggregate: { totalEvents: number; totalPolicyRecords: number; chaptersExported: number };
    };
    assert.ok(exportedPackage.artifactPath.includes("exports"));
    assert.strictEqual(exportedPackage.package.exportArtifactPath, exportedPackage.artifactPath);
    assert.ok(exportedPackage.package.lastExportAt);
    assert.strictEqual(exportedPackage.aggregate.chaptersExported, 2);
    assert.ok(exportedPackage.aggregate.totalEvents >= 2);
    assert.ok(exportedPackage.aggregate.totalPolicyRecords >= 2);
    const exportArtifact = JSON.parse(readFileSync(exportedPackage.artifactPath, "utf-8")) as { package: { title: string } };
    assert.strictEqual(exportArtifact.package.title, "Release Binder");

    const packageList = await packageRequestJson("GET", "/api/session-packages") as {
        packages: Array<{ packageId: string }>;
        releaseSnapshot: { exportedCount: number; latestExportArtifactPath: string | null };
    };
    assert.strictEqual(packageList.packages.length, 1);
    assert.strictEqual(packageList.releaseSnapshot.exportedCount, 1);
    assert.strictEqual(packageList.releaseSnapshot.latestExportArtifactPath, exportedPackage.artifactPath);

    const packageHistory = await packageRequestJson("GET", "/api/session-packages/history?limit=10") as {
        history: Array<{ action: string; packageId: string }>;
    };
    assert.ok(packageHistory.history.some((entry) => entry.action === "created" && entry.packageId === createdPackage.package.packageId));
    assert.ok(packageHistory.history.some((entry) => entry.action === "workflow_blocked" && entry.packageId === createdPackage.package.packageId));
    assert.ok(packageHistory.history.some((entry) => entry.action === "exported" && entry.packageId === createdPackage.package.packageId));

    // -- Metrics endpoint --
    const metrics = await packageRequestJson("GET", "/api/session-packages/metrics") as {
        generatedAt: string;
        totals: { all: number; byStatus: { planned: number; running: number; blocked: number; complete: number } };
        chapterStats: { total: number; avg: number; min: number; max: number };
        exportStats: { exportedCount: number; exportRate: number; completeWithoutExportCount: number };
        historyStats: { totalEntries: number; actionFrequency: Array<{ action: string; count: number }> };
        creationTrend: Array<{ day: string; count: number }>;
    };
    assert.ok(metrics.generatedAt);
    assert.strictEqual(metrics.totals.all, 1);
    assert.ok(metrics.totals.byStatus.blocked >= 1);
    assert.strictEqual(metrics.chapterStats.total, 2);
    assert.strictEqual(metrics.chapterStats.min, 2);
    assert.strictEqual(metrics.chapterStats.max, 2);
    assert.ok(metrics.chapterStats.avg > 0);
    assert.strictEqual(metrics.exportStats.exportedCount, 1);
    assert.ok(metrics.exportStats.exportRate > 0);
    assert.ok(metrics.historyStats.totalEntries >= 3);
    assert.ok(Array.isArray(metrics.historyStats.actionFrequency));
    assert.ok(metrics.historyStats.actionFrequency.length > 0);
    assert.ok(Array.isArray(metrics.creationTrend));
    assert.ok(metrics.creationTrend.length > 0);

    // -- SQLite persistence: reload service on same DB, verify packages survive --
    await packageService.stop();

    const reloadSqlite = new SqliteActivityStore(packageDbPath);
    const reloadChatStore = new ChatSessionStore(":memory:");
    const reloadService = new DashboardService(
        new ApprovalQueue(),
        new ActivityBus(),
        { sessionId: "pkg-reload", environmentProfile: "test", mode: "server", startedAt: new Date().toISOString(), executionProfileSegment: "individual" },
        reloadChatStore,
        [],
        0,
        undefined,
        undefined,
        new InMemoryProviderSecretStore(),
        reloadSqlite,
        packageStorePath,
        packageExportDir,
    );
    const reloadedPackages = reloadService.listSessionPackages();
    assert.strictEqual(reloadedPackages.length, 1, "packages must persist across service restart via SQLite");
    assert.strictEqual(reloadedPackages[0]!.packageId, createdPackage.package.packageId);
    assert.strictEqual(reloadedPackages[0]!.sessionIds.length, 2);
    assert.ok(reloadedPackages[0]!.exportArtifactPath, "export path must survive restart");
    await reloadService.stop().catch(() => { /* ignore */ });
    reloadSqlite.close();
    reloadChatStore.close();

    packageSqlite.close();
    packageChatStore.close();
    rmSync(packageTempDir, { recursive: true, force: true });

    await telemetryService.stop();
    telemetryStore.close();

    chatSessionStore.close();
    console.log("✓ DashboardService tests passed");
}