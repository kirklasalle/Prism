import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { BrowserProfileManager } from "./browser-profile-manager.js";

// ── Session lifecycle states ────────────────────────────────────────────
export type BrowserSessionState =
  | "idle"
  | "launching"
  | "active"
  | "navigating"
  | "suspended"
  | "terminated";

// ── Network log entry ───────────────────────────────────────────────────
export interface NetworkLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  resourceType: string;
  sizeBytes: number;
  durationMs: number;
}

// ── Console log entry ───────────────────────────────────────────────────
export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
}

// ── Session record ──────────────────────────────────────────────────────
export interface BrowserSession {
  id: string;
  state: BrowserSessionState;
  headless: boolean;
  currentUrl: string;
  title: string;
  networkLog: NetworkLogEntry[];
  consoleLog: ConsoleLogEntry[];
  createdAt: string;
  updatedAt: string;
  // Profile binding
  profileId?: string;
  assignmentId?: string;
  prismUserEmail?: string;
  profileSyncedAt?: string;
  // CAC fingerprint
  userAgent?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  sessionToken?: string;
}

// ── Launch options ───────────────────────────────────────────────────────
export interface BrowserLaunchOptions {
  headless?: boolean;
  sessionId?: string;
  profileId?: string;
  assignmentId?: string;
  prismUserEmail?: string;
}

// ── Serialized session info (no Playwright internals) ───────────────────
export interface BrowserSessionInfo {
  id: string;
  state: BrowserSessionState;
  headless: boolean;
  currentUrl: string;
  title: string;
  networkLogCount: number;
  consoleLogCount: number;
  createdAt: string;
  updatedAt: string;
  profileId?: string;
  assignmentId?: string;
  prismUserEmail?: string;
  // CAC fingerprint
  userAgent?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  sessionToken?: string;
}

// ── Internal record holding Playwright handles ──────────────────────────
interface InternalSession {
  meta: BrowserSession;
  browser: unknown;   // playwright Browser
  context: unknown;    // playwright BrowserContext
  page: unknown;       // playwright Page
}

const MAX_NETWORK_LOG = 500;
const MAX_CONSOLE_LOG = 500;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Manages browser sessions backed by Playwright.
 * Provides session lifecycle, network/console capture, and screenshot support.
 * All operations emit audit events to the ActivityBus.
 */
export class BrowserSessionManager {
  private sessions = new Map<string, InternalSession>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pw: typeof import("playwright") | null = null;
  private profileManager: BrowserProfileManager | null = null;

  constructor(
    private readonly activityBus?: ActivityBus,
    private readonly sessionId?: string,
  ) { }

  /** Attach a BrowserProfileManager for persistent profile support. */
  setProfileManager(pm: BrowserProfileManager): void {
    this.profileManager = pm;
  }

  /** Get the attached profile manager, if any. */
  getProfileManager(): BrowserProfileManager | null {
    return this.profileManager;
  }

  // ── Lazy-load Playwright ────────────────────────────────────────────
  private async playwright(): Promise<typeof import("playwright")> {
    if (!this.pw) {
      this.pw = await import("playwright");
    }
    return this.pw;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────
  async diagnostics(): Promise<Record<string, unknown>> {
    try {
      const pw = await this.playwright();
      return {
        playwrightAvailable: true,
        chromium: !!pw.chromium,
        firefox: !!pw.firefox,
        webkit: !!pw.webkit,
      };
    } catch (err: unknown) {
      return {
        playwrightAvailable: false,
        error: (err as Error).message ?? "Unknown error",
      };
    }
  }

  // ── Launch ──────────────────────────────────────────────────────────
  async launch(options?: BrowserLaunchOptions): Promise<BrowserSession> {
    const pw = await this.playwright();
    const id = options?.sessionId ?? `browser-${randomUUID().slice(0, 8)}`;
    const headless = options?.headless ?? true;
    const now = new Date().toISOString();

    const meta: BrowserSession = {
      id,
      state: "launching",
      headless,
      currentUrl: "about:blank",
      title: "",
      networkLog: [],
      consoleLog: [],
      createdAt: now,
      updatedAt: now,
      profileId: options?.profileId,
      assignmentId: options?.assignmentId,
      prismUserEmail: options?.prismUserEmail,
    };

    const browser = await pw.chromium.launch({ headless });

    // Load persistent profile storageState if a profileId is provided
    let contextOptions: Record<string, unknown> = {};
    if (options?.profileId && this.profileManager) {
      const stored = this.profileManager.loadStorageState(options.profileId);
      if (stored) {
        contextOptions = { storageState: stored };
        meta.profileSyncedAt = now;
      }
      this.profileManager.recordSessionLaunch(options.profileId);
    }

    const context = await (browser as any).newContext(contextOptions);
    const page = await (context as any).newPage();

    // Network interception — log all responses
    (page as any).on("response", (response: any) => {
      const request = response.request();
      const entry: NetworkLogEntry = {
        id: randomUUID().slice(0, 8),
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        status: response.status(),
        statusText: response.statusText(),
        resourceType: request.resourceType(),
        sizeBytes: 0,
        durationMs: 0,
      };
      // Try to get timing
      try {
        const timing = request.timing?.();
        if (timing && timing.responseEnd > 0) {
          entry.durationMs = Math.round(timing.responseEnd);
        }
      } catch { /* timing unavailable */ }

      meta.networkLog.push(entry);
      if (meta.networkLog.length > MAX_NETWORK_LOG) {
        meta.networkLog.splice(0, meta.networkLog.length - MAX_NETWORK_LOG);
      }
    });

    // Console capture
    (page as any).on("console", (msg: any) => {
      const level = msg.type() === "warning" ? "warn" : msg.type() as ConsoleLogEntry["level"];
      const entry: ConsoleLogEntry = {
        id: randomUUID().slice(0, 8),
        timestamp: new Date().toISOString(),
        level: ["log", "info", "warn", "error", "debug"].includes(level) ? level : "log",
        text: msg.text(),
      };
      meta.consoleLog.push(entry);
      if (meta.consoleLog.length > MAX_CONSOLE_LOG) {
        meta.consoleLog.splice(0, meta.consoleLog.length - MAX_CONSOLE_LOG);
      }
    });

    meta.state = "active";
    meta.updatedAt = new Date().toISOString();

    // ── CAC fingerprint capture ────────────────────────────────────────
    try {
      meta.userAgent = await (page as any).evaluate(() => navigator.userAgent) as string;
    } catch { /* not critical */ }
    try {
      const vp = (page as any).viewportSize?.();
      if (vp) { meta.viewportWidth = vp.width; meta.viewportHeight = vp.height; }
    } catch { /* not critical */ }
    meta.sessionToken = randomUUID();

    this.sessions.set(id, { meta, browser, context, page });
    this.resetIdleTimer(id);
    this.emit("browser.session.started", {
      sessionId: id,
      headless,
      profileId: meta.profileId,
      prismUserEmail: meta.prismUserEmail,
      assignmentId: meta.assignmentId,
      userAgent: meta.userAgent,
      viewportWidth: meta.viewportWidth,
      viewportHeight: meta.viewportHeight,
      sessionToken: meta.sessionToken,
    });

    return { ...meta };
  }

  // ── Navigate ────────────────────────────────────────────────────────
  async navigate(sessionId: string, url: string): Promise<{ title: string; url: string }> {
    const s = this.requireSession(sessionId);

    // Normalize URL: prepend https:// if no protocol specified
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    // Security: block dangerous protocols
    const proto = normalizedUrl.split(":")[0].toLowerCase();
    if (proto !== "http" && proto !== "https") {
      throw new Error(`Blocked navigation to disallowed protocol: ${proto}`);
    }

    s.meta.state = "navigating";
    s.meta.updatedAt = new Date().toISOString();

    await (s.page as any).goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    s.meta.currentUrl = (s.page as any).url();
    s.meta.title = await (s.page as any).title();
    s.meta.state = "active";
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.navigate.completed", { sessionId, url: s.meta.currentUrl, title: s.meta.title });

    return { title: s.meta.title, url: s.meta.currentUrl };
  }

  // ── Click ───────────────────────────────────────────────────────────
  async click(sessionId: string, selector: string): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.page as any).click(selector, { timeout: 10000 });
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.click.completed", { sessionId, selector });
  }

  // ── Type ────────────────────────────────────────────────────────────
  async type(sessionId: string, selector: string, text: string): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.page as any).fill(selector, text, { timeout: 10000 });
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.type.completed", { sessionId, selector, textLength: text.length });
  }

  // ── Screenshot ──────────────────────────────────────────────────────
  async screenshot(sessionId: string): Promise<Buffer> {
    const s = this.requireSession(sessionId);
    const buf = await (s.page as any).screenshot({ type: "png" });
    this.resetIdleTimer(sessionId);
    this.emit("browser.screenshot.captured", { sessionId });
    return buf;
  }

  // ── Evaluate ────────────────────────────────────────────────────────
  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const s = this.requireSession(sessionId);
    const result = await (s.page as any).evaluate(expression);
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.evaluate.completed", { sessionId, expressionLength: expression.length });
    return result;
  }

  // ── DOM Snapshot ────────────────────────────────────────────────────
  async domSnapshot(sessionId: string): Promise<string> {
    const s = this.requireSession(sessionId);
    const html: string = await (s.page as any).content();
    this.resetIdleTimer(sessionId);
    return html;
  }

  // ── Console Logs ────────────────────────────────────────────────────
  getConsoleLogs(sessionId: string): ConsoleLogEntry[] {
    return [...this.requireSession(sessionId).meta.consoleLog];
  }

  // ── Network Log ─────────────────────────────────────────────────────
  getNetworkLog(sessionId: string): NetworkLogEntry[] {
    return [...this.requireSession(sessionId).meta.networkLog];
  }

  // ── List Sessions ───────────────────────────────────────────────────
  listSessions(): BrowserSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.meta.id,
      state: s.meta.state,
      headless: s.meta.headless,
      currentUrl: s.meta.currentUrl,
      title: s.meta.title,
      networkLogCount: s.meta.networkLog.length,
      consoleLogCount: s.meta.consoleLog.length,
      createdAt: s.meta.createdAt,
      updatedAt: s.meta.updatedAt,
      profileId: s.meta.profileId,
      assignmentId: s.meta.assignmentId,
      prismUserEmail: s.meta.prismUserEmail,
      userAgent: s.meta.userAgent,
      viewportWidth: s.meta.viewportWidth,
      viewportHeight: s.meta.viewportHeight,
      sessionToken: s.meta.sessionToken,
    }));
  }

  // ── Get Session ─────────────────────────────────────────────────────
  getSession(sessionId: string): BrowserSessionInfo | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return {
      id: s.meta.id,
      state: s.meta.state,
      headless: s.meta.headless,
      currentUrl: s.meta.currentUrl,
      title: s.meta.title,
      networkLogCount: s.meta.networkLog.length,
      consoleLogCount: s.meta.consoleLog.length,
      createdAt: s.meta.createdAt,
      updatedAt: s.meta.updatedAt,
      profileId: s.meta.profileId,
      assignmentId: s.meta.assignmentId,
      prismUserEmail: s.meta.prismUserEmail,
      userAgent: s.meta.userAgent,
      viewportWidth: s.meta.viewportWidth,
      viewportHeight: s.meta.viewportHeight,
      sessionToken: s.meta.sessionToken,
    };
  }

  // ── Close Session ───────────────────────────────────────────────────
  async closeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    this.clearIdleTimer(sessionId);
    s.meta.state = "terminated";
    s.meta.updatedAt = new Date().toISOString();

    // Save profile storageState before closing
    if (s.meta.profileId && this.profileManager && s.context) {
      try {
        const storageState = await (s.context as any).storageState();
        this.profileManager.saveStorageState(s.meta.profileId, storageState);
        s.meta.profileSyncedAt = new Date().toISOString();
      } catch { /* best-effort profile save */ }
    }

    try {
      await (s.browser as any).close();
    } catch { /* already closed */ }

    this.sessions.delete(sessionId);
    this.emit("browser.session.terminated", { sessionId, profileId: s.meta.profileId });
  }

  // ── Close All ───────────────────────────────────────────────────────
  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.closeSession(id);
    }
  }

  // ── Navigation helpers ──────────────────────────────────────────────
  async goBack(sessionId: string): Promise<{ url: string; title: string }> {
    const s = this.requireSession(sessionId);
    await (s.page as any).goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
    s.meta.currentUrl = (s.page as any).url();
    s.meta.title = await (s.page as any).title();
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.goBack.completed", { sessionId, url: s.meta.currentUrl });
    return { url: s.meta.currentUrl, title: s.meta.title };
  }

  async goForward(sessionId: string): Promise<{ url: string; title: string }> {
    const s = this.requireSession(sessionId);
    await (s.page as any).goForward({ waitUntil: "domcontentloaded", timeout: 30000 });
    s.meta.currentUrl = (s.page as any).url();
    s.meta.title = await (s.page as any).title();
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.goForward.completed", { sessionId, url: s.meta.currentUrl });
    return { url: s.meta.currentUrl, title: s.meta.title };
  }

  async reload(sessionId: string): Promise<{ url: string; title: string }> {
    const s = this.requireSession(sessionId);
    await (s.page as any).reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    s.meta.currentUrl = (s.page as any).url();
    s.meta.title = await (s.page as any).title();
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.reload.completed", { sessionId, url: s.meta.currentUrl });
    return { url: s.meta.currentUrl, title: s.meta.title };
  }

  // ── Interaction helpers ─────────────────────────────────────────────
  async hover(sessionId: string, selector: string): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.page as any).hover(selector, { timeout: 10000 });
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.hover.completed", { sessionId, selector });
  }

  async dragAndDrop(sessionId: string, fromSelector: string, toSelector: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await (session.page as any).dragAndDrop(fromSelector, toSelector, { timeout: 20000 });
    session.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.dragAndDrop.completed", { sessionId, from: fromSelector, to: toSelector });
  }

  async selectOption(sessionId: string, selector: string, values: string[]): Promise<string[]> {
    const s = this.requireSession(sessionId);
    const selected: string[] = await (s.page as any).selectOption(selector, values, { timeout: 10000 });
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.selectOption.completed", { sessionId, selector, selectedCount: selected.length });
    return selected;
  }

  async scroll(sessionId: string, x: number, y: number): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.page as any).evaluate(`window.scrollTo(${Number(x)}, ${Number(y)})`);
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.scroll.completed", { sessionId, x, y });
  }

  async waitForSelector(sessionId: string, selector: string, timeoutMs = 30000): Promise<boolean> {
    const s = this.requireSession(sessionId);
    try {
      await (s.page as any).waitForSelector(selector, { timeout: timeoutMs });
      this.resetIdleTimer(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  // ── Page info extraction (low-risk, read-only) ──────────────────────
  async getPageInfo(sessionId: string): Promise<Record<string, unknown>> {
    const s = this.requireSession(sessionId);
    const page = s.page as any;
    const title = await page.title();
    const url = page.url();
    const viewport = page.viewportSize();
    const scrollPosition = await page.evaluate('({ x: window.scrollX, y: window.scrollY })');
    this.resetIdleTimer(sessionId);
    return { title, url, viewport, scrollPosition };
  }

  async getTextContent(sessionId: string, selector?: string): Promise<string> {
    const s = this.requireSession(sessionId);
    const page = s.page as any;
    const text: string = selector
      ? await page.locator(selector).textContent({ timeout: 10000 }) ?? ""
      : await page.evaluate('document.body.innerText');
    this.resetIdleTimer(sessionId);
    return text;
  }

  async getLinks(sessionId: string): Promise<Array<{ text: string; href: string }>> {
    const s = this.requireSession(sessionId);
    const links: Array<{ text: string; href: string }> = await (s.page as any).evaluate(
      'Array.from(document.querySelectorAll("a[href]")).map(a => ({ text: (a.textContent || "").trim(), href: a.href })).filter(l => l.href && !l.href.startsWith("javascript:"))'
    );
    this.resetIdleTimer(sessionId);
    return links;
  }

  async getAccessibilityTree(sessionId: string): Promise<unknown> {
    const s = this.requireSession(sessionId);
    const snapshot = await (s.page as any).accessibility.snapshot();
    this.resetIdleTimer(sessionId);
    this.emit("browser.accessibility.captured", { sessionId });
    return snapshot;
  }

  async screenshotFullPage(sessionId: string): Promise<Buffer> {
    const s = this.requireSession(sessionId);
    const buf = await (s.page as any).screenshot({ type: "png", fullPage: true });
    this.resetIdleTimer(sessionId);
    this.emit("browser.screenshot.fullpage", { sessionId });
    return buf;
  }

  async savePdf(sessionId: string): Promise<Buffer> {
    const s = this.requireSession(sessionId);
    const buf = await (s.page as any).pdf({ format: "A4" });
    this.resetIdleTimer(sessionId);
    this.emit("browser.pdf.saved", { sessionId });
    return buf;
  }

  // ── Cookie management ───────────────────────────────────────────────
  async getCookies(sessionId: string): Promise<unknown[]> {
    const s = this.requireSession(sessionId);
    const cookies = await (s.context as any).cookies();
    this.resetIdleTimer(sessionId);
    return cookies;
  }

  async setCookie(sessionId: string, cookie: Record<string, unknown>): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.context as any).addCookies([cookie]);
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.cookie.set", { sessionId, domain: cookie.domain });
  }

  async clearCookies(sessionId: string): Promise<void> {
    const s = this.requireSession(sessionId);
    await (s.context as any).clearCookies();
    s.meta.updatedAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    this.emit("browser.cookies.cleared", { sessionId });
  }

  /** Get the raw page and context of a session. Used by SSHP and CSH extensions. */
  getSessionPageAndContext(sessionId: string): { page: any; context: any } | null {
    const s = this.sessions.get(sessionId);
    if (!s || s.meta.state === "terminated") return null;
    return { page: s.page, context: s.context };
  }

  // ── Internal Helpers ────────────────────────────────────────────────
  private requireSession(sessionId: string): InternalSession {
    const s = this.sessions.get(sessionId);
    if (!s || s.meta.state === "terminated") {
      throw new Error(`Browser session "${sessionId}" not found or terminated.`);
    }
    return s;
  }

  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    this.idleTimers.set(
      sessionId,
      setTimeout(() => {
        void this.closeSession(sessionId);
      }, IDLE_TIMEOUT_MS),
    );
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  private emit(operation: string, details: Record<string, unknown>): void {
    if (!this.activityBus) return;
    this.activityBus.emit({
      sessionId: this.sessionId ?? "browser",
      layer: "tool_execution",
      operation,
      status: "succeeded",
      details: { ...details, source: "browser-session-manager", prismSessionId: this.sessionId },
    });
  }
}
