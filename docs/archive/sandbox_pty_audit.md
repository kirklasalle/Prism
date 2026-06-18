# Sandbox Containerization & PTY — Completion Audit

## Executive Summary

Both features have **substantial implementation** but are **not fully production-wired**. The adapters, tools, tests, and governance policies are all built — the critical remaining gap is **integration wiring** at the application boot layer.

---

## PTY (Pseudo-Terminal)

### ✅ Completed

| Component | File | Status |
|-----------|------|--------|
| **TerminalSessionAdapter** | [terminal-session-adapter.ts](file:///d:/Projects/Prism/src/adapters/application/terminal-session-adapter.ts) | ✅ Full implementation |
| Real `node-pty` dynamic import | L111-118 | ✅ Auto-loads, sets `ptyEnabled` flag |
| ConPTY + WinPTY fallback loop (Win32) | L255-285 | ✅ Tries `useConpty=true`, falls back to `false` |
| PTY liveness probe (400ms stability check) | L269-278 | ✅ Catches early-exit backends |
| Sentinel-based exit code capture | L357-407 | ✅ `__PRISM_DONE__:<code>` protocol, cross-platform |
| Terminal resize support | L134-140 | ✅ `ptyProcess.resize(cols, rows)` |
| Policy-tier command routing (T1/T2/T3) | L574-650 | ✅ Keyword classification + profile-aware gating |
| SQLite persistence (sessions, history, signals) | L156-218, L684-741 | ✅ Three tables, full CRUD |
| ActivityBus event emission | L298-306 (start), L439-447 (stop), L485-493 (revoke) | ✅ All lifecycle events |
| **TerminalSessionTool** | [terminal-session-tool.ts](file:///d:/Projects/Prism/src/adapters/system/terminal-session-tool.ts) | ✅ Full implementation |
| Dual-route exec (PTY adapter → child_process fallback) | L212-317 | ✅ Graceful degradation |
| Safety blocklist (rm -rf, format, shutdown) | L51 | ✅ Regex guard |
| Session lifecycle (start/exec/stop/revoke/status) | L84-389 | ✅ Complete |
| Tool registration in builtins | [builtin-tools.ts](file:///d:/Projects/Prism/src/core/tools/builtin-tools.ts#L25) | ✅ `new TerminalSessionTool()` |
| Governance schema & reason codes | [reason-code-taxonomy.ts](file:///d:/Projects/Prism/src/core/policy/reason-code-taxonomy.ts#L117-L120) | ✅ 4 codes |
| Dashboard UI entry | [tab-tools.js](file:///d:/Projects/Prism/src/core/operator/public/tab-tools.js#L494) | ✅ Listed |
| **Integration tests** | [terminal-session-adapter.test.ts](file:///d:/Projects/Prism/tests/terminal-session-adapter.test.ts) | ✅ 13 test functions, 460 lines |
| Demo scenario | [demo-scenario-runner.ts](file:///d:/Projects/Prism/src/benchmarks/demo-scenario-runner.ts#L483) | ✅ C3 scenario |

### ❌ Remaining Tasks

| # | Task | Priority | Details |
|---|------|----------|---------|
| 1 | **`node-pty` not in `package.json`** | **P0** | The adapter does `await import("node-pty")` but `node-pty` is not listed in `dependencies` or `devDependencies` in [package.json](file:///d:/Projects/Prism/package.json). Without it, `tryInitPty()` always fails and the adapter degrades to child_process. |
| 2 | **Adapter not wired at boot** | **P0** | [builtin-tools.ts:25](file:///d:/Projects/Prism/src/core/tools/builtin-tools.ts#L25) creates `new TerminalSessionTool()` with **no adapter argument**. The `TerminalSessionAdapter` is never instantiated in [index.ts](file:///d:/Projects/Prism/src/index.ts). PTY always runs in direct `child_process.exec` fallback mode. |
| 3 | **Dockerfile missing node-pty build deps** | **P1** | [Dockerfile](file:///d:/Projects/Prism/Dockerfile) uses Alpine which lacks the native build tooling for node-pty. Needs `python3 make g++` in runtime stage or a prebuilt binary. |
| 4 | **No PTY status exposed in dashboard** | **P2** | Dashboard [tab-computer.js](file:///d:/Projects/Prism/src/core/operator/public/tab-computer.js) doesn't show whether PTY is active vs. child_process fallback. Operators can't verify PTY health. |

---

## Sandbox Containerization

### ✅ Completed

| Component | File | Status |
|-----------|------|--------|
| **ContainerSandboxAdapter** (built-in runtime) | [container-sandbox-adapter.ts](file:///d:/Projects/Prism/src/adapters/application/container-sandbox-adapter.ts) | ✅ Full implementation (745 lines) |
| Filesystem-isolated per-container runtime dirs | L200-210 | ✅ `tmpdir()/prism-runtime-containers/<id>/{workspace,snapshots}` |
| Real command exec via `spawn()` in workspace cwd | L281-353 | ✅ Cross-platform (cmd.exe / /bin/sh) |
| Snapshot via `cpSync()` filesystem copy | L355-421 | ✅ With size accounting |
| Revert via delete-and-restore from snapshot | L423-461 | ✅ Full roundtrip |
| Resource quota monitoring (disk) | L648-666 | ✅ Emits quota-exceeded events |
| SQLite persistence (containers, snapshots, history, signals) | L119-198 | ✅ Four tables |
| Policy-tier routing + audit | L587-646 | ✅ Same T1/T2/T3 model as terminal |
| ActivityBus events for all lifecycle operations | L236-520 | ✅ Create, start, stop, destroy, snapshot, revert |
| **ContainerSandboxTool** (lightweight) | [container-sandbox-tool.ts](file:///d:/Projects/Prism/src/adapters/system/container-sandbox-tool.ts) | ✅ In-memory state management (236 lines) |
| Actions: create/start/stop/destroy/snapshot/revert/status | L52-233 | ✅ Complete |
| Governance schema | L16-26 | ✅ Per-action risk levels |
| SideEffects tracking | Throughout | ✅ Every mutation logged |
| Tool registration | [builtin-tools.ts:26](file:///d:/Projects/Prism/src/core/tools/builtin-tools.ts#L26) | ✅ `new ContainerSandboxTool()` |
| Governance reason codes | [reason-code-taxonomy.ts:121-127](file:///d:/Projects/Prism/src/core/policy/reason-code-taxonomy.ts#L121-L127) | ✅ 7 codes |
| Dashboard UI entry | [tab-tools.js:495](file:///d:/Projects/Prism/src/core/operator/public/tab-tools.js#L495) | ✅ Listed |
| **Integration tests** | [container-sandbox-adapter.test.ts](file:///d:/Projects/Prism/tests/container-sandbox-adapter.test.ts) | ✅ 6 test functions |
| Demo scenario | [demo-scenario-runner.ts:519](file:///d:/Projects/Prism/src/benchmarks/demo-scenario-runner.ts#L519) | ✅ C5 scenario |
| **Docker deployment** | [Dockerfile](file:///d:/Projects/Prism/Dockerfile) + [docker-compose.yml](file:///d:/Projects/Prism/docker-compose.yml) | ✅ Multi-stage build, health checks, volume persistence |
| Workspace sandbox enforcement | [agentic-chat-executor.ts:19-27, 226-236](file:///d:/Projects/Prism/src/core/operator/agentic-chat-executor.ts#L226-L236) | ✅ File ops restricted to workspace root |
| Plugin manifest support | [plugin-pack-manifest-schema.json:116](file:///d:/Projects/Prism/src/core/plugins/plugin-pack-manifest-schema.json#L116) | ✅ `"container"` type supported |
| Governance hooks for Docker Agent sidecar | [governance-hooks-adapter.ts](file:///d:/Projects/Prism/src/adapters/application/governance-hooks-adapter.ts) | ✅ Pre/post tool-use hooks |

### ❌ Remaining Tasks

| # | Task | Priority | Details |
|---|------|----------|---------|
| 1 | **ContainerSandboxAdapter not wired at boot** | **P0** | `ContainerSandboxAdapter` is never instantiated in [index.ts](file:///d:/Projects/Prism/src/index.ts). The `ContainerSandboxTool` in builtin-tools uses **in-memory state only** — no filesystem isolation, no real process spawning, no SQLite persistence. |
| 2 | **Tool↔Adapter bridge missing** | **P0** | `ContainerSandboxTool` doesn't accept an adapter parameter (unlike `TerminalSessionTool` which has `constructor(adapter?)`) — it's entirely self-contained with `Map<string, Record>`. Need to add an adapter delegate pattern so the tool routes through the full adapter pipeline. |
| 3 | **Test file references Docker** | **P1** | [container-sandbox-adapter.test.ts:76](file:///d:/Projects/Prism/tests/container-sandbox-adapter.test.ts#L76) asserts `isDockerEnabled() === true`, but the adapter's `isDockerEnabled()` always returns `false` (L98-100). The test will always fail. Needs updating to test the builtin runtime. |
| 4 | **No resource quota enforcement (CPU/memory)** | **P2** | Only disk quota is monitored (L648-666). CPU and memory limits are stored but never enforced. On Linux, could use `cgroups`; on Windows, would need job objects. |
| 5 | **No container exec security sandbox** | **P2** | `execInContainer()` uses `spawn()` with `cwd` set to the workspace dir, but the process can still access the full host filesystem. True isolation would need `chroot`, namespaces, or actual Docker/Podman. |
| 6 | **Dashboard container panel** | **P2** | No dedicated dashboard UI panel for managing container lifecycle (create/start/stop/snapshot/revert). Only appears in the tools list. |

---

## Summary: What's Needed to Reach Production

### P0 — Must Fix (Functionality Broken)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. npm install node-pty (add to package.json dependencies)      │
│ 2. Wire TerminalSessionAdapter in index.ts:                     │
│    - Instantiate with (db, policyEngine, activityBus, profile)  │
│    - Pass to TerminalSessionTool constructor in builtinTools()   │
│ 3. Wire ContainerSandboxAdapter in index.ts:                    │
│    - Instantiate with (db, policyEngine, activityBus, profile)  │
│ 4. Add adapter delegate to ContainerSandboxTool:                │
│    - Accept optional ContainerSandboxAdapter in constructor     │
│    - Route operations through adapter when available            │
└──────────────────────────────────────────────────────────────────┘
```

### P1 — Should Fix (Tests / Deployment)

- Fix `container-sandbox-adapter.test.ts` Docker assertion (now always-false)
- Add `node-pty` native build deps to Dockerfile runtime stage  
- Verify `node-pty` works in Alpine Docker container

### P2 — Nice to Have (Polish)

- Dashboard PTY/container status indicators
- CPU/memory quota enforcement
- True process isolation (chroot/namespaces/job objects)
- Container management dashboard panel
