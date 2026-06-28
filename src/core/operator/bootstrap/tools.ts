import type { ToolRegistry } from "../../tools/registry.js";
import type { Tool } from "../../tools/types.js";
import type { LlmProviderManager } from "../llm-provider-manager.js";
import type { ProviderSecretStore } from "../provider-secret-store.js";
import type { ActivityBus } from "../../activity/bus.js";
import type { FramebufferCapture } from "../framebuffer-capture.js";
import { DashboardControlTool } from "../../tools/dashboard-control-tool.js";
import { ComputerUseTool } from "../../../adapters/system/computer-use-tool.js";
import { ImageGenerateTool } from "../../../adapters/application/image-generate-tool.js";
import { VideoGenerateTool, AudioGenerateTool, AudioTranscribeTool } from "../../../adapters/application/media-tools.js";

export interface ToolsConfig {
  tools: Tool[];
}

export function bootstrapTools(
  toolRegistry: ToolRegistry | null,
  llmProviders: LlmProviderManager,
  providerSecretStore: ProviderSecretStore,
  activityBus: ActivityBus,
  framebufferCapture: FramebufferCapture
): ToolsConfig {
  const tools: Tool[] = toolRegistry ? [...toolRegistry.list()] : [];

  if (toolRegistry) {
    // ── reasoning tool ──
    toolRegistry.register({
      name: "ask_reasoning_model",
      contract: {
        version: "1.0.0",
        args: {
          prompt: { type: "string", required: true }
        }
      },
      execute: async (request: any) => {
        const prompt = request.args.prompt as string;
        if (!prompt) return { ok: false, output: { error: "Missing prompt." } };
        const result = await llmProviders.generateForRole("reasoning", {
          message: prompt,
          conversation: [],
          systemPrompt: "You are the primary reasoning model for PRISM. A smaller agent has delegated a complex task to you. Provide the best possible answer or analysis based on the prompt."
        });
        if (!result) return { ok: false, output: { error: "Reasoning model failed to produce a response." } };
        return { ok: true, output: { response: result.content } };
      }
    });
  }

  const dashboardControlTool = new DashboardControlTool(activityBus);
  if (toolRegistry) {
    toolRegistry.register(dashboardControlTool);
  }
  tools.push(dashboardControlTool);

  const computerUseTool = new ComputerUseTool(framebufferCapture);
  if (toolRegistry) {
    toolRegistry.register(computerUseTool);
  }
  tools.push(computerUseTool);

  const imageGenerateTool = new ImageGenerateTool({
    providerManager: llmProviders,
    secretStore: providerSecretStore,
  });
  if (toolRegistry) {
    toolRegistry.register(imageGenerateTool);
  }
  tools.push(imageGenerateTool);

  const videoGenerateTool = new VideoGenerateTool({
    providerManager: llmProviders,
    secretStore: providerSecretStore,
  });
  const audioGenerateTool = new AudioGenerateTool({
    providerManager: llmProviders,
    secretStore: providerSecretStore,
  });
  const audioTranscribeTool = new AudioTranscribeTool({
    providerManager: llmProviders,
    secretStore: providerSecretStore,
  });
  if (toolRegistry) {
    toolRegistry.register(videoGenerateTool);
    toolRegistry.register(audioGenerateTool);
    toolRegistry.register(audioTranscribeTool);
  }
  tools.push(videoGenerateTool, audioGenerateTool, audioTranscribeTool);

  return { tools };
}
