/**
 * OpenAI API compatibility route handler.
 *
 * Mounts the transport-agnostic shim from `src/core/compat/openai-assistants.ts`
 * onto the dashboard's custom Router under the `/v1/*` path prefix. This is
 * the seam that makes existing OpenAI Python/Node clients reach PRISM by
 * changing only `base_url` — auth still goes through the existing AuthGate
 * (a request without a valid bearer token is rejected upstream in
 * `dashboard-service.ts` before this handler ever runs).
 *
 * Surface served (all under /v1):
 *   POST /v1/chat/completions
 *   POST /v1/threads
 *   GET  /v1/threads/:thread_id
 *   POST /v1/threads/:thread_id/messages
 *   GET  /v1/threads/:thread_id/messages
 *   POST /v1/threads/:thread_id/runs
 *   GET  /v1/threads/:thread_id/runs/:run_id
 *
 * Streaming is intentionally rejected at the shim layer with a typed
 * `invalid_request` error directing clients to `/api/chat/stream`.
 *
 * Frontend Protection Guarantee preserved — this is a NEW handler; nothing
 * existing was modified beyond the one-line registration in
 * `routes/index.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import {
    OpenAiCompatStore,
    ShimError,
    errorEnvelope,
    handleChatCompletions,
    handleCreateMessage,
    handleCreateRun,
    handleCreateThread,
    handleGetRun,
    handleGetThread,
    handleListMessages,
    statusForError,
    type ChatExecutor,
    type ChatExecutorInput,
    type ChatExecutorResult,
    type ChatMessage,
    type ShimHandlerDeps,
} from "../../compat/openai-assistants.js";

/**
 * Build a `ChatExecutor` that delegates to the live `LlmProviderManager`.
 * Keeps the shim decoupled from provider internals and lets tests pass an
 * alternate executor.
 */
export function buildLlmProviderChatExecutor(service: DashboardService): ChatExecutor {
    return async (input: ChatExecutorInput): Promise<ChatExecutorResult> => {
        const lpm = service.getLlmProviderManager();
        const { systemPrompt, conversation, lastUser } = splitMessages(input.messages);
        if (!lastUser) {
            throw new Error("OpenAI compat: no user message in conversation");
        }
        const out = await lpm.generate({
            message: lastUser,
            conversation,
            systemPrompt,
        });
        if (!out) {
            // No active provider — surface a deterministic stub so the shim
            // still returns a valid OpenAI-shaped response. The compat layer
            // is not the place to return 500s for "no provider configured";
            // the operator should fix that via the dashboard.
            return {
                content:
                    "[PRISM] No active LLM provider is configured. Configure one in the dashboard "
                    + "(Settings → Providers) to receive real model output via the OpenAI compatibility shim.",
                model: input.requestedModel ?? "prism-no-provider",
            };
        }
        return {
            content: out.content,
            model: out.model,
            usage: out.tokensUsed
                ? { promptTokens: out.tokensUsed.input, completionTokens: out.tokensUsed.output }
                : undefined,
            finishReason: out.stopReason === "max_tokens" ? "length" : "stop",
        };
    };
}

/**
 * Split an OpenAI-shaped message list into the `(systemPrompt, conversation,
 * lastUser)` triple expected by `LlmProviderManager.generate()`.
 *
 * - All `role:"system"` messages are concatenated into `systemPrompt` with
 *   blank-line separators.
 * - Everything except the last `role:"user"` becomes `conversation`.
 * - The last user message becomes `message`.
 */
function splitMessages(messages: ChatMessage[]): {
    systemPrompt: string;
    conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
    lastUser: string | null;
} {
    const systems: string[] = [];
    const nonSystem: ChatMessage[] = [];
    for (const m of messages) {
        if (m.role === "system") systems.push(m.content);
        else nonSystem.push(m);
    }
    let lastUserIdx = -1;
    for (let i = nonSystem.length - 1; i >= 0; i--) {
        if (nonSystem[i].role === "user") {
            lastUserIdx = i;
            break;
        }
    }
    const lastUser = lastUserIdx >= 0 ? nonSystem[lastUserIdx].content : null;
    const conversation = nonSystem
        .filter((_, i) => i !== lastUserIdx)
        .map((m) => ({ role: m.role, content: m.content }));
    return {
        systemPrompt: systems.join("\n\n"),
        conversation,
        lastUser,
    };
}

interface RouteParams {
    threadId?: string;
    runId?: string;
}

/**
 * Match `/v1/threads/{id}/messages` and similar templated paths. Returns
 * the captured params or `null` when the path does not match the template.
 */
function matchPath(template: string, path: string): RouteParams | null {
    const tParts = template.split("/").filter(Boolean);
    const pParts = path.split("/").filter(Boolean);
    if (tParts.length !== pParts.length) return null;
    const params: RouteParams = {};
    for (let i = 0; i < tParts.length; i++) {
        const t = tParts[i];
        const p = pParts[i];
        if (t.startsWith(":")) {
            const key = t.slice(1);
            if (key === "thread_id") params.threadId = p;
            else if (key === "run_id") params.runId = p;
            else (params as Record<string, string>)[key] = p;
        } else if (t !== p) {
            return null;
        }
    }
    return params;
}

export class OpenAiCompatHandler implements IRouteHandler {
    private readonly store = new OpenAiCompatStore();
    /**
     * Optional override for the chat executor. Tests inject a fake here so
     * they exercise the routing layer without spinning up a provider.
     */
    private readonly executorOverride: ChatExecutor | null;
    private readonly defaultModel: string;

    constructor(opts?: { chatExecutor?: ChatExecutor; defaultModel?: string }) {
        this.executorOverride = opts?.chatExecutor ?? null;
        this.defaultModel = opts?.defaultModel ?? "prism-default";
    }

    match(req: IncomingMessage): boolean {
        const url = (req.url ?? "").split("?")[0];
        return url === "/v1/chat/completions"
            || url === "/v1/threads"
            || url.startsWith("/v1/threads/");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const path = rawUrl.split("?")[0];
        const method = (req.method ?? "GET").toUpperCase();
        const deps: ShimHandlerDeps = {
            store: this.store,
            defaultModel: this.defaultModel,
            chatExecutor: this.executorOverride ?? buildLlmProviderChatExecutor(service),
        };

        try {
            // POST /v1/chat/completions
            if (method === "POST" && path === "/v1/chat/completions") {
                const body = await service.readJsonBody<Record<string, unknown>>(req);
                const out = await handleChatCompletions(body as never, deps);
                return this.json(res, 200, out);
            }

            // POST /v1/threads
            if (method === "POST" && path === "/v1/threads") {
                // Allow empty body (POST with no payload is idiomatic for thread create).
                const body = await this.readJsonBodyOptional(service, req);
                const out = handleCreateThread(body as never, deps);
                return this.json(res, 200, out);
            }

            // GET /v1/threads/:thread_id
            {
                const m = matchPath("/v1/threads/:thread_id", path);
                if (m && method === "GET") {
                    const out = handleGetThread(m.threadId!, deps);
                    return this.json(res, 200, out);
                }
            }

            // POST/GET /v1/threads/:thread_id/messages
            {
                const m = matchPath("/v1/threads/:thread_id/messages", path);
                if (m) {
                    if (method === "POST") {
                        const body = await service.readJsonBody<Record<string, unknown>>(req);
                        const out = handleCreateMessage(m.threadId!, body as never, deps);
                        return this.json(res, 200, out);
                    }
                    if (method === "GET") {
                        const out = handleListMessages(m.threadId!, deps);
                        return this.json(res, 200, out);
                    }
                }
            }

            // POST /v1/threads/:thread_id/runs
            {
                const m = matchPath("/v1/threads/:thread_id/runs", path);
                if (m && method === "POST") {
                    const body = await service.readJsonBody<Record<string, unknown>>(req);
                    const out = await handleCreateRun(m.threadId!, body as never, deps);
                    return this.json(res, 200, out);
                }
            }

            // GET /v1/threads/:thread_id/runs/:run_id
            {
                const m = matchPath("/v1/threads/:thread_id/runs/:run_id", path);
                if (m && method === "GET") {
                    const out = handleGetRun(m.threadId!, m.runId!, deps);
                    return this.json(res, 200, out);
                }
            }

            // No sub-route matched — fall through to 404.
            return this.json(res, 404, {
                error: { message: `Not found: ${method} ${path}`, type: "invalid_request_error", code: "not_found" },
            });
        } catch (err: unknown) {
            if (err instanceof ShimError) {
                return this.json(res, statusForError(err), errorEnvelope(err));
            }
            const message = err instanceof Error ? err.message : String(err);
            return this.json(res, 400, {
                error: { message, type: "invalid_request_error", code: "invalid_request" },
            });
        }
    }

    /**
     * Like `service.readJsonBody()` but returns an empty object when the
     * body is missing or empty — required for `POST /v1/threads` which
     * accepts a bare request.
     */
    private async readJsonBodyOptional(
        service: DashboardService,
        req: IncomingMessage,
    ): Promise<Record<string, unknown>> {
        try {
            const body = await service.readJsonBody<Record<string, unknown>>(req);
            return body ?? {};
        } catch {
            return {};
        }
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(body));
    }
}
