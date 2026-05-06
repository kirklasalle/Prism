/**
 * OpenAI API compatibility shim.
 *
 * Provides drop-in surface for the most common OpenAI API endpoints so any
 * existing OpenAI client (Python `openai`, Node `openai`, langchain, etc.) can
 * point its base URL at PRISM and continue working unmodified. This is a
 * **conversion lever** — it doesn't expose the full OpenAI API, just the
 * parts every client uses out of the box:
 *
 *   - POST /v1/chat/completions           (non-streaming)
 *   - POST /v1/threads                    (Assistants API)
 *   - GET  /v1/threads/:id
 *   - POST /v1/threads/:id/messages
 *   - GET  /v1/threads/:id/messages
 *   - POST /v1/threads/:id/runs
 *   - GET  /v1/threads/:id/runs/:run_id
 *
 * Storage is **in-memory by design** — the shim is a façade over the real
 * PRISM chat path. Threads expire when the process restarts. Long-term
 * persistence is deferred to the next iteration once the design is validated
 * against real client traffic.
 *
 * Every response carries a `prism_metadata` field so consumers can detect
 * they're talking to PRISM and not the real OpenAI service. This is mandated
 * by Law 6 (Transparency) of the Permanent Active Directives.
 *
 * The module is **transport-agnostic**: the real generation path is supplied
 * via the `chatExecutor` callback so the same code is unit-testable with a
 * fake and wires to `DashboardService` later by injecting the real executor.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------- types

export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
}

export interface ChatCompletionsRequest {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    user?: string;
    stream?: boolean;
}

export interface ChatCompletionsResponse {
    id: string;
    object: "chat.completion";
    created: number;
    model: string;
    choices: Array<{
        index: 0;
        message: ChatMessage;
        finish_reason: "stop" | "length" | "content_filter";
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    prism_metadata: PrismMetadata;
}

export interface ThreadObject {
    id: string;
    object: "thread";
    created_at: number;
    metadata: Record<string, string>;
    prism_metadata: PrismMetadata;
}

export interface ThreadMessage {
    id: string;
    object: "thread.message";
    created_at: number;
    thread_id: string;
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: { value: string } }>;
    metadata: Record<string, string>;
}

export interface RunObject {
    id: string;
    object: "thread.run";
    created_at: number;
    thread_id: string;
    assistant_id: string;
    status: "queued" | "in_progress" | "completed" | "failed";
    model: string;
    started_at: number | null;
    completed_at: number | null;
    failed_at: number | null;
    last_error: { code: string; message: string } | null;
    metadata: Record<string, string>;
    prism_metadata: PrismMetadata;
}

export interface PrismMetadata {
    compat_shim: "openai";
    version: "v1";
    /** Non-OpenAI fields the client may surface for transparency. */
    notice: string;
}

/**
 * The shim does not call models directly. Its host wires this callback to the
 * real PRISM provider path. The fake used in tests just echoes the prompt
 * back, which is enough to verify routing and request/response shape.
 */
export type ChatExecutor = (input: ChatExecutorInput) => Promise<ChatExecutorResult>;

export interface ChatExecutorInput {
    messages: ChatMessage[];
    /** Hint from the client; PRISM is free to remap. */
    requestedModel?: string;
    /** Forwarded for observability/audit. */
    user?: string;
    /** Stable id for traceability. */
    requestId: string;
}

export interface ChatExecutorResult {
    /** The assistant reply text. */
    content: string;
    /** Effective model PRISM used (after remapping). */
    model: string;
    /** Optional usage telemetry. Falls back to a length-based estimate. */
    usage?: { promptTokens: number; completionTokens: number };
    /** Optional finish reason override. */
    finishReason?: "stop" | "length" | "content_filter";
}

// ---------------------------------------------------------------- store

/**
 * In-memory store for threads, messages, and runs. Methods are sync so the
 * shim handlers stay easy to reason about. Thread eviction is intentionally
 * absent for v1 — the shim is a façade, not a database.
 */
export class OpenAiCompatStore {
    private readonly threads = new Map<string, ThreadObject>();
    private readonly messagesByThread = new Map<string, ThreadMessage[]>();
    private readonly runsByThread = new Map<string, RunObject[]>();

    createThread(metadata: Record<string, string> = {}): ThreadObject {
        const id = `thread_${shortId()}`;
        const thread: ThreadObject = {
            id,
            object: "thread",
            created_at: nowSec(),
            metadata: { ...metadata },
            prism_metadata: defaultMetadata(),
        };
        this.threads.set(id, thread);
        this.messagesByThread.set(id, []);
        this.runsByThread.set(id, []);
        return thread;
    }

    getThread(threadId: string): ThreadObject | null {
        return this.threads.get(threadId) ?? null;
    }

    appendMessage(
        threadId: string,
        role: "user" | "assistant",
        text: string,
        metadata: Record<string, string> = {},
    ): ThreadMessage {
        const thread = this.threads.get(threadId);
        if (!thread) throw new ShimError("not_found", `thread '${threadId}' not found`);
        const msg: ThreadMessage = {
            id: `msg_${shortId()}`,
            object: "thread.message",
            created_at: nowSec(),
            thread_id: threadId,
            role,
            content: [{ type: "text", text: { value: text } }],
            metadata: { ...metadata },
        };
        this.messagesByThread.get(threadId)!.push(msg);
        return msg;
    }

    listMessages(threadId: string): ThreadMessage[] {
        if (!this.threads.has(threadId)) {
            throw new ShimError("not_found", `thread '${threadId}' not found`);
        }
        return [...(this.messagesByThread.get(threadId) ?? [])];
    }

    recordRun(run: RunObject): void {
        if (!this.threads.has(run.thread_id)) {
            throw new ShimError("not_found", `thread '${run.thread_id}' not found`);
        }
        this.runsByThread.get(run.thread_id)!.push(run);
    }

    getRun(threadId: string, runId: string): RunObject | null {
        const list = this.runsByThread.get(threadId);
        if (!list) return null;
        return list.find((r) => r.id === runId) ?? null;
    }

    /** Test/diagnostic only. */
    _stats(): { threads: number; messages: number; runs: number } {
        let messages = 0;
        let runs = 0;
        for (const arr of this.messagesByThread.values()) messages += arr.length;
        for (const arr of this.runsByThread.values()) runs += arr.length;
        return { threads: this.threads.size, messages, runs };
    }
}

// ---------------------------------------------------------------- errors

export type ShimErrorCode =
    | "invalid_request"
    | "not_found"
    | "missing_field"
    | "executor_failed";

export class ShimError extends Error {
    constructor(public readonly code: ShimErrorCode, message: string) {
        super(message);
        this.name = "ShimError";
    }
}

export interface ErrorEnvelope {
    error: {
        type: string;
        code: ShimErrorCode;
        message: string;
    };
    prism_metadata: PrismMetadata;
}

export function errorEnvelope(err: ShimError): ErrorEnvelope {
    return {
        error: {
            type: "invalid_request_error",
            code: err.code,
            message: err.message,
        },
        prism_metadata: defaultMetadata(),
    };
}

export function statusForError(err: ShimError): number {
    switch (err.code) {
        case "not_found":
            return 404;
        case "missing_field":
        case "invalid_request":
            return 400;
        case "executor_failed":
            return 502;
    }
}

// ---------------------------------------------------------------- handlers

export interface ShimHandlerDeps {
    store: OpenAiCompatStore;
    chatExecutor: ChatExecutor;
    /** Default model returned when the executor doesn't supply one. */
    defaultModel?: string;
}

/** POST /v1/chat/completions */
export async function handleChatCompletions(
    req: ChatCompletionsRequest,
    deps: ShimHandlerDeps,
): Promise<ChatCompletionsResponse> {
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
        throw new ShimError("missing_field", "field 'messages' must be a non-empty array");
    }
    for (const m of req.messages) {
        if (!m || typeof m !== "object") {
            throw new ShimError("invalid_request", "every message must be an object");
        }
        if (typeof m.role !== "string" || typeof m.content !== "string") {
            throw new ShimError(
                "invalid_request",
                "every message must have string 'role' and 'content'",
            );
        }
    }
    if (req.stream === true) {
        throw new ShimError(
            "invalid_request",
            "streaming is not yet supported by the PRISM OpenAI compat shim; "
            + "use POST /api/chat/stream for SSE",
        );
    }

    const requestId = `chatcmpl-${shortId()}`;
    let result: ChatExecutorResult;
    try {
        result = await deps.chatExecutor({
            messages: req.messages,
            requestedModel: req.model,
            user: req.user,
            requestId,
        });
    } catch (err) {
        throw new ShimError(
            "executor_failed",
            `chat executor failed: ${(err as Error).message}`,
        );
    }

    const promptText = req.messages.map((m) => m.content).join("\n");
    const usage = result.usage ?? estimateUsage(promptText, result.content);

    return {
        id: requestId,
        object: "chat.completion",
        created: nowSec(),
        model: result.model || req.model || deps.defaultModel || "prism-default",
        choices: [
            {
                index: 0,
                message: { role: "assistant", content: result.content },
                finish_reason: result.finishReason ?? "stop",
            },
        ],
        usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.promptTokens + usage.completionTokens,
        },
        prism_metadata: defaultMetadata(),
    };
}

export interface CreateThreadRequest {
    messages?: Array<{ role: "user"; content: string }>;
    metadata?: Record<string, string>;
}

/** POST /v1/threads */
export function handleCreateThread(
    req: CreateThreadRequest | undefined,
    deps: ShimHandlerDeps,
): ThreadObject {
    const thread = deps.store.createThread(req?.metadata ?? {});
    if (req?.messages) {
        for (const m of req.messages) {
            if (m.role !== "user" || typeof m.content !== "string") {
                throw new ShimError(
                    "invalid_request",
                    "thread seed messages must have role='user' and string content",
                );
            }
            deps.store.appendMessage(thread.id, "user", m.content);
        }
    }
    return thread;
}

/** GET /v1/threads/:id */
export function handleGetThread(threadId: string, deps: ShimHandlerDeps): ThreadObject {
    const t = deps.store.getThread(threadId);
    if (!t) throw new ShimError("not_found", `thread '${threadId}' not found`);
    return t;
}

export interface CreateMessageRequest {
    role: "user";
    content: string;
    metadata?: Record<string, string>;
}

/** POST /v1/threads/:id/messages */
export function handleCreateMessage(
    threadId: string,
    req: CreateMessageRequest,
    deps: ShimHandlerDeps,
): ThreadMessage {
    if (!req || req.role !== "user" || typeof req.content !== "string") {
        throw new ShimError(
            "invalid_request",
            "messages.create requires role='user' and string content",
        );
    }
    return deps.store.appendMessage(threadId, "user", req.content, req.metadata ?? {});
}

/** GET /v1/threads/:id/messages */
export function handleListMessages(
    threadId: string,
    deps: ShimHandlerDeps,
): { object: "list"; data: ThreadMessage[]; prism_metadata: PrismMetadata } {
    return {
        object: "list",
        data: deps.store.listMessages(threadId),
        prism_metadata: defaultMetadata(),
    };
}

export interface CreateRunRequest {
    assistant_id: string;
    model?: string;
    metadata?: Record<string, string>;
}

/** POST /v1/threads/:id/runs — synchronous: executes against the thread's user
 *  messages and appends the assistant reply before returning the run object
 *  in `completed` state. Async behaviour can be layered later. */
export async function handleCreateRun(
    threadId: string,
    req: CreateRunRequest,
    deps: ShimHandlerDeps,
): Promise<RunObject> {
    if (!req || typeof req.assistant_id !== "string" || !req.assistant_id) {
        throw new ShimError("missing_field", "field 'assistant_id' is required");
    }
    const messages = deps.store.listMessages(threadId);
    if (messages.length === 0) {
        throw new ShimError(
            "invalid_request",
            "cannot run an empty thread; create at least one message first",
        );
    }

    const runId = `run_${shortId()}`;
    const startedAt = nowSec();
    const chatMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content[0]?.text.value ?? "",
    }));

    let result: ChatExecutorResult;
    try {
        result = await deps.chatExecutor({
            messages: chatMessages,
            requestedModel: req.model,
            requestId: runId,
        });
    } catch (err) {
        const failed: RunObject = {
            id: runId,
            object: "thread.run",
            created_at: startedAt,
            thread_id: threadId,
            assistant_id: req.assistant_id,
            status: "failed",
            model: req.model || deps.defaultModel || "prism-default",
            started_at: startedAt,
            completed_at: null,
            failed_at: nowSec(),
            last_error: {
                code: "executor_failed",
                message: (err as Error).message,
            },
            metadata: req.metadata ?? {},
            prism_metadata: defaultMetadata(),
        };
        deps.store.recordRun(failed);
        return failed;
    }

    deps.store.appendMessage(threadId, "assistant", result.content);

    const run: RunObject = {
        id: runId,
        object: "thread.run",
        created_at: startedAt,
        thread_id: threadId,
        assistant_id: req.assistant_id,
        status: "completed",
        model: result.model || req.model || deps.defaultModel || "prism-default",
        started_at: startedAt,
        completed_at: nowSec(),
        failed_at: null,
        last_error: null,
        metadata: req.metadata ?? {},
        prism_metadata: defaultMetadata(),
    };
    deps.store.recordRun(run);
    return run;
}

/** GET /v1/threads/:id/runs/:run_id */
export function handleGetRun(
    threadId: string,
    runId: string,
    deps: ShimHandlerDeps,
): RunObject {
    const r = deps.store.getRun(threadId, runId);
    if (!r) throw new ShimError("not_found", `run '${runId}' not found in thread '${threadId}'`);
    return r;
}

// ---------------------------------------------------------------- helpers

function defaultMetadata(): PrismMetadata {
    return {
        compat_shim: "openai",
        version: "v1",
        notice:
            "Response generated by PRISM via the OpenAI compatibility shim. "
            + "PRISM is a governance-native, self-hostable agents runtime; this is not the OpenAI service.",
    };
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function shortId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 24);
}

/**
 * Heuristic token estimator: ~4 chars per token. Real PRISM token counts
 * come from the executor when the underlying provider supplies them; this
 * is only the fallback so usage is always populated for client compatibility.
 */
function estimateUsage(prompt: string, completion: string): { promptTokens: number; completionTokens: number } {
    return {
        promptTokens: Math.max(1, Math.ceil(prompt.length / 4)),
        completionTokens: Math.max(1, Math.ceil(completion.length / 4)),
    };
}
