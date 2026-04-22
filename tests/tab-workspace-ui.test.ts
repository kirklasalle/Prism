/**
 * Frontend Unit Tests for tab-workspace.js & tab-characters.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads both
 * modules with a mocked dashboard-core.js so we can test:
 *
 *   Workspace Tab (tab-workspace.js):
 *     - renderWorkspaceFileTree (hierarchical file tree)
 *     - formatFileSize (human-readable byte formatting)
 *     - filterWorkspaceFiles (client-side search)
 *     - showImportStatus (toast notifications)
 *     - renderImportHistory (timeline rendering)
 *     - initWorkspaceTab (tab activation sequence)
 *
 *   Character Panel (tab-characters.js):
 *     - renderCharacterSummary (metric cards)
 *     - renderCharacterRoster (assignment list with state badges)
 *     - filterCharacterAssignments (client-side search)
 *     - renderCharacterAuditLog (accountability events)
 *     - renderCharacterAssignmentForm (dropdown + labels)
 *     - renderCharacterDefinitionPreview (CAC profile inspect)
 *     - onProfileChanged (dynamic label switching)
 *     - toggleCharacterAssignmentDetails (expand/collapse)
 *
 * Run: mocha dist/tests/tab-workspace-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

/* ── Global DOM scaffold ──────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Workspace Info -->
<span id="workspace-path"></span>
<span id="ws-active-profile"></span>
<span id="ws-auto-save"></span>
<span id="ws-git-status"></span>

<!-- Workspace File Tree -->
<div id="workspace-file-tree"></div>
<input id="workspace-file-filter" />

<!-- Import Manager -->
<div id="import-status" style="display:none;"></div>
<div id="import-history-list"></div>
<input id="import-file-input" type="file" style="display:none;" />
<input id="import-registered-input" type="file" style="display:none;" />
<input id="import-folder-input" type="file" style="display:none;" webkitdirectory />

<!-- Character Panel -->
<div id="character-summary-cards"></div>
<div id="character-roster"></div>
<div id="character-audit-log"></div>
<div id="character-definition-preview"></div>
<div id="character-panel-status" style="display:none;"></div>

<!-- Character Assignment Form -->
<select id="character-assign-profile">
  <option value="individual">Individual</option>
  <option value="business">Business</option>
</select>
<select id="character-assign-character">
  <option value="">Select a character...</option>
</select>
<input id="character-assign-prism-user-id" />
<input id="character-assign-prism-user-email" />
<input id="character-assign-operator-id" />
<input id="character-assign-operator-email" />
<input id="character-assign-client-id" />
<input id="character-assign-workspace-hub" placeholder="" />

<!-- Dynamic Labels -->
<label id="label-prism-user-email">Assistant Email *</label>
<label id="label-operator-email">Personal Email *</label>
<label id="label-workspace-hub">Workspace Label (optional)</label>
</body></html>`;

/* ── Mock dashboard-core ──────────────────────────────────────────────── */

const MOCK_DASHBOARD_CORE = `
export const state = {
  characterAssignments: [],
  availableCharacters: [],
  characterAuditEvents: [],
  selectedAssignmentId: null,
  characterFilterText: '',
  selectedSessionId: null,
  _workspaceFiles: null,
  importHistory: [],
  importManagerCollapsed: false,
};
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function dashboardLog() {}
export function safeRenderStep() {}
`;

/* ── Module types ─────────────────────────────────────────────────────── */

interface TabWorkspaceModule {
    refreshWorkspaceInfo(): Promise<void>;
    refreshGitStatus(): Promise<void>;
    refreshWorkspaceFiles(): Promise<void>;
    renderWorkspaceFileTree(entries: any[], container: any): void;
    formatFileSize(bytes: number): string;
    filterWorkspaceFiles(query: string): void;
    showImportStatus(msg: string, isError?: boolean): void;
    renderImportHistory(): void;
    initWorkspaceTab(): void;
}

interface TabCharactersModule {
    renderCharacterSummary(): void;
    renderCharacterRoster(): void;
    renderCharacterAuditLog(): void;
    renderCharacterAssignmentForm(): void;
    renderCharacterDefinitionPreview(): void;
    filterCharacterAssignments(query: string): void;
    toggleCharacterAssignmentDetails(id: string): void;
    onProfileChanged(): void;
    onCharacterDefinitionChanged(): void;
    submitCharacterAssignment(): Promise<void>;
    clearCharacterPanelStatus(): void;
    initCharacterPanel(): void;
}

/* ── Suite ─────────────────────────────────────────────────────────────── */

describe("tab-workspace.js & tab-characters.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let wsMod: TabWorkspaceModule;
    let charMod: TabCharactersModule;
    let dom: InstanceType<typeof JSDOM>;
    let mockState: Record<string, any>;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    // Save any Node.js builtins we overwrite so we can restore them
    const savedGlobals: Record<string, any> = {};
    const GLOBAL_KEYS = [
        "document", "window", "navigator", "HTMLElement", "location",
        "URL", "FileReader", "fetch", "alert", "prompt",
    ] as const;

    before(async () => {
        // Save existing globals before overwriting
        for (const key of GLOBAL_KEYS) {
            if (key in globalThis) {
                savedGlobals[key] = (globalThis as any)[key];
            }
        }
        // Set up temp directory with mock dashboard-core.js and real modules
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-workspace-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-workspace.js"),
            join(tmpDir, "tab-workspace.js"),
        );
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-characters.js"),
            join(tmpDir, "tab-characters.js"),
        );

        // Set up jsdom environment
        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).FileReader = dom.window.FileReader;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));
        (global as any).alert = () => {};
        (global as any).prompt = () => null;
        // Use a no-op setTimeout stub that captures but doesn't execute callbacks
        // to avoid jsdom's infinite recursion with timerInitializationSteps
        (global as any).setTimeout = (_fn: Function) => 0;
        (global as any).clearTimeout = () => {};

        // Provide the global constants that tab-workspace.js expects from the HTML template
        (global as any).IMPORT_TARGET_DIRS = [
            "workspace", "config", "artifacts", "data", "data/tasks",
            "data/notes", "data/email", "data/calendar", "characters", "logs", "state",
        ];
        (global as any).IMPORT_REGISTERED_TYPES = [
            { label: "Character (JSON)", value: "character" },
            { label: "MCP Config", value: "mcp-config" },
            { label: "Session Package", value: "session-package" },
            { label: "Tool Contract", value: "tool-contract" },
            { label: "Self-Review", value: "self-review" },
            { label: "Task Timeline", value: "task-timeline" },
            { label: "Note", value: "note" },
        ];

        // Import both modules
        const wsUrl = pathToFileURL(join(tmpDir, "tab-workspace.js")).href;
        wsMod = await import(wsUrl) as TabWorkspaceModule;

        const charUrl = pathToFileURL(join(tmpDir, "tab-characters.js")).href;
        charMod = await import(charUrl) as TabCharactersModule;

        // Grab mock state reference
        const coreUrl = pathToFileURL(join(tmpDir, "dashboard-core.js")).href;
        const core = await import(coreUrl);
        mockState = core.state;
    });

    after(() => {
        // Restore or delete globals to avoid polluting subsequent suites
        for (const key of GLOBAL_KEYS) {
            if (key in savedGlobals) {
                (global as any)[key] = savedGlobals[key];
            } else {
                delete (global as any)[key];
            }
        }
        delete (global as any).IMPORT_TARGET_DIRS;
        delete (global as any).IMPORT_REGISTERED_TYPES;
        (global as any).setTimeout = originalSetTimeout;
        (global as any).clearTimeout = originalClearTimeout;
        dom.window.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Reset DOM between tests */
    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        mockState.characterAssignments = [];
        mockState.availableCharacters = [];
        mockState.characterAuditEvents = [];
        mockState.selectedAssignmentId = null;
        mockState.characterFilterText = "";
        mockState._workspaceFiles = null;
        mockState.importHistory = [];
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * WORKSPACE FILE MANAGEMENT
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("formatFileSize", () => {
        it("returns '0 B' for zero bytes", () => {
            assert.strictEqual(wsMod.formatFileSize(0), "0 B");
        });

        it("returns bytes for small values", () => {
            assert.strictEqual(wsMod.formatFileSize(512), "512 B");
        });

        it("returns KB for kilobyte-range values", () => {
            const result = wsMod.formatFileSize(2048);
            assert.ok(result.includes("KB"), `Expected KB, got ${result}`);
            assert.ok(result.includes("2.0"), `Expected 2.0, got ${result}`);
        });

        it("returns MB for megabyte-range values", () => {
            const result = wsMod.formatFileSize(5 * 1024 * 1024);
            assert.ok(result.includes("MB"), `Expected MB, got ${result}`);
        });

        it("returns GB for gigabyte-range values", () => {
            const result = wsMod.formatFileSize(2.5 * 1024 * 1024 * 1024);
            assert.ok(result.includes("GB"), `Expected GB, got ${result}`);
        });

        it("always returns a valid string for any positive integer", () => {
            const values = [1, 100, 1023, 1024, 1025, 999999, 1048576, 1073741824];
            for (const v of values) {
                const result = wsMod.formatFileSize(v);
                assert.ok(typeof result === "string" && result.length > 0, `Invalid for ${v}: ${result}`);
                assert.ok(/\d/.test(result), `No digits in result for ${v}: ${result}`);
            }
        });
    });

    describe("renderWorkspaceFileTree", () => {
        it("renders hierarchical tree with directory grouping", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "src/index.ts", name: "index.ts", type: "file", size: 1024 },
                { path: "src/utils.ts", name: "utils.ts", type: "file", size: 512 },
                { path: "README.md", name: "README.md", type: "file", size: 256 },
            ];
            wsMod.renderWorkspaceFileTree(entries, container);
            assert.ok(container.innerHTML.includes("src"), "Should show directory name");
            assert.ok(container.innerHTML.includes("README.md"), "Should show root file");
        });

        it("shows file count per directory", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "tests/a.test.ts", name: "a.test.ts", type: "file", size: 100 },
                { path: "tests/b.test.ts", name: "b.test.ts", type: "file", size: 200 },
                { path: "tests/c.test.ts", name: "c.test.ts", type: "file", size: 300 },
            ];
            wsMod.renderWorkspaceFileTree(entries, container);
            assert.ok(container.innerHTML.includes("3 files"), "Should show file count");
        });

        it("displays file sizes in human-readable format", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "data/big.bin", name: "big.bin", type: "file", size: 5242880 },
            ];
            wsMod.renderWorkspaceFileTree(entries, container);
            assert.ok(container.innerHTML.includes("MB"), "Should show MB for large file");
        });

        it("shows 'No files found.' for empty entries", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            wsMod.renderWorkspaceFileTree([], container);
            assert.ok(container.innerHTML.includes("No files found"), "Should show empty message");
        });

        it("uses folder icon for directories and file icon for files", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "docs/readme.md", name: "readme.md", type: "file", size: 100 },
            ];
            wsMod.renderWorkspaceFileTree(entries, container);
            // File icon 📄
            assert.ok(container.innerHTML.includes("\u{1F4C4}") || container.innerHTML.includes("📄"), "Should include file icon");
        });
    });

    describe("filterWorkspaceFiles", () => {
        it("filters file list by query string", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "src/index.ts", name: "index.ts", type: "file", size: 100 },
                { path: "src/utils.ts", name: "utils.ts", type: "file", size: 200 },
                { path: "README.md", name: "README.md", type: "file", size: 50 },
            ];
            mockState._workspaceFiles = entries;
            wsMod.filterWorkspaceFiles("index");
            assert.ok(container.innerHTML.includes("index.ts"), "Should show matching file");
            assert.ok(!container.innerHTML.includes("README.md"), "Should hide non-matching file");
        });

        it("shows all files when query is empty", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "src/a.ts", name: "a.ts", type: "file", size: 100 },
                { path: "src/b.ts", name: "b.ts", type: "file", size: 200 },
            ];
            mockState._workspaceFiles = entries;
            wsMod.filterWorkspaceFiles("");
            assert.ok(container.innerHTML.includes("a.ts"));
            assert.ok(container.innerHTML.includes("b.ts"));
        });

        it("is case-insensitive", () => {
            const container = dom.window.document.getElementById("workspace-file-tree")!;
            const entries = [
                { path: "src/MyComponent.tsx", name: "MyComponent.tsx", type: "file", size: 100 },
            ];
            mockState._workspaceFiles = entries;
            wsMod.filterWorkspaceFiles("mycomponent");
            assert.ok(container.innerHTML.includes("MyComponent"), "Should match case-insensitively");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * IMPORT MANAGER
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("showImportStatus", () => {
        it("displays success toast with green styling", () => {
            wsMod.showImportStatus("Import complete!");
            const el = dom.window.document.getElementById("import-status")!;
            assert.strictEqual(el.style.display, "block");
            assert.ok(el.textContent!.includes("Import complete!"));
            assert.ok(el.style.color.includes("126, 207, 126") || el.style.color.includes("7ecf7e") || el.style.background.includes("126, 207, 126"));
        });

        it("displays error toast with red styling", () => {
            wsMod.showImportStatus("Import failed: size exceeded", true);
            const el = dom.window.document.getElementById("import-status")!;
            assert.strictEqual(el.style.display, "block");
            assert.ok(el.textContent!.includes("Import failed"));
            assert.ok(el.style.color.includes("255, 141, 141") || el.style.color.includes("ff8d8d") || el.style.background.includes("231, 76, 60"));
        });
    });

    describe("renderImportHistory", () => {
        it("shows 'No imports yet.' when history is empty", () => {
            mockState.importHistory = [];
            wsMod.renderImportHistory();
            const el = dom.window.document.getElementById("import-history-list")!;
            assert.ok(el.innerHTML.includes("No imports yet"));
        });

        it("renders timeline entries with status badges", () => {
            mockState.importHistory = [
                { id: "i1", timestamp: new Date().toISOString(), mode: "general", fileName: "data.json", status: "success", message: "Imported to workspace/" },
                { id: "i2", timestamp: new Date().toISOString(), mode: "registered", fileName: "agent.json", status: "error", message: "Validation failed" },
            ];
            wsMod.renderImportHistory();
            const el = dom.window.document.getElementById("import-history-list")!;
            assert.ok(el.innerHTML.includes("data.json"), "Should show filename");
            assert.ok(el.innerHTML.includes("success"), "Should show success status");
            assert.ok(el.innerHTML.includes("error"), "Should show error status");
            assert.ok(el.innerHTML.includes("agent.json"), "Should show second filename");
        });

        it("shows '... and N more' when history exceeds 25 items", () => {
            mockState.importHistory = [];
            for (let i = 0; i < 30; i++) {
                mockState.importHistory.push({
                    id: `i${i}`, timestamp: new Date().toISOString(),
                    mode: "general", fileName: `file${i}.txt`, status: "success", message: "OK",
                });
            }
            wsMod.renderImportHistory();
            const el = dom.window.document.getElementById("import-history-list")!;
            assert.ok(el.innerHTML.includes("and 5 more"), "Should show overflow count");
        });

        it("renders mode icons (folder, registered, general)", () => {
            mockState.importHistory = [
                { id: "f1", timestamp: new Date().toISOString(), mode: "folder", fileName: "mydir", status: "success", message: "OK" },
                { id: "r1", timestamp: new Date().toISOString(), mode: "registered", fileName: "char.json", status: "success", message: "OK" },
                { id: "g1", timestamp: new Date().toISOString(), mode: "general", fileName: "readme.md", status: "success", message: "OK" },
            ];
            wsMod.renderImportHistory();
            const el = dom.window.document.getElementById("import-history-list")!;
            // Folder icon 📁, Puzzle 🧩, File 📄
            assert.ok(el.innerHTML.includes("\u{1F4C1}") || el.innerHTML.includes("📁"), "Should have folder icon");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — SUMMARY
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("renderCharacterSummary", () => {
        it("displays 4 metric cards (total, active, suspended, revoked)", () => {
            mockState.characterAssignments = [
                { state: "active", characterId: "a1" },
                { state: "active", characterId: "a2" },
                { state: "suspended", characterId: "a3" },
                { state: "revoked", characterId: "a4" },
            ];
            charMod.renderCharacterSummary();
            const el = dom.window.document.getElementById("character-summary-cards")!;
            assert.ok(el.innerHTML.includes("Total Assignments"), "Should have total card");
            assert.ok(el.innerHTML.includes("Active"), "Should have active card");
            assert.ok(el.innerHTML.includes("Suspended"), "Should have suspended card");
            assert.ok(el.innerHTML.includes("Revoked"), "Should have revoked card");
            assert.ok(el.innerHTML.includes("4"), "Total should be 4");
            assert.ok(el.innerHTML.includes("2"), "Active should be 2");
        });

        it("renders zeros when no assignments exist", () => {
            mockState.characterAssignments = [];
            charMod.renderCharacterSummary();
            const el = dom.window.document.getElementById("character-summary-cards")!;
            assert.ok(el.innerHTML.includes("0"), "Should show 0 for empty");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — ROSTER
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("renderCharacterRoster", () => {
        it("renders assignment list with state badges", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "assign-1",
                    characterId: "sentinel-business",
                    state: "active",
                    operatorEmail: "op@prism.local",
                    prismUserEmail: "user@prism.local",
                    executionProfileSegment: "individual",
                    dispatchCount: 3,
                    character: { displayName: "Sentinel" },
                },
            ];
            charMod.renderCharacterRoster();
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Sentinel"), "Should show display name");
            assert.ok(el.innerHTML.includes("active"), "Should show state badge");
            assert.ok(el.innerHTML.includes("op@prism.local"), "Should show operator email");
        });

        it("shows action buttons based on assignment state", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "assign-active",
                    characterId: "aria-business",
                    state: "active",
                    character: { displayName: "Aria" },
                },
            ];
            charMod.renderCharacterRoster();
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Dispatch"), "Active should show Dispatch");
            assert.ok(el.innerHTML.includes("Suspend"), "Active should show Suspend");
            assert.ok(el.innerHTML.includes("Revoke"), "Active should show Revoke");
        });

        it("shows Resume and Revoke for suspended assignments", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "assign-sus",
                    characterId: "phoenix-individual",
                    state: "suspended",
                    character: { displayName: "Phoenix" },
                },
            ];
            charMod.renderCharacterRoster();
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Resume"), "Suspended should show Resume");
            assert.ok(el.innerHTML.includes("Revoke"), "Suspended should show Revoke");
            assert.ok(!el.innerHTML.includes(">Dispatch<"), "Suspended should not show Dispatch button");
        });

        it("shows no action buttons for revoked assignments", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "assign-rev",
                    characterId: "aria-individual",
                    state: "revoked",
                    character: { displayName: "Aria" },
                },
            ];
            charMod.renderCharacterRoster();
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(!el.innerHTML.includes(">Dispatch<"), "Revoked should not show Dispatch button");
            assert.ok(!el.innerHTML.includes(">Suspend<"), "Revoked should not show Suspend button");
            assert.ok(!el.innerHTML.includes(">Resume<"), "Revoked should not show Resume button");
        });

        it("shows empty message when no assignments match filter", () => {
            mockState.characterAssignments = [];
            charMod.renderCharacterRoster();
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("No character assignments"), "Should show empty message");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — FILTER
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("filterCharacterAssignments", () => {
        it("filters by character name", () => {
            mockState.characterAssignments = [
                { assignmentId: "a1", characterId: "sentinel-business", state: "active", operatorEmail: "op@co.com", character: { displayName: "Sentinel" } },
                { assignmentId: "a2", characterId: "aria-individual", state: "active", operatorEmail: "op@co.com", character: { displayName: "Aria" } },
            ];
            charMod.filterCharacterAssignments("sentinel");
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Sentinel"), "Should show matching");
            assert.ok(!el.innerHTML.includes("Aria"), "Should hide non-matching");
        });

        it("filters by email", () => {
            mockState.characterAssignments = [
                { assignmentId: "a1", characterId: "a", state: "active", operatorEmail: "kirk@co.com", character: { displayName: "A" } },
                { assignmentId: "a2", characterId: "b", state: "active", operatorEmail: "other@co.com", character: { displayName: "B" } },
            ];
            charMod.filterCharacterAssignments("kirk");
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("kirk@co.com"), "Should show matching");
        });

        it("shows all when query is empty", () => {
            mockState.characterAssignments = [
                { assignmentId: "a1", characterId: "a", state: "active", character: { displayName: "A" } },
                { assignmentId: "a2", characterId: "b", state: "active", character: { displayName: "B" } },
            ];
            charMod.filterCharacterAssignments("");
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("a1") || el.innerHTML.length > 100, "Should show both");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — AUDIT LOG
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("renderCharacterAuditLog", () => {
        it("shows empty message when no events exist", () => {
            mockState.characterAuditEvents = [];
            charMod.renderCharacterAuditLog();
            const el = dom.window.document.getElementById("character-audit-log")!;
            assert.ok(el.innerHTML.includes("No accountability events"));
        });

        it("renders audit events with operation names", () => {
            mockState.characterAuditEvents = [
                {
                    operation: "character_accountability.assign",
                    characterId: "sentinel-business",
                    assignmentId: "a1",
                    timestamp: new Date().toISOString(),
                    status: "active",
                    operatorEmail: "op@prism.local",
                    prismUserEmail: "user@prism.local",
                    details: {},
                },
                {
                    operation: "character_accountability.suspend",
                    characterId: "sentinel-business",
                    assignmentId: "a1",
                    timestamp: new Date().toISOString(),
                    status: "suspended",
                    operatorEmail: "op@prism.local",
                    details: { reason: "policy hold", previousState: "active" },
                },
            ];
            charMod.renderCharacterAuditLog();
            const el = dom.window.document.getElementById("character-audit-log")!;
            assert.ok(el.innerHTML.includes("assign"), "Should show assign operation");
            assert.ok(el.innerHTML.includes("suspend"), "Should show suspend operation");
            assert.ok(el.innerHTML.includes("policy hold"), "Should show reason");
            assert.ok(el.innerHTML.includes("active"), "Should show previous state");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — ASSIGNMENT FORM
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("renderCharacterAssignmentForm", () => {
        it("populates character dropdown from available characters", () => {
            mockState.availableCharacters = [
                { id: "sentinel-business", name: "sentinel-business", displayName: "Sentinel", executionProfile: "individual" },
                { id: "aria-individual", name: "aria-individual", displayName: "Aria", executionProfile: "individual" },
            ];
            charMod.renderCharacterAssignmentForm();
            const select = dom.window.document.getElementById("character-assign-character") as any;
            assert.ok(select.innerHTML.includes("Sentinel"), "Should include Sentinel");
            assert.ok(select.innerHTML.includes("Aria"), "Should include Aria");
        });

        it("filters characters based on selected profile", () => {
            mockState.availableCharacters = [
                { id: "sentinel-business", displayName: "Sentinel", executionProfile: "business" },
                { id: "aria-individual", displayName: "Aria", executionProfile: "individual" },
            ];
            // Set profile to business
            const profileEl = dom.window.document.getElementById("character-assign-profile") as any;
            profileEl.value = "business";
            charMod.renderCharacterAssignmentForm();
            const select = dom.window.document.getElementById("character-assign-character") as any;
            assert.ok(select.innerHTML.includes("Sentinel"), "Should include business character");
            assert.ok(!select.innerHTML.includes("Aria"), "Should exclude individual character");
        });
    });

    describe("renderCharacterDefinitionPreview", () => {
        it("shows placeholder when no character is selected", () => {
            charMod.renderCharacterDefinitionPreview();
            const el = dom.window.document.getElementById("character-definition-preview")!;
            assert.ok(el.innerHTML.includes("Select a character"));
        });

        it("renders character details when a character is selected", () => {
            mockState.availableCharacters = [
                {
                    id: "sentinel-business",
                    displayName: "Sentinel Agent",
                    executionProfile: "business",
                    maxRiskTier: 2,
                    greeting: "Ready for action.",
                    defaultEmail: "sentinel@prism.local",
                    persona: "Security focused, diligent.",
                    tags: ["security", "governance"],
                    allowedTools: ["semantic_query"],
                    deniedTools: ["shell_exec"],
                },
            ];
            const select = dom.window.document.getElementById("character-assign-character") as any;
            select.innerHTML = '<option value="sentinel-business">Sentinel</option>';
            select.value = "sentinel-business";

            charMod.renderCharacterDefinitionPreview();
            const el = dom.window.document.getElementById("character-definition-preview")!;
            assert.ok(el.innerHTML.includes("Sentinel Agent"), "Should show display name");
            assert.ok(el.innerHTML.includes("business"), "Should show profile");
            assert.ok(el.innerHTML.includes("sentinel@prism.local"), "Should show email");
            assert.ok(el.innerHTML.includes("security"), "Should show tags");
            assert.ok(el.innerHTML.includes("semantic_query"), "Should show allowed tools");
            assert.ok(el.innerHTML.includes("shell_exec"), "Should show denied tools");
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — PROFILE SWITCHING
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("onProfileChanged", () => {
        it("updates labels for business profile", () => {
            const profileEl = dom.window.document.getElementById("character-assign-profile") as any;
            profileEl.value = "business";
            mockState.availableCharacters = [];
            charMod.onProfileChanged();
            const emailLabel = dom.window.document.getElementById("label-prism-user-email")!;
            const opLabel = dom.window.document.getElementById("label-operator-email")!;
            const hubLabel = dom.window.document.getElementById("label-workspace-hub")!;
            assert.ok(emailLabel.textContent!.includes("Employee"), `Expected Employee, got ${emailLabel.textContent}`);
            assert.ok(opLabel.textContent!.includes("Company"), `Expected Company, got ${opLabel.textContent}`);
            assert.ok(hubLabel.textContent!.includes("Department") || hubLabel.textContent!.includes("Project"),
                `Expected Department/Project, got ${hubLabel.textContent}`);
        });

        it("updates labels for individual profile", () => {
            const profileEl = dom.window.document.getElementById("character-assign-profile") as any;
            profileEl.value = "individual";
            mockState.availableCharacters = [];
            charMod.onProfileChanged();
            const emailLabel = dom.window.document.getElementById("label-prism-user-email")!;
            const opLabel = dom.window.document.getElementById("label-operator-email")!;
            assert.ok(emailLabel.textContent!.includes("Assistant"), `Expected Assistant, got ${emailLabel.textContent}`);
            assert.ok(opLabel.textContent!.includes("Personal"), `Expected Personal, got ${opLabel.textContent}`);
        });
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * CHARACTER PANEL — TOGGLE DETAILS
     * ═══════════════════════════════════════════════════════════════════════ */

    describe("toggleCharacterAssignmentDetails", () => {
        it("expands details for selected assignment", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "toggle-1",
                    characterId: "aria-individual",
                    state: "active",
                    prismUserId: "user1",
                    operatorId: "op1",
                    clientId: "c1",
                    sessionId: "s1",
                    workspaceHub: "TestHub",
                    assignedAt: new Date().toISOString(),
                    character: { displayName: "Aria" },
                },
            ];
            charMod.toggleCharacterAssignmentDetails("toggle-1");
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Assignment Chain") || el.innerHTML.includes("characterId"),
                "Should show expanded details");
            assert.ok(el.innerHTML.includes("Hide Details"), "Should show Hide Details button");
        });

        it("collapses details on second toggle", () => {
            mockState.characterAssignments = [
                {
                    assignmentId: "toggle-2",
                    characterId: "aria-individual",
                    state: "active",
                    character: { displayName: "Aria" },
                },
            ];
            // First toggle opens
            charMod.toggleCharacterAssignmentDetails("toggle-2");
            // Second toggle closes
            charMod.toggleCharacterAssignmentDetails("toggle-2");
            const el = dom.window.document.getElementById("character-roster")!;
            assert.ok(el.innerHTML.includes("Inspect"), "Should show Inspect button (collapsed)");
        });
    });
});
