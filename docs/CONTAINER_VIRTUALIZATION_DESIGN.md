# Container Sandbox Virtualization Design Specification

**Document**: CONTAINER_VIRTUALIZATION_DESIGN.md  
**Date**: 2026-03-17  
**Owner**: Engineering  
**Status**: ACCEPTED (reviewed 2026-04-20)

---

## 1. Overview

Container sandbox virtualization enables PRISM agents to spawn, manage, and lifecycle isolated containerized environments with the following guarantees:

- **Deterministic Control**: create, start, exec, snapshot, revert, stop, destroy operations
- **Replay Determinism**: Full command history with snapshot/revert enables deterministic replay validation
- **Resource Quotas**: CPU, memory, disk limits enforced per container
- **Policy-Aware**: risk-tiered container operations integrated with policy engine
- **Session Persistence**: SQLite persistence for container metadata, snapshot lineage, execution history
- **Reason-Coded Telemetry**: all lifecycle events emit reason-codes for audit trail

Canonical cross-reference:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md` (computer-use core + Business Security Alignment Gate)

Business enterprise note:

- Container virtualization release claims for Business profile must satisfy `CU-BG-*` gate requirements before enterprise-ready positioning.

---

## 2. Container Session Lifecycle

### 2.1 State Machine

```
[IDLE]
  ↓
  create_container()
  ↓
[CREATED]
  ↓
  start_container()
  ↓
[RUNNING]
  ├─→ exec_in_container() → [EXECUTING] → [RUNNING]
  ├─→ snapshot_container() → snapshot stored, remains [RUNNING]
  ├─→ revert_container() → state restored from snapshot, [RUNNING]
  ├─→ timeout → [TIMEOUT] → [STOPPED]
  └─→ stop_container() → [STOPPED]
  ↓
[STOPPED]
  ├─→ destroy_container() → [DESTROYED] → FINAL STATE
  └─→ start_container() → [RUNNING]
  ↓
[DESTROYED]
  └─→ FINAL STATE (cleanup complete, container removed)
```

### 2.2 State Definitions

| State | Definition | Persistence | Cleanup |
|-------|-----------|-------------|---------|
| **IDLE** | Container image ready, instance not spawned | ✓ | N/A |
| **CREATED** | Container instance created, not started | ✓ | N/A |
| **RUNNING** | Container executing, I/O available | ✓ | N/A |
| **EXECUTING** | Command in progress within container | ✓ | Implicit (return to RUNNING on completion) |
| **TIMEOUT** | Command exceeded timeout_ms, container stopping | ✓ | Graceful shutdown via SIGTERM/SIGKILL |
| **STOPPED** | Container halted, can be restarted or destroyed | ✓ | Container kept for potential revert |
| **DESTROYED** | Container image/state cleaned up, removed | ✓ | All resources released, snapshots optionally retained |

---

## 3. Container Interface Contract

### 3.1 Core Methods

#### 3.1.1 `create_container(image, resource_quota?, config?)`

```typescript
interface CreateContainerRequest {
  image: string;                    // Container image (e.g., "ubuntu:20.04")
  resource_quota?: {
    cpu_limit?: number;             // CPU cores (default: 2.0)
    memory_limit_mb?: number;       // Memory in MB (default: 2048)
    disk_limit_mb?: number;         // Disk in MB (default: 10240)
  };
  config?: {
    working_directory?: string;     // CWD inside container
    environment?: Record<string, string>;  // Env vars
    hostname?: string;
  };
}

interface CreateContainerResponse {
  container_id: string;             // UUID for container tracking
  image: string;
  status: "created";
  created_at: string;               // ISO 8601 timestamp
  resource_quota: {
    cpu_limit: number;
    memory_limit_mb: number;
    disk_limit_mb: number;
  };
}
```

**Tier**: Tier 1 (autonomous)  
**Reason-Code**: `autonomous_container_create`  
**Persistence**: Store container_id, image, created_at, resource_quota

---

#### 3.1.2 `start_container(container_id, health_check?)`

```typescript
interface StartContainerRequest {
  container_id: string;
  health_check?: {
    command?: string;               // Health check command (e.g., "curl localhost:8080")
    interval_ms?: number;           // Check interval (default: 5000)
    max_retries?: number;           // Max retries before failure (default: 3)
  };
}

interface StartContainerResponse {
  container_id: string;
  status: "running";
  started_at: string;               // ISO 8601 timestamp
  pid?: number;                     // Container PID (if available)
  health_check_passed: boolean;
}
```

**Tier**: Tier 1 (autonomous)  
**Reason-Code**: `autonomous_container_start`  
**Persistence**: Store started_at, health_check_passed status

---

#### 3.1.3 `exec_in_container(container_id, command, timeout_ms?, stream?)`

```typescript
interface ExecInContainerRequest {
  container_id: string;
  command: string;                  // Shell command to execute
  timeout_ms?: number;              // Override default timeout (default: 30000)
  stream?: {
    stdout?: boolean;               // Capture stdout (default: true)
    stderr?: boolean;               // Capture stderr (default: true)
  };
}

interface ExecInContainerResponse {
  container_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  status: "success" | "timeout" | "error";
  executed_at: string;              // ISO 8601 timestamp
}
```

**Tier**: Tier 1 (autonomous) for read-only commands  
**Tier 2/3**: For high-risk keywords (see §3.3)  
**Reason-Code**: Auto-populated based on tier decision  
**Persistence**: Store command, exit_code, duration_ms, executed_at

---

#### 3.1.4 `snapshot_container(container_id, snapshot_name, metadata?)`

```typescript
interface SnapshotContainerRequest {
  container_id: string;
  snapshot_name: string;            // User-friendly snapshot name
  metadata?: {
    description?: string;
    tags?: string[];
  };
}

interface SnapshotContainerResponse {
  container_id: string;
  snapshot_id: string;              // UUID for snapshot
  snapshot_name: string;
  status: "snapshot_created";
  snapshot_size_mb: number;
  created_at: string;               // ISO 8601 timestamp
  command_history_count: number;    // Commands executed before snapshot
}
```

**Tier**: Tier 1 (autonomous, non-destructive)  
**Reason-Code**: `autonomous_container_snapshot`  
**Persistence**: Store snapshot_id, snapshot_name, snapshot_size_mb, created_at, command_history_count

---

#### 3.1.5 `revert_container(container_id, snapshot_id)`

```typescript
interface RevertContainerRequest {
  container_id: string;
  snapshot_id: string;              // Snapshot to restore from
}

interface RevertContainerResponse {
  container_id: string;
  snapshot_id: string;
  status: "reverted";
  reverted_at: string;              // ISO 8601 timestamp
  command_history_preserved: boolean; // History before snapshot still accessible
}
```

**Tier**: Tier 2 (conditional) or Tier 1 (depends on snapshot operations)  
**Reason-Code**: `conditional_container_revert_to_snapshot`  
**Persistence**: Store reverted_at, snapshot_id used for revert

---

#### 3.1.6 `stop_container(container_id, timeout_before_kill_ms?, reason?)`

```typescript
interface StopContainerRequest {
  container_id: string;
  timeout_before_kill_ms?: number;  // Grace period before SIGKILL (default: 3000)
  reason?: string;                  // Operator reason (optional)
}

interface StopContainerResponse {
  container_id: string;
  status: "stopped";
  signal_sequence: string[];        // Signals sent (["SIGTERM", "SIGKILL"])
  cleanup_duration_ms: number;
  stopped_at: string;               // ISO 8601 timestamp
}
```

**Tier**: Tier 2 (conditional)  
**Reason-Code**: `conditional_container_stop_<reason>`  
**Persistence**: Store signal_sequence, cleanup_duration_ms, stopped_at

---

#### 3.1.7 `destroy_container(container_id, reason, approver_id?)`

```typescript
interface DestroyContainerRequest {
  container_id: string;
  reason: string;                   // Why container is being destroyed
  approver_id?: string;             // ID of approver (Tier 3 only)
  retain_snapshots?: boolean;       // Keep snapshots for audit (default: true)
}

interface DestroyContainerResponse {
  container_id: string;
  status: "destroyed";
  destruction_reason: string;
  snapshots_retained_count: number;
  destroyed_at: string;             // ISO 8601 timestamp
  approver_id?: string;
}
```

**Tier**: Tier 3 (approval required)  
**Reason-Code**: `approval_required_destroy_container`  
**Persistence**: Store destruction_reason, snapshots_retained_count, approver_id, destroyed_at

---

#### 3.1.8 `get_container_status(container_id)`

```typescript
interface ContainerStatusResponse {
  container_id: string;
  image: string;
  status: ContainerState;
  created_at: string;
  started_at?: string;
  current_snapshot?: {
    snapshot_id: string;
    snapshot_name: string;
    created_at: string;
  };
  resource_usage?: {
    cpu_percent: number;
    memory_mb: number;
    disk_mb: number;
  };
}
```

**Tier**: Tier 1 (autonomous, read-only)  
**Reason-Code**: `autonomous_container_status`

---

#### 3.1.9 `list_snapshots(container_id, limit?, offset?)`

```typescript
interface ListSnapshotsResponse {
  container_id: string;
  snapshots: Array<{
    snapshot_id: string;
    snapshot_name: string;
    created_at: string;
    snapshot_size_mb: number;
    command_count: number;
  }>;
  total_count: number;
  returned_count: number;
}
```

**Tier**: Tier 1 (autonomous, read-only)  
**Reason-Code**: `autonomous_container_list_snapshots`

---

### 3.2 Policy Tier Mapping

#### Tier 1 (Autonomous)

- `create_container()`
- `start_container()`
- `exec_in_container()` with read-only commands
- `snapshot_container()`
- `get_container_status()`
- `list_snapshots()`

**Reason-Code Format**: `autonomous_container_<operation>`

---

#### Tier 2 (Conditional)

- `exec_in_container()` with mutating commands
- `stop_container()`
- `revert_container()` (depends on commands in snapshot)

**Policy Logic**:

- If container has running services → require approval for stop
- If snapshot contains high-risk operations → require approval for revert
- Otherwise → auto-approve

**Reason-Code Format**: `conditional_container_<operation>_<reason>`

---

#### Tier 3 (Approval Required)

- `destroy_container()` (destructive, removes all container state)
- `exec_in_container()` with high-risk keywords:
  - **Destructive**: rm -rf, dd, format, fdisk
  - **Privilege**: sudo, chmod, chown, setfacl
  - **System**: systemctl stop/restart, reboot

**Reason-Code Format**: `approval_required_destroy_container` or `approval_required_dangerous_command_<keyword>`

---

### 3.3 High-Risk Keyword Detection

Same as Terminal spec (§3.3 in TERMINAL_VIRTUALIZATION_DESIGN.md):

```typescript
const TIER_1_KEYWORDS = ["ls", "cat", "grep", "ps", "echo", ...];
const TIER_2_KEYWORDS = ["mkdir", "touch", "cp", "install", ...];
const TIER_3_KEYWORDS = ["rm", "dd", "sudo", "reboot", ...];
```

---

## 4. Container Session Persistence

### 4.1 SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS containers (
  container_id TEXT PRIMARY KEY,
  image TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  created_at TEXT NOT NULL,
  started_at TEXT,
  stopped_at TEXT,
  destroyed_at TEXT,
  destruction_reason TEXT,
  approver_id TEXT
);

CREATE TABLE IF NOT EXISTS container_resource_quota (
  container_id TEXT PRIMARY KEY,
  cpu_limit REAL DEFAULT 2.0,
  memory_limit_mb INTEGER DEFAULT 2048,
  disk_limit_mb INTEGER DEFAULT 10240,
  FOREIGN KEY(container_id) REFERENCES containers(container_id)
);

CREATE TABLE IF NOT EXISTS container_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  snapshot_name TEXT NOT NULL,
  description TEXT,
  snapshot_size_mb INTEGER,
  command_count_at_snapshot INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(container_id) REFERENCES containers(container_id)
);

CREATE TABLE IF NOT EXISTS container_command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  command TEXT NOT NULL,
  snapshot_id TEXT,  -- Which snapshot this command is in
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  executed_at TEXT NOT NULL,
  reason_code TEXT,
  policy_tier TEXT,
  FOREIGN KEY(container_id) REFERENCES containers(container_id),
  FOREIGN KEY(snapshot_id) REFERENCES container_snapshots(snapshot_id)
);

CREATE TABLE IF NOT EXISTS container_revert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  reverted_at TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY(container_id) REFERENCES containers(container_id),
  FOREIGN KEY(snapshot_id) REFERENCES container_snapshots(snapshot_id)
);
```

---

## 5. Snapshot & Revert Semantics

### 5.1 Snapshot Strategy

Snapshots use **Copy-on-Write (COW)** filesystem model:

1. **Base Layer**: Original container filesystem (immutable after first snapshot)
2. **Delta Layer**: Changes accumulated since previous snapshot
3. **Metadata Layer**: Command history + execution state

**Storage**:

- Snapshots stored in `prism-output/container-snapshots/<container_id>/<snapshot_id>/`
- Full command history linked to each snapshot
- Automatic retention: Keep >= 5 most recent snapshots per container

---

### 5.2 Revert Workflow

```
Original state:
  [Snapshot A]
    $ echo "start"
    $ touch file.txt
    $ echo "content" > file.txt

User executes:
  $ rm file.txt
  $ mkdir /tmp/work

[Snapshot B]
  $ echo "start"
  $ touch file.txt
  $ echo "content" > file.txt
  $ rm file.txt
  $ mkdir /tmp/work

User calls: revert_container(container_id, snapshot_id=A)

Result:
  [Back to Snapshot A state]
  $ ls → file.txt exists, /tmp/work does not exist
  Command history restored to state at snapshot A
```

---

### 5.3 Replay Determinism

For Stage 2 validation:

```
1. Execute commands in container:
   $ mkdir /tmp/test
   $ echo "hello" > /tmp/test/file.txt
   $ cat /tmp/test/file.txt

2. Snapshot state [Snapshot-X]

3. Revert to [Snapshot-X]

4. Re-execute exact same commands:
   $ mkdir /tmp/test
   $ echo "hello" > /tmp/test/file.txt
   $ cat /tmp/test/file.txt

5. Validate outputs match:
   - exit_code: same
   - stdout: identical
   - stderr: identical
```

**Success Criteria**:

- 3+ command sequences tested
- All outputs match after revert+replay
- Documented in container-lifecycle-report.md

---

## 6. Resource Quota Enforcement

### 6.1 Quota Engine

When `exec_in_container()` executes:

1. **Monitor CPU usage**: If exceeds `cpu_limit` → throttle or interrupt
2. **Monitor Memory usage**: If exceeds `memory_limit_mb` → OOM kill process
3. **Monitor Disk usage**: If exceeds `disk_limit_mb` → block write operations

### 6.2 Error Handling

**OOM (Out of Memory)**:

```json
{
  "error": "Container out of memory",
  "container_id": "<id>",
  "status": "oom_killed",
  "memory_limit_mb": 2048,
  "command": "python train_model.py"
}
```

**Disk Full**:

```json
{
  "error": "Disk quota exceeded",
  "container_id": "<id>",
  "disk_limit_mb": 10240,
  "current_usage_mb": 10241,
  "status": "disk_full"
}
```

---

## 7. Timeout & Cleanup Semantics

### 7.1 Command Timeout

Same as Terminal (§5.1 in TERMINAL_VIRTUALIZATION_DESIGN.md):

```
exec_in_container() with timeout_ms=5000
  ↓
[Command executing]
  ↓
5000ms elapsed, no completion
  ↓
SIGTERM sent
  ↓
[Wait 2000ms]
  ↓
If still alive: SIGKILL sent
  ↓
Status: "timeout"
```

---

### 7.2 Container Destruction Cleanup

```
destroy_container(container_id, reason="deployment complete")
  ↓
[Verify Tier 3 approval]
  ↓
[Stop any running processes]
  ↓
[Optionally retain snapshots for audit (default: yes)]
  ↓
[Remove container instance]
  ↓
[Clean up delta layers, keep base image]
  ↓
Status: "destroyed"
```

---

## 8. Integration with Policy Engine

Same approach as Terminal (§8 in TERMINAL_VIRTUALIZATION_DESIGN.md):

1. Extract keywords from command
2. Determine policy tier
3. Route to policy engine
4. Await approval for Tier 3
5. Execute or gate based on decision

---

## 9. Testing Strategy

### 9.1 Unit Tests

- [ ] create_container() creates container with correct ID and quotas
- [ ] start_container() transitions to RUNNING
- [ ] exec_in_container() with read-only → Tier 1
- [ ] exec_in_container() with mutating → Tier 2
- [ ] exec_in_container() with high-risk → Tier 3
- [ ] snapshot_container() creates snapshot with metadata
- [ ] revert_container() restores filesystem state
- [ ] stop_container() gracefully stops container
- [ ] destroy_container() requires Tier 3 approval
- [ ] Resource quota enforcement works (OOM, disk full)
- [ ] Keyword detection accurate

### 9.2 Integration Tests

- [ ] Normal create → start → exec → stop → destroy workflow
- [ ] Snapshot → revert workflow
- [ ] Concurrent container isolation
- [ ] Container persistence: restart system, recover container state
- [ ] Approval gate integration: Tier 3 ops require approval
- [ ] Resource quota limits enforced (OOM test, disk full test)

### 9.3 Replay/Determinism Tests

- [ ] Execute 5+ command sequences in container
- [ ] Take snapshot [S1]
- [ ] Execute 3+ more commands
- [ ] Revert to [S1]
- [ ] Re-execute first 5 commands
- [ ] Validate all outputs match exactly
- [ ] Document replay coverage

### 9.4 Drill Scenarios (Stage 2)

- [ ] **Revert Drill 1**: Execute commands → snapshot → modify → revert → verify original state
- [ ] **Revert Drill 2**: Multiple snapshots, revert to oldest, verify state
- [ ] **Destroy Drill**: Destroy container → verify snapshots retained → verify container gone
- [ ] **Quota Drill**: Exceed memory limit → verify OOM handling → verify process killed

---

## 10. Success Criteria

### Completeness

- ✓ All 9 core methods implemented
- ✓ Tier 1/2/3 routing integrated
- ✓ SQLite persistence + snapshot storage working
- ✓ Resource quota enforcement working

### Quality

- ✓ 100% of unit tests pass
- ✓ 100% of integration tests pass
- ✓ 3+ replay/determinism tests pass
- ✓ 4+ drills documented with metrics

### Safety

- ✓ No orphaned processes after destroy
- ✓ SIGKILL always terminates containers
- ✓ Snapshots retained for audit trail
- ✓ Reason-codes emitted for all high-risk operations
- ✓ Approval gate blocks Tier 3 until approved

---

## 11. Appendix: Implementation Checklist

- [ ] Define SQLite schema migrations (containers, snapshots, command_history, revert_log)
- [ ] Create ContainerSandboxAdapter class with 9 core methods
- [ ] Implement COW snapshot strategy using filesystem deltas
- [ ] Implement resource quota monitoring (CPU, memory, disk)
- [ ] Integrate with existing policy engine (add tier routing)
- [ ] Add reason-code emission to policy decisions
- [ ] Write unit test suite (15+ tests)
- [ ] Write integration test suite (7+ tests)
- [ ] Write replay validation tests (3+ scenarios)
- [ ] Document all error modes with recovery procedures
- [ ] Execute Stage 2 drill scenarios (4+ drills)
- [ ] Create container-lifecycle-report.md with test results
- [x] Get sign-off from Engineering Lead

---

**Design Review**: Completed 2026-04-20.

---

## Implementation Notes (2026-04-20)

### Artifacts

| Artifact | Location |
|----------|----------|
| Adapter implementation | `src/adapters/application/container-sandbox-adapter.ts` |
| Test suite | `tests/container-sandbox-adapter.test.ts` (10+ test cases) |
| System tool wrapper | `src/adapters/system/container-sandbox-tool.ts` |

### Implemented Capabilities

- Full container state machine (CREATED → RUNNING → EXECUTING → TIMEOUT → STOPPED → DESTROYED)
- SQLite persistence: 4 tables (`containers`, `container_snapshots`, `container_command_history`, `container_signal_log`)
- Resource quotas stored as metadata (CPU cores, memory MB, disk MB)
- Snapshot/revert with parent-tracked lineage chain
- Policy tier routing with keyword classification (Tier 1/2/3)
- Graceful shutdown with SIGTERM → SIGKILL signal escalation (2s grace period)
- Activity bus event emission for all lifecycle transitions
- Snapshot listing with chronological ordering
- Destroy with forced termination and audit trail (Tier 3)

### Known Gaps (Deferred to Future Scope)

- **Container runtime**: Uses `spawn("sh", ["sleep infinity"])` simulation; Docker Engine API / containerd gRPC integration deferred.
- **Resource quotas**: Metadata-only storage; no OS-level enforcement (cgroups v2) applied.
- **Resource monitoring**: `monitorResourceUsage()` called but returns immediately; no /proc polling.
- **Snapshot delta analysis**: Snapshots stored but no binary diff or delta comparison between snapshots.
- **Policy routing**: `routeThroughPolicy()` classifies tiers but always returns `allow`; real ApprovalQueue integration for Tier 3 deferred.
