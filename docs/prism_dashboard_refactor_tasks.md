# 📋 Refactoring Plan: Constructor & Route Decomposition

This plan outlines the steps for executing the remaining refactoring tasks for the PRISM Dashboard:
1. **PowerShell Script Extraction** — ✅ **COMPLETED**
2. **Phase 3: Constructor Decomposition** — ✅ **COMPLETED**
3. **Phase 4: Route Service Decomposition & DI** — ✅ **COMPLETED**

---

## 🛠️ Step 1: PowerShell Script Extraction [COMPLETED]

* Extracted the WMI/CIM hardware device query PowerShell script to `src/core/operator/scripts/device-query.ps1`.
* Updated `computer-handler.ts` to execute it using `-File`.
* Updated `package.json` to copy `scripts/` directory to `dist/` on build.

---

## ⚙️ Step 2: Phase 3 — Constructor Decomposition [COMPLETED]

Decomposed the constructor of `DashboardService` using dedicated helper modules:
* `iam-security.ts`
* `observability.ts`
* `tools.ts`
* `autonomous.ts`
* `utilities.ts`

---

## ⚡ Step 3: Phase 4 — Route Service Decomposition & DI [COMPLETED]

* Converted all value imports of `DashboardService` inside route handlers and types into compile-time-only type imports (`import type`).
* Purged all circular value dependencies at runtime between `routes/` and the main dashboard controller, allowing both modules to resolve independently.
* Extracted the remaining route sections from the main monolithic `handle` method:
  * **Utilities Routes** -> `utilities-handler.ts`
  * **Tools & Plugins API** -> `tools-handler.ts`
  * **Character Accountability (CAC)** -> `cac-handler.ts`
  * **Incubation Prototypes** -> `incubation-handler.ts`
  * **Prometheus Metrics** -> `telemetry-handler.ts`
* Registered all new handlers in the central `Router` registry.
* Implemented unversioned-to-versioned backward-compatibility 301 redirection.
* Verified that the compiler resolves all imports correctly and the test suites pass successfully.
