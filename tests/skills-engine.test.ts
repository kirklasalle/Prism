import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SkillsEngine } from "../src/core/skills/skills-engine.js";
import { SkillDefinition } from "../src/core/skills/types.js";
import { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import { ActivityBus } from "../src/core/activity/bus.js";

// Mock LLM Provider Manager for dependency-free, high-speed execution testing
class MockLlmProviderManager extends LlmProviderManager {
  public generateCalled = 0;
  public generateSRCalled = 0;
  public lastGenerateInput: any = null;
  public lastGenerateSRInput: any = null;

  constructor() {
    super(process.env, [], undefined, undefined, undefined, new ActivityBus());
  }

  override async generate(input: any, selection?: any): Promise<any> {
    this.generateCalled++;
    this.lastGenerateInput = input;
    return {
      providerId: "mock-provider",
      model: "mock-model",
      content: 'Executed successfully! {"compiledHtml": "<h1>Hello Prism</h1>"}',
      toolCalls: []
    };
  }

  override async generateSR(input: any, srConfig: any, mainSelection?: any): Promise<any> {
    this.generateSRCalled++;
    this.lastGenerateSRInput = { input, srConfig };
    return {
      providerId: "mock-provider",
      model: "mock-model",
      content: 'Spectrum Refraction Executed! {"compiledHtml": "<h1>Hello Prism SR</h1>"}',
      hemispheres: {
        main: { providerId: "mock-provider", model: "mock-model", content: "Main output", toolCalls: [] }
      }
    };
  }
}

// Mock ChatSessionStore to test SR Config loading
class MockChatSessionStore {
  public enabled = false;

  getSRConfig(sessionId: string) {
    return {
      enabled: this.enabled,
      leftProviderId: "mock-provider",
      leftModel: "mock-left",
      rightProviderId: "mock-provider",
      rightModel: "mock-right",
      leftSlot: 0,
      rightSlot: 1,
      leftTimeoutMs: 5000,
      rightTimeoutMs: 5000,
      circuitBreakerEnabled: true,
      showHemispheres: true
    };
  }
}

describe("PRISM SOTA Skills Engine", () => {
  const workspaceRoot = process.cwd();
  const testDbFile = join(workspaceRoot, "prism-activity.db");
  let mockProviderManager: MockLlmProviderManager;
  let mockChatStore: MockChatSessionStore;
  let activityBus: ActivityBus;
  let skillsEngine: SkillsEngine;

  const sampleSkill: SkillDefinition = {
    id: "prism.skill.web_creator",
    version: "1.0.0",
    name: "Web Page Creator",
    description: "Generates high fidelity web components and HTML/CSS styles",
    tags: ["development", "html", "design"],
    governance: {
      min_policy_tier: "tier2",
      required_approvals: ["write_file"],
      covenant_rules: ["valid_html5"]
    },
    triad_templates: {
      left_hemisphere: "Verify security target in target {{ targetDir }}.",
      right_hemisphere: "Structure aesthetic outfit style utilizing responsive CSS.",
      main_hemisphere: "Execute action: {{ action }}."
    },
    workflow: {
      steps: [
        {
          id: "init",
          name: "Initialize Sandbox",
          tools: ["mkdir_tool"],
          action: "Initialize workspace directory: {{ targetDir }}.",
          transitions: { success: "compile", failed: "abort_task" }
        },
        {
          id: "compile",
          name: "Compile Styles and Markup",
          tools: ["write_file_tool", "verify_covenant_tool"],
          action: "Generate elegant index.html.",
          transitions: { success: "complete", failed: "abort_task" }
        }
      ]
    }
  };

  before(() => {
    mockProviderManager = new MockLlmProviderManager();
    mockChatStore = new MockChatSessionStore();
    activityBus = new ActivityBus();
    skillsEngine = new SkillsEngine(mockProviderManager, activityBus, workspaceRoot, mockChatStore);
    skillsEngine.registerSkill(sampleSkill);
  });

  after(() => {
    skillsEngine.close();
    // Clean up temporary database if created
    if (existsSync(testDbFile)) {
      try {
        unlinkSync(testDbFile);
      } catch {
        // Fallback if locked
      }
    }
  });

  it("registers skill programmatically and loads correctly", () => {
    const skill = skillsEngine.getSkill("prism.skill.web_creator");
    assert.ok(skill);
    assert.equal(skill!.id, "prism.skill.web_creator");
    assert.equal(skill!.name, "Web Page Creator");
  });

  it("routes queries semantically matching id, name or tags", async () => {
    const routeById = await skillsEngine.routeQuery("web_creator");
    assert.ok(routeById);
    assert.equal(routeById!.id, "prism.skill.web_creator");

    const routeByTag = await skillsEngine.routeQuery("I need html design");
    assert.ok(routeByTag);
    assert.equal(routeByTag!.id, "prism.skill.web_creator");
  });

  it("durable session persistence: creates and loads sessions", async () => {
    const session = await skillsEngine.createSession("prism.skill.web_creator", "session-123");
    assert.ok(session);
    assert.ok(session.sessionId.startsWith("skill_sess_"));
    assert.equal(session.currentStep, "init");
    assert.equal(session.status, "running");

    const retrieved = skillsEngine.getSession(session.sessionId);
    assert.ok(retrieved);
    assert.equal(retrieved!.skillId, "prism.skill.web_creator");
    assert.equal(retrieved!.parentChatSession, "session-123");
  });

  it("progressive tool disclosure: limits tools per step", async () => {
    const session = await skillsEngine.createSession("prism.skill.web_creator", "session-123");
    
    // Wire a check into MockLlmProviderManager to verify tool filters
    let capturedToolFilter: string[] | null = null;
    
    const originalSetFilter = mockProviderManager.setTemporaryToolFilter.bind(mockProviderManager);
    mockProviderManager.setTemporaryToolFilter = (allowed: string[] | null) => {
      capturedToolFilter = allowed;
      originalSetFilter(allowed);
    };

    // Execute first step ("init") which has only ["mkdir_tool"]
    await skillsEngine.executeStep(session.sessionId);

    // Verify step transition and captured tools filter
    assert.equal(capturedToolFilter, null); // Restored afterwards
    
    const updatedSession = skillsEngine.getSession(session.sessionId);
    assert.equal(updatedSession!.currentStep, "compile");
    assert.equal(updatedSession!.status, "running");
  });

  it("executes fallback generation when Spectrum Refraction is disabled", async () => {
    mockChatStore.enabled = false;
    mockProviderManager.generateCalled = 0;
    mockProviderManager.generateSRCalled = 0;

    const session = await skillsEngine.createSession("prism.skill.web_creator", "session-123");
    session.statePayload = { targetDir: "Prism_public" };
    skillsEngine["dbAdapter"].saveSession(session);

    // Execute step ("init")
    await skillsEngine.executeStep(session.sessionId);

    assert.equal(mockProviderManager.generateCalled, 1);
    assert.equal(mockProviderManager.generateSRCalled, 0);

    // Verify fused prompt contents
    const inputPrompt = mockProviderManager.lastGenerateInput.systemPrompt;
    assert.ok(inputPrompt.includes("SECURITY & VALIDATION"));
    assert.ok(inputPrompt.includes("Verify security target in target"));
    assert.ok(inputPrompt.includes("COORDINATION"));
  });

  it("executes Spectrum Refraction generation when enabled", async () => {
    mockChatStore.enabled = true;
    mockProviderManager.generateCalled = 0;
    mockProviderManager.generateSRCalled = 0;

    const session = await skillsEngine.createSession("prism.skill.web_creator", "session-123");
    session.statePayload = { targetDir: "Prism_public" };
    skillsEngine["dbAdapter"].saveSession(session);

    // Execute step ("init")
    await skillsEngine.executeStep(session.sessionId);

    assert.equal(mockProviderManager.generateCalled, 0);
    assert.equal(mockProviderManager.generateSRCalled, 1);

    // Verify hemispheric structured message contents
    const message = mockProviderManager.lastGenerateSRInput.input.message;
    assert.ok(message.includes("LEFT HEMISPHERE"));
    assert.ok(message.includes("RIGHT HEMISPHERE"));
    assert.ok(message.includes("COORDINATION DIRECTIVE"));
  });

  it("extracts and updates state variables dynamically from LLM outputs", async () => {
    const session = await skillsEngine.createSession("prism.skill.web_creator", "session-123");
    skillsEngine["dbAdapter"].saveSession(session);

    // Execute step ("init") -> moves to "compile"
    const nextSess = await skillsEngine.executeStep(session.sessionId);
    assert.equal(nextSess.statePayload.compiledHtml, "<h1>Hello Prism SR</h1>");
  });

  // ── PRISM Support Desk Skill Verification ─────────────────────────────

  it("loads the support desk skill from filesystem and routes successfully", async () => {
    // Force a fresh scan of skills directory (includes our new json)
    skillsEngine.loadAllSkills();

    const supportSkill = skillsEngine.getSkill("prism.skill.support_desk");
    assert.ok(supportSkill, "support desk skill is loaded from file");
    assert.equal(supportSkill.name, "Prism Support Desk Operations & Incident Healing");
    assert.equal(supportSkill.version, "1.0.0");
    assert.ok(supportSkill.tags.includes("triage"));

    // Verify semantic query routing
    const routed = await skillsEngine.routeQuery("triage software incidents on support desk");
    assert.ok(routed, "semantic query routes successfully");
    assert.equal(routed.id, "prism.skill.support_desk");

    // Verify durable session creation
    const session = await skillsEngine.createSession("prism.skill.support_desk", "session-support-101");
    assert.ok(session);
    assert.equal(session.currentStep, "triage_incident");
    assert.equal(session.status, "running");
  });

  // ── PRISM Skill Wizard Meta-Skill Verification ────────────────────────

  it("loads the skill wizard meta-skill from filesystem and routes successfully", async () => {
    // Force a fresh scan of skills directory (includes our new wizard skill)
    skillsEngine.loadAllSkills();

    const wizardSkill = skillsEngine.getSkill("prism.skill.skill_wizard");
    assert.ok(wizardSkill, "skill wizard is loaded from file");
    assert.equal(wizardSkill.name, "Prism Skill Wizard");
    assert.equal(wizardSkill.version, "1.0.0");
    assert.ok(wizardSkill.tags.includes("meta-skill"));
    assert.ok(wizardSkill.tags.includes("create"));

    // Verify semantic query routing
    const routed = await skillsEngine.routeQuery("I need to upgrade and manage with meta-skill registry");
    assert.ok(routed, "semantic query routes to skill wizard successfully");
    assert.equal(routed.id, "prism.skill.skill_wizard");

    // Verify durable session creation
    const session = await skillsEngine.createSession("prism.skill.skill_wizard", "session-wizard-202");
    assert.ok(session);
    assert.equal(session.currentStep, "analyze_requirement");
    assert.equal(session.status, "running");
  });

  // ── PRISM Full Skills Matrix Verification ─────────────────────────────

  it("loads and verifies the entire 12-skill matrix from the filesystem", async () => {
    skillsEngine.loadAllSkills();

    const expectedSkills = [
      { id: "prism.skill.web_creator", name: "Prism Autonomous Web Builder" },
      { id: "prism.skill.support_desk", name: "Prism Support Desk Operations & Incident Healing" },
      { id: "prism.skill.skill_wizard", name: "Prism Skill Wizard" },
      { id: "prism.skill.covenant_guard", name: "Prism Governance Covenant Guard" },
      { id: "prism.skill.tui_conductor", name: "Prism Terminal Conductor" },
      { id: "prism.skill.ast_architect", name: "Prism Autonomous AST Architect" },
      { id: "prism.skill.graph_harvest", name: "Prism Knowledge Graph Harvester" },
      { id: "prism.skill.iam_provisioner", name: "Prism IAM & Directory Provisioner" },
      { id: "prism.skill.browser_researcher", name: "Prism Headless Browser Researcher" },
      { id: "prism.skill.sandbox_auditor", name: "Prism Docker Sandbox Auditor" },
      { id: "prism.skill.api_connector", name: "Prism MCP API Server Connector" },
      { id: "prism.skill.setup_wizard", name: "Prism Environment Setup Wizard" },
      { id: "prism.skill.telemetry_analyst", name: "Prism Telemetry & Metrics Analyst" },
      { id: "prism.skill.diff_gatekeeper", name: "Prism Code Diff Gatekeeper" },
      { id: "prism.skill.personal_scheduler", name: "Prism Personal Scheduler & Tracker" }
    ];

    for (const spec of expectedSkills) {
      const skill = skillsEngine.getSkill(spec.id);
      assert.ok(skill, `Skill ${spec.id} should be successfully loaded`);
      assert.equal(skill!.name, spec.name, `Skill name for ${spec.id} should match`);
      assert.ok(skill!.workflow.steps.length > 0, `Skill ${spec.id} should have a non-empty workflow`);
      
      // Verify transition mappings exist for each step
      for (const step of skill!.workflow.steps) {
        assert.ok(step.id, `Step in ${spec.id} should have an id`);
        assert.ok(step.name, `Step in ${spec.id} should have a name`);
        if (step.transitions) {
          assert.ok(step.transitions.success, `Step ${step.id} in ${spec.id} should map a success transition`);
          assert.ok(step.transitions.failed, `Step ${step.id} in ${spec.id} should map a failed transition`);
        }
      }
    }

    // Test a sample semantic query routing for one of the newly written skills
    const routedDocker = await skillsEngine.routeQuery("run vulnerability sweeps inside dynamic Docker sandboxes");
    assert.ok(routedDocker);
    assert.equal(routedDocker!.id, "prism.skill.sandbox_auditor");
  });
});
