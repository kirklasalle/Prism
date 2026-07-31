import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SetupHandler } from "../src/core/operator/routes/setup-handler.js";

type PrincipalLike = { email: string; roles: string[] } | null;

function makeRes() {
    return {
        statusCode: 0,
        headers: {} as Record<string, string>,
        body: "",
        writeHead(code: number, headers: Record<string, string>) {
            this.statusCode = code;
            this.headers = { ...this.headers, ...headers };
            return this;
        },
        end(chunk?: string) {
            if (chunk) this.body += chunk;
        },
    };
}

function makeService(opts: {
    principal: PrincipalLike;
    hasCert: boolean;
    tokenValid?: boolean;
    authToken?: string;
}) {
    return {
        getPort: () => 7070,
        listSessionPackages: () =>
            opts.hasCert
                ? [{ title: "Initialization Certificate", sessionIds: ["s1"] }]
                : [{ title: "Some Other Package", sessionIds: ["s2"] }],
        getIamHandler: () => ({
            resolvePrincipalFromCookie: () => opts.principal,
        }),
        getAuthGate: () => ({
            check: () => ({ authenticated: opts.tokenValid ?? false }),
            getToken: () => opts.authToken ?? "server-generated-token",
        }),
    } as any;
}

describe("SetupHandler auth behavior", () => {
    const handler = new SetupHandler();
    const oldPrefsPath = process.env.PRISM_PREFERENCES_PATH;
    let tempDir = "";
    let prefsPath = "";

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), "prism-setup-handler-auth-"));
        prefsPath = join(tempDir, "prefs.json");
        process.env.PRISM_PREFERENCES_PATH = prefsPath;
        delete process.env.PRISM_AUTH_DISABLED;
    });

    afterEach(() => {
        if (oldPrefsPath !== undefined) {
            process.env.PRISM_PREFERENCES_PATH = oldPrefsPath;
        } else {
            delete process.env.PRISM_PREFERENCES_PATH;
        }
        delete process.env.PRISM_AUTH_DISABLED;
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    });

    it("serves setup page to unauthenticated users so anyone can start the wizard", async () => {
        writeFileSync(
            prefsPath,
            JSON.stringify({ setupComplete: true, lastModified: new Date().toISOString() }) + "\n",
            "utf-8",
        );

        const req = { method: "GET", url: "/setup?rerun=true", headers: {} } as any;
        const res = makeRes() as any;
        const service = makeService({ principal: null, hasCert: true, tokenValid: false });

        await handler.handle(req, res, service);

        assert.equal(res.statusCode, 200);
        assert.match(res.body, /Setup Wizard/i);
    });

    it("serves setup page when setup is incomplete without requiring auth", async () => {
        writeFileSync(
            prefsPath,
            JSON.stringify({ setupComplete: false, lastModified: new Date().toISOString() }) + "\n",
            "utf-8",
        );

        const req = { method: "GET", url: "/setup?rerun=true", headers: {} } as any;
        const res = makeRes() as any;
        const service = makeService({ principal: null, hasCert: false, tokenValid: false });

        await handler.handle(req, res, service);

        assert.equal(res.statusCode, 200);
        assert.match(res.body, /Setup Wizard/i);
    });

    it("injects auth token into setup page for authenticated cookie sessions", async () => {
        writeFileSync(
            prefsPath,
            JSON.stringify({ setupComplete: true, lastModified: new Date().toISOString() }) + "\n",
            "utf-8",
        );

        const req = { method: "GET", url: "/setup", headers: {} } as any;
        const res = makeRes() as any;
        const service = makeService({
            principal: { email: "operator@example.com", roles: ["admin"] },
            hasCert: true,
            tokenValid: false,
            authToken: "cookie-session-token",
        });

        await handler.handle(req, res, service);

        assert.equal(res.statusCode, 200);
        assert.match(res.body, /meta name="prism-auth-token" content="cookie-session-token"/i);
    });
});
