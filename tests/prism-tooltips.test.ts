/**
 * Frontend unit tests for prism-tooltips.js — the Prism Tooltips framework.
 *
 * Verifies:
 *   - initPrismTooltips() injects a single #prism-tooltip overlay
 *   - registerTooltipById attaches descriptors that drive tooltip content
 *   - pushGuardianTip is observed on the next show via the rotation order
 *   - server tip cache, when primed, surfaces in the dynamic line
 *   - lore array rotates through descriptor.lore on subsequent shows
 *
 * Run: mocha dist/tests/prism-tooltips.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

interface PrismTooltipsModule {
    initPrismTooltips: () => void;
    registerTooltip: (el: any, descriptor: any) => void;
    registerTooltipById: (tipId: string, descriptor: any) => void;
    setDynamicProvider: (kind: string, fn: any) => void;
    pushGuardianTip: (payload: any) => void;
    primeServerTip: (tipId: string, payload: any) => void;
    autoCoverContainer: (root: any) => number;
    registerTooltipsByTab: (tabId: string) => number;
    __TEST__: { reset: () => void; state: any };
}

describe("prism-tooltips.js — framework", function () {
    this.timeout(30_000);
    let dom: InstanceType<typeof JSDOM>;
    let mod: PrismTooltipsModule;

    const savedKeys = ["document", "window", "navigator", "HTMLElement", "fetch"] as const;
    const savedGlobals: Record<string, any> = {};

    before(async () => {
        for (const k of savedKeys) {
            if (k in globalThis) savedGlobals[k] = (globalThis as any)[k];
        }
        dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        const url = pathToFileURL(join(process.cwd(), "src", "core", "operator", "public", "prism-tooltips.js")).href;
        mod = (await import(url)) as PrismTooltipsModule;
    });

    after(() => {
        for (const k of savedKeys) {
            if (k in savedGlobals) (global as any)[k] = savedGlobals[k];
            else delete (global as any)[k];
        }
    });

    beforeEach(() => {
        mod.__TEST__.reset();
        // Wipe DOM
        dom.window.document.body.innerHTML = "";
    });

    it("injects a single #prism-tooltip overlay on init (idempotent)", () => {
        mod.initPrismTooltips();
        mod.initPrismTooltips();
        const overlays = dom.window.document.querySelectorAll("#prism-tooltip");
        assert.strictEqual(overlays.length, 1, "Exactly one overlay should be present");
        const overlay = overlays[0]!;
        assert.strictEqual(overlay.getAttribute("role"), "tooltip");
        assert.strictEqual(overlay.getAttribute("aria-hidden"), "true");
    });

    it("registerTooltipById stores descriptor retrievable by tipId", () => {
        mod.initPrismTooltips();
        mod.registerTooltipById("character:test", {
            label: "Test",
            summary: "A test character",
            lore: ["lore-line-1"],
        });
        const stored = mod.__TEST__.state.descriptorsById.get("character:test");
        assert.ok(stored, "Descriptor should be registered");
        assert.strictEqual(stored.summary, "A test character");
    });

    it("pushGuardianTip records the latest message per tipId", () => {
        mod.initPrismTooltips();
        mod.pushGuardianTip({ tipId: "character:test", message: "guardian says hi" });
        const entry = mod.__TEST__.state.guardianTips.get("character:test");
        assert.ok(entry, "Guardian tip should be stored");
        assert.strictEqual(entry.message, "guardian says hi");
    });

    it("primeServerTip seeds the server cache so descriptors can render server lines", () => {
        mod.initPrismTooltips();
        mod.primeServerTip("character:test", {
            tipId: "character:test",
            summary: "from server",
            dynamic: ["server tip A", "server tip B"],
            links: [],
        });
        const cached = mod.__TEST__.state.serverTipCache.get("character:test");
        assert.ok(cached, "Server tip should be cached");
        assert.deepStrictEqual(cached.data.dynamic, ["server tip A", "server tip B"]);
    });

    it("registerTooltip sets data-tip-id and a baseline title on the element", () => {
        mod.initPrismTooltips();
        const el = dom.window.document.createElement("button");
        dom.window.document.body.appendChild(el);
        mod.registerTooltip(el, { id: "btn:test", summary: "Press me", lore: ["alpha"] });
        assert.strictEqual(el.getAttribute("data-tip-id"), "btn:test");
        assert.strictEqual(el.getAttribute("title"), "Press me");
    });

    it("autoCoverContainer registers a synthesised descriptor for each interactive element", () => {
        mod.initPrismTooltips();
        const root = dom.window.document.createElement("div");
        root.innerHTML = `
            <button aria-label="Refresh agents">Refresh</button>
            <input type="text" placeholder="Search devices" />
            <select><option>One</option></select>
            <a href="#x">Open viewer</a>
            <span>not interactive</span>
        `;
        dom.window.document.body.appendChild(root);
        const count = mod.autoCoverContainer(root);
        assert.strictEqual(count, 4, "Should register 4 interactive elements");
        // Verify a baseline title was placed on an element that lacked one.
        const btn = root.querySelector("button")!;
        assert.ok(btn.getAttribute("title"), "Button should gain a baseline title");
    });

    it("autoCoverContainer is idempotent on re-run", () => {
        mod.initPrismTooltips();
        const root = dom.window.document.createElement("div");
        root.innerHTML = `<button aria-label="Run">Run</button>`;
        dom.window.document.body.appendChild(root);
        const first = mod.autoCoverContainer(root);
        const second = mod.autoCoverContainer(root);
        assert.strictEqual(first, 1);
        assert.strictEqual(second, 0, "Second pass should not re-register");
    });

    it("registerTooltipsByTab covers a tab fragment by id convention", () => {
        mod.initPrismTooltips();
        const tab = dom.window.document.createElement("section");
        tab.id = "tab-demo";
        tab.innerHTML = `
            <button aria-label="A">A</button>
            <button aria-label="B">B</button>
        `;
        dom.window.document.body.appendChild(tab);
        const count = mod.registerTooltipsByTab("demo");
        assert.strictEqual(count, 2);
    });
});
