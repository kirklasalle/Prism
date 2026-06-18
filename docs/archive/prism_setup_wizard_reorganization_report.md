# PRISM Operator Setup Wizard & CAC Login Enforcement

## Context & Objectives
To ensure security and proper operational provenance in PRISM, we enforced the following restrictions:
1. **Setup Complete & Initialization Certificate Enforcement**: An operator can only login to the dashboard directly if they have completed the setup and generated a valid `Initialization Certificate`. If not, they are redirected to `/setup`.
2. **Reorganized 5-Step Basic Wizard**:
   - **Step 1**: Profile Choice
   - **Step 2**: Workspace Location (runs prerequisites checks and blocks if they do not pass)
   - **Step 3**: Choose First Assistant (character selection)
   - **Step 4**: Identity & First Session (CAC setup with real email validation)
   - **Step 5**: Provider & Model Setup + Guardian Setup (combined final step with LLM connection test validation, launch endpoint call, and Initialization Certificate generation)

---

## Technical Details

### 1. Dashboard Redirection & Session Rules
* Modified `src/core/operator/dashboard-handler.ts` to inspect the `.prism-preferences.json` setup state.
* If `setupComplete` is not true, or if no `Initialization Certificate` exists under the active workspace, the user is redirected to `/setup`.
* Ensure that the web UI blocks dashboard access until these criteria are fully satisfied.

### 2. Basic Setup Wizard Steps
* **Step 1: Choose Profile**
  * Profile choices are `individual` or `business`.
* **Step 3: Choose First Assistant**
  * Displays bundled characters or allows custom character import.
* **Step 4: Identity & First Session**
  * Requires valid emails. Placeholder domains are blocked to guarantee traceability.
  * Calls `/api/setup/cac` to register the active character assignment.
* **Step 5: Combined Provider & Guardian Setup**
  * Allows selecting Ollama, OpenAI, Anthropic, Google, etc.
  * Prompts for API keys where applicable and tests connectivity with `testProviderConnection()`.
  * Integrates Guardian model path, authority tier selection, and autostart preferences.
  * Creates the initialization session and packages the `certificate` under `/api/setup/initialization-session`.

### 3. Step-by-Step Backend Verification
* Built additional endpoints in `src/core/operator/setup-handler.ts` to validate workspace path prerequisites, test provider connection reachability, and handle certificate storage.
* Ensured the advanced setup wizard (`setup-wizard-advanced.js`) mirrors these strict validation points.

---

## Code Modification Diff Summary

The following files have been modified:
1. `src/core/operator/dashboard-handler.ts` — Implemented redirection to `/setup` if setup or initialization certificate is missing.
2. `src/core/operator/setup-handler.ts` — Added validation APIs for LLM testing, workspace checks, CAC creation, and Initialization Certificate sessions.
3. `src/core/operator/public/setup-wizard.js` — Redesigned basic wizard client flow, step validations, and final Launch integration.
4. `src/core/operator/public/setup-wizard-advanced.js` — Enhanced advanced wizard validations.
5. `src/core/operator/templates/setup.ts` — Updated the HTML template progress indicator to reflect 5 basic steps.
6. `tests/wizard-parity.test.ts` — Updated the test suite assertions to match 5 steps.

---

## Validation Status
All unit and parity test suites were built and verified successfully:
* `npm run build` completed with code `0`.
* `node --test dist/tests/wizard-parity.test.js` executed 25 tests, all passed.
* `node --test dist/tests/cli-setup-wizard.test.js` executed 15 tests, all passed.
* Global integration test suite `npm test` completed with code `0`.
