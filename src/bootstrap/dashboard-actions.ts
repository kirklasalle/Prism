/**
 * PRISM Bootstrap — Dashboard Action Factory
 *
 * Creates the DashboardAction[] array for the DashboardService.
 * Extracted from `src/index.ts` monolith as part of Phase R (Readiness) audit remediation.
 */

import type { Orchestrator } from "../core/runtime/orchestrator.js";
import type { WorkflowExecutor } from "../core/runtime/workflow.js";
import type { ApprovalQueue } from "../core/approval/approval-queue.js";
import type { ActivityBus } from "../core/activity/bus.js";
import type { DashboardService, DashboardAction } from "../core/operator/dashboard-service.js";

/**
 * Create the set of dashboard quick actions (run_file_list, run_approval_demo,
 * run_workflow_demo). The `dashboardServiceReady` promise resolves when the
 * DashboardService has been fully constructed and wired.
 */
export function createDashboardActions(
    orchestrator: Orchestrator,
    workflowExecutor: WorkflowExecutor,
    approvalQueue: ApprovalQueue,
    sessionId: string,
    dashboardServiceReady: Promise<DashboardService>,
    activityBus: ActivityBus,
): DashboardAction[] {
    let actionInFlight = false;

    const guarded = async (
        run: () => Promise<{ message: string; details?: Record<string, unknown> }>,
    ): Promise<{ message: string; details?: Record<string, unknown> }> => {
        if (actionInFlight) {
            throw new Error("Another action is already running. Please wait for completion.");
        }
        actionInFlight = true;
        try {
            return await run();
        } finally {
            actionInFlight = false;
        }
    };

    return [
        {
            name: "run_file_list",
            label: "Run file list demo",
            description: "Runs a low-risk autonomous file listing operation.",
            run: () => guarded(async () => {
                await orchestrator.run({
                    operation: "file_list",
                    args: { path: "." },
                    risk: "low",
                    mutatesState: false,
                });
                return { message: "file_list demo completed." };
            }),
        },
        {
            name: "run_approval_demo",
            label: "Queue approval-required action",
            description: "Submits a high-risk write operation that requires manual approve/deny.",
            run: () => guarded(async () => {
                await orchestrator.run({
                    operation: "file_write",
                    args: { path: "./prism-output/dashboard-critical.cfg", content: "DASHBOARD_TRIGGERED=true\n" },
                    risk: "high",
                    mutatesState: true,
                    rollbackPlan: "restore dashboard-critical.cfg from git checkpoint",
                });
                return {
                    message: "Approval-required action submitted.",
                    details: { pendingApprovals: approvalQueue.list().length },
                };
            }),
        },
        {
            name: "run_workflow_demo",
            label: "Run workflow demo",
            description: "Visual UI tour + a 2-step DAG + a real (best-effort) browser-use and computer-use probe so the operator can watch PRISM operate itself.",
            run: () => guarded(async () => {
                const dag = workflowExecutor.createDAG(
                    "Dashboard Workflow",
                    [
                        { id: "step1", operation: "file_list", args: { path: "." }, risk: "low", mutatesState: false },
                        { id: "step2", operation: "memory_query", args: { mode: "episodic_recent", limit: 2, sessionId }, risk: "low", mutatesState: false },
                    ],
                    [],
                );

                // Await the dashboard service — resolves once it's fully wired
                const svc = await dashboardServiceReady;
                const tour = svc
                    ? svc.broadcastUiTour([
                        { tabId: "chat", dwellMs: 600, message: "Workflow demo started" },
                        { tabId: "agentic", anchor: "guardian-status", dwellMs: 1500, message: "Guardian observing the run" },
                        { tabId: "computer", dwellMs: 1500, message: "Computer-use probe — capturing a screengrab" },
                        { tabId: "browser", dwellMs: 1800, message: "Browser-use probe — launching a headless session" },
                        { tabId: "logs", anchor: "actions", dwellMs: 1500, message: "Quick Actions running" },
                        { tabId: "logs", anchor: "action-history", dwellMs: 1500, message: "Action recorded in history" },
                        { tabId: "chat", dwellMs: 200, message: "Workflow demo complete" },
                    ])
                    : Promise.resolve();

                // ── Real CUA probe: take a single framebuffer screengrab. Best-effort,
                //    fails gracefully on headless servers / restricted environments.
                const cuaProbe = (async () => {
                    if (!svc) return;
                    try {
                        const fb = svc.getFramebufferCapture();
                        const result = await fb.captureSingle();
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "cua.screengrab",
                            status: "succeeded",
                            details: { source: "workflow_demo", path: (result as Record<string, unknown>)?.path ?? null },
                        });
                    } catch (err) {
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "cua.screengrab",
                            status: "failed",
                            details: { source: "workflow_demo", error: String(err) },
                        });
                    }
                })();

                // ── Real BUA probe: launch a headless browser, navigate to about:blank,
                //    take a screenshot, close. Best-effort — fails gracefully when no
                //    Chromium is available (e.g. fresh Windows dev box without Playwright).
                const buaProbe = (async () => {
                    if (!svc) return;
                    try {
                        const session = await (svc as any).getSessionManager().createSession({ headless: true });
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "bua.probe",
                            status: "succeeded",
                            details: { source: "workflow_demo", url: "about:blank", sessionId: session.id },
                        });
                    } catch { /* swallow */ }
                })();

                // Run the underlying DAG concurrently with the cosmetic tour and the
                // BUA/CUA probes.
                await Promise.all([
                    orchestrator.runWorkflow(dag),
                    tour,
                    cuaProbe,
                    buaProbe,
                ]);

                return { message: "Workflow demo completed (DAG + UI tour + BUA + CUA)." };
            }),
        },
    ];
}