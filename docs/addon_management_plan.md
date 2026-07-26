# Implementation Plan: Operator-Facing Add-on Management Panel

This document outlines the design and implementation plan to add an operator-facing control panel for managing boot-time Add-ons at `D:\Projects\Prism\addons`.

---

## 1. Objectives

- **Operator Panel:** Add a collapsible section at the top of the **Tools & Plugins** tab.
- **Add-on Lifecycle Management:** Support listing, downloading (installing), and deleting Add-ons in compliance with PRISM standards (validation, trust tiers, certification check).
- **Restart Coordination:** Since Add-ons are loaded at boot time, additions/deletions will transition through a "Pending Restart" status to keep the operator informed.

---

## 2. Taxonomy & Standards

Add-ons follow the PRISM standard defined in `VRGC_ROBOTICS_ADDON_DESIGN_DISCUSSION.md`:
- **Trust Tier:** Must declare `"trust": "certified"`.
- **Council Approval:** If `governanceCouncilSignoff` is missing, the Add-on is flagged as **Unsigned / Dev Mode**.
- **Integration Schema:** Scans `addon.manifest.json` for validation using the built-in validator (`validateAddonManifest`).

---

## 3. Architecture & API Design

We will introduce a new API route handler `AddonsHandler` (`src/core/operator/routes/addons-handler.ts`) supporting the following routes:

### 3.1 `GET /api/addons/status`

Returns the status of all Add-ons, combining in-memory boot states with live disk states to detect pending changes.
- **Response Schema:**

```json
{
  "addons": [
    {
      "id": "prism.addon.vrgc-robotics",
      "name": "Robotics Entity Management",
      "version": "0.1.0",
      "description": "...",
      "state": "active", // active | error | pending_restart | pending_delete
      "trust": "certified",
      "hasSignoff": true,
      "manifest": { ... },
      "errors": []
    }
  ]
}
```

### 3.2 `POST /api/addons/install`

Installs an Add-on from a Local Path, Git Repository, or ZIP URL.
- **Payload:**

```json
{
  "sourceType": "git" | "zip" | "local",
  "pathOrUrl": "https://github.com/..."
}
```
- **Process:**
  1. Downloads/clones/copies files to a temporary location.
  2. Parses and validates `addon.manifest.json`.
  3. Moves/copies the validated files to `addons/<addon-id>`.
  4. Returns `201 Created` with a status indicating restart is required.

### 3.3 `POST /api/addons/delete`

Uninstalls an Add-on by removing its folder or moving it to a backup directory.
- **Payload:**

```json
{
  "id": "prism.addon.vrgc-robotics"
}
```
- **Process:**
  1. Locates the folder corresponding to the ID under `addons/`.
  2. Moves the folder to `addons/.backup/<id>` (or deletes it permanently).
  3. Returns `200 OK` indicating restart is required.

---

## 4. UI/UX Design

We will update the operator dashboard files to display the **Add-ons** panel at the top of the "Tools & Plugins" tab.

### 4.1 Collapsible Panel (HTML)

Located in `src/core/operator/public/tab-tools.html`:

```html
<section class="rail-section panel">
    <div class="collapsible-header" onclick="togglePanelCollapse('addonsPanel')">
        <h3>🤖 Add-ons</h3>
        <span class="tp-panel-summary" id="addonsPanel-summary" style="display: none"></span>
        <span class="collapse-chevron" id="chevron-addonsPanel">▶</span>
    </div>
    <div class="collapsible-body collapsed" id="body-addonsPanel">
        <div id="addons-panel" class="stack"></div>
    </div>
</section>
```

### 4.2 Interactive Logic (JS)

Located in `src/core/operator/public/tab-tools.js`:

- `renderAddonsPanel()`: Dynamically renders the list of Add-ons.
- Displays state badges (`Active`, `Error`, `Pending Restart`, `Pending Deletion`).
- Displays trust badges (`Certified`, `Unsigned / Dev`).
- Highlights integration points (e.g. Memory, Dashboard Tabs, Policies).
- Form triggers:
  - **"Install Add-on" modal:** Accepts source type (Local, Git, ZIP) and path/URL.
  - **"Delete" button:** Requests deletion of the Add-on directory with a confirmation prompt.

---

## 5. Verification Plan

1. **Unit/Integration Tests:** Add tests to verify `/api/addons` endpoints under various scenarios (valid manifest, invalid manifest, missing dependency, local path vs. git clone).
2. **UI Testing:** Verify the panel displays correctly in the dashboard, collapses, expands, and updates upon installation/deletion.

---

## 6. Open Questions & Decisions

1. **Backup on Deletion:** Should deletion permanently remove the directory (`fs.rmSync`), or should we move it to `addons/.backup/` to allow easy recovery? (Recommended: move to `.backup/`).
2. **Git/ZIP commands:** On Windows, we'll use `git clone` for Git URLs and PowerShell `Expand-Archive` for ZIP files. Is there any environment constraint preventing these commands from running?
