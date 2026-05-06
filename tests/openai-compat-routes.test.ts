/**
 * Tests for the OpenAI compatibility *route handler* — the HTTP-layer
 * adapter on top of the pure shim. The shim itself is covered by
 * `openai-compat-shim.test.ts`; here we verify path matching, JSON body
 * parsing, status codes, and 404 fall-through behavior using synthetic
 * `IncomingMessage` / `ServerResponse` stand-ins.
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OpenAiCompatHandler } from "../src/core/operator/routes/openai-compat-handler.js";
import type { ChatExecutor } from "../src/core/compat/openai-assistants.js";
import type { DashboardService } from "../src/core/operator/dashboard-service.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

interface FakeRes {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    writeHead(code: number, headers: Record<string, string>): void;
    end(chunk?: string): void;
}

function makeRes(): FakeRes {
    return {
        statusCode: 0,
        headers: {},
        body: "",
        writeHead(code: number, headers: Record<string, string>) {
            this.statusCode = code;
            this.headers = headers;
        },
        end(chunk?: string) {
            this.body = chunk ?? "";
        },
    };
}

/**
 * Build a synthetic `IncomingMessage` carrying the provided URL/method/body.
 * Body is delivered via two events: `data` (single chunk) then `end`. This
 * is the contract that `DashboardService.readJsonBody()` consumes.
 */
function makeReq(url: string, method: string, body?: unknown): IncomingMessage {
    const ee = new EventEmitter() as IncomingMessage & EventEmitter;
    (ee as unknown as { url: string }).url = url;
    (ee as unknown as { method: string }).method = method;
    (ee as unknown as { headers: Record<string, string> }).headers = {};
    queueMicrotask(() => {
        if (body !== undefined) {
            ee.emit("data", Buffer.from(JSON.stringify(body), "utf-8"));
        }
        ee.emit("end");
    });
    return ee;
}

/**
 * Tiny `DashboardService` stub exposing only the surface the handler uses:
 * `readJsonBody()` (reads `data`/`end` events). The injected ChatExecutor
 * means the LlmProviderManager is never consulted.
 */
function makeService(): DashboardService {
    return {
        readJsonBody<T>(req: IncomingMessage): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                const chunks: Buffer[] = [];
                req.on("data", (c) => chunks.push(Buffer.from(c)));
                req.on("end", () => {
                    const raw = Buffer.concat(chunks).toString("utf-8");
                    if (raw.length === 0) {
                        // Match real readJsonBody behaviour: empty body → throw
                        reject(new Error("empty body"));
                        return;
                    }
                    try {
                        resolve(JSON.parse(raw) as T);
                    } catch (e) {
                        reject(e);
                    }
                });
                req.on("error", reject);
            });
        },
        // Not consulted because the test injects a ChatExecutor.
        getLlmProviderManager() {
            throw new Error("test should not call getLlmProviderManager");
        },
    } as unknown as DashboardService;
}

async function dispatch(
    handler: OpenAiCompatHandler,
    service: DashboardService,
    method: string,
    url: string,
    body?: unknown,
): Promise<{ status: number; body: unknown }> {
    const req = makeReq(url, method, body);
    const res = makeRes();
    assert(handler.match(req), `expected match for ${method} ${url}`);
    await handler.handle(req, res as unknown as ServerResponse, service);
    return {
        status: res.statusCode,
        body: res.body.length > 0 ? JSON.parse(res.body) : null,
    };
}

export async function testOpenAiCompatRoutes(): Promise<void> {
    const echo: ChatExecutor = async (input) => {
        const last = input.messages[input.messages.length - 1];
        return { content: `echo: ${last?.content ?? ""}`, model: input.requestedModel ?? "prism-fake" };
    };
    const handler = new OpenAiCompatHandler({ chatExecutor: echo, defaultModel: "prism-test" });
    const service = makeService();

    // ── chat.completions HTTP round-trip
    {
        const r = await dispatch(handler, service, "POST", "/v1/chat/completions", {
            model: "gpt-4o",
            messages: [{ role: "user", content: "hi" }],
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const b = r.body as { object: string; choices: Array<{ message: { content: string } }>; prism_metadata: { compat_shim: string } };
        assert(b.object === "chat.completion", "object field");
        assert(b.choices[0].message.content === "echo: hi", "executor invoked end-to-end");
        assert(b.prism_metadata.compat_shim === "openai", "transparency tag");
    }

    // ── chat.completions: streaming rejected with proper envelope
    {
        const r = await dispatch(handler, service, "POST", "/v1/chat/completions", {
            messages: [{ role: "user", content: "hi" }],
            stream: true,
        });
        assert(r.status === 400, `expected 400 for stream=true, got ${r.status}`);
        const env = r.body as { error: { code: string; message: string } };
        assert(env.error.code === "invalid_request", "error code");
        assert(env.error.message.toLowerCase().includes("streaming"), "error mentions streaming");
    }

    // ── threads create/get round-trip
    let threadId: string;
    {
        const r = await dispatch(handler, service, "POST", "/v1/threads", {
            metadata: { source: "test" },
        });
        assert(r.status === 200, "create thread 200");
        const t = r.body as { id: string; object: string };
        assert(t.object === "thread", "object");
        threadId = t.id;

        const got = await dispatch(handler, service, "GET", `/v1/threads/${threadId}`);
        assert(got.status === 200, "get thread 200");
        assert((got.body as { id: string }).id === threadId, "round-trip id");
    }

    // ── thread create with no body (idiomatic OpenAI)
    {
        const r = await dispatch(handler, service, "POST", "/v1/threads");
        assert(r.status === 200, "POST /v1/threads with no body succeeds");
    }

    // ── thread not found → 404 envelope
    {
        const r = await dispatch(handler, service, "GET", "/v1/threads/thread_does_not_exist");
        assert(r.status === 404, `expected 404, got ${r.status}`);
        const env = r.body as { error: { code: string } };
        assert(env.error.code === "not_found", "code");
    }

    // ── messages append + list
    {
        const r1 = await dispatch(handler, service, "POST", `/v1/threads/${threadId}/messages`, {
            role: "user",
            content: "what's up",
        });
        assert(r1.status === 200, "append message");

        const r2 = await dispatch(handler, service, "GET", `/v1/threads/${threadId}/messages`);
        assert(r2.status === 200, "list messages");
        const list = r2.body as { data: Array<{ role: string; content: Array<{ text: { value: string } }> }> };
        assert(list.data.length === 1, "1 message");
        assert(list.data[0].content[0].text.value === "what's up", "content preserved");
    }

    // ── runs: full lifecycle through HTTP
    {
        const r = await dispatch(handler, service, "POST", `/v1/threads/${threadId}/runs`, {
            assistant_id: "asst_test",
        });
        assert(r.status === 200, "create run");
        const run = r.body as { id: string; status: string };
        assert(run.status === "completed", "run completed");

        const got = await dispatch(handler, service, "GET", `/v1/threads/${threadId}/runs/${run.id}`);
        assert(got.status === 200, "get run");
        assert((got.body as { id: string }).id === run.id, "run id round-trip");

        // Assistant reply now visible in the message list.
        const list = await dispatch(handler, service, "GET", `/v1/threads/${threadId}/messages`);
        const data = (list.body as { data: Array<{ role: string }> }).data;
        assert(data.length === 2, "user + assistant");
        assert(data[1].role === "assistant", "assistant appended");
    }

    // ── unknown /v1 path → 404 with envelope
    {
        const r = await dispatch(handler, service, "POST", "/v1/threads/abc/wrong");
        assert(r.status === 404, `expected 404 for unknown sub-route, got ${r.status}`);
    }

    // ── handler.match() does not claim non-/v1 paths
    {
        const req = makeReq("/api/health", "GET");
        assert(handler.match(req) === false, "must not match /api/* paths");
    }

    // ── executor failure on /v1/threads/:id/runs surfaces a `failed` run, not a 5xx
    {
        const failingHandler = new OpenAiCompatHandler({
            chatExecutor: async () => {
                throw new Error("provider down");
            },
        });
        const t = await dispatch(failingHandler, service, "POST", "/v1/threads", {});
        const tid = (t.body as { id: string }).id;
        await dispatch(failingHandler, service, "POST", `/v1/threads/${tid}/messages`, {
            role: "user",
            content: "hi",
        });
        const r = await dispatch(failingHandler, service, "POST", `/v1/threads/${tid}/runs`, {
            assistant_id: "asst",
        });
        assert(r.status === 200, "failed run is still HTTP 200");
        const run = r.body as { status: string; last_error: { code: string } | null };
        assert(run.status === "failed", "status reflects failure");
        assert(run.last_error?.code === "executor_failed", "error code");
    }
}
