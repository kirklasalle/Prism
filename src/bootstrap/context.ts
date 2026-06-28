/**
 * PRISM Bootstrap — AppContext
 *
 * Holds all initialized services created during bootstrap.
 * This is the shared context passed between bootstrap phases,
 * eliminating the need for all ~35 local variables in main().
 *
 * Phase R (Readiness) — Audit remediation item R2a (continued).
 */

import type { DatabaseSync } from "node:sqlite";
import type sqlite3 from "sqlite3";
import type { ActivityBus } from "../core/activity/bus.js";
import type { ApprovalQueue } from "../core/approval/approval-queue.js";
import type { EpisodicMemory } from "../core/memory/episodic-memory.js";
import type { SemanticMemoryIndex } from "../core/memory/semantic-memory.js";
import type { SessionMemoryStore } from "../core/memory/session-memory.js";
import type { RetrievalDashboardStore } from "../core/memory/retrieval-dashboard-store.js";
import type { RetrievalMetricsCollector } from "../core/memory/retrieval-metrics.js";
import type { PolicyEngine } from "../core/policy/engine.js";
import type { ToolRegistry } from "../core/tools/registry.js";
import type { Orchestrator } from "../core/runtime/orchestrator.js";
import type { WorkflowExecutor } from "../core/runtime/workflow.js";
import type { AgentPool } from "../core/agents/agent-pool.js";
import type { AgentLifecycleManager } from "../core/agents/agent-lifecycle.js";
import type { AgentTelemetryCollector } from "../core/agents/agent-telemetry-collector.js";
import type { AgentRouter } from "../core/agents/agent-router.js";
import type { SwarmCoordinator } from "../core/agents/swarm-coordinator.js";
import type { DashboardService } from "../core/operator/dashboard-service.js";
import type { ChatSessionStore } from "../core/operator/chat-session-store.js";
import type { UsageMeteringService } from "../core/operator/usage-metering-service.js";
import type { SelfReviewScheduler } from "../core/operator/self-review-scheduler.js";
import type { McpClientAdapter } from "../adapters/protocol/mcp-client-tool.js";
import type { LlmProviderManager } from "../core/operator/llm-provider-manager.js";
import type { LlmDelegate } from "../core/agents/agent-types.js";
import type { DevIdentityProvider } from "../core/iam/dev-identity-provider.js";
import type { TabSessionRegistry } from "../core/iam/tab-session-registry.js";
import type { UniversalTelemetryAggregator } from "../core/observability/universal-telemetry-aggregator.js";
import type { AutonomousAgentLoop } from "../core/runtime/autonomous-agent-loop.js";
import type { AutonomousBrowserAgent } from "../core/runtime/autonomous-browser-agent.js";
import type { AutonomousComputerAgent } from "../core/runtime/autonomous-computer-agent.js";
import type { PrismCovenant } from "../core/governance/prism-covenant.js";
import type { GmailOAuthAdapter } from "../adapters/application/email-oauth-adapter.js";
import type { OutlookOAuthAdapter } from "../adapters/application/outlook-oauth-adapter.js";
import type { TerminalSessionAdapter } from "../adapters/application/terminal-session-adapter.js";
import type { ContainerSandboxAdapter } from "../adapters/application/container-sandbox-adapter.js";
import type { ConsoleInterceptor } from "../core/logging/console-interceptor.js";
import type { ExecutionProfile } from "../core/policy/execution-profiles.js";
import type { GuardianAgent } from "../core/agents/guardian-agent.js";
import type { SkillsEngine } from "../core/skills/skills-engine.js";

/**
 * AppContext — the complete set of initialized runtime services.
 * Created by `createAppContext()` and consumed by all bootstrap phases.
 */
export interface AppContext {
    // Identity & session
    sessionId: string;
    runtimeMode: "demo" | "server";
    cliSetup: boolean;
    dashboardPort: number;
    environmentProfile: string;
    startedAt: string;
    executionProfile: ExecutionProfile;

    // Console & activity
    consoleInterceptor: ConsoleInterceptor;
    activityBus: ActivityBus;
    sqliteStore: any;
    approvalQueue: ApprovalQueue;

    // Memory
    episodicMemory: EpisodicMemory;
    metricsCollector: RetrievalMetricsCollector;
    semanticIndex: SemanticMemoryIndex;
    retrievalDashboardStore: any;
    sessionMemory: any;

    // Chat & usage
    chatSessionStore: any;
    usageMeteringService: UsageMeteringService;

    // OAuth
    gmailOAuth: GmailOAuthAdapter;
    outlookOAuth: OutlookOAuthAdapter;

    // Adapters
    adapterDb: sqlite3.Database;
    terminalAdapter: TerminalSessionAdapter;
    containerAdapter: ContainerSandboxAdapter;

    // Tools
    registry: ToolRegistry;
    mcpAdapter: McpClientAdapter;

    // Policy & orchestration
    policyEngine: PolicyEngine;
    orchestrator: Orchestrator;
    workflowExecutor: WorkflowExecutor;

    // IAM
    devIdentity: DevIdentityProvider;
    tabSessionRegistry: TabSessionRegistry;

    // Telemetry & covenant
    telemetryAggregator: UniversalTelemetryAggregator;
    covenant: PrismCovenant;

    // Autonomous
    autonomousLoop: AutonomousAgentLoop;
    autonomousBrowserAgent: AutonomousBrowserAgent;
    autonomousComputerAgent: AutonomousComputerAgent;

    // Agents
    llmDelegate: LlmDelegate;
    agentTelemetry: AgentTelemetryCollector;
    agentLifecycle: AgentLifecycleManager;
    agentPool: AgentPool;
    swarmCoordinator: SwarmCoordinator;
    agentRouter: AgentRouter;

    // Dashboard
    dashboardService: DashboardService;
    selfReviewScheduler: SelfReviewScheduler;

    // Guardian & Skills
    guardianAgent: GuardianAgent;
    skillsEngine: SkillsEngine;
}