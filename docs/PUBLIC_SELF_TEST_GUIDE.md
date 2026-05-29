# PRISM Public Self-Test Operator Guide

This guide provides step-by-step instructions for running the PRISM automated self-test diagnostics suite. The suite executes the full end-to-end quiet release health checks and generates high-fidelity reports for operator sign-off.

---

## 1. Prerequisites

Before running the diagnostic executive, ensure that the workspace requirements have been satisfied:

```bash
# 1. Standard package installation
npm install

# 2. Compile TypeScript source code
npm run build
```

---

## 2. Running Diagnostics

The unified self-test diagnostic tool sequentially executes three key validation gates in a clean sandbox:

1. **Workspace Integrity (Doctor)** — Verifies database SQLite schemas, plugin keys, PAD integrity, and folder permissions.
2. **Autonomy Smoke (PTAC)** — Spawns the local dashboard server, runs the standard Tier-1 capabilities test scenarios, and cleanly terminates background services.
3. **Strict Release Validation** — Checks the performance qualification benchmarks, SRE runbook currency, and release candidate artifacts.

To run the self-test, execute the following command:

```bash
npm run prism:selftest:public
```

---

## 3. Interpreting Reports

Once the diagnostic executive completes execution, it writes unified, high-fidelity artifacts inside the `prism-output/` directory:

### 📊 Interactive HTML Report: `prism-output/self-test-report.html`

- **Verdict Panel**: A glowing green **PASS** or red **FAIL** marquee showing the aggregated validation status.
- **Total Duration**: Fully tracked millisecond execution stats for each phase.
- **Interactive Collapsible Console logs**: Click on any phase row to expand the raw CLI outputs, standard out (`stdout`), and standard error (`stderr`) traces.

### 📝 Machine-Readable JSON Summary: `prism-output/self-test-summary.json`

- Perfect for automated CI/CD pipeline integration, this file contains metadata, duration stats, and exit codes for every validation check.

---

## 4. Troubleshooting

If any phase reports a **FAIL**:

- **Phase 1 Fail**: Run `npm run doctor` to pinpoint the specific diagnostic issue. Ensure SQLite databases are writable and all files in `characters/` are present.
- **Phase 2 Fail**: Ensure your local port `7070` is not bound by an existing process. The diagnostic utility will attempt to auto-start the server, but if it is blocked, the smoke scenario will timeout.
- **Phase 3 Fail**: Verify that you have generated a release candidate packet using:

  ```bash
  npm run release:generate-packet
  ```
