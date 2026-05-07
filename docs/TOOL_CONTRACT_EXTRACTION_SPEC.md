# Tool Contract Extraction & Dynamic Staging Specification

**Document**: TOOL_CONTRACT_EXTRACTION_SPEC.md  
**Date**: 2026-03-17  
**Owner**: Engineering  
**Status**: ACCEPTED (reviewed 2026-04-20)

---

## 1. Overview

Tool contract extraction enables PRISM to dynamically ingest staged tools, validate their schemas against baseline contracts, assign policy tiers, and route them through the approval governance system. This enables:

- **Dynamic Tool Registration**: New tools can be staged without recompilation
- **Contract Safety**: Extracted schemas validated against known-good baselines
- **Risk Auto-Assignment**: Policy tier determined from contract analysis
- **Approval Gating**: High-risk tools require approval before registration
- **Audit Trail**: All staged tools logged with contract diffs and tier assignments
- **Reason-Coded Telemetry**: Rejected tools emit specific reason-codes

---

## 2. Tool Contract Model

### 2.1 Tool Contract Schema

Every tool has an **immutable contract** that defines its interface:

```typescript
interface ToolContract {
  // Identity
  tool_name: string;              // Unique tool identifier
  version: string;                // Semver (e.g., "1.2.3")
  provider: string;               // Tool author (e.g., "anthropic/tools")
  
  // Functional specification
  description: string;            // One-line tool purpose
  category: "system" | "protocol" | "application" | "staged"; // Tool class
  
  // Input contract
  input_schema: {
    type: "object" | "string" | "number" | ...;
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
      enum?: any[];
      pattern?: string;
      min_length?: number;
      max_length?: number;
    }>;
    required: string[];
  };
  
  // Output contract
  output_schema: {
    type: "object" | "string" | "number" | ...;
    properties: Record<string, any>;
    description: string;
  };
  
  // Safety & Risk
  mutating: boolean;              // Does tool modify system state?
  error_classes: string[];        // Possible error types
  risk_tier?: "tier1" | "tier2" | "tier3";  // Auto-assigned or explicit
  dangerous_keywords?: string[];  // Keywords in tool path that escalate risk
  rollback_strategy?: "none" | "snapshot" | "revert";  // Recovery capability
  
  // Governance
  requires_approval?: boolean;
  timeout_ms?: number;            // Default timeout
  max_retries?: number;           // Max execution retries
  
  // Metadata
  created_at: string;             // ISO 8601
  updated_at: string;             // ISO 8601
  signature?: string;             // Optional code signature (for Business profile)
}
```

---

## 3. Contract Extraction Pipeline

### 3.1 Extraction Methods

#### Method 1: Direct Manifest (Preferred)

Tool providers include a `tool-contract.json` manifest:

```json
{
  "_meta": {
    "extraction_method": "direct_manifest",
    "signature_scheme": "ed25519",
    "signature": "sig_..."
  },
  "tool_contract": {
    "tool_name": "git_commit_analyzer",
    "version": "1.0.0",
    "provider": "acme-tools/vcs",
    "description": "Analyze and categorize git commits",
    "category": "staged",
    "input_schema": {
      "type": "object",
      "properties": {
        "repository_path": {
          "type": "string",
          "description": "Local git repository path"
        },
        "commit_count": {
          "type": "integer",
          "description": "Number of commits to analyze"
        }
      },
      "required": ["repository_path"]
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "commits": {
          "type": "array",
          "description": "Analyzed commits"
        }
      }
    },
    "mutating": false,
    "error_classes": ["repository_not_found", "invalid_commit_hash"],
    "risk_tier": "tier1",
    "timeout_ms": 10000
  }
}
```

**Extraction Logic**:

1. Find `tool-contract.json` in tool package root
2. Parse JSON, validate against ToolContract schema
3. Optionally verify signature (Business profile)
4. Return extracted contract

---

#### Method 2: Decorator Inference

Tool decorated with metadata that can be introspected:

```typescript
@Tool({
  name: "file_search",
  description: "Search files by pattern",
  tier: "tier1",
  keywords: ["filesystem", "search"]
})
export async function searchFiles(query: string, path: string): Promise<FileMatch[]> {
  // Implementation
}
```

**Extraction Logic**:

1. Introspect TypeScript decorators using reflection
2. Extract name, description, tier from decorator
3. Infer input schema from function signature
4. Infer output schema from return type
5. Combine into ToolContract

---

#### Method 3: Dynamic Inspection

Tool provided as black box (no manifest), inspect at runtime:

```typescript
const tool = require("./mysterious-tool");

// Inspect tool properties
const contract = {
  tool_name: tool.name || "unknown_tool",
  description: tool.description || "No description",
  input_schema: inferSchemaFromUsage(tool),
  output_schema: { type: "any" },
  mutating: tool.isMutating || false,
  risk_tier: "tier2"  // Conservative default
};
```

**Extraction Logic**:

1. Call introspection functions on tool object
2. Infer schema from type hints (if available)
3. Fallback to conservative defaults
4. Mark with `inference_confidence: "low"` flag
5. Flag for manual review (may require approval even for Tier 1)

---

### 3.2 Extraction Algorithm

```
extract_contract(tool_source):
  
  1. DETECT MANIFEST
     Try to locate tool-contract.json
     if found:
       contract = parse_json(manifest)
       method = "direct_manifest"
       goto VALIDATE
     
  2. DETECT DECORATOR
     if TypeScript && @Tool decorator present:
       contract = introspect_decorator(tool)
       method = "decorator_inference"
       goto VALIDATE
     
  3. DYNAMIC INSPECTION
     contract = inspect_tool_object(tool)
     method = "dynamic_inspection"
     confidence_level = "low"
     goto VALIDATE
  
  4. VALIDATE
     if not valid_against_schema(contract):
       return ERROR("Invalid contract schema")
     
  5. COMPUTE RISK TIER
     if contract.tier explicitly set:
       tier = contract.tier
     else:
       tier = infer_risk_tier(contract)
     
  6. DETECT DANGEROUS KEYWORDS
     keywords = extract_dangerous_keywords(tool_name, tool_path, contract)
     if keywords found:
       tier = escalate_tier(tier)
     
  7. RETURN
     return {
       contract: contract,
       tier: tier,
       extraction_method: method,
       confidence: "high" or "low",
       keywords_found: keywords
     }
```

---

## 4. Risk Tier Auto-Assignment

### 4.1 Risk Scoring Algorithm

```
function infer_risk_tier(contract):
  
  score = 0
  
  // Behavioral risk
  if contract.mutating:
    score += 50
  
  if "destructive" in contract.error_classes:
    score += 40
  
  // I/O risk
  if has_filesystem_operations(contract):
    score += 20
  
  if has_network_operations(contract):
    score += 25
  
  // Recovery risk
  if contract.rollback_strategy == "none":
    score += 30
  
  if contract.timeout_ms > 60000:
    score += 10
  
  // Keyword risk
  if has_dangerous_keywords(contract.tool_name):
    score += 35
  
  // Determine tier
  if score >= 80:
    return "tier3"  // Requires approval
  else if score >= 40:
    return "tier2"  // Conditional approval
  else:
    return "tier1"  // Autonomous
```

### 4.2 Dangerous Keywords

```typescript
const TIER_ESCALATION_KEYWORDS = {
  "tier3": [
    "destroy", "delete", "remove", "annihilate",
    "revoke", "kill", "terminate", "cleanse",
    "format", "wipe", "erase", "purge"
  ],
  "tier2": [
    "modify", "edit", "change", "patch",
    "deploy", "provision", "install", "upgrade"
  ]
};

function has_dangerous_keywords(tool_name: string): boolean {
  const lower_name = tool_name.toLowerCase();
  for (const keyword of TIER_ESCALATION_KEYWORDS["tier3"]) {
    if (lower_name.includes(keyword)) return true;
  }
  return false;
}
```

---

## 5. Contract Baseline & Validation

### 5.1 Baseline Contract Registry

PRISM maintains a **known-good baseline** for common tools:

```
prism-output/baseline-contracts/
  anthropic-tools/
    memory_query_v1.0.0.json
    semantic_search_v1.0.0.json
  system-tools/
    shell_exec_v1.0.0.json
    filesystem_ops_v1.0.0.json
```

Each baseline entry:

```json
{
  "_meta": {
    "tool_id": "system.shell_exec",
    "last_validated": "2026-03-17T10:00:00Z",
    "validation_method": "production_audit",
    "approver": "security-team"
  },
  "contract": { ... }
}
```

---

### 5.2 Contract Diff & Validation

When a new contract is extracted:

```
compare_contracts(extracted, baseline):
  
  diff = {}
  
  // Check identity
  if extracted.version != baseline.version:
    diff.version_mismatch = true
  
  // Check schema changes
  if extracted.input_schema != baseline.input_schema:
    diff.input_schema_changed = true
    diff.input_schema_diff = compute_diff(baseline, extracted)
  
  if extracted.output_schema != baseline.output_schema:
    diff.output_schema_changed = true
    diff.output_schema_diff = compute_diff(baseline, extracted)
  
  // Check behavioral changes
  if extracted.mutating != baseline.mutating:
    diff.mutating_changed = true
  
  // Check risk tier
  if extracted.risk_tier != baseline.risk_tier:
    diff.tier_escalation = true
    diff.tier_changed_from = baseline.risk_tier
    diff.tier_changed_to = extracted.risk_tier
  
  // Validation decision
  if no diffs:
    return VALID
  
  if only_patch_version_changed:
    return VALID  // Patch updates okay
  
  if tier_escalation:
    return REQUIRES_REVIEW  // Manual approval
  
  if input/output_schema_changed:
    return REQUIRES_COMPARISON  // Compare vs baseline
  
  else:
    return VALID  // Minor metadata changes okay
```

---

## 6. Dynamic Tool Staging Pipeline

### 6.1 Staging Endpoint

```
POST /api/tools/stage
Content-Type: application/json

{
  "tool_source": "upload" | "url" | "package",
  "tool_data": {
    // upload: base64-encoded .tar.gz
    // url: git repo URL or package URL
    // package: npm package name or OCI image
  },
  "profile": "individual" | "business",
  "metadata": {
    "reason": "Testing new analysis tool",
    "team": "data-science"
  }
}
```

### 6.2 Staging Workflow

```
1. RECEIVE TOOL
   Download/extract tool package
   Store in prism-output/staged-tools/<tool_id>/

2. EXTRACT CONTRACT
   contract = extract_contract(tool_source)
   
3. VALIDATE SCHEMA
   if not valid:
     return ERROR("Invalid contract")
   
4. COMPARE BASELINE
   comparison = compare_contracts(contract, baseline)
   if requires_review:
     goto APPROVAL_GATE
   
5. AUTO-ASSIGN TIER
   tier = infer_risk_tier(contract)
   keywords = detect_keywords(contract)
   
6. APPROVAL GATE
   if tier == "tier3" or requires_review:
     approval = request_approval({
       tool_name: contract.tool_name,
       tier: tier,
       contract_diff: comparison,
       profile: profile,
       reason: metadata.reason
     })
     
     if approval denied:
       return ERROR("Tool staging rejected")
     
     if approval timeout:
       return ERROR("Tool staging approval expired")
   
7. REGISTER TOOL
   Register tool in PRISM tool registry
   Add to active tool set for profile
   Log staging event with reason-code
   
8. RESPONSE
   return {
     tool_id: contract.tool_name,
     status: "staged",
     tier: tier,
     contract: contract,
     timestamp: now()
   }
```

---

## 7. Business Profile Trust Validation

For Business profile (§G2 in phase plan):

```
if profile == "business":
  
  1. VERIFY SIGNATURE
     if signature missing:
       return ERROR("Business profile requires signed tools")
     
     if signature invalid:
       return ERROR("Tool signature verification failed")
     
     signer = extract_signer_from_signature(tool)
  
  2. CHECK PUBLISHER WHITELIST
     if signer not in trusted_publishers:
       return ERROR("Tool publisher not in whitelist")
  
  3. CHECK REVOCATION
     if signer in revocation_list:
       return ERROR("Tool publisher revoked")
  
  4. LOG TRUST DECISION
     log_trust_validation({
       tool_id: contract.tool_name,
       signer: signer,
       status: "trusted",
       timestamp: now()
     })

else if profile == "individual":
  // Individual profile: sign verification optional
  // Auto-trust unless tool tier suggests caution
```

---

## 8. Integration with Policy Engine

### 8.1 Tier-Based Routing

```
POST /api/tools/stage → Policy Engine

{
  operation: "tool.stage",
  tool_name: "git_commit_analyzer",
  tier: "tier3",
  reason_code: "approval_required_high_risk_tool_staging",
  metadata: {
    contract_method: "direct_manifest",
    keywords_detected: ["analyze"],
    baseline_comparison: "matches_v1.0.0"
  }
}

Policy Decision:
  {
    decision: "approval_pending" | "approved" | "denied",
    approval_id: "appr-<uuid>" (if pending),
    expires_in_ms: 60000,
    reason: "High-risk tool requires security review"
  }
```

### 8.2 Reason-Code Taxonomy

```
autonomous_tool_staging_tier1
  → Low-risk tool, auto-approved

conditional_tool_staging_tier2
  → Medium-risk tool, requires context check

approval_required_tool_staging_tier3
  → High-risk tool, requires explicit approval

approval_required_tool_staging_contract_mismatch
  → Tool contract differs from baseline, manual review needed

tool_staging_rejected_unsafe_keywords
  → Tool name contains dangerous keywords

tool_staging_rejected_untrusted_publisher (Business)
  → Publisher not in whitelist

tool_staging_rejected_revoked_publisher (Business)
  → Publisher revocation list hit
```

---

## 9. Error Handling

### 9.1 Contract Extraction Failures

**Invalid Manifest**

```json
{
  "error": "Contract extraction failed",
  "reason": "Invalid JSON in tool-contract.json",
  "details": "Unexpected token at line 15",
  "reason_code": "system_error_contract_parse_failed"
}
```

**Schema Mismatch**

```json
{
  "error": "Contract schema validation failed",
  "reason": "Missing required field: input_schema",
  "missing_fields": ["input_schema"],
  "reason_code": "system_error_contract_schema_invalid"
}
```

**Inference Low Confidence**

```json
{
  "error": "Tool contract inference not confident",
  "reason": "Tool has no manifest and decorator, dynamic inference gave low confidence",
  "confidence": "0.3",
  "recommendation": "Provide tool-contract.json manifest",
  "reason_code": "system_error_contract_inference_low_confidence"
}
```

---

### 9.2 Staging Failures

**Tier 3 Rejected**

```json
{
  "error": "Tool staging rejected",
  "reason": "Tier 3 tool requires approval",
  "approval_id": "appr-<uuid>",
  "status": "approval_pending",
  "expires_in_ms": 60000,
  "reason_code": "approval_required_tool_staging_tier3"
}
```

**Publisher Untrusted (Business)**

```json
{
  "error": "Tool staging rejected",
  "reason": "Publisher not in whitelist",
  "publisher": "untrusted-vendor",
  "status": "rejected",
  "reason_code": "tool_staging_rejected_untrusted_publisher"
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

- [ ] Extract contract from valid manifest
- [ ] Reject invalid manifest (missing required fields)
- [ ] Infer contract from TypeScript decorator
- [ ] Dynamic inspection of black-box tool
- [ ] Risk tier calculation (Tier 1, 2, 3 examples)
- [ ] Dangerous keyword detection in tool names
- [ ] Contract diff computation (version, schema changes)
- [ ] Keyword escalation (tier3 keywords bump score)

### 10.2 Integration Tests

- [ ] Staging endpoint: receive tool, extract contract, auto-assign tier
- [ ] Tier 1 tool: auto-approved staging
- [ ] Tier 2 tool: conditional approval (test both approve + deny)
- [ ] Tier 3 tool: requires approval gate
- [ ] Contract mismatch: compare against baseline, trigger manual review
- [ ] Business profile: signature verification + publisher whitelist check
- [ ] Individual profile: signature optional, auto-trust
- [ ] Concurrent tool stagings: isolation verified

### 10.3 Contract Edge Cases

- [ ] Tool with no input (function takes no params)
- [ ] Tool with variadic input (arbitrary arguments)
- [ ] Tool with complex nested schema
- [ ] Tool with union output types
- [ ] Versioning: patch vs minor vs major version changes

### 10.4 Drill Scenarios

- [ ] **Staging Drill 1**: Stage legitimate tool, verify registered and usable
- [ ] **Staging Drill 2**: Attempt high-risk tool, approval required → approve → stage succeeds
- [ ] **Staging Drill 3**: Attempt high-risk tool → approve → revoke approval → verify removed
- [ ] **Staging Drill 4** (Business): High-risk tool from untrusted publisher → rejected

---

## 11. Success Criteria

### Completeness

- ✓ All 3 extraction methods implemented
- ✓ Contract diff algorithm working
- ✓ Risk tier auto-assignment functional
- ✓ Dynamic staging endpoint operational

### Quality

- ✓ 100% of unit tests pass
- ✓ 100% of integration tests pass
- ✓ All contract edge cases handled
- ✓ Baseline contracts up to date

### Safety

- ✓ No Tier 3 tools stage without approval
- ✓ No untrusted publisher tools register (Business profile)
- ✓ Contract diffs trigger manual review when needed
- ✓ Reason-codes emitted for all staging decisions
- ✓ Rejected tools logged with audit trail

---

## 12. Appendix: Implementation Checklist

- [ ] Create ToolContractExtractor class with 3 extraction methods
- [ ] Define ToolContract TypeScript interface
- [ ] Implement contract diff algorithm
- [ ] Implement risk tier auto-assignment
- [ ] Create baseline contract registry
- [ ] Implement `/api/tools/stage` endpoint
- [ ] Integrate with policy engine (tier routing)
- [ ] Implement Business profile trust validation
- [ ] Write unit test suite (12+ tests)
- [ ] Write integration test suite (8+ tests)
- [ ] Write edge case handling tests
- [ ] Execute Stage 1 drill scenarios (4+ drills)
- [ ] Create contract-extraction-report.md with test results
- [ ] Get sign-off from Engineering Lead + Policy Owner

---

**Next Step**: Schedule design review with Engineering Lead + Policy Lead. Target: 2026-03-20.

---

## 13. Computer-Use Business Security Alignment Gate Coupling (2026-03-25)

Tool staging is part of PRISM computer-use risk posture and is therefore coupled to Business gate controls.

Required alignment:

1. Staged tools that can drive browser/terminal/container workflows must preserve tiered governance routing.
2. High-risk staged tools must preserve approval/revoke semantics with reason-coded outcomes.
3. Business-profile trust/provenance checks must remain mandatory for enterprise release claims.
4. Release evidence must map staging behavior to `CU-BG-1` through `CU-BG-5` where applicable.

Canonical references:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- `REQUIREMENTS_TRACEABILITY_MATRIX.md`
- `PRODUCTION_RELEASE_RUNBOOK.md`

---

## Implementation Notes (2026-04-20)

### Artifacts

| Artifact | Location |
|----------|----------|
| Extractor implementation | `src/core/tools/tool-contract-extractor.ts` |
| Contract utilities | `src/core/tools/contracts.ts` |
| Test suite | `tests/tool-contract-extractor.test.ts` (8+ test cases) |
| Contract validation tests | `tests/tool-contracts.test.ts` (2+ test cases) |

### Implemented Capabilities

- Three-source extraction pipeline: manifest, decorator, dynamic (all sources defined, pipeline orchestrated)
- Baseline comparison: current vs. stored baseline with breaking/safe/deprecated change detection
- Risk tier auto-assignment via keyword scoring (HIGH_RISK_KEYWORDS + BREAKING_CHANGE_KEYWORDS)
- Approval routing for high-risk changes (routes to ApprovalQueue)
- SQLite persistence: 4 tables (`tool_contracts`, `contract_baseline`, `extraction_requests`, `contract_changes`)
- `ToolContract` and `ToolArgSchema` interfaces with semver versioning
- Runtime contract validation: `validateToolContract()` and `validateToolRequestAgainstContract()`

### Known Gaps (Deferred to Future Scope)

- ~~**Manifest parsing**: Extraction returns structured test data; real JSON/YAML manifest file parsing not implemented.~~ **Resolved (April 2026)**: `extractFromManifest()` now parses real `tool-contract.json` files, `tool-contract-snapshot.json` manifests, and per-tool subdirectory manifests from configurable paths. Falls back to simulated data only when no manifest paths are configured.
- ~~**Decorator reflection**: No TypeScript AST or decorator API introspection; uses simulated extraction.~~ **Resolved (April 2026)**: `extractFromDecorators()` now scans the `ToolRegistry` for tools with explicit `contract` properties, extracting real contract metadata. Falls back to simulated data only when no registry is wired.
- ~~**Dynamic inspection**: No runtime tool loading/introspection; uses hardcoded contract definitions.~~ **Resolved (April 2026)**: `extractFromDynamic()` now infers contracts from `GovernanceSchema` on registered tools that lack explicit contracts. Extracts action names, risk levels, and mutation flags from governance rules.
- ~~**Risk scoring**: Keyword-presence-based scoring only; no context weighting, NLP, or semantic analysis.~~ **Partially Resolved (April 2026)**: `assessRiskTier()` now scores across 6 dimensions: description keywords, parameter count, parameter types (side-effect indicators), parameter names (mutation indicators), tool name patterns, and governance schema analysis (mutating, minimumRisk, rollbackRequired). Full NLP/semantic analysis deferred.
- ~~**Approval handler**: Routes to ApprovalQueue but approval response handling not fully wired.~~ **Resolved (April 2026)**: `resolveApproval()` method completes the approval flow — accepts approve/reject decisions, calls `stageForDeployment()`, retrieves approved contracts from the database, and registers them into the `ToolRegistry` with stub executors. Emits governance activity events for both approval and rejection paths.
