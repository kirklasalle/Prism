/**
 * Tests for the OpenAI API compatibility shim.
 *
 * Uses a fake `chatExecutor` so the tests are pure (no network, no provider).
 * Verifies request/response shape parity with the OpenAI surface, error
 * envelopes, and the Threads/Runs lifecycle.
 */

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
    type ShimHandlerDeps,
} from "../src/core/compat/openai-assistants.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

function makeDeps(executor?: ChatExecutor): ShimHandlerDeps {
    return {
        store: new OpenAiCompatStore(),
        defaultModel: "prism-default",
        chatExecutor:
            executor
            ?? (async (input: ChatExecutorInput): Promise<ChatExecutorResult> => {
                const last = input.messages[input.messages.length - 1];
                return {
                    content: `echo: ${last?.content ?? ""}`,
                    model: input.requestedModel ?? "prism-fake",
                };
            }),
    };
}

export async function testOpenAiCompatShim(): Promise<void> {
    // ── chat.completions: happy path
    {
        const deps = makeDeps();
        const out = await handleChatCompletions(
            {
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "you are helpful" },
                    { role: "user", content: "hi" },
                ],
            },
            deps,
        );
        assert(out.object === "chat.completion", "object field");
        assert(out.id.startsWith("chatcmpl-"), "id prefix");
        assert(out.choices.length === 1 && out.choices[0].index === 0, "single choice");
        assert(out.choices[0].message.role === "assistant", "assistant role");
        assert(out.choices[0].message.content === "echo: hi", "executor invoked");
        assert(out.choices[0].finish_reason === "stop", "default finish reason");
        assert(out.usage.total_tokens === out.usage.prompt_tokens + out.usage.completion_tokens, "usage sums");
        assert(out.usage.prompt_tokens > 0 && out.usage.completion_tokens > 0, "usage estimated");
        assert(out.prism_metadata.compat_shim === "openai", "transparency tag present");
        assert(out.model === "gpt-4o", "echoes requested model when executor returned it");
    }

    // ── chat.completions: model fallback to default when executor returns empty
    {
        const deps = makeDeps(async () => ({ content: "x", model: "" }));
        const out = await handleChatCompletions(
            { messages: [{ role: "user", content: "q" }] },
            deps,
        );
        assert(out.model === "prism-default", "falls back to defaultModel");
    }

    // ── chat.completions: missing messages
    {
        const deps = makeDeps();
        let caught: ShimError | null = null;
        try {
            // @ts-expect-error — testing runtime guard
            await handleChatCompletions({}, deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "missing_field", "rejects missing messages");
        assert(statusForError(caught!) === 400, "missing_field maps to 400");
        assert(errorEnvelope(caught!).error.message.includes("messages"), "error references field");
    }

    // ── chat.completions: streaming explicitly rejected
    {
        const deps = makeDeps();
        let caught: ShimError | null = null;
        try {
            await handleChatCompletions(
                { messages: [{ role: "user", content: "q" }], stream: true },
                deps,
            );
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "invalid_request", "rejects stream=true");
        assert(caught!.message.includes("streaming"), "explanatory message");
    }

    // ── chat.completions: executor failure surfaces typed error
    {
        const deps = makeDeps(async () => {
            throw new Error("provider down");
        });
        let caught: ShimError | null = null;
        try {
            await handleChatCompletions({ messages: [{ role: "user", content: "q" }] }, deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "executor_failed", "executor error wrapped");
        assert(statusForError(caught!) === 502, "executor_failed maps to 502");
    }

    // ── threads: create, get, seed messages
    {
        const deps = makeDeps();
        const t = handleCreateThread(
            { metadata: { source: "test" }, messages: [{ role: "user", content: "first" }] },
            deps,
        );
        assert(t.id.startsWith("thread_"), "thread id prefix");
        assert(t.metadata.source === "test", "metadata persisted");
        assert(t.prism_metadata.compat_shim === "openai", "transparency tag");

        const same = handleGetThread(t.id, deps);
        assert(same.id === t.id, "round-trip");

        const list = handleListMessages(t.id, deps);
        assert(list.data.length === 1 && list.data[0].role === "user", "seed message stored");
        assert(list.data[0].content[0].text.value === "first", "seed content preserved");

        let caught: ShimError | null = null;
        try {
            handleGetThread("thread_missing", deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "not_found", "missing thread");
        assert(statusForError(caught!) === 404, "not_found maps to 404");
    }

    // ── thread.create rejects malformed seed messages
    {
        const deps = makeDeps();
        let caught: ShimError | null = null;
        try {
            handleCreateThread(
                // @ts-expect-error — invalid role
                { messages: [{ role: "assistant", content: "bad" }] },
                deps,
            );
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "invalid_request", "seed role guard");
    }

    // ── messages: append
    {
        const deps = makeDeps();
        const t = handleCreateThread(undefined, deps);
        const m = handleCreateMessage(t.id, { role: "user", content: "hello" }, deps);
        assert(m.id.startsWith("msg_"), "message id prefix");
        assert(m.thread_id === t.id, "thread linkage");

        let caught: ShimError | null = null;
        try {
            // @ts-expect-error — invalid role
            handleCreateMessage(t.id, { role: "assistant", content: "x" }, deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "invalid_request", "rejects assistant role");
    }

    // ── runs: happy path executes and appends assistant reply
    {
        const deps = makeDeps();
        const t = handleCreateThread(undefined, deps);
        handleCreateMessage(t.id, { role: "user", content: "what's 2+2?" }, deps);
        const run = await handleCreateRun(t.id, { assistant_id: "asst_test" }, deps);
        assert(run.status === "completed", "run completes");
        assert(run.last_error === null, "no error");
        assert(run.completed_at !== null, "completed_at set");
        assert(run.id.startsWith("run_"), "run id prefix");

        const list = handleListMessages(t.id, deps);
        assert(list.data.length === 2, "assistant reply appended");
        assert(list.data[1].role === "assistant", "second message is assistant");
        assert(list.data[1].content[0].text.value.startsWith("echo:"), "executor produced reply");

        const fetched = handleGetRun(t.id, run.id, deps);
        assert(fetched.id === run.id, "run retrievable");

        let caught: ShimError | null = null;
        try {
            handleGetRun(t.id, "run_missing", deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "not_found", "missing run");
    }

    // ── runs: empty thread refused
    {
        const deps = makeDeps();
        const t = handleCreateThread(undefined, deps);
        let caught: ShimError | null = null;
        try {
            await handleCreateRun(t.id, { assistant_id: "asst_test" }, deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "invalid_request", "empty thread refused");
    }

    // ── runs: missing assistant_id
    {
        const deps = makeDeps();
        const t = handleCreateThread(undefined, deps);
        handleCreateMessage(t.id, { role: "user", content: "hi" }, deps);
        let caught: ShimError | null = null;
        try {
            // @ts-expect-error — missing field
            await handleCreateRun(t.id, {}, deps);
        } catch (err) {
            caught = err as ShimError;
        }
        assert(caught !== null && caught.code === "missing_field", "assistant_id required");
    }

    // ── runs: executor failure produces a `failed` run record (not a throw)
    {
        const deps = makeDeps(async () => {
            throw new Error("upstream 503");
        });
        const t = handleCreateThread(undefined, deps);
        handleCreateMessage(t.id, { role: "user", content: "hi" }, deps);
        const run = await handleCreateRun(t.id, { assistant_id: "asst_test" }, deps);
        assert(run.status === "failed", "run records failure");
        assert(run.last_error !== null && run.last_error.code === "executor_failed", "error code");
        assert(run.last_error!.message.includes("upstream 503"), "error message preserved");
        assert(run.failed_at !== null && run.completed_at === null, "timestamps reflect failure");

        // The thread should NOT have an assistant message appended on failure.
        const msgs = handleListMessages(t.id, deps).data;
        assert(msgs.length === 1 && msgs[0].role === "user", "no assistant message on failure");
    }

    // ── store stats sanity
    {
        const deps = makeDeps();
        const t = handleCreateThread(undefined, deps);
        handleCreateMessage(t.id, { role: "user", content: "a" }, deps);
        handleCreateMessage(t.id, { role: "user", content: "b" }, deps);
        await handleCreateRun(t.id, { assistant_id: "asst" }, deps);
        const stats = deps.store._stats();
        assert(stats.threads === 1, "1 thread");
        assert(stats.messages === 3, "2 user + 1 assistant");
        assert(stats.runs === 1, "1 run");
    }

    // ── prism_metadata is on every response shape
    {
        const deps = makeDeps();
        const cmpl = await handleChatCompletions(
            { messages: [{ role: "user", content: "ping" }] },
            deps,
        );
        const t = handleCreateThread(undefined, deps);
        handleCreateMessage(t.id, { role: "user", content: "ping" }, deps);
        const run = await handleCreateRun(t.id, { assistant_id: "asst" }, deps);
        const list = handleListMessages(t.id, deps);
        assert(cmpl.prism_metadata.notice.includes("PRISM"), "notice on chat completions");
        assert(t.prism_metadata.notice.includes("PRISM"), "notice on thread");
        assert(run.prism_metadata.notice.includes("PRISM"), "notice on run");
        assert(list.prism_metadata.notice.includes("PRISM"), "notice on message list");
    }
}
