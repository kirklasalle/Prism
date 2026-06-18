import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import { BrowserSessionManager } from "../../core/operator/browser-session-manager.js";
import { BrowserProfileManager } from "../../core/operator/browser-profile-manager.js";
import type { ActivityBus } from "../../core/activity/bus.js";
import type { SSHPInterceptor } from "../../core/operator/sshp-interceptor.js";
import type { CSHManager } from "../../core/operator/csh-manager.js";

const BROWSER_GOVERNANCE: GovernanceSchema = {
  actions: {
    launch_session: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    close_session: { minimumRisk: "low", mutating: true, rollbackRequired: false },
    navigate: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
    click: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    type: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    screenshot: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    evaluate: { minimumRisk: "high", mutating: true, rollbackRequired: true },
    get_console_logs: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    get_network_log: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    get_dom_snapshot: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    list_sessions: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    diagnostics: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    // Navigation helpers (medium-risk)
    go_back: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
    go_forward: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
    reload: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
    // Interaction helpers (medium-risk)
    hover: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
    select_option: { minimumRisk: "medium", mutating: true, rollbackRequired: false }, drag_and_drop: { minimumRisk: "medium", mutating: true, rollbackRequired: false }, scroll: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    wait_for_selector: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    // Page info extraction (low-risk)
    get_page_info: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    get_text_content: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    get_links: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    get_accessibility_tree: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    screenshot_full_page: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    save_pdf: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    // Cookie management (medium-risk)
    get_cookies: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    set_cookie: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    clear_cookies: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    // Profile management (medium-risk)
    list_profiles: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    create_profile: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    delete_profile: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
    get_profile: { minimumRisk: "low", mutating: false, rollbackRequired: false },
  },
};

export class BrowserControlTool implements Tool {
  readonly name = "browser_control";

  readonly contract: ToolContract = {
    version: "2.0.0",
    args: {
      action: {
        type: "string", required: true, enum: [
          "launch_session", "close_session", "navigate", "click", "type",
          "screenshot", "evaluate", "get_console_logs", "get_network_log",
          "get_dom_snapshot", "list_sessions", "diagnostics",
          "go_back", "go_forward", "reload",
          "hover", "select_option", "drag_and_drop", "scroll", "wait_for_selector",
          "get_page_info", "get_text_content", "get_links",
          "get_accessibility_tree", "screenshot_full_page", "save_pdf",
          "get_cookies", "set_cookie", "clear_cookies",
          "list_profiles", "create_profile", "delete_profile", "get_profile",
        ]
      },
      sessionId: { type: "string" },
      url: { type: "string" },
      selector: { type: "string" },
      selector_to: { type: "string" },
      text: { type: "string" },
      expression: { type: "string" },
      headless: { type: "boolean" },
      profileId: { type: "string" },
      values: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      timeout: { type: "number" },
      email: { type: "string" },
      segment: { type: "string" },
      cookie: { type: "string" },
    },
  };

  readonly governance = BROWSER_GOVERNANCE;

  private manager: BrowserSessionManager;
  private profileManager: BrowserProfileManager;
  private sshpInterceptor: SSHPInterceptor | null = null;
  private cshManager: CSHManager | null = null;

  constructor(activityBus?: ActivityBus, sessionId?: string) {
    this.manager = new BrowserSessionManager(activityBus, sessionId);
    this.profileManager = new BrowserProfileManager(activityBus, sessionId);
    this.manager.setProfileManager(this.profileManager);
  }

  setSSHPInterceptor(sshpInterceptor: SSHPInterceptor): void {
    this.sshpInterceptor = sshpInterceptor;
  }

  setCSHManager(cshManager: CSHManager): void {
    this.cshManager = cshManager;
  }

  /** Expose the session manager for direct API-route access. */
  getManager(): BrowserSessionManager {
    return this.manager;
  }

  /** Expose the profile manager for direct API-route access. */
  getProfileManager(): BrowserProfileManager {
    return this.profileManager;
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    const action = String(request.args.action ?? "").trim();
    const sessionId = request.args.sessionId ? String(request.args.sessionId) : undefined;

    try {
      switch (action) {
        case "diagnostics": {
          const diag = await this.manager.diagnostics();
          return { ok: true, output: diag as Record<string, unknown> };
        }

        case "list_sessions": {
          const sessions = this.manager.listSessions();
          return { ok: true, output: { sessions } as unknown as Record<string, unknown> };
        }

        case "launch_session": {
          const headless = request.args.headless === true;
          const profileId = request.args.profileId ? String(request.args.profileId) : undefined;
          const session = await this.manager.launch({
            headless,
            profileId,
            assignmentId: request.args.assignmentId ? String(request.args.assignmentId) : undefined,
            prismUserEmail: request.args.email ? String(request.args.email) : undefined,
          });
          return {
            ok: true,
            output: { ...session } as unknown as Record<string, unknown>,
            sideEffects: [{ type: "process", description: `Browser session launched: ${session.id}${profileId ? ` (profile: ${profileId})` : ""}`, mutating: true, reversible: true }],
          };
        }

        case "close_session": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          await this.manager.closeSession(sessionId);
          return {
            ok: true,
            output: { sessionId, closed: true },
            sideEffects: [{ type: "process", description: `Browser session closed: ${sessionId}`, mutating: true, reversible: false }],
          };
        }

        case "navigate": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const url = String(request.args.url ?? "");
          if (!url) return { ok: false, output: { error: "url is required." } };
          if (this.sshpInterceptor) {
            const audit = await this.sshpInterceptor.auditAction("navigate", { sessionId, url });
            if (!audit.allowed) {
              return { ok: false, output: { error: `SSHP Covenant block: ${audit.reason || "Action violates Sacred Covenant articles"}` } };
            }
          }
          const result = await this.manager.navigate(sessionId, url);
          return {
            ok: true,
            output: result as unknown as Record<string, unknown>,
            sideEffects: [{ type: "network", description: `Navigated to ${url}`, mutating: false, reversible: true }],
          };
        }

        case "click": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const selector = String(request.args.selector ?? "");
          if (!selector) return { ok: false, output: { error: "selector is required." } };
          if (this.sshpInterceptor) {
            const audit = await this.sshpInterceptor.auditAction("click", { sessionId, selector });
            if (!audit.allowed) {
              return { ok: false, output: { error: `SSHP Covenant block: ${audit.reason || "Action violates Sacred Covenant articles"}` } };
            }
          }
          await this.manager.click(sessionId, selector);
          return {
            ok: true,
            output: { sessionId, clicked: selector },
            sideEffects: [{ type: "process", description: `Clicked: ${selector}`, mutating: true, reversible: false }],
          };
        }

        case "type": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const selector = String(request.args.selector ?? "");
          const text = String(request.args.text ?? "");
          if (!selector) return { ok: false, output: { error: "selector is required." } };
          if (this.sshpInterceptor) {
            const audit = await this.sshpInterceptor.auditAction("type", { sessionId, selector, text });
            if (!audit.allowed) {
              return { ok: false, output: { error: `SSHP Covenant block: ${audit.reason || "Action violates Sacred Covenant articles"}` } };
            }
          }
          await this.manager.type(sessionId, selector, text);
          return {
            ok: true,
            output: { sessionId, typed: { selector, length: text.length } },
            sideEffects: [{ type: "process", description: `Typed into: ${selector}`, mutating: true, reversible: false }],
          };
        }

        case "screenshot": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          let buf = await this.manager.screenshot(sessionId);
          if (this.sshpInterceptor && this.sshpInterceptor.isEnabled()) {
            const handles = this.manager.getSessionPageAndContext(sessionId);
            if (handles && handles.page) {
              const sensitiveSelectorMatches = [
                'input[type="password"]',
                'input[autocomplete*="cc-"]',
                'input[autocomplete*="ssn"]',
                'input[autocomplete*="card"]',
                'input[name*="pass"]',
                'input[name*="card"]',
                'input[name*="cvv"]',
                'input[name*="ssn"]',
                'input[name*="secret"]',
                'input[name*="token"]',
                'input[name*="apikey"]',
                'input[name*="api-key"]',
                'input[id*="pass"]',
                'input[id*="card"]',
                'input[id*="cvv"]',
                'input[id*="ssn"]',
                'input[id*="secret"]',
                'input[id*="token"]',
                'input[id*="apikey"]',
                'input[id*="api-key"]',
              ];
              const rects = await handles.page.evaluate((selectors: string[]) => {
                const results: Array<{ x: number; y: number; width: number; height: number }> = [];
                for (const selector of selectors) {
                  const elms = document.querySelectorAll(selector);
                  for (const el of elms) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      results.push({
                        x: rect.left + window.scrollX,
                        y: rect.top + window.scrollY,
                        width: rect.width,
                        height: rect.height
                      });
                    }
                  }
                }
                return results;
              }, sensitiveSelectorMatches).catch(() => []);
              buf = await this.sshpInterceptor.redactScreenshot(buf, rects);
            }
          }
          return {
            ok: true,
            output: { sessionId, sizeBytes: buf.length, format: "png", base64: buf.toString("base64") },
            sideEffects: [{ type: "file", description: "Screenshot captured", mutating: false, reversible: true }],
          };
        }

        case "evaluate": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const expression = String(request.args.expression ?? "");
          if (!expression) return { ok: false, output: { error: "expression is required." } };
          if (this.sshpInterceptor) {
            const audit = await this.sshpInterceptor.auditAction("evaluate", { sessionId, expression });
            if (!audit.allowed) {
              return { ok: false, output: { error: `SSHP Covenant block: ${audit.reason || "Action violates Sacred Covenant articles"}` } };
            }
          }
          const evalResult = await this.manager.evaluate(sessionId, expression);
          return {
            ok: true,
            output: { sessionId, result: evalResult } as unknown as Record<string, unknown>,
            sideEffects: [{ type: "process", description: `Evaluated JS expression (${expression.length} chars)`, mutating: true, reversible: false }],
          };
        }

        case "get_console_logs": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const logs = this.manager.getConsoleLogs(sessionId);
          return { ok: true, output: { sessionId, logs } as unknown as Record<string, unknown> };
        }

        case "get_network_log": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const entries = this.manager.getNetworkLog(sessionId);
          return { ok: true, output: { sessionId, entries } as unknown as Record<string, unknown> };
        }

        case "get_dom_snapshot": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          let html = await this.manager.domSnapshot(sessionId);
          if (this.sshpInterceptor && this.sshpInterceptor.isEnabled()) {
            html = this.sshpInterceptor.sanitizeDom(html);
          }
          return { ok: true, output: { sessionId, html, length: html.length } };
        }

        // ── Navigation helpers ──────────────────────────────────────────
        case "go_back": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const result = await this.manager.goBack(sessionId);
          return { ok: true, output: result as unknown as Record<string, unknown> };
        }
        case "go_forward": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const result = await this.manager.goForward(sessionId);
          return { ok: true, output: result as unknown as Record<string, unknown> };
        }
        case "reload": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const result = await this.manager.reload(sessionId);
          return { ok: true, output: result as unknown as Record<string, unknown> };
        }

        // ── Interaction helpers ─────────────────────────────────────────
        case "hover": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const sel = String(request.args.selector ?? "");
          if (!sel) return { ok: false, output: { error: "selector is required." } };
          await this.manager.hover(sessionId, sel);
          return { ok: true, output: { sessionId, hovered: sel } };
        }
        case "drag_and_drop": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const from = String(request.args.selector ?? "");
          const to = String(request.args.selector_to ?? "");
          if (!from || !to) return { ok: false, output: { error: "selector and selector_to are required." } };
          await this.manager.dragAndDrop(sessionId, from, to);
          return { ok: true, output: { sessionId, dragged: from, droppedOn: to } };
        }
        case "select_option": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const sel = String(request.args.selector ?? "");
          if (!sel) return { ok: false, output: { error: "selector is required." } };
          const vals = String(request.args.values ?? "").split(",").map((v) => v.trim()).filter(Boolean);
          const selected = await this.manager.selectOption(sessionId, sel, vals);
          return { ok: true, output: { sessionId, selector: sel, selected } as unknown as Record<string, unknown> };
        }
        case "scroll": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const sx = Number(request.args.x ?? 0);
          const sy = Number(request.args.y ?? 0);
          await this.manager.scroll(sessionId, sx, sy);
          return { ok: true, output: { sessionId, scrolledTo: { x: sx, y: sy } } };
        }
        case "wait_for_selector": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const sel = String(request.args.selector ?? "");
          if (!sel) return { ok: false, output: { error: "selector is required." } };
          const tms = Number(request.args.timeout ?? 30000);
          const found = await this.manager.waitForSelector(sessionId, sel, tms);
          return { ok: true, output: { sessionId, selector: sel, found } };
        }

        // ── Page info extraction (low-risk) ─────────────────────────────
        case "get_page_info": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const info = await this.manager.getPageInfo(sessionId);
          return { ok: true, output: { sessionId, ...info } };
        }
        case "get_text_content": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const sel = request.args.selector ? String(request.args.selector) : undefined;
          let content = await this.manager.getTextContent(sessionId, sel);
          if (this.sshpInterceptor && this.sshpInterceptor.isEnabled()) {
            content = this.sshpInterceptor.sanitizeDom(content);
          }
          return { ok: true, output: { sessionId, text: content, length: content.length } };
        }
        case "get_links": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const links = await this.manager.getLinks(sessionId);
          return { ok: true, output: { sessionId, links, count: links.length } as unknown as Record<string, unknown> };
        }
        case "get_accessibility_tree": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          let tree = await this.manager.getAccessibilityTree(sessionId);
          if (this.sshpInterceptor && this.sshpInterceptor.isEnabled()) {
            try {
              const serialized = JSON.stringify(tree);
              const sanitized = this.sshpInterceptor.sanitizeDom(serialized);
              tree = JSON.parse(sanitized);
            } catch {
              // fallback
            }
          }
          return { ok: true, output: { sessionId, tree } as unknown as Record<string, unknown> };
        }
        case "screenshot_full_page": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          let buf = await this.manager.screenshotFullPage(sessionId);
          if (this.sshpInterceptor && this.sshpInterceptor.isEnabled()) {
            const handles = this.manager.getSessionPageAndContext(sessionId);
            if (handles && handles.page) {
              const sensitiveSelectorMatches = [
                'input[type="password"]',
                'input[autocomplete*="cc-"]',
                'input[autocomplete*="ssn"]',
                'input[autocomplete*="card"]',
                'input[name*="pass"]',
                'input[name*="card"]',
                'input[name*="cvv"]',
                'input[name*="ssn"]',
                'input[name*="secret"]',
                'input[name*="token"]',
                'input[name*="apikey"]',
                'input[name*="api-key"]',
                'input[id*="pass"]',
                'input[id*="card"]',
                'input[id*="cvv"]',
                'input[id*="ssn"]',
                'input[id*="secret"]',
                'input[id*="token"]',
                'input[id*="apikey"]',
                'input[id*="api-key"]',
              ];
              const rects = await handles.page.evaluate((selectors: string[]) => {
                const results: Array<{ x: number; y: number; width: number; height: number }> = [];
                for (const selector of selectors) {
                  const elms = document.querySelectorAll(selector);
                  for (const el of elms) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      results.push({
                        x: rect.left + window.scrollX,
                        y: rect.top + window.scrollY,
                        width: rect.width,
                        height: rect.height
                      });
                    }
                  }
                }
                return results;
              }, sensitiveSelectorMatches).catch(() => []);
              buf = await this.sshpInterceptor.redactScreenshot(buf, rects);
            }
          }
          return { ok: true, output: { sessionId, sizeBytes: buf.length, format: "png", fullPage: true, base64: buf.toString("base64") } };
        }
        case "save_pdf": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const pdf = await this.manager.savePdf(sessionId);
          return { ok: true, output: { sessionId, sizeBytes: pdf.length, format: "pdf" } };
        }

        // ── Cookie management ───────────────────────────────────────────
        case "get_cookies": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const cookies = await this.manager.getCookies(sessionId);
          return { ok: true, output: { sessionId, cookies, count: cookies.length } as unknown as Record<string, unknown> };
        }
        case "set_cookie": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          const cookieStr = String(request.args.cookie ?? "");
          if (!cookieStr) return { ok: false, output: { error: "cookie (JSON string) is required." } };
          let cookieObj: Record<string, unknown>;
          try { cookieObj = JSON.parse(cookieStr); } catch { return { ok: false, output: { error: "cookie must be valid JSON." } }; }
          await this.manager.setCookie(sessionId, cookieObj);
          return { ok: true, output: { sessionId, cookieSet: true }, sideEffects: [{ type: "process", description: "Cookie set", mutating: true, reversible: true }] };
        }
        case "clear_cookies": {
          if (!sessionId) return { ok: false, output: { error: "sessionId is required." } };
          await this.manager.clearCookies(sessionId);
          return { ok: true, output: { sessionId, cookiesCleared: true }, sideEffects: [{ type: "process", description: "Cookies cleared", mutating: true, reversible: false }] };
        }

        // ── Profile management ──────────────────────────────────────────
        case "list_profiles": {
          const profiles = this.profileManager.listProfiles();
          return { ok: true, output: { profiles, count: profiles.length } as unknown as Record<string, unknown> };
        }
        case "create_profile": {
          const email = String(request.args.email ?? "").toLowerCase().trim();
          if (!email) return { ok: false, output: { error: "email is required." } };
          const segment = (String(request.args.segment ?? "individual")) as "individual" | "business";
          const profile = this.profileManager.createProfile({ prismUserEmail: email, executionProfileSegment: segment });
          return { ok: true, output: { ...profile } as unknown as Record<string, unknown>, sideEffects: [{ type: "file", description: `Browser profile created: ${profile.profileId}`, mutating: true, reversible: true }] };
        }
        case "delete_profile": {
          const pid = String(request.args.profileId ?? "");
          if (!pid) return { ok: false, output: { error: "profileId is required." } };
          const deleted = this.profileManager.deleteProfile(pid);
          return { ok: true, output: { profileId: pid, deleted }, sideEffects: [{ type: "file", description: `Browser profile deleted: ${pid}`, mutating: true, reversible: false }] };
        }
        case "get_profile": {
          const pid = String(request.args.profileId ?? "");
          if (!pid) return { ok: false, output: { error: "profileId is required." } };
          const profile = this.profileManager.getProfile(pid);
          if (!profile) return { ok: false, output: { error: `Profile "${pid}" not found.` } };
          return { ok: true, output: { ...profile } as unknown as Record<string, unknown> };
        }

        default:
          return { ok: false, output: { error: `Unknown browser_control action: "${action}".` } };
      }
    } catch (err: unknown) {
      return { ok: false, output: { error: (err as Error).message ?? "Browser operation failed." } };
    }
  }
}
