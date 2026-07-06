import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WikiHandler } from "../src/core/operator/routes/wiki-handler.js";

class FakeRes extends EventEmitter {
    statusCode = 200;
    headers: Record<string, string | string[]> = {};
    body = "";
    ended = false;

    setHeader(key: string, value: string | string[]): void {
        this.headers[key.toLowerCase()] = value;
    }

    getHeader(key: string): string | string[] | undefined {
        return this.headers[key.toLowerCase()];
    }

    writeHead(status: number, headers?: Record<string, string>): this {
        this.statusCode = status;
        if (headers) {
            for (const [k, v] of Object.entries(headers)) {
                this.headers[k.toLowerCase()] = v;
            }
        }
        return this;
    }

    write(chunk: string): boolean {
        this.body += chunk;
        return true;
    }

    end(chunk?: string): this {
        if (chunk) this.body += chunk;
        this.ended = true;
        return this;
    }

    json<T>(): T {
        return this.body ? (JSON.parse(this.body) as T) : (null as unknown as T);
    }
}

function makeReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    (emitter as unknown as { method: string }).method = method;
    (emitter as unknown as { url: string }).url = url;
    (emitter as unknown as { headers: Record<string, string> }).headers = headers;
    process.nextTick(() => {
        (emitter as unknown as EventEmitter).emit("end");
    });
    (emitter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<Buffer> })[Symbol.asyncIterator] =
        async function* () {
            return undefined;
        };
    return emitter;
}

export async function testWikiHandler(): Promise<void> {
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), "prism-wiki-handler-"));
    try {
        process.chdir(tempDir);
        mkdirSync(join(tempDir, "docs"));
        writeFileSync(
            join(tempDir, "docs", "README.md"),
            "---\ntitle: Home\ntags: [guide, intro]\n---\n# Prism Wiki\nWelcome to the Prism docs. [Subpage](./SUBPAGE.md)\n",
        );
        writeFileSync(join(tempDir, "docs", "SUBPAGE.md"), "# Subpage\nContent of subpage.\n");

        const handler = new WikiHandler();

        const listRes = new FakeRes();
        await handler.handle(makeReq("GET", "/api/wiki/docs"), listRes as unknown as ServerResponse, {} as never);
        assert.equal(listRes.statusCode, 200);
        const listBody = listRes.json<{
            documents: Array<{ filename: string; title: string; category?: string; tags?: string[] }>;
        }>();
        assert.ok(Array.isArray(listBody.documents));
        assert.equal(listBody.documents.length, 2);
        const readme = listBody.documents.find((doc) => doc.filename === "README.md");
        assert.ok(readme);
        assert.equal(readme!.title, "Home");

        const contentRes = new FakeRes();
        await handler.handle(
            makeReq("GET", "/api/wiki/content?path=README.md"),
            contentRes as unknown as ServerResponse,
            {} as never,
        );
        assert.equal(contentRes.statusCode, 200);
        const contentBody = contentRes.json<{ html: string; title: string; content: string }>();
        assert.equal(contentBody.title, "Home");
        assert.ok(contentBody.html.includes("data-doc-path"));
        assert.ok(contentBody.html.includes('href="#"'));
    } finally {
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
    }
}
