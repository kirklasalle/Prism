import * as assert from "assert";
import { describe, it, before } from "mocha";
import { SSHPInterceptor } from "../src/core/operator/sshp-interceptor.js";
import { CSHManager } from "../src/core/operator/csh-manager.js";

// Mock PrismCovenant for auditing logic verification
class MockCovenant {
  public checks: Array<{ articleId: string; condition: boolean; description: string }> = [];
  check(articleId: string, condition: boolean, description: string): boolean {
    this.checks.push({ articleId, condition, description });
    return condition;
  }
}

describe("SSHP Interceptor & CSH Manager Test Suite", function () {
  this.timeout(5000);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SSHP Interceptor Unit Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("SSHPInterceptor", () => {
    let mockCovenant: MockCovenant;
    let interceptor: SSHPInterceptor;

    before(() => {
      mockCovenant = new MockCovenant();
      interceptor = new SSHPInterceptor(mockCovenant as any);
    });

    it("identifies if PII Redaction is active", () => {
      assert.strictEqual(interceptor.isEnabled(), true);
    });

    it("redacts raw text-level PII patterns from DOM source", () => {
      const sourceHtml = `<div>My email is operator@prism.ai, CC card is 4111-2222-3333-4444, SSN 123-45-6789.</div>`;
      const sanitized = interceptor.sanitizeDom(sourceHtml);

      assert.ok(sanitized.includes("[REDACTED_EMAIL]"), "should mask email");
      assert.ok(sanitized.includes("[REDACTED_CARD]"), "should mask credit card");
      assert.ok(sanitized.includes("[REDACTED_SSN]"), "should mask SSN");
      assert.ok(!sanitized.includes("operator@prism.ai"), "raw email must not exist");
    });

    it("identifies and redacts sensitive input value attributes", () => {
      const sourceHtml = `<input type="password" value="mysecretpwd"><input id="ssn-field" name="ssn" value="999-99-9999"><input name="api-key" value="prism-sk-123">`;
      const sanitized = interceptor.sanitizeDom(sourceHtml);

      assert.ok(sanitized.includes('value="[REDACTED_PII]"'), "password value should be redacted");
      assert.ok(!sanitized.includes("mysecretpwd"), "raw secret value must be scrubbed");
      assert.ok(!sanitized.includes("999-99-9999"), "raw SSN value must be scrubbed");
    });

    it("passes through non-sensitive DOM HTML untouched", () => {
      const sourceHtml = `<div class="container"><p>This is public text.</p><input type="text" name="username" value="kirk"></div>`;
      const sanitized = interceptor.sanitizeDom(sourceHtml);
      assert.strictEqual(sanitized, sourceHtml);
    });

    it("applies SVG black-out coordinate composites over screenshots", async () => {
      // 1x1 transparent PNG buffer
      const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
      );
      const rects = [{ x: 10, y: 10, width: 50, height: 20 }];
      
      const redacted = await interceptor.redactScreenshot(pngBuffer, rects);
      assert.ok(redacted instanceof Buffer, "should return a redesigned Buffer");
      assert.ok(redacted.length > 0, "Buffer should have content");
    });

    it("audits actions and enforces Sacred Covenant protections", async () => {
      // Rule 1: Allow simple navigation and click tracing
      const clickAudit = await interceptor.auditAction("click", { sessionId: "sess-1", selector: "#btn" });
      assert.strictEqual(clickAudit.allowed, true);

      // Rule 2: Block session-less triggers
      const anonymousAudit = await interceptor.auditAction("click", { selector: "#btn" });
      assert.strictEqual(anonymousAudit.allowed, false);
      assert.strictEqual(anonymousAudit.violatedArticle, "accountability.01");

      // Rule 3: safety.03 Scope containment check (Internal dangerous protocols)
      const fileNav = await interceptor.auditAction("navigate", { sessionId: "sess-1", url: "file:///etc/passwd" });
      assert.strictEqual(fileNav.allowed, false);
      assert.strictEqual(fileNav.violatedArticle, "safety.03");

      // Rule 4: safety.02 Destructive evaluation block
      const evalDestructive = await interceptor.auditAction("evaluate", { sessionId: "sess-1", expression: "localStorage.clear()" });
      assert.strictEqual(evalDestructive.allowed, false);
      assert.strictEqual(evalDestructive.violatedArticle, "safety.02");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. CSH Manager Unit Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("CSHManager", () => {
    let cshManager: CSHManager;

    before(() => {
      cshManager = new CSHManager();
    });

    it("serializes dynamic cookies, localStorage, and sessionStorage page states", async () => {
      // Mock Playwright Context
      const mockContext = {
        async storageState() {
          return {
            cookies: [{ name: "sid", value: "abcdef", domain: "prism.ai", path: "/", expires: 0, httpOnly: true, secure: true }],
            origins: [{ origin: "https://prism.ai", localStorage: [{ key: "theme", value: "dark" }] }],
          };
        },
      };

      // Mock Playwright Page
      const mockPage = {
        url() {
          return "https://prism.ai/dashboard";
        },
        async title() {
          return "Dashboard";
        },
        viewportSize() {
          return { width: 1024, height: 768 };
        },
        async evaluate(fn: Function) {
          // Simulate sessionStorage extraction in-page
          return { cart_id: "998877" };
        },
      };

      const handoff = await cshManager.serialize(mockPage as any, mockContext as any, {
        sessionId: "sess-123",
        sourceAgentId: "developer",
        targetAgentId: "operator",
        reason: "captcha_detected",
        objective: "Automate portal",
      });

      assert.ok(handoff.handoffId.startsWith("handoff-"), "should generate handoffId");
      assert.strictEqual(handoff.sessionId, "sess-123");
      assert.strictEqual(handoff.reason, "captcha_detected");
      assert.strictEqual(handoff.targetAgentId, "operator");
      assert.strictEqual(handoff.sessionStorage.cart_id, "998877");
      assert.strictEqual(handoff.storageState.cookies[0].value, "abcdef");
    });

    it("deserializes state back into a running Page and Context", async () => {
      const mockContext = {
        cookiesList: [] as any[],
        async clearCookies() {
          this.cookiesList = [];
        },
        async addCookies(cookies: any[]) {
          this.cookiesList.push(...cookies);
        },
      };

      const mockPage = {
        navigatedTo: "",
        reloaded: false,
        evalsRun: [] as any[],
        url() {
          return "https://prism.ai/dashboard";
        },
        async goto(url: string) {
          this.navigatedTo = url;
        },
        async reload() {
          this.reloaded = true;
        },
        async evaluate(fn: Function, args: any) {
          this.evalsRun.push(args);
        },
      };

      const list = cshManager.getPendingHandoffs();
      assert.strictEqual(list.length, 1);
      const pendingHandoff = list[0];

      const restored = await cshManager.deserialize(pendingHandoff.handoffId, mockPage as any, mockContext as any);
      assert.strictEqual(restored.status, "resolved");
      assert.strictEqual(mockContext.cookiesList[0].name, "sid");
      assert.strictEqual(mockPage.navigatedTo, "https://prism.ai/dashboard");
      assert.strictEqual(mockPage.reloaded, true);
    });
  });
});
