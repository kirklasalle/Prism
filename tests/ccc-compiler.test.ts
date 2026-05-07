/**
 * Tests for the Constitutional Causal Compiler (CCC) prototype.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { BUSINESS_PROFILE, INDIVIDUAL_PROFILE } from "../src/core/policy/execution-profiles.js";
import { WorkflowExecutor } from "../src/core/runtime/workflow.js";
import type { WorkflowStep } from "../src/core/runtime/workflow.js";
import { CausalCompiler } from "../src/core/incubation/ccc/compiler.js";
import { RuntimePlanEnforcer } from "../src/core/incubation/ccc/enforcer.js";
import { loadConstitution, validateConstitution, ConstitutionValidationError } from "../src/core/incubation/ccc/constitution.js";

export async function testCccCompiler(): Promise<void> {
    const policyEngine = new PolicyEngine();
    const compiler = new CausalCompiler(policyEngine);
    const executor = new WorkflowExecutor();

    // 1. Constitution validation: bad input throws
    assert.throws(() => validateConstitution({}), ConstitutionValidationError);
    assert.throws(() => validateConstitution({ version: "x", id: "x", principles: [] }), ConstitutionValidationError);

    // 2. Load sample constitution
    const constitutionPath = resolve(process.cwd(), "examples", "constitutions", "business-default.json");
    const constitution = loadConstitution(constitutionPath);
    assert.equal(constitution.id, "business-default");
    assert.ok(constitution.principles.length >= 3);

    // 3. All-allow path: low-risk individual workflow compiles enforceable
    const safeSteps: WorkflowStep[] = [
        { id: "s1", operation: "read.config", args: {}, risk: "low", mutatesState: false },
    ];
    const safeDag = executor.createDAG("safe-read", safeSteps);
    const safePlan = compiler.compile(safeDag, {
        profile: INDIVIDUAL_PROFILE,
        constitution,
    });
    assert.equal(safePlan.enforceable, true, "low-risk plan should be enforceable");
    assert.equal(safePlan.unsatisfiableSteps.length, 0);
    assert.ok(safePlan.compilationHash.length === 64, "compilationHash must be 64-char sha256 hex");

    // 4. Policy projection: medium-risk mutation without rollbackPlan in business profile is denied
    const unsafeSteps: WorkflowStep[] = [
        { id: "s1", operation: "write.file", args: {}, risk: "medium", mutatesState: true },
    ];
    const unsafeDag = executor.createDAG("unsafe-write", unsafeSteps);
    const unsafePlan = compiler.compile(unsafeDag, {
        profile: BUSINESS_PROFILE,
        constitution,
    });
    assert.equal(unsafePlan.enforceable, false, "missing rollbackPlan must fail");
    assert.ok(unsafePlan.unsatisfiableSteps.length > 0, "principle no-mutation-without-rollback must fire");
    const violatedIds = unsafePlan.unsatisfiableSteps.map((v) => v.principleId);
    assert.ok(violatedIds.includes("no-mutation-without-rollback"));

    // 5. Hash stability: compiling the same DAG+constitution twice yields the same hash
    const replan = compiler.compile(safeDag, {
        profile: INDIVIDUAL_PROFILE,
        constitution,
    });
    assert.equal(replan.compilationHash, safePlan.compilationHash, "compilation hash must be deterministic");

    // 6. Enforcer blocks unsatisfiable steps and emits step_blocked
    const bus = new ActivityBus();
    const collected: string[] = [];
    bus.subscribe({ onEvent: (e) => collected.push(e.operation) });
    const enforcer = new RuntimePlanEnforcer(bus, "test-session");
    const blocked = enforcer.authorizeStep(unsafePlan, "s1");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.violatedPrincipleIds.includes("no-mutation-without-rollback"));
    assert.ok(collected.includes("incubation.ccc.step_blocked"), "must emit step_blocked");

    // 7. Enforcer authorizes safe steps
    const ok = enforcer.authorizeStep(safePlan, "s1");
    assert.equal(ok.allowed, true);
    assert.ok(collected.includes("incubation.ccc.step_authorized"));
}
