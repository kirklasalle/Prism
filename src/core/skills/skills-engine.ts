import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import { SkillsDbAdapter } from "./db-adapter.js";
import { SkillDefinition, SkillSession, SkillStep, SkillSessionCreateOptions, SkillPermissionCheck, SkillAccountabilityChain, SkillExecutor } from "./types.js";
import { LlmProviderManager } from "../operator/llm-provider-manager.js";
import { ActivityBus } from "../activity/bus.js";

export class SkillsEngine {
  private readonly skillsDir: string;
  private readonly loadedSkills = new Map<string, SkillDefinition>();
  private readonly dbAdapter: SkillsDbAdapter;
  /** Optional CAC manager for permission gating */
  private characterAccountability: any = null;

  constructor(
    private readonly providerManager: LlmProviderManager,
    private readonly activityBus: ActivityBus,
    private readonly workspaceRoot: string,
    private readonly tabToolAdapter?: any,  // TabToolAdapter for tool execution
    dbAdapter?: SkillsDbAdapter
  ) {
    this.skillsDir = join(workspaceRoot, "skills");
    this.dbAdapter = dbAdapter ?? new SkillsDbAdapter();
    this.ensureSkillsDirectory();
    this.loadAllSkills();
  }

  /**
   * Set the CharacterAccountabilityManager for CAC-gated skill execution.
   * Called during bootstrap after CAC is initialized.
   */
  public setCharacterAccountability(cacManager: any): void {
    this.characterAccountability = cacManager;
  }

  /**
   * Check if a skill is permitted for the given CAC assignment.
   * Returns allowed=true if no CAC is configured (dev mode).
   */
  public async checkPermission(
    skillId: string,
    accountabilityChain: SkillAccountabilityChain | null
  ): Promise<SkillPermissionCheck> {
    // No CAC configured — allow but warn (dev mode)
    if (!this.characterAccountability || !accountabilityChain) {
      return { allowed: true, tier: "tier1_autonomous" };
    }

    // Guardian custodian identity — always allowed for custodian skills
    if (accountabilityChain.characterId === "guardian" && skillId.startsWith("skill.custodian.")) {
      return { allowed: true, tier: "tier1_autonomous" };
    }

    // Guardian cannot access tab skills
    if (accountabilityChain.characterId === "guardian" && skillId.startsWith("tab.")) {
      return {
        allowed: false,
        tier: "tier3_approval",
        reason: "Guardian (Custodian) cannot execute tab skills — role separation enforced",
        remediation: "Tab skills are reserved for the CAC Character agent",
      };
    }

    // CAC Character cannot access custodian skills
    if (accountabilityChain.characterId !== "guardian" && skillId.startsWith("skill.custodian.")) {
      return {
        allowed: false,
        tier: "tier3_approval",
        reason: "CAC Character cannot execute custodian skills — role separation enforced",
        remediation: "Custodian skills are reserved for the Guardian",
      };
    }

    // Check CAC permission scopes if the manager supports it
    if (this.characterAccountability.assertSkillPermission) {
      return this.characterAccountability.assertSkillPermission(
        accountabilityChain.assignmentId,
        skillId
      );
    }

    // Default: allow
    return { allowed: true, tier: "tier1_autonomous" };
  }

  private ensureSkillsDirectory(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  /**
   * Get all registered skill profiles
   */
  public getLoadedSkills(): SkillDefinition[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Semantically route a user query to find the best matching skill
   */
  public async routeQuery(query: string): Promise<SkillDefinition | null> {
    const queryLower = query.toLowerCase();

    // Scan loaded skills for direct semantic ID, name, or tag matches
    for (const skill of this.loadedSkills.values()) {
      if (
        queryLower.includes(skill.id.toLowerCase()) || skill.id.toLowerCase().includes(queryLower) ||
        queryLower.includes(skill.name.toLowerCase()) || skill.name.toLowerCase().includes(queryLower) ||
        skill.tags.some(tag => queryLower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(queryLower))
      ) {
        return skill;
      }
    }
    return null;
  }

  /**
   * Initialize a new durable skill execution session.
   * CAC permission is checked before creation.
   */
  public async createSession(
    skillIdOrOpts: string | SkillSessionCreateOptions,
    parentChatSession?: string | null
  ): Promise<SkillSession> {
    // Support both old signature (skillId, parentChatSession) and new (opts)
    const opts: SkillSessionCreateOptions = typeof skillIdOrOpts === "string"
      ? { skillId: skillIdOrOpts, parentChatSession: parentChatSession ?? undefined }
      : skillIdOrOpts;

    const skill = this.loadedSkills.get(opts.skillId);
    if (!skill) {
      throw new Error(`Skill ${opts.skillId} is not registered in the system.`);
    }

    if (skill.workflow.steps.length === 0) {
      throw new Error(`Skill ${opts.skillId} has an empty workflow step list.`);
    }

    // CAC permission gate
    const permission = await this.checkPermission(opts.skillId, opts.accountabilityChain ?? null);
    if (!permission.allowed) {
      throw new Error(
        `Skill '${opts.skillId}' denied: ${permission.reason}. ${permission.remediation ?? ""}`
      );
    }

    const sessionId = `skill_sess_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const executor: SkillExecutor = opts.executor ?? "agent_loop";

    const session: SkillSession = {
      sessionId,
      skillId: opts.skillId,
      currentStep: skill.workflow.steps[0].id,
      statePayload: {},
      parentChatSession: opts.parentChatSession ?? null,
      assignmentId: opts.accountabilityChain?.assignmentId ?? null,
      accountabilityChain: opts.accountabilityChain ?? null,
      guardianTriggered: executor === "guardian",
      executor,
      stepHistory: [],
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.dbAdapter.saveSession(session);

    this.activityBus.emit({
      sessionId,
      layer: "causal",
      operation: "skill.session.created",
      status: "succeeded",
      details: {
        skillId: opts.skillId,
        startingStep: session.currentStep,
        executor,
        assignmentId: session.assignmentId,
        guardianTriggered: session.guardianTriggered,
      }
    });

    return session;
  }

  /**
   * Execute the current step of a skill session
   */
  public async executeStep(sessionId: string): Promise<SkillSession> {
    const session = this.dbAdapter.getSession(sessionId);
    if (!session) {
      throw new Error(`Skill session ${sessionId} not found.`);
    }

    if (session.status === "completed" || session.status === "failed") {
      return session;
    }

    const skill = this.loadedSkills.get(session.skillId);
    if (!skill) {
      session.status = "failed";
      this.dbAdapter.saveSession(session);
      throw new Error(`Skill ${session.skillId} is no longer registered.`);
    }

    const step = skill.workflow.steps.find(s => s.id === session.currentStep);
    if (!step) {
      session.status = "failed";
      this.dbAdapter.saveSession(session);
      throw new Error(`Step ${session.currentStep} not found in skill ${skill.id}.`);
    }

    // Telemetry: step started
    this.activityBus.emit({
      sessionId,
      layer: "causal",
      operation: `skill.step.${step.id}.start`,
      status: "started",
      details: { stepName: step.name }
    });

    const stepStart = Date.now();
    const inputHash = crypto.createHash("sha256").update(JSON.stringify({ stepId: step.id, state: session.statePayload })).digest("hex");

    try {
      // 1. SOTA Progressive Tool Disclosure (Tool Hot-Swapping)
      // Removed global setTemporaryToolFilter calls to avoid multi-execution race conditions.

      // 2. Interpolate Hemispheric Prompts with session variables
      const leftPrompt = this.interpolate(skill.triad_templates.left_hemisphere, session.statePayload);
      const rightPrompt = this.interpolate(skill.triad_templates.right_hemisphere, session.statePayload);
      const mainPrompt = this.interpolate(skill.triad_templates.main_hemisphere, { ...session.statePayload, action: step.action });

      let content = "";
      let toolCalls: any[] | undefined = undefined;

      // 3. Resolve SR Configuration if chatStore is configured
      const srConfig = null;  // TODO: Integrate with chatStore when available
      const isSREnabled = false;  // TODO: Enable when chatStore is integrated

      if (isSREnabled) {
        // Run parallel Spectrum Refraction
        const srInputMessage = `
[GOVERNED SKILL STEP EXECUTION]
Skill: ${skill.name}
Step: ${step.name}

--- LEFT HEMISPHERE (LOGIC/SECURITY) CLEARANCE ---
${leftPrompt}

--- RIGHT HEMISPHERE (CREATIVE/GENERATION) BOILERPLATE ---
${rightPrompt}

--- COORDINATION DIRECTIVE ---
${mainPrompt}
        `.trim();

        const srResult = await this.providerManager.generateSR(
          {
            message: srInputMessage,
            conversation: [],
            systemPrompt: "You are the PRISM Spectrum Refraction orchestrator running a governed skill workflow.",
            allowedTools: step.tools ?? []
          },
          {
            enabled: true,
            leftModel: { providerId: "unknown", model: "unknown" },
            rightModel: { providerId: "unknown", model: "unknown" },
            leftSlot: undefined,
            rightSlot: undefined,
            leftTimeoutMs: undefined,
            rightTimeoutMs: undefined,
            circuitBreakerEnabled: false,
            showHemispheres: false,
          }
        );

        if (false) {
          // SR disabled - no content to process
        }
      } else {
        // SR is Disabled: Fallback to unified prompt on the primary model
        const fusedSystemPrompt = `
You are the PRISM SOTA Skills execution coordinator. 
You are running skill: "${skill.name}" (${skill.id}), step: "${step.name}".

Please execute the following step-level hemispheric instructions:

=== SECURITY & VALIDATION (LOGIC HEMISPHERE) ===
${leftPrompt}

=== GENERATION & TEMPLATE (CREATIVE HEMISPHERE) ===
${rightPrompt}

=== MAIN COORDINATION & WORKFLOW DIRECTION ===
${mainPrompt}
        `.trim();

        const parentSession = null;  // TODO: Integrate with chatStore when available
        const selection = undefined;  // TODO: Integrate with chatStore when available

        const genResult = await this.providerManager.generate({
          message: `Execute step action: ${step.action}`,
          conversation: [],
          systemPrompt: fusedSystemPrompt,
          allowedTools: step.tools ?? []
        }, selection);

        if (genResult) {
          content = genResult.content;
          toolCalls = genResult.toolCalls;
        }
      }

      // 4. Parse execution outcome and variables
      const outputHash = crypto.createHash("sha256").update(content).digest("hex");

      // Look for JSON block in content to dynamically update state variables
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const extractedVars = JSON.parse(jsonMatch[0]);
          session.statePayload = { ...session.statePayload, ...extractedVars };
        } catch {
          // Fall back gracefully if block is not valid JSON
        }
      }

      // Record transitions in history
      const nextStep = step.transitions.success;
      session.stepHistory.push({
        stepId: step.id,
        transitionedTo: nextStep,
        timestamp: new Date().toISOString(),
        inputHash,
        outputHash
      });

      if (nextStep === "complete" || nextStep === "completed") {
        session.status = "completed";
      } else if (nextStep === "abort_task" || nextStep === "failed") {
        session.status = "failed";
      } else {
        session.currentStep = nextStep;
      }

      session.updatedAt = new Date().toISOString();
      this.dbAdapter.saveSession(session);

      this.activityBus.emit({
        sessionId,
        layer: "causal",
        operation: `skill.step.${step.id}.complete`,
        status: "succeeded",
        details: { nextStep, durationMs: Date.now() - stepStart }
      });

    } catch (err: any) {
      const nextStep = step.transitions.failed;
      session.stepHistory.push({
        stepId: step.id,
        transitionedTo: nextStep,
        timestamp: new Date().toISOString(),
        inputHash,
        outputHash: ""
      });

      if (nextStep === "complete" || nextStep === "completed") {
        session.status = "completed";
      } else {
        session.status = "failed";
      }

      session.updatedAt = new Date().toISOString();
      this.dbAdapter.saveSession(session);

      this.activityBus.emit({
        sessionId,
        layer: "causal",
        operation: `skill.step.${step.id}.failed`,
        status: "failed",
        details: { error: err.message, nextStep }
      });
    } finally {
      // SOTA: Done executing step.
    }

    return session;
  }

  /**
   * Load and parse all skill definitions in the skills/ workspace directory
   */
  public loadAllSkills(): void {
    if (!existsSync(this.skillsDir)) return;

    const files = readdirSync(this.skillsDir);
    for (const file of files) {
      if (file.endsWith(".json") || file.endsWith(".yaml") || file.endsWith(".yml")) {
        try {
          const content = readFileSync(join(this.skillsDir, file), "utf-8");
          let parsed: any = null;

          if (file.endsWith(".json")) {
            parsed = JSON.parse(content);
          } else {
            parsed = this.parseSimpleYaml(content);
          }

          if (parsed && parsed.id && parsed.workflow?.steps) {
            this.loadedSkills.set(parsed.id, parsed as SkillDefinition);
          }
        } catch (err: any) {
          console.error(`[SkillsEngine] Failed to parse skill file ${file}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Register a skill definition directly programmatically
   */
  public registerSkill(skill: SkillDefinition): void {
    this.loadedSkills.set(skill.id, skill);
  }

  /**
   * Retrieve a loaded skill definition
   */
  public getSkill(skillId: string): SkillDefinition | null {
    return this.loadedSkills.get(skillId) || null;
  }

  public getSession(sessionId: string): SkillSession | null {
    return this.dbAdapter.getSession(sessionId);
  }

  public close(): void {
    this.dbAdapter.close();
  }

  /**
   * High-reliability, dependency-free YAML frontmatter and structure parser
   */
  private parseSimpleYaml(content: string): any {
    // Dynamic import try for js-yaml, fallback to structured regex parsing
    try {
      // Try importing js-yaml synchronously via standard require if possible
      const jsYaml = require("js-yaml");
      return jsYaml.load(content);
    } catch {
      // Fallback: Custom lightweight parser for YAML profiles
      const result: any = {
        governance: { min_policy_tier: "tier1", required_approvals: [], covenant_rules: [] },
        triad_templates: { left_hemisphere: "", right_hemisphere: "", main_hemisphere: "" },
        workflow: { steps: [] }
      };

      const lines = content.split("\n");
      let currentSection: string | null = null;
      let currentStep: Partial<SkillStep> | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) continue;

        // Frontmatter boundaries
        if (trimmed === "---") continue;

        // Key value detection
        const match = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (match) {
          const key = match[1];
          const val = match[2].trim().replace(/^['"]|['"]$/g, "");

          if (key === "id") result.id = val;
          else if (key === "version") result.version = val;
          else if (key === "name") result.name = val;
          else if (key === "description") result.description = val;
          else if (key === "tags") {
            result.tags = val.replace(/[\[\]]/g, "").split(",").map(s => s.trim());
          }
          continue;
        }

        // Section header boundaries
        if (line.startsWith("governance:")) {
          currentSection = "governance";
          continue;
        }
        if (line.startsWith("triad_templates:")) {
          currentSection = "triad_templates";
          continue;
        }
        if (line.startsWith("workflow:")) {
          currentSection = "workflow";
          continue;
        }

        // Section parser logic
        if (currentSection === "governance") {
          const govMatch = line.match(/^\s+([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
          if (govMatch) {
            const gk = govMatch[1];
            const gv = govMatch[2].trim().replace(/[\[\]'"]/g, "");
            if (gk === "min_policy_tier") result.governance.min_policy_tier = gv;
            else if (gk === "required_approvals") result.governance.required_approvals = gv.split(",").map(s => s.trim()).filter(Boolean);
            else if (gk === "covenant_rules") result.governance.covenant_rules = gv.split(",").map(s => s.trim()).filter(Boolean);
          }
        } else if (currentSection === "triad_templates") {
          // Read hemispheric template until the next header block
          const tmplMatch = line.match(/^\s+([a-zA-Z0-9_]+)\s*:\s*\|(.*)$/);
          if (tmplMatch) {
            const tk = tmplMatch[1];
            let templateVal = "";
            let j = i + 1;
            while (j < lines.length && (lines[j].startsWith(" ") || lines[j].trim() === "")) {
              templateVal += lines[j].replace(/^\s{4}/, "") + "\n";
              j++;
            }
            i = j - 1;
            if (tk === "left_hemisphere") result.triad_templates.left_hemisphere = templateVal.trim();
            else if (tk === "right_hemisphere") result.triad_templates.right_hemisphere = templateVal.trim();
            else if (tk === "main_hemisphere") result.triad_templates.main_hemisphere = templateVal.trim();
          }
        } else if (currentSection === "workflow") {
          if (trimmed === "steps:") continue;

          if (line.startsWith("    - ") || line.startsWith("      - ")) {
            if (currentStep && currentStep.id) {
              result.workflow.steps.push(currentStep as SkillStep);
            }
            currentStep = {};
          }

          const stepMatch = line.replace(/^\s*-\s*/, "").match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
          if (stepMatch) {
            const sk = stepMatch[1];
            const sv = stepMatch[2].trim().replace(/^['"]|['"]$/g, "");

            if (currentStep) {
              if (sk === "id") currentStep.id = sv;
              else if (sk === "name") currentStep.name = sv;
              else if (sk === "action") currentStep.action = sv;
              else if (sk === "tools") {
                currentStep.tools = sv.replace(/[\[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean);
              } else if (sk === "transitions") {
                // Parse simple success/failed mapping
                let j = i + 1;
                const transitions: any = { success: "", failed: "" };
                while (j < lines.length && lines[j].startsWith("      ")) {
                  const transMatch = lines[j].trim().match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
                  if (transMatch) {
                    transitions[transMatch[1]] = transMatch[2].trim();
                  }
                  j++;
                }
                currentStep.transitions = transitions;
                i = j - 1;
              }
            }
          }
        }
      }

      if (currentStep && currentStep.id) {
        result.workflow.steps.push(currentStep as SkillStep);
      }

      return result;
    }
  }

  /**
   * Helper: Interpolate variables in string templates
   */
  private interpolate(tmpl: string, vars: Record<string, any>): string {
    return tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : "";
    });
  }
}
