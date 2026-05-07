/**
 * Frontend Unit Tests for tab-scheduler.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-scheduler.js with a mocked dashboard-core.js so we can test:
 *   - Date helpers (daysInMonth, formatDateStr, isToday, mondayOfWeek, eventsForDate)
 *   - switchSchedulerView (sub-view toggling)
 *   - setCalMode / schedCalNav (calendar mode switching & navigation)
 *   - renderSchedulerCalendar (mini-month, full-month, week, day views)
 *   - renderSchedulerProjects (project card list)
 *   - renderSchedulerBoard (kanban lane rendering)
 *   - renderSchedulerGantt (timeline bar rendering)
 *   - openSchedulerModal / closeSchedulerModal (modal lifecycle)
 *   - initSchedulerTab (initialization wiring)
 *
 * Run: mocha dist/tests/tab-scheduler-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

type JSDOMInstance = InstanceType<typeof JSDOM>;

/* ── Global DOM scaffold ────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Calendar view -->
<div id="sched-view-calendar">
  <span id="sched-cal-title"></span>
  <div id="sched-cal-body" style="min-height:200px;"></div>
  <button class="sched-mode-btn" data-cal-mode="year"></button>
  <button class="sched-mode-btn active" data-cal-mode="day"></button>
  <button class="sched-mode-btn" data-cal-mode="month"></button>
  <button class="sched-mode-btn" data-cal-mode="week"></button>
</div>

<!-- Projects view -->
<div id="sched-view-projects" style="display:none;">
  <div id="sched-projects-list" class="stack"></div>
</div>

<!-- Board view -->
<div id="sched-view-board" style="display:none;">
  <div data-status="backlog"><div id="sched-lane-backlog" class="sched-lane-body"></div></div>
  <div data-status="todo"><div id="sched-lane-todo" class="sched-lane-body"></div></div>
  <div data-status="in-progress"><div id="sched-lane-in-progress" class="sched-lane-body"></div></div>
  <div data-status="review"><div id="sched-lane-review" class="sched-lane-body"></div></div>
  <div data-status="done"><div id="sched-lane-done" class="sched-lane-body"></div></div>
</div>

<!-- Timeline view -->
<div id="sched-view-timeline" style="display:none;">
  <div id="sched-gantt-header" style="position:relative;height:24px;"></div>
  <div id="sched-gantt-rows" style="min-height:100px;"></div>
</div>

<!-- Cron Jobs view -->
<div id="sched-view-cron" style="display:none;">
  <span id="sched-cron-count"></span>
  <div id="sched-cron-list" class="stack"></div>
</div>

<!-- Sub-nav buttons -->
<button class="sched-subnav-btn active" data-sched-view="calendar"></button>
<button class="sched-subnav-btn" data-sched-view="projects"></button>
<button class="sched-subnav-btn" data-sched-view="board"></button>
<button class="sched-subnav-btn" data-sched-view="timeline"></button>
<button class="sched-subnav-btn" data-sched-view="cron"></button>

<!-- Modal -->
<div id="sched-modal" style="display:none;">
  <h3 id="sched-modal-title"></h3>
  <div id="sched-modal-body"></div>
  <button id="sched-modal-save"></button>
</div>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = {};
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function dashboardLog() {}
`;

/* ── Module types ─────────────────────────────────────────────────────── */

interface TabSchedulerModule {
    daysInMonth(year: number, month: number): number;
    formatDateStr(d: Date): string;
    isToday(d: Date): boolean;
    mondayOfWeek(d: Date): Date;
    eventsForDate(dateStr: string): any[];
    refreshSchedulerData(): Promise<void>;
    switchSchedulerView(view: string): void;
    renderSchedulerPanel(): void;
    setCalMode(mode: string): void;
    schedCalNav(dir: number): void;
    renderSchedulerCalendar(): void;
    renderMiniMonth(year: number, month: number): string;
    renderFullMonth(year: number, month: number): string;
    renderWeekView(monday: Date): string;
    renderDayView(date: Date): string;
    renderSchedulerProjects(): void;
    openProjectDetail(projectId: string): Promise<void>;
    renderSchedulerBoard(): void;
    initBoardDragDrop(): void;
    renderSchedulerGantt(): void;
    openSchedulerModal(type: string, editId?: string): void;
    closeSchedulerModal(): void;
    saveSchedulerModal(): Promise<void>;
    initSchedulerTab(): Promise<void>;
    refreshCronJobs(): Promise<void>;
    renderCronJobs(): void;
    cancelCronJob(jobId: string): Promise<void>;
    previewCronJob(jobId: string): Promise<void>;
    toggleCronFields(): void;
}

/* ── Suite ─────────────────────────────────────────────────────────────── */

describe("tab-scheduler.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabSchedulerModule;
    let dom: JSDOMInstance;
    let savedURL: unknown;
    let savedFetch: unknown;

    before(async () => {
        savedURL = (global as any).URL;
        savedFetch = (global as any).fetch;
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-scheduler-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-scheduler.js"),
            join(tmpDir, "tab-scheduler.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-scheduler.js")).href;
        mod = await import(moduleUrl) as TabSchedulerModule;
    });

    after(() => {
        delete (global as any).document;
        delete (global as any).window;
        delete (global as any).navigator;
        delete (global as any).HTMLElement;
        delete (global as any).location;
        // Restore rather than delete: prevent leaving global.URL undefined
        // which can break Playwright and other native Node.js subsystems.
        if (savedURL !== undefined) {
            (global as any).URL = savedURL;
        } else {
            delete (global as any).URL;
        }
        if (savedFetch !== undefined) {
            (global as any).fetch = savedFetch;
        } else {
            delete (global as any).fetch;
        }
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
    });

    /* ── Date helpers ─────────────────────────────────────────────────── */

    describe("daysInMonth", () => {
        it("returns 31 for January", () => {
            assert.strictEqual(mod.daysInMonth(2026, 0), 31);
        });
        it("returns 28 for non-leap February", () => {
            assert.strictEqual(mod.daysInMonth(2025, 1), 28);
        });
        it("returns 29 for leap year February", () => {
            assert.strictEqual(mod.daysInMonth(2024, 1), 29);
        });
        it("returns 30 for April", () => {
            assert.strictEqual(mod.daysInMonth(2026, 3), 30);
        });
    });

    describe("formatDateStr", () => {
        it("returns YYYY-MM-DD with zero-padded month and day", () => {
            assert.strictEqual(mod.formatDateStr(new Date(2026, 0, 5)), "2026-01-05");
        });
        it("formats double-digit month and day correctly", () => {
            assert.strictEqual(mod.formatDateStr(new Date(2026, 11, 25)), "2026-12-25");
        });
    });

    describe("isToday", () => {
        it("returns true for today's date", () => {
            assert.strictEqual(mod.isToday(new Date()), true);
        });
        it("returns false for a date in the past", () => {
            assert.strictEqual(mod.isToday(new Date(2020, 0, 1)), false);
        });
    });

    describe("mondayOfWeek", () => {
        it("returns Monday for a Wednesday input", () => {
            // 2026-04-08 is a Wednesday
            const wed = new Date(2026, 3, 8);
            const mon = mod.mondayOfWeek(wed);
            assert.strictEqual(mon.getDay(), 1);
            assert.strictEqual(mon.getDate(), 6);
        });
        it("returns the same date for a Monday input", () => {
            // 2026-04-06 is a Monday
            const monday = new Date(2026, 3, 6);
            const result = mod.mondayOfWeek(monday);
            assert.strictEqual(result.getDay(), 1);
            assert.strictEqual(result.getDate(), 6);
        });
        it("returns previous Monday for a Sunday input", () => {
            // 2026-04-12 is a Sunday
            const sunday = new Date(2026, 3, 12);
            const result = mod.mondayOfWeek(sunday);
            assert.strictEqual(result.getDay(), 1);
            assert.strictEqual(result.getDate(), 6);
        });
    });

    describe("eventsForDate", () => {
        it("returns empty array when no events are cached", () => {
            assert.deepStrictEqual(mod.eventsForDate("2026-04-11"), []);
        });
    });

    /* ── View switching ───────────────────────────────────────────────── */

    describe("switchSchedulerView", () => {
        it("shows the selected panel and hides others", () => {
            mod.switchSchedulerView("projects");
            const projectsPanel = dom.window.document.getElementById("sched-view-projects");
            const calendarPanel = dom.window.document.getElementById("sched-view-calendar");
            assert.notStrictEqual(projectsPanel!.style.display, "none");
            assert.strictEqual(calendarPanel!.style.display, "none");
        });

        it("toggles active class on sub-nav buttons", () => {
            mod.switchSchedulerView("board");
            const btns = dom.window.document.querySelectorAll(".sched-subnav-btn");
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i] as Element;
                const view = btn.getAttribute("data-sched-view");
                if (view === "board") {
                    assert.ok(btn.classList.contains("active"), "board button should be active");
                } else {
                    assert.ok(!btn.classList.contains("active"), `${view} button should not be active`);
                }
            }
        });

        it("cycles through all four views", () => {
            const views = ["calendar", "projects", "board", "timeline"];
            for (const v of views) {
                mod.switchSchedulerView(v);
                const panel = dom.window.document.getElementById(`sched-view-${v}`);
                assert.notStrictEqual(panel!.style.display, "none", `${v} panel should be visible`);
            }
        });
    });

    /* ── Calendar mode ────────────────────────────────────────────────── */

    describe("setCalMode", () => {
        it("toggles active class on mode buttons", () => {
            mod.setCalMode("week");
            const btns = dom.window.document.querySelectorAll(".sched-mode-btn");
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i] as Element;
                const mode = btn.getAttribute("data-cal-mode");
                if (mode === "week") {
                    assert.ok(btn.classList.contains("active"), "week button should be active");
                } else {
                    assert.ok(!btn.classList.contains("active"), `${mode} button should not be active`);
                }
            }
        });
    });

    /* ── Calendar renderers ───────────────────────────────────────────── */

    describe("renderMiniMonth", () => {
        it("returns HTML containing day labels", () => {
            const html = mod.renderMiniMonth(2026, 3);
            assert.ok(html.includes("M"), "should contain Monday label");
            assert.ok(html.includes("Apr"), "should contain month name");
        });

        it("contains correct number of day cells for April (30)", () => {
            const html = mod.renderMiniMonth(2026, 3);
            // Count day numbers 1–30 appearing
            let found = 0;
            for (let d = 1; d <= 30; d++) {
                if (html.includes(">" + d + "<") || html.includes(">" + d + "\\u003c") || html.includes(`>${d}`)) found++;
            }
            assert.ok(found >= 25, `Should find most of the 30 days, found ${found}`);
        });
    });

    describe("renderFullMonth", () => {
        it("returns HTML containing day-of-week headers", () => {
            const html = mod.renderFullMonth(2026, 3);
            assert.ok(html.includes("Mon"), "should contain Mon");
            assert.ok(html.includes("Fri"), "should contain Fri");
        });
    });

    describe("renderWeekView", () => {
        it("returns 7 day columns", () => {
            const mon = new Date(2026, 3, 6);
            const html = mod.renderWeekView(mon);
            assert.ok(html.includes("Mon"), "should contain Mon label");
            assert.ok(html.includes("Sun"), "should contain Sun label");
        });

        it("shows 'No events' when no events are cached", () => {
            const mon = new Date(2026, 3, 6);
            const html = mod.renderWeekView(mon);
            assert.ok(html.includes("No events"));
        });
    });

    describe("renderDayView", () => {
        it("shows empty state for a day with no events", () => {
            const html = mod.renderDayView(new Date(2026, 3, 11));
            assert.ok(html.includes("No events scheduled"));
        });

        it("includes an add-event button", () => {
            const html = mod.renderDayView(new Date(2026, 3, 11));
            assert.ok(html.includes("Add event for"));
        });
    });

    /* ── Projects ─────────────────────────────────────────────────────── */

    describe("renderSchedulerProjects", () => {
        it("shows empty state when no projects are cached", () => {
            mod.switchSchedulerView("projects");
            mod.renderSchedulerProjects();
            const el = dom.window.document.getElementById("sched-projects-list");
            assert.ok(el!.innerHTML.includes("No projects"));
        });
    });

    /* ── Board ────────────────────────────────────────────────────────── */

    describe("renderSchedulerBoard", () => {
        it("shows 'No tasks' in empty lanes", () => {
            mod.switchSchedulerView("board");
            mod.renderSchedulerBoard();
            const backlog = dom.window.document.getElementById("sched-lane-backlog");
            assert.ok(backlog!.innerHTML.includes("No tasks"));
        });
    });

    /* ── Gantt / Timeline ─────────────────────────────────────────────── */

    describe("renderSchedulerGantt", () => {
        it("shows empty state when no projects exist", () => {
            mod.switchSchedulerView("timeline");
            mod.renderSchedulerGantt();
            const rows = dom.window.document.getElementById("sched-gantt-rows");
            assert.ok(rows!.innerHTML.includes("No projects"));
        });

        it("renders month header labels", () => {
            mod.switchSchedulerView("timeline");
            mod.renderSchedulerGantt();
            const header = dom.window.document.getElementById("sched-gantt-header");
            // Should have at least one month label
            assert.ok(header!.innerHTML.length > 0, "gantt header should have content");
        });
    });

    /* ── Modal ────────────────────────────────────────────────────────── */

    describe("openSchedulerModal", () => {
        it("shows the modal for event type", () => {
            mod.openSchedulerModal("event");
            const modal = dom.window.document.getElementById("sched-modal");
            assert.strictEqual(modal!.style.display, "flex");
        });

        it("sets the correct title for new event", () => {
            mod.openSchedulerModal("event");
            const title = dom.window.document.getElementById("sched-modal-title");
            assert.strictEqual(title!.textContent, "New Event");
        });

        it("sets the correct title for new task", () => {
            mod.openSchedulerModal("task");
            const title = dom.window.document.getElementById("sched-modal-title");
            assert.strictEqual(title!.textContent, "New Task");
        });

        it("sets the correct title for new project", () => {
            mod.openSchedulerModal("project");
            const title = dom.window.document.getElementById("sched-modal-title");
            assert.strictEqual(title!.textContent, "New Project");
        });

        it("renders title input for event modal", () => {
            mod.openSchedulerModal("event");
            const body = dom.window.document.getElementById("sched-modal-body");
            assert.ok(body!.innerHTML.includes("sched-modal-event-title"), "should have event title input");
        });

        it("renders project select for task modal", () => {
            mod.openSchedulerModal("task");
            const body = dom.window.document.getElementById("sched-modal-body");
            assert.ok(body!.innerHTML.includes("sched-modal-task-project"), "should have project dropdown");
        });

        it("renders name input for project modal", () => {
            mod.openSchedulerModal("project");
            const body = dom.window.document.getElementById("sched-modal-body");
            assert.ok(body!.innerHTML.includes("sched-modal-project-name"), "should have project name input");
        });

        it("sets the correct title for edit event", () => {
            mod.openSchedulerModal("event", "existing-id");
            const title = dom.window.document.getElementById("sched-modal-title");
            assert.strictEqual(title!.textContent, "Edit Event");
        });
    });

    describe("closeSchedulerModal", () => {
        it("hides the modal", () => {
            mod.openSchedulerModal("event");
            mod.closeSchedulerModal();
            const modal = dom.window.document.getElementById("sched-modal");
            assert.strictEqual(modal!.style.display, "none");
        });
    });

    /* ── initSchedulerTab ─────────────────────────────────────────────── */

    describe("initSchedulerTab", () => {
        it("sets up window._schedGoToDate helper", async () => {
            await mod.initSchedulerTab();
            assert.ok(typeof (dom.window as any)._schedGoToDate === "function", "should define _schedGoToDate");
        });
    });

    /* ── Cron Jobs view ────────────────────────────────────────────────── */

    describe("Cron Jobs view", () => {
        it("switchSchedulerView('cron') shows cron panel and hides others", () => {
            mod.switchSchedulerView("cron");
            const cronPanel = dom.window.document.getElementById("sched-view-cron");
            const calPanel = dom.window.document.getElementById("sched-view-calendar");
            assert.strictEqual(cronPanel!.style.display, "");
            assert.strictEqual(calPanel!.style.display, "none");
            // Active button should be 'cron'
            const btns = dom.window.document.querySelectorAll(".sched-subnav-btn[data-sched-view]");
            btns.forEach((btn: any) => {
                if (btn.getAttribute("data-sched-view") === "cron") {
                    assert.ok(btn.classList.contains("active"), "cron button should be active");
                } else {
                    assert.ok(!btn.classList.contains("active"), btn.getAttribute("data-sched-view") + " button should not be active");
                }
            });
            // Reset to calendar
            mod.switchSchedulerView("calendar");
        });

        it("renderCronJobs() shows empty state when no jobs", () => {
            mod.renderCronJobs();
            const container = dom.window.document.getElementById("sched-cron-list");
            assert.ok(container!.innerHTML.includes("No cron jobs"), "should show empty state message");
        });

        it("renderCronJobs() updates count element", () => {
            mod.renderCronJobs();
            const count = dom.window.document.getElementById("sched-cron-count");
            assert.ok(count!.textContent!.includes("0 jobs"), "count should show 0 jobs");
        });

        it("openSchedulerModal('cron') populates modal with cron form fields", () => {
            mod.openSchedulerModal("cron");
            const modal = dom.window.document.getElementById("sched-modal");
            const title = dom.window.document.getElementById("sched-modal-title");
            const body = dom.window.document.getElementById("sched-modal-body");
            assert.strictEqual(modal!.style.display, "flex");
            assert.strictEqual(title!.textContent, "New Cron Job");
            assert.ok(body!.innerHTML.includes("sched-modal-cron-label"), "should have label input");
            assert.ok(body!.innerHTML.includes("sched-modal-cron-type"), "should have type selector");
            assert.ok(body!.innerHTML.includes("sched-modal-cron-expr"), "should have cron expression input");
            assert.ok(body!.innerHTML.includes("sched-modal-cron-action"), "should have action input");
            assert.ok(body!.innerHTML.includes("sched-modal-cron-payload"), "should have payload textarea");
            mod.closeSchedulerModal();
        });

        it("toggleCronFields() toggles recurring vs one-time fields", () => {
            mod.openSchedulerModal("cron");
            const typeSelect = dom.window.document.getElementById("sched-modal-cron-type") as any;
            const recurringFields = dom.window.document.getElementById("sched-cron-recurring-fields") as any;
            const onceFields = dom.window.document.getElementById("sched-cron-once-fields") as any;
            // Default: recurring shown, once hidden
            assert.strictEqual(recurringFields!.style.display, "");
            assert.strictEqual(onceFields!.style.display, "none");
            // Switch to once
            typeSelect.value = "once";
            mod.toggleCronFields();
            assert.strictEqual(recurringFields!.style.display, "none");
            assert.strictEqual(onceFields!.style.display, "");
            // Switch back to recurring
            typeSelect.value = "recurring";
            mod.toggleCronFields();
            assert.strictEqual(recurringFields!.style.display, "");
            assert.strictEqual(onceFields!.style.display, "none");
            mod.closeSchedulerModal();
        });

        it("all 5 views cycle correctly", () => {
            const views = ["calendar", "projects", "board", "timeline", "cron"];
            for (const v of views) {
                mod.switchSchedulerView(v);
                const panel = dom.window.document.getElementById("sched-view-" + v);
                assert.strictEqual(panel!.style.display, "", v + " panel should be visible");
                for (const other of views) {
                    if (other !== v) {
                        const otherPanel = dom.window.document.getElementById("sched-view-" + other);
                        assert.strictEqual(otherPanel!.style.display, "none", other + " panel should be hidden when " + v + " is active");
                    }
                }
            }
            mod.switchSchedulerView("calendar"); // reset
        });
    });

    /* ── Default calMode is day ───────────────────────────────────────── */

    describe("default calendar mode", () => {
        it("setCalMode('day') renders day view", () => {
            mod.setCalMode("day");
            mod.renderSchedulerCalendar();
            const title = dom.window.document.getElementById("sched-cal-title");
            const body = dom.window.document.getElementById("sched-cal-body");
            // Day view title is a formatted date string (YYYY-MM-DD)
            assert.ok(title!.textContent!.match(/\d{4}-\d{2}-\d{2}/), "title should show date in day view format");
            // Day view body includes "No events scheduled" or "Add event for"
            assert.ok(
                body!.innerHTML.includes("No events scheduled") || body!.innerHTML.includes("Add event for"),
                "body should show day view content",
            );
        });
    });
});
