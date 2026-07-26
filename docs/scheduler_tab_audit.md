# 🔍 Prism Scheduler Tab — Full Hardcore Audit

> **Audited files:** `tab-scheduler.html`, `tab-scheduler.js`, `scheduler-engine.ts`, `scheduler-handler.ts`, `dashboard.ts` (modal fragment)
> **Date:** July 5, 2026

---

## Executive Verdict

The Scheduler tab is **structurally complete** — it has all five sub-views (Calendar, Projects, Board, Timeline, Cron Jobs), a working backend engine with cron parsing, and a functioning CRUD flow through modals. But it suffers from **zero dedicated CSS**, a **modal that lives in the wrong place**, significant **UX gaps** in almost every view, and a handful of real **bugs** that will bite under normal use. It's a solid skeleton wearing a threadbare suit.

---

## 🚨 Critical Bugs

### 1. Event Edit Uses POST (Upsert Ambiguity)

**File:** [tab-scheduler.js:611-619](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L611-L619)

When editing an existing event, `saveSchedulerModal` sends `eventId` in the POST body, but the handler at [scheduler-handler.ts:38-46](file:///d:/Projects/Prism/src/core/operator/routes/scheduler-handler.ts#L38-L46) blindly creates a **new** event with that ID, overwriting the old one in the Map. This *works* by accident (Map.set overwrites), but:

- It loses the original `createdAt` timestamp
- There is no dedicated PUT/PATCH endpoint — this is a code smell
- If the ID format ever changes, this breaks silently

### 2. Tasks Without a Project Are Silently Dropped

**File:** [scheduler-handler.ts:90-110](file:///d:/Projects/Prism/src/core/operator/routes/scheduler-handler.ts#L90-L110)

If you create a task without selecting a project (the dropdown defaults to empty `""`), the handler skips the project-attach logic entirely. The task gets a 200 response but **is never stored anywhere**. The frontend gets a success, the user sees nothing on refresh.

```javascript
// Line 104-108: If no projectId, task just evaporates
if (body.projectId) {
    const project = schedulerProjects.get(body.projectId);
    if (project) { project.tasks.push(task); }
    else { return this.json(res, 404, { error: "Project not found" }); }
}
return this.json(res, 200, { task }); // ← returns 200 even if task wasn't saved
```

### 3. `switchSchedulerView` Re-queries Button NodeList Inside Loop

**File:** [tab-scheduler.js:92-99](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L92-L99)

```javascript
for (var i = 0; i < views.length; i++) {
    var panel = document.getElementById('sched-view-' + views[i]);
    if (panel) panel.style.display = views[i] === view ? '' : 'none';
    var btns = document.querySelectorAll('.sched-subnav-btn[data-sched-view]'); // ← querySelectorAll inside loop, 5x
    for (var b = 0; b < btns.length; b++) {
        btns[b].classList.toggle('active', ...);
    }
}
```

The `querySelectorAll` is called 5 times (once per view) and the button toggle loop runs 5×N. This should be hoisted outside the loop.

### 4. Drag-and-Drop Event Listeners Leak Every Render

**File:** [tab-scheduler.js:391-434](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L391-L434)

`initBoardDragDrop()` is called on every `renderSchedulerBoard()`. Since `innerHTML` replaces all DOM nodes, old listeners are garbage-collected, BUT the `lanes` (the container divs) survive the innerHTML replace because they're in the static HTML template. So every render adds **duplicate** event listeners to the lane containers. After 10 renders, each drop fires 10 times.

### 5. Calendar Year Fetch Only Gets Current Year

**File:** [tab-scheduler.js:53-56](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L53-L56)

```javascript
var now = new Date();
var yearStart = now.getFullYear() + '-01-01';
var yearEnd = now.getFullYear() + '-12-31';
```

If the user navigates the calendar to next year or a previous year, the events won't show — the API fetch is always hardcoded to the current year.

---

## ⚠️ Major UX Deficiencies

### 6. Zero Dedicated CSS — Everything is Inline Styles

There are **zero CSS rules** for the scheduler in `dashboard.css`. Every single style is inline in the HTML template or string-concatenated in JavaScript. This means:

- No hover states on calendar cells
- No transitions on view switches
- No responsive behavior
- Impossible to maintain or theme
- The kanban board has no visual column structure classes (`.sched-kanban-board`, `.sched-kanban-lane` are referenced in HTML but **don't exist in the stylesheet**)

### 7. No Delete for Events, Projects, or Tasks

You can create events, projects, and tasks. You can edit events (kinda, see Bug #1). You can move tasks on the board. But there is:

- **No delete button** for events
- **No delete button** for projects
- **No delete button** for individual tasks
- **No edit** for tasks or projects after creation
- Only cron jobs have a cancel/delete action

### 8. Modal is a Singleton in the Dashboard Template, Not in the Tab

**File:** [dashboard.ts:125-137](file:///d:/Projects/Prism/src/core/operator/templates/dashboard.ts#L125-L137)

The `#sched-modal` lives at the root level of `dashboard.ts`, outside any tab panel. This means:

- It pollutes the global DOM
- It's the only tab that injects a modal into the shell template
- All other tabs should probably use a shared modal system instead of scheduler-specific markup in the global layout

### 9. No Loading States or Skeleton UI

When `refreshSchedulerData()` fires its 3 sequential API calls, the user sees nothing — no spinner, no skeleton, no "Loading...". The UI just sits there, then abruptly changes. On slow connections this will feel broken.

### 10. Timeline View is Fixed to Current Month ± 1

**File:** [tab-scheduler.js:444-448](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L444-L448)

The Gantt/Timeline view is hardcoded to show only the current month plus/minus one month. There's no navigation, no zoom, and no way to see tasks that span further out. This is a severe limitation for project planning.

### 11. No Event Time Support in Calendar

The calendar stores `start` and `end` as dates, but there's no time picker in the event modal. The day view shows events with `startTime`/`endTime` fields, but the creation form never collects them. This means all events are effectively "all-day" events.

---

## 🔧 Code Quality Issues

### 12. Massive `saveSchedulerModal()` Function — 120 Lines of Branching

**File:** [tab-scheduler.js:599-720](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L599-L720)

This single function handles save logic for 4 completely different entity types (event, task, project, cron) through a deeply nested if-else chain. Each branch does its own DOM reading, validation, error display, and API call. This should be 4 separate functions dispatched by type.

### 13. HTML String Concatenation Everywhere

Every render function builds HTML through string concatenation with manual escaping. This is:

- Error-prone (easy to miss an `escapeHtml` call)
- Hard to read (300-char lines of concatenated HTML+JS)
- Not using template literals despite being an ES module

Example — this single line is 450+ chars:

```javascript
html += '<div style="position:absolute;left:' + barLeftPct + '%;width:' + barWidthPct + 
'%;height:16px;top:4px;background:' + barColor + ';border-radius:3px;...' // etc
```

### 14. Global Window Pollution

**File:** [tab-scheduler.js:727-735](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L727-L735)

Several functions are attached to `window` manually (`window._schedGoToDate`, `window.toggleCronFields`, `window.cancelCronJob`, `window.previewCronJob`, `window.refreshCronJobs`), while others like `openSchedulerModal`, `switchSchedulerView`, etc. are referenced from `onclick=""` handlers in the HTML but their window binding is presumably done elsewhere in `dashboard-app.js`. This is inconsistent and fragile.

### 15. `var` Declarations Throughout

The entire file uses `var` instead of `let`/`const`, despite being an ES module. This is inconsistent with modern JavaScript practices and can cause subtle hoisting bugs. The file even mixes `let` (lines 4-12 for module-level state) with `var` everywhere else.

### 16. Duplicated Month Label Arrays

The `months` array is defined in 3 separate places:

- [Line 144](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L144) in `renderSchedulerCalendar()`
- [Line 168](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L168) in `renderMiniMonth()`
- [Line 452](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L452) in `renderSchedulerGantt()`

### 17. `refreshCronJobs` Duplicates Logic from `refreshSchedulerData`

**File:** [tab-scheduler.js:741-751](file:///d:/Projects/Prism/src/core/operator/public/tab-scheduler.js#L741-L751)

`refreshCronJobs()` re-implements the same API call and error handling that already exists in `refreshSchedulerData()`. The cron count text update is also duplicated in both `refreshCronJobs` and `renderCronJobs`.

---

## 🎨 Design & Visual Issues

### 18. Calendar Has No Visual Grid Lines or Cell Borders in Day/Week View

The month view has faint cell borders (`rgba(148,163,184,0.06)`), but they're so transparent they're practically invisible. The day view is just a flat stack of panels with no time grid. There's no visual notion of hours/blocks.

### 19. Kanban Board Has No Column Visual Structure

The kanban columns are defined in HTML with class names like `.sched-kanban-board` and `.sched-kanban-column-title`, but these classes don't exist in the CSS. The board layout depends entirely on whatever default styles these elements inherit — likely broken flex/grid behavior.

### 20. No Empty State Illustrations

Every empty state is just plain text: "No projects yet", "No events scheduled", "No tasks". There are no illustrations, no icons, no call-to-action styling. Compare this to any modern project management tool.

### 21. No Color Coding or Categorization for Events

All events are the same accent color. There's no concept of event types, categories, or color labels. Every event in every view is identically styled — you can't visually distinguish a meeting from a deadline from a reminder.

---

## 🏗 Architecture Issues

### 22. No Persistence for Events and Projects

**File:** [scheduler-handler.ts:18-19](file:///d:/Projects/Prism/src/core/operator/routes/scheduler-handler.ts#L18-L19)

Events and projects are stored in in-memory Maps on `DashboardService`. The `SchedulerEngine` has file-based persistence for cron jobs, but events and projects **are lost on every server restart**. This is a critical gap — users will create projects and events, restart Prism, and find everything gone.

### 23. No WebSocket Push for Scheduler Updates

Cron job creation/cancellation broadcasts WebSocket events (`scheduler:cron-created`, `scheduler:cron-cancelled`), but event/project/task CRUD does not. If multiple tabs are open, only the active one will see changes. The board drag-and-drop is especially affected — you move a task, it calls `refreshSchedulerData()` which re-fetches everything, but other clients are never notified.

### 24. Self-Review Scheduler is Completely Disconnected

There's a `self-review-scheduler.ts` in the operator directory and a `SelfReviewScheduler` listed in the tools registry, but the Scheduler Tab has **zero integration** with it. The self-review system likely creates its own cron-like schedules that never appear in the Scheduler UI. These should be visible (even if read-only) in the Cron Jobs view.

---

## 📋 Recommended Fixes — Priority Ordered

| # | Priority | Fix | Effort |
|---|----------|-----|--------|
| 1 | 🔴 P0 | Fix task-without-project silent failure (Bug #2) | 30 min |
| 2 | 🔴 P0 | Fix duplicate drag-drop listeners (Bug #4) | 20 min |
| 3 | 🔴 P0 | Fix year-locked event fetching (Bug #5) | 20 min |
| 4 | 🟠 P1 | Add dedicated scheduler CSS (Issues #6, #18, #19) | 2-3 hrs |
| 5 | 🟠 P1 | Add persistence for events/projects (Issue #22) | 1-2 hrs |
| 6 | 🟠 P1 | Add delete for events/projects/tasks (Issue #7) | 1-2 hrs |
| 7 | 🟡 P2 | Add loading states (Issue #9) | 45 min |
| 8 | 🟡 P2 | Add time picker for events (Issue #11) | 45 min |
| 9 | 🟡 P2 | Refactor `saveSchedulerModal` into separate functions (Issue #12) | 1 hr |
| 10 | 🟡 P2 | Fix event edit to use PUT (Bug #1) | 45 min |
| 11 | 🟡 P2 | Add timeline navigation/zoom (Issue #10) | 2 hrs |
| 12 | 🟢 P3 | Clean up `var` → `let`/`const` (Issue #15) | 30 min |
| 13 | 🟢 P3 | Deduplicate month arrays and refresh logic (Issues #16, #17) | 20 min |
| 14 | 🟢 P3 | Hoist querySelector out of loop (Bug #3) | 10 min |
| 15 | 🟢 P3 | Add event color coding/categories (Issue #21) | 2 hrs |
| 16 | 🟢 P3 | Integrate SelfReviewScheduler entries (Issue #24) | 1-2 hrs |
| 17 | 🟢 P3 | Move modal to shared system (Issue #8) | 2 hrs |

---

## Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| **Functionality** | 6/10 | CRUD works for happy path, but missing delete, edit, and persistence |
| **Bug-Free** | 4/10 | 5 real bugs, 2 are data-losing |
| **Code Quality** | 4/10 | Massive functions, string concatenation, var usage, duplication |
| **Visual Design** | 3/10 | Zero CSS classes, no hover states, invisible grid, broken kanban layout |
| **Architecture** | 5/10 | Clean backend engine, but in-memory data loss and no WS sync |
| **UX** | 4/10 | No loading states, no empty states, no delete, no time support |
| **Overall** | **4.3/10** | Functional skeleton that needs a design+code quality pass |

> [!IMPORTANT]
> The three highest-impact fixes are: **(1)** the task-without-project silent failure, **(2)** the drag-drop listener leak, and **(3)** adding real CSS. Fixing just those three would move this tab from "prototype" to "usable."
