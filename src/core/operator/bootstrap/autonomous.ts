import type { ActivityBus } from "../../activity/bus.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { Tool } from "../../tools/types.js";
import type { LlmProviderManager } from "../llm-provider-manager.js";
import type { UsageMeteringService } from "../usage-metering-service.js";
import { PrismCovenant } from "../../governance/prism-covenant.js";
import { SSHPInterceptor } from "../sshp-interceptor.js";
import { CSHManager } from "../csh-manager.js";
import { AutonomousBrowserAgent } from "../../runtime/autonomous-browser-agent.js";
import { AutonomousComputerAgent } from "../../runtime/autonomous-computer-agent.js";
import { AutonomousAgentLoop } from "../../runtime/autonomous-agent-loop.js";
import type { AutonomousLlmGenerateFn, LlmToolDef } from "../../runtime/autonomous-planner.js";

export interface AutonomousConfig {
  covenant: PrismCovenant;
  sshpInterceptor: SSHPInterceptor;
  cshManager: CSHManager;
  browserAgent: AutonomousBrowserAgent;
  computerAgent: AutonomousComputerAgent;
  autonomousLoop: AutonomousAgentLoop | null;
}

export function bootstrapAutonomous(
  activityBus: ActivityBus,
  toolRegistry: ToolRegistry | null,
  llmProviders: LlmProviderManager,
  usageMetering: UsageMeteringService | null,
  tools: Tool[]
): AutonomousConfig {
  const covenant = new PrismCovenant(activityBus);
  const sshpInterceptor = new SSHPInterceptor(covenant);
  const cshManager = new CSHManager();
  const browserAgent = new AutonomousBrowserAgent(activityBus);
  browserAgent.setSSHPInterceptor(sshpInterceptor);
  browserAgent.setCSHManager(cshManager);
  const computerAgent = new AutonomousComputerAgent(activityBus);

  // Propagate SSHP Interceptor and CSH Manager to any matching registered tools (browser_control, secure_browser)
  for (const tool of tools) {
    if (typeof (tool as any).setSSHPInterceptor === "function") {
      (tool as any).setSSHPInterceptor(sshpInterceptor);
    }
    if (typeof (tool as any).setCSHManager === "function") {
      (tool as any).setCSHManager(cshManager);
    }
  }

  let autonomousLoop: AutonomousAgentLoop | null = null;

  if (toolRegistry) {
    const loop = new AutonomousAgentLoop(
      activityBus,
      toolRegistry,
      {
        maxConcurrentGoals: 1,
        defaultMaxActions: 100,
        defaultMaxDurationMs: 10 * 60 * 1000,
        guardianCheckIntervalActions: 5,
        actionsPerMinuteLimit: 30,
      },
    );
    if (usageMetering) {
      loop.setUsageMetering(usageMetering);
    }
    autonomousLoop = loop;

    // Wire LLM generate function
    const autonomousGenerateFn: AutonomousLlmGenerateFn = async (input) => {
      const result = await llmProviders.generate({
        message: input.message,
        conversation: input.conversation as any,
        systemPrompt: input.systemPrompt,
        tools: input.tools as any,
        tool_choice: input.tool_choice,
      });
      if (!result) return null;
      return {
        content: result.content,
        toolCalls: result.toolCalls,
        stopReason: result.stopReason,
        thoughtSignature: result.thoughtSignature,
      };
    };
    loop.setLlmGenerateFn(autonomousGenerateFn);

    // Wire tool definitions from the registry
    const toolDefs: LlmToolDef[] = toolRegistry.list()
      .filter(t => t.contract?.args)
      .map(t => ({
        name: t.name,
        description: (t.contract as any)?.description ?? `Execute the ${t.name} tool`,
        parameters: {
          type: "object" as const,
          properties: Object.fromEntries(
            Object.entries(t.contract?.args ?? {}).map(([key, schema]) => [
              key,
              {
                type: String((schema as any).type ?? "string"),
                description: String((schema as any).description ?? key),
              },
            ]),
          ),
          required: Object.entries(t.contract?.args ?? {})
            .filter(([, schema]) => (schema as any).required === true)
            .map(([key]) => key),
        },
      }));
    loop.setToolDefinitions(toolDefs);

    // Wire specialized agents
    loop.setSpecializedAgents(
      browserAgent,
      computerAgent,
    );

    // Wire covenant for pre-step enforcement
    loop.setCovenant(covenant);
  }

  return {
    covenant,
    sshpInterceptor,
    cshManager,
    browserAgent,
    computerAgent,
    autonomousLoop,
  };
}
