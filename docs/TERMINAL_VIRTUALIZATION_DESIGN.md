# Terminal Virtualization Design Specification

**Document**: TERMINAL_VIRTUALIZATION_DESIGN.md  
**Date**: 2026-03-17  
**Owner**: Engineering  
**Status**: ACCEPTED (reviewed 2026-04-20)

---

## 1. Overview

Terminal virtualization enables PRISM agents to spawn, manage, and lifecycle isolated shell sessions with the following guarantees:

- **Deterministic Control**: start, stop, revoke operations with explicit state tracking
- **Policy-Aware**: risk-tiered terminal operations integrated with policy engine
- **Timeout & Revoke**: graceful shutdown with signal escalation (SIGTERM → SIGKILL)
- **Session Persistence**: SQLite persistence for session metadata, history, and exit codes
- **Reason-Coded Telemetry**: all lifecycle events emit reason-codes for audit trail

Canonical cross-reference:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md` (computer-use core + Business Security Alignment Gate)

Business enterprise note:

- Terminal virtualization release claims for Business profile must satisfy `CU-BG-*` gate requirements before enterprise-ready positioning.

---

## 2. Terminal Session Lifecycle

### 2.1 State Machine

```
[IDLE] 
  ↓
  start_session()
  ↓
[ACTIVE] 
  ├─→ exec_command() → [EXECUTING] → [ACTIVE]
  ├─→ pause_session() → [SUSPENDED]
  ├─→ timeout → [TIMEOUT] → [TERMINATED]
  └─→ revoke_session() → [REVOKED] → [TERMINATED]
  ↓
[SUSPENDED]
  ├─→ resume_session() → [ACTIVE]
  └─→ revoke_session() → [REVOKED] → [TERMINATED]
  ↓
[TERMINATED]
  └─→ FINAL STATE (cleanup complete, exit code recorded)
```

### 2.2 State Definitions

| State | Definition | Persistence | Cleanup |
|-------|-----------|-------------|---------|
| **IDLE** | Session created, process not spawned | ✓ | N/A |
| **ACTIVE** | Shell process running, I/O available | ✓ | N/A |
| **EXECUTING** | Command in progress within session | ✓ | Implicit (return to ACTIVE on completion) |
| **SUSPENDED** | Shell paused, stdin/stdout available but process suspended | ✓ | Signal: SIGSTOP |
| **TIMEOUT** | Command exceeded timeout_ms, escalating cleanup | ✓ | Signal escalation sequence |
| **REVOKED** | Explicit human/policy revocation | ✓ | Signal escalation sequence |
| **TERMINATED** | Process cleaned up, session closed | ✓ | All resources released |

---

## 3. Terminal Interface Contract

### 3.1 Core Methods

#### 3.1.1 `start_session(shell_type, init_script?, config?)`

```typescript
interface StartSessionRequest {
  shell_type: "bash" | "sh" | "zsh" | "powershell";
  init_script?: string;        // Optional shell commands to run on startup
  config?: {
    timeout_ms?: number;        // Default command timeout (default: 30000)
    max_history?: number;       // Max lines to keep (default: 1000)
    working_directory?: string; // CWD for session (default: process.cwd())
  };
}

interface StartSessionResponse {
  session_id: string;           // UUID for session tracking
  status: "active";
  shell_type: string;
  created_at: string;           // ISO 8601 timestamp
  pid?: number;                 // Process ID (if available)
}
```

**Tier**: Tier 1 (autonomous)  
**Reason-Code**: `autonomous_terminal_start`  
**Persistence**: Store session_id, shell_type, created_at in SQLite

---

#### 3.1.2 `exec_command(session_id, command, timeout_ms?, stream?)`

```typescript
interface ExecCommandRequest {
  session_id: string;
  command: string;              // Shell command to execute
  timeout_ms?: number;          // Override default timeout (default: 30000)
  stream?: {
    stdout?: boolean;           // Capture stdout (default: true)
    stderr?: boolean;           // Capture stderr (default: true)
  };
}

interface ExecCommandResponse {
  session_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  status: "success" | "timeout" | "error";
  executed_at: string;          // ISO 8601 timestamp
}
```

**Tier**: Tier 1 (autonomous) for read-only commands  
**Tier 2/3**: For high-risk keywords (see §3.3)  
**Reason-Code**: Auto-populated based on tier decision  
**Persistence**: Store command, exit_code, duration_ms, executed_at

---

#### 3.1.3 `stop_session(session_id, signal?, reason?)`

```typescript
interface StopSessionRequest {
  session_id: string;
  signal?: "SIGTERM" | "SIGKILL";  // Default: SIGTERM
  reason?: string;                  // Operator reason (optional)
}

interface StopSessionResponse {
  session_id: string;
  status: "terminated";
  signal_sent: string;
  cleanup_duration_ms: number;
  exit_code: number;
  terminated_at: string;            // ISO 8601 timestamp
}
```

**Tier**: Tier 2 (conditional)  
**Reason-Code**: `conditional_terminal_stop_<reason>` or `conditional_terminal_stop`  
**Persistence**: Store signal_sent, cleanup_duration_ms, exit_code, terminated_at

---

#### 3.1.4 `revoke_session(session_id, reason, approver_id?)`

```typescript
interface RevokeSessionRequest {
  session_id: string;
  reason: string;                   // Why session is being revoked
  approver_id?: string;             // ID of approver (Tier 3 only)
}

interface RevokeSessionResponse {
  session_id: string;
  status: "revoked";
  revocation_reason: string;
  signal_sequence: string[];        // Signals sent in order ["SIGTERM", "SIGKILL"]
  cleanup_duration_ms: number;
  revoked_at: string;               // ISO 8601 timestamp
  approver_id?: string;
}
```

**Tier**: Tier 3 (approval required)  
**Reason-Code**: `approval_required_revoke_session`  
**Persistence**: Store revocation_reason, signal_sequence, cleanup_duration_ms, approver_id, revoked_at

---

#### 3.1.5 `get_session_status(session_id)`

```typescript
interface SessionStatusResponse {
  session_id: string;
  status: SessionState;             // Current state
  shell_type: string;
  created_at: string;
  last_activity_at: string;
  pid?: number;
  exit_code?: number;               // Only if TERMINATED
  history_line_count: number;
}
```

**Tier**: Tier 1 (autonomous, read-only)  
**Reason-Code**: `autonomous_terminal_status`

---

#### 3.1.6 `get_session_history(session_id, limit?, offset?)`

```typescript
interface SessionHistoryResponse {
  session_id: string;
  history: Array<{
    command: string;
    exit_code: number;
    duration_ms: number;
    executed_at: string;
    stdout?: string;
    stderr?: string;
  }>;
  total_count: number;
  returned_count: number;
}
```

**Tier**: Tier 1 (autonomous, read-only)  
**Reason-Code**: `autonomous_terminal_history`

---

### 3.2 Policy Tier Mapping

#### Tier 1 (Autonomous)

Operations that can execute without approval:

- `start_session()`
- `exec_command()` with read-only keywords (ls, cat, grep, ps, whoami, etc.)
- `get_session_status()`
- `get_session_history()`
- `pause_session()`
- `resume_session()`

**Reason-Code Format**: `autonomous_terminal_<operation>`

---

#### Tier 2 (Conditional)

Operations that may require approval based on context:

- `exec_command()` with mutating keywords (mkdir, touch, cp, mv, etc.)
- `stop_session()` (graceful termination)

**Policy Logic**:

- If session has pending long-running commands → require approval
- If operator has Admin tier → auto-approve
- Otherwise → require explicit approval

**Reason-Code Format**: `conditional_terminal_<operation>_<reason>`

---

#### Tier 3 (Approval Required)

Operations that always require explicit human approval:

- `revoke_session()` (destructive, kills running processes)
- `exec_command()` with high-risk keywords:
  - **Destructive**: rm, dd, shred, format, mkfs, fdisk
  - **Privilege**: sudo, su, chmod, chown, setfacl
  - **System**: reboot, shutdown, systemctl stop/restart
  - **Dangerous**: eval, exec, source

**Reason-Code Format**: `approval_required_revoke_session` or `approval_required_dangerous_command_<keyword>`

---

### 3.3 High-Risk Keyword Detection

```typescript
const TIER_1_KEYWORDS = [
  "ls", "cat", "grep", "ps", "whoami", "pwd", "echo",
  "date", "uname", "which", "type", "find", "head", "tail"
];

const TIER_2_KEYWORDS = [
  "mkdir", "touch", "cp", "mv", "rename", "cp -r",
  "write", "append", "install", "update", "curl", "wget"
];

const TIER_3_KEYWORDS = [
  "rm", "rm -rf", "dd", "shred", "format", "mkfs", "fdisk",
  "sudo", "su", "chmod", "chown", "setfacl",
  "reboot", "shutdown", "systemctl stop", "systemctl restart",
  "eval", "exec", "source", ">", ">>", "|"
];
```

**Detection Logic**:

1. Parse first word of command (before spaces/pipes)
2. Check against keyword lists
3. If high-risk keyword found → escalate tier
4. If multiple keywords → use highest tier

**Example**:

- `cat /etc/passwd` → Tier 1 (read-only)
- `mkdir /tmp/work` → Tier 2 (create directory)
- `rm -rf /tmp/work` → Tier 3 (destructive)
- `sudo systemctl restart nginx` → Tier 3 (privilege + system)

---

## 4. Terminal Session Persistence

### 4.1 SQLite Schema

```sql
-- Terminal sessions table
CREATE TABLE IF NOT EXISTS terminal_sessions (
  session_id TEXT PRIMARY KEY,
  shell_type TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  pid INTEGER,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  terminated_at TEXT,
  exit_code INTEGER,
  revocation_reason TEXT,
  approver_id TEXT,
  working_directory TEXT,
  max_history INTEGER DEFAULT 1000
);

-- Command history table
CREATE TABLE IF NOT EXISTS terminal_command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  executed_at TEXT NOT NULL,
  reason_code TEXT,
  policy_tier TEXT,
  FOREIGN KEY(session_id) REFERENCES terminal_sessions(session_id)
);

-- Signal escalation log table
CREATE TABLE IF NOT EXISTS terminal_signal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT,  -- 'timeout', 'revoke', 'stop'
  signal_sequence TEXT,  -- JSON array ["SIGTERM", "SIGKILL"]
  cleanup_duration_ms INTEGER,
  event_at TEXT NOT NULL,
  reason TEXT,
  approver_id TEXT,
  FOREIGN KEY(session_id) REFERENCES terminal_sessions(session_id)
);
```

### 4.2 Persistence Guarantees

- **Session Metadata**: Persisted on create, updated on state transition
- **Command History**: Persisted after each exec_command()
- **Signals & Timeouts**: Persisted on revoke/timeout/stop
- **Replay**: Command history fully reconstructible for deterministic replay testing

---

## 5. Timeout & Revoke Semantics

### 5.1 Command Timeout Handling

```
exec_command() with timeout_ms=5000
  ↓
[Command executing]
  ↓
5000ms elapsed, no completion
  ↓
SIGTERM sent (graceful termination)
  ↓
[Wait 2000ms for process cleanup]
  ↓
If process still alive:
  ↓
SIGKILL sent (forceful termination)
  ↓
Status: "timeout"
Response: {exit_code: -15 or -9, status: "timeout"}
```

**Reason-Code**: `conditional_timeout_command_exceeded_threshold`

### 5.2 Revoke Session Handling

```
revoke_session(session_id, reason="operator request")
  ↓
[Verify approval is satisfied]
  ↓
SIGTERM sent to process
  ↓
[Wait 3000ms for graceful shutdown]
  ↓
If process still alive:
  ↓
SIGKILL sent
  ↓
[Close all file descriptors, release resources]
  ↓
Status: "revoked"
Session transitioned to TERMINATED
```

**Signal Sequence**: ["SIGTERM", "SIGKILL"]  
**Reason-Code**: `approval_required_revoke_session`

---

## 6. Rollback & Determinism

### 6.1 Rollback Semantics

Terminal sessions are **not** intrinsically rollback-able (they represent OS state). However:

1. **Session Snapshot**: Before high-risk operations, capture session metadata
2. **Command History**: Full traceable history in SQLite
3. **Replay Mode**: Execute same command sequence in fresh session → validate determinism

### 6.2 Replay Validation

```
Original session execution trace:
  [Session 1] $ mkdir /tmp/work
  [Session 1] $ touch /tmp/work/file.txt
  [Session 1] $ cat /tmp/work/file.txt → "hello"
  [Session 1] $ revoke_session()

Replay in fresh session:
  [Session 2] $ mkdir /tmp/work
  [Session 2] $ touch /tmp/work/file.txt
  [Session 2] $ cat /tmp/work/file.txt → "hello"  [MATCH ✓]
```

**Test Coverage**: Execute 3+ command sequences, validate exit codes and output match

---

## 7. Error Handling & Failure Modes

### 7.1 Process Spawn Failures

**Scenario**: Shell process fails to start (e.g., shell binary not found)

**Response**:

```json
{
  "error": "Failed to spawn shell",
  "reason": "Shell binary not found",
  "shell_type": "bash",
  "status": "error"
}
```

**Tier**: Autonomous (system error, no policy gate)  
**Reason-Code**: `system_error_shell_spawn_failed`

---

### 7.2 Command Timeout Without Cleanup

**Scenario**: Process doesn't respond to SIGTERM, SIGKILL hangs

**Response**:

```json
{
  "error": "Forceful termination failed",
  "reason": "Process still alive after SIGKILL",
  "signal_sequence": ["SIGTERM", "SIGKILL"],
  "cleanup_duration_ms": 5000,
  "status": "termination_failed"
}
```

**Action**: Escalate to Operations, mark session for manual recovery  
**Reason-Code**: `system_error_termination_failed`

---

### 7.3 Revocation Blocked by Approval

**Scenario**: Attempt to revoke without approval, Tier 3 gate rejects

**Response**:

```json
{
  "error": "Revocation required approval",
  "approval_id": "req-<uuid>",
  "status": "approval_pending",
  "expires_in_ms": 60000
}
```

**Action**: Broker revocation through approval service  
**Reason-Code**: `approval_pending_revoke_session`

---

## 8. Integration with Policy Engine

### 8.1 Policy Routing

When `exec_command()` is called:

1. **Extract first word** from command string
2. **Check keyword lists** (Tier 1, 2, 3)
3. **Determine tier** based on keywords found
4. **Route to policy engine** with tier and reason-code
5. **Await policy decision** (auto-approve, require approval, deny)
6. **Execute or gate** command based on decision

### 8.2 Example Flow

```
User Request:
  exec_command(session_id="sess-123", command="rm -rf /tmp/work")

Step 1: Extract keywords
  ["rm", "rf"] → matches TIER_3_KEYWORDS

Step 2: Route to policy engine
  PolicyRequest {
    tier: 3,
    operation: "terminal.exec_command",
    command: "rm -rf /tmp/work",
    reason_code: "approval_required_dangerous_command_rm"
  }

Step 3: Policy decision
  Tier 3 requires approval → return approval_pending

Step 4: Broker approval
  Approval ID: "appr-<uuid>"
  Expires: 60 seconds

Step 5a: Approval granted
  exec_command() executes → returns stdout/stderr, exit_code

Step 5b: Approval denied
  Command blocked → return error with denial reason

Step 5c: Timeout
  Command blocked → return error with timeout reason
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

- [ ] start_session() creates session with correct ID
- [ ] exec_command() with read-only keywords → Tier 1
- [ ] exec_command() with mutating keywords → Tier 2
- [ ] exec_command() with high-risk keywords → Tier 3
- [ ] stop_session() sets status to TERMINATED
- [ ] revoke_session() requires Tier 3 approval
- [ ] Session status transitions validate state machine
- [ ] Keyword detection accurate for all keyword lists

### 9.2 Integration Tests

- [ ] Normal start → exec → stop workflow
- [ ] Timeout handling: command exceeds timeout_ms
- [ ] Revoke drills: revoke_session() with approval + cleanup
- [ ] Concurrent session isolation: two sessions don't interfere
- [ ] Session persistence: restart process, recover session state
- [ ] Approval gate integration: Tier 3 ops require approval

### 9.3 Replay/Determinism Tests

- [ ] Execute 5+ command sequences, capture history
- [ ] Replay each sequence in fresh session
- [ ] Validate exit codes match
- [ ] Validate stdout/stderr match
- [ ] Document replay coverage and results

### 9.4 Drill Scenarios (Stage 2)

- [ ] **Revoke Drill 1**: Long-running command → revoke → verify cleanup
- [ ] **Revoke Drill 2**: Command with multiple subprocesses → revoke → verify all terminated
- [ ] **Timeout Drill**: Command exceeds timeout → auto-cleanup → verify exit code
- [ ] **Approval Drill**: Attempt Tier 3 command → approval denied → command blocked

---

## 10. Success Criteria

### Completeness

- ✓ All 6 core methods implemented
- ✓ Tier 1/2/3 routing integrated
- ✓ SQLite persistence working
- ✓ Timeout + revoke signal escalation working

### Quality

- ✓ 100% of unit tests pass
- ✓ 100% of integration tests pass
- ✓ 3+ replay/determinism tests pass
- ✓ 3+ revoke drills documented with metrics

### Safety

- ✓ No orphaned processes after revoke
- ✓ SIGKILL always terminates (fallback to process.kill())
- ✓ Reason-codes emitted for all high-risk operations
- ✓ Approval gate blocks Tier 3 operations until approved

---

## 11. Appendix: Implementation Checklist

- [ ] Define SQLite schema migrations (terminal_sessions, terminal_command_history, terminal_signal_log)
- [ ] Create TerminalSessionAdapter class with 6 core methods
- [ ] Implement keyword detection logic for Tier 1/2/3
- [ ] Integrate with existing policy engine (add tier routing)
- [ ] Add reason-code emission to policy decisions
- [ ] Write unit test suite (14+ tests)
- [ ] Write integration test suite (6+ tests)
- [ ] Write replay validation tests (3+ scenarios)
- [ ] Document all error modes with recovery procedures
- [ ] Execute Stage 2 drill scenarios (3+ drills)
- [ ] Create terminal-lifecycle-report.md with test results
- [x] Get sign-off from Engineering Lead

---

**Design Review**: Completed 2026-04-20.

---

## Implementation Notes (2026-04-20)

### Artifacts

| Artifact | Location |
|----------|----------|
| Adapter implementation | `src/adapters/application/terminal-session-adapter.ts` |
| Test suite | `tests/terminal-session-adapter.test.ts` (12 test cases) |
| System tool wrapper | `src/adapters/system/terminal-session-tool.ts` |

### Implemented Capabilities

- Full session lifecycle state machine (IDLE → ACTIVE → EXECUTING → TIMEOUT/REVOKED → TERMINATED)
- SQLite persistence: 3 tables (`terminal_sessions`, `terminal_command_history`, `terminal_signal_log`)
- Policy tier routing with keyword classification (Tier 1/2/3)
- Graceful shutdown with SIGTERM → SIGKILL signal escalation (2s grace period)
- Activity bus event emission for all lifecycle transitions
- Command history retrieval with configurable limit
- Revoke with forced termination and audit trail

### Known Gaps (Deferred to Future Scope)

- **Pause/Resume**: `SUSPENDED` state defined in spec but `pauseSession()`/`resumeSession()` methods not implemented. SIGSTOP/SIGCONT signals not wired.
- **Shell process**: Uses `child_process.spawn` (mock); real PTY integration via `node-pty` deferred.
- **Timeout detection**: Exit code detection via regex pattern; true terminal I/O handling deferred.
- **Session pooling**: Each session spawns a fresh shell process; session pool/reuse not implemented.
- **Policy routing**: `routeThroughPolicy()` classifies tiers but always returns `allow`; real ApprovalQueue integration for Tier 3 deferred.
