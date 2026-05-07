# Refactoring Prism Dashboard Tabs

The goal is to modularize the 8,000+ line `dashboard-service.ts` (specifically, the monolithic `dashboardHtml()` function in `templates/dashboard.ts` which returns the entire dashboard HTML structure as a string) by extracting each tab into its own standalone HTML file. This needs to be done without changing the visual layout, styling, or functionality.

## Proposed Changes

### 1. File Structure Updates
Create a new directory: `src/core/operator/public/tabs/`
This directory will contain the individual HTML fragments for each tab, e.g.,
- `tab-chat.html`
- `tab-settings.html`
- `tab-tools.html`
- `tab-agentic.html`
- `tab-computer.html`
- `tab-browser.html`
- `tab-workspace.html`
- `tab-network.html`
- `tab-telemetry.html`
- `tab-logs.html`
- `tab-scheduler.html`
- `tab-hardware.html`

Each file will contain only the inner HTML of its respective `<section id="tab-xxx" ...>` element, without any wrapper elements or inline `<script>` tags that belong in the main shell.

### 2. Main Dashboard Template Updates

#### [MODIFY] `dashboard.ts` (file:///d:/Projects/Prism/src/core/operator/templates/dashboard.ts)
- Strip out the massive inline HTML for each tab.
- Leave empty `<section id="tab-xxx" class="tab-panel" role="tabpanel" ...></section>` placeholders.
- Maintain the unified CSS (`<style>`), the sidebar navigation, the tab switching buttons, and all structural `div` wrappers (e.g., `<main class="main-content">`) so the design remains identical.
- Ensure the chat tab (the default tab) and other tabs use the new dynamic loader.

### 3. Server Public Route Modification

#### [MODIFY] `dashboard-service.ts` (file:///d:/Projects/Prism/src/core/operator/dashboard-service.ts)
Currently, `dashboard-service.ts` restricts `/public/` files to `.js` and `.css` extensions and explicitly blocks subdirectories (`safeFile.includes("/")`).
- Modify the static file handler (around line 2617) to allow `.html` files.
- Modify the path validation logic to safely allow serving from the `/public/tabs/` subdirectory while still preventing path traversal (`..`).

### 4. Dynamic Tab Loading Logic

#### [NEW] `tab-loader.js` (file:///d:/Projects/Prism/src/core/operator/public/tab-loader.js)
Create a new script to handle fetching tab HTML content on-demand.
- On first selection of a tab, fetch `/public/tabs/tab-[name].html`.
- Inject the HTML into the corresponding `<section>` container.
- Cache the loaded state so it is only fetched once per session.
- Dispatch an event or callback to initialize any tab-specific JS (like charts or inputs) after injection.

#### [MODIFY] `dashboard-app.js` (file:///d:/Projects/Prism/src/core/operator/public/dashboard-app.js)
- Import `tab-loader.js`.
- Update `setActiveTab(tabId)` to await the dynamic loading of the tab's HTML before triggering the corresponding `init*Tab()` or `render()` methods.
- Immediately trigger the load of the `chat` tab upon bootstrap since it is the default active view.

### 5. Documentation Updates
Update the core documentation artifacts (CHANGELOG.md, README.md, etc.) reflecting this architectural improvement, which shifts the dashboard to a decoupled, async-loading structure.

## Verification Plan

### Automated Tests
- Review TypeScript compilation (`npx tsc --noEmit`) to ensure no errors were introduced in the dashboard/templates integration.

### Manual Verification
1. Open the local Prism dashboard in the browser.
2. Verify the Chat tab loads successfully and functions (messages render, inputs work).
3. Click through every tab (Settings, Tools, Agentic, Computer, etc.). Ensure the network request fetches the `tab-*.html` file correctly.
4. Verify that the UI structure and styling look exactly the same as before.
5. Check the browser console to ensure there are no errors related to missing DOM elements during initialization.

## User Review Required
> [!IMPORTANT]
> The initial implementation plan is ready. Please review the proposed architecture change.
> Specifically, note that we will introduce an async `fetch` to load tab HTML when clicked, instead of serving a monolithic 2MB+ HTML file at boot. This will significantly improve initial load performance while satisfying the decoupling requirement.

Should I proceed with the Git backup and execute this plan?
