/**
 * Add-ons API Route Integration Tests — exercises all /api/addons/* REST
 * endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP requests,
 * and validates responses.
 *
 * Run via Mocha: mocha dist/tests/addons-api-routes.test.js --timeout 30000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { _setWorkspaceRootForTest, _resetWorkspaceRootCache } from "../src/core/config/workspace-resolver.js";

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
let authToken = "";
let savedPrefs: string | undefined;

const VALID_MANIFEST_1 = {
    addonFormatVersion: 1,
    id: "prism.addon.testaddon",
    name: "Test Add-on",
    version: "1.0.0",
    description: "A test addon description",
    author: { name: "Test Author" },
    license: "MIT",
    minPrismVersion: "0.22.3",
    trust: "certified",
    integrationPoints: {
        memorySubsystem: false,
        dashboardTab: false,
        characterExtensions: false,
        dashboardSubPanels: [],
        guardianSkills: [],
        policyExtensions: [],
        skillDefinitions: [],
        adapterBridges: []
    },
    dependencies: {
        addons: [],
        plugins: [],
        systemCapabilities: []
    }
};

const VALID_MANIFEST_2 = {
    addonFormatVersion: 1,
    id: "prism.addon.installedaddon",
    name: "Installed Add-on",
    version: "2.1.0",
    description: "An addon installed locally",
    author: { name: "Ext Author" },
    license: "Apache-2.0",
    minPrismVersion: "0.22.3",
    trust: "certified",
    integrationPoints: {
        memorySubsystem: false,
        dashboardTab: false,
        characterExtensions: false,
        dashboardSubPanels: [],
        guardianSkills: [],
        policyExtensions: [],
        skillDefinitions: [],
        adapterBridges: []
    },
    dependencies: {
        addons: [],
        plugins: [],
        systemCapabilities: []
    }
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
}

function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path, headers: authHeaders() }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") });
                } catch {
                    resolve({ status: res.statusCode!, body: data });
                }
            });
        }).on("error", reject);
    });
}

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: body == null ? authHeaders() : authHeaders({ "Content-Type": "application/json" }),
            },
            (res) => {
                let payload = "";
                res.on("data", (chunk: Buffer) => {
                    payload += chunk;
                });
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") });
                    } catch {
                        resolve({ status: res.statusCode!, body: payload });
                    }
                });
            },
        );
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

describe("Add-ons API Routes (/api/addons/*)", function () {
    this.timeout(30_000);

    before(async () => {
        tmpDir = fs.mkdtempSync(join(tmpdir(), "prism-addons-api-"));

        // Isolate the preferences path to avoid polluting the workspace's main prefs file
        savedPrefs = process.env.PRISM_PREFERENCES_PATH;
        process.env.PRISM_PREFERENCES_PATH = join(tmpDir, "isolated-prefs.json");

        // Seed addons directory
        fs.mkdirSync(join(tmpDir, "addons"), { recursive: true });
        fs.mkdirSync(join(tmpDir, "logs"), { recursive: true });

        // Point workspace resolver at the temp dir
        _setWorkspaceRootForTest(tmpDir);

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "addons-api-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],
            0,
            undefined,
            undefined,
            new InMemoryProviderSecretStore(),
            undefined,
            join(tmpDir, "session-packages.json"),
            join(tmpDir, "exports"),
            registry,
        );

        // Mock LLM generation for learning addons
        service.getLlmProviders().generate = async (opts) => {
            return {
                content: JSON.stringify({
                    documentationMarkdown: "# Mock Add-on Docs\nThis is mock documentation.",
                    skillDefinition: {
                        id: "prism.skill.addon_mock_addon",
                        version: "1.0.0",
                        name: "Use Mock Add-on",
                        description: "Mock skill definition",
                        tags: ["addon", "mock_addon"],
                        governance: {
                            min_policy_tier: "tier-2",
                            required_approvals: [],
                            covenant_rules: ["Rule 1"]
                        },
                        triad_templates: {
                            left_hemisphere: "left template",
                            right_hemisphere: "right template",
                            main_hemisphere: "main template"
                        },
                        workflow: {
                            steps: []
                        }
                    }
                })
            } as any;
        };

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");

        // Capture the admin token so requests pass the AuthGate.
        authToken = service.getAuthGate().getToken();
        assert.ok(authToken.length > 0, "AuthGate should expose an admin token");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        _resetWorkspaceRootCache();

        if (savedPrefs === undefined) {
            delete process.env.PRISM_PREFERENCES_PATH;
        } else {
            process.env.PRISM_PREFERENCES_PATH = savedPrefs;
        }

        try {
            fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
            /* ignore */
        }
    });

    it("GET /api/addons/status lists installed addons", async () => {
        // Create a fake addon on disk with a valid manifest
        const fakeAddonPath = join(tmpDir, "addons", "prism.addon.testaddon");
        fs.mkdirSync(fakeAddonPath, { recursive: true });
        fs.writeFileSync(
            join(fakeAddonPath, "addon.manifest.json"),
            JSON.stringify(VALID_MANIFEST_1)
        );

        const { status, body } = await fetchJson("/api/addons/status");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.addons), "addons should be an array");
        const found = body.addons.find((a: any) => a.id === "prism.addon.testaddon");
        assert.ok(found, "should find the prism.addon.testaddon");
        assert.strictEqual(found.name, "Test Add-on");
        assert.strictEqual(found.version, "1.0.0");
        assert.strictEqual(found.enabled, true);
    });

    it("POST /api/addons/toggle disables and enables an addon", async () => {
        // Toggle disable
        const toggleRes1 = await requestJson("POST", "/api/addons/toggle", { id: "prism.addon.testaddon", enabled: false });
        assert.strictEqual(toggleRes1.status, 200);
        assert.strictEqual(toggleRes1.body.success, true);
        assert.strictEqual(toggleRes1.body.enabled, false);

        // Check status reflect changes
        const statusRes1 = await fetchJson("/api/addons/status");
        const addon1 = statusRes1.body.addons.find((a: any) => a.id === "prism.addon.testaddon");
        assert.strictEqual(addon1.enabled, false);

        // Toggle enable
        const toggleRes2 = await requestJson("POST", "/api/addons/toggle", { id: "prism.addon.testaddon", enabled: true });
        assert.strictEqual(toggleRes2.status, 200);
        assert.strictEqual(toggleRes2.body.enabled, true);

        // Check status reflects changes again
        const statusRes2 = await fetchJson("/api/addons/status");
        const addon2 = statusRes2.body.addons.find((a: any) => a.id === "prism.addon.testaddon");
        assert.strictEqual(addon2.enabled, true);
    });

    it("POST /api/addons/install copies a local addon", async () => {
        // Create an external addon to install
        const extDir = fs.mkdtempSync(join(tmpdir(), "prism-addon-ext-"));
        fs.writeFileSync(
            join(extDir, "addon.manifest.json"),
            JSON.stringify(VALID_MANIFEST_2)
        );

        const { status, body } = await requestJson("POST", "/api/addons/install", {
            sourceType: "local",
            pathOrUrl: extDir
        });

        assert.strictEqual(status, 201, `Failed to install local addon: ${JSON.stringify(body)}`);
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.id, "prism.addon.installedaddon");

        // Verify it was copied to the addons directory
        const installedPath = join(tmpDir, "addons", "prism.addon.installedaddon");
        assert.ok(fs.existsSync(installedPath));
        assert.ok(fs.existsSync(join(installedPath, "addon.manifest.json")));

        // Clean up external temp dir
        fs.rmSync(extDir, { recursive: true, force: true });
    });

    it("POST /api/addons/learn generates doc and skill", async () => {
        const { status, body } = await requestJson("POST", "/api/addons/learn", { id: "prism.addon.testaddon" });
        assert.strictEqual(status, 200, `Failed to learn addon: ${JSON.stringify(body)}`);
        assert.strictEqual(body.success, true);
        assert.ok(body.docPath);
        assert.ok(body.skillPath);

        // Verify files exist on disk
        assert.ok(fs.existsSync(body.docPath), "doc file should exist");
        assert.ok(fs.existsSync(body.skillPath), "skill file should exist");

        // Verify contents
        const docContent = fs.readFileSync(body.docPath, "utf-8");
        assert.ok(docContent.includes("# Mock Add-on Docs"));

        const skillContent = JSON.parse(fs.readFileSync(body.skillPath, "utf-8"));
        assert.strictEqual(skillContent.id, "prism.skill.addon_mock_addon");
    });

    it("GET and POST /api/addons/settings retrieves and saves addon settings", async () => {
        // 1. Get default settings
        const getRes1 = await fetchJson("/api/addons/settings?id=prism.addon.installedaddon");
        assert.strictEqual(getRes1.status, 200);
        assert.strictEqual(getRes1.body.autostart, true);
        assert.strictEqual(getRes1.body.logLevel, "info");

        // 2. Post new settings
        const updatedSettings = {
            autostart: false,
            logLevel: "debug",
            threadMode: "child_process",
            mcpPort: 9001,
            customEnvironment: { "TEST_VAR": "hello" }
        };
        const postRes = await requestJson("POST", "/api/addons/settings", {
            id: "prism.addon.installedaddon",
            settings: updatedSettings
        });
        assert.strictEqual(postRes.status, 200);
        assert.strictEqual(postRes.body.success, true);
        assert.strictEqual(postRes.body.settings.autostart, false);
        assert.strictEqual(postRes.body.settings.logLevel, "debug");
        assert.strictEqual(postRes.body.settings.customEnvironment.TEST_VAR, "hello");

        // 3. Get updated settings and verify persistence
        const getRes2 = await fetchJson("/api/addons/settings?id=prism.addon.installedaddon");
        assert.strictEqual(getRes2.status, 200);
        assert.strictEqual(getRes2.body.autostart, false);
        assert.strictEqual(getRes2.body.logLevel, "debug");
        assert.strictEqual(getRes2.body.mcpPort, 9001);
        assert.strictEqual(getRes2.body.customEnvironment.TEST_VAR, "hello");
    });

    it("POST /api/addons/delete backups and deletes the addon directory", async () => {
        const { status, body } = await requestJson("POST", "/api/addons/delete", { id: "prism.addon.testaddon" });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.success, true);

        const installedPath = join(tmpDir, "addons", "prism.addon.testaddon");
        assert.ok(!fs.existsSync(installedPath), "addon directory should have been deleted");

        // Should be found under .backup
        const backupParentDir = join(tmpDir, "addons", ".backup");
        assert.ok(fs.existsSync(backupParentDir), "backup directory should exist");
        const backups = fs.readdirSync(backupParentDir);
        const hasBackup = backups.some(name => name.startsWith("prism.addon.testaddon-"));
        assert.ok(hasBackup, "backup of deleted addon should exist");
    });
});
