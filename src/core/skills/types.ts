export interface PermissionScope {
  scope: string;
  expiresAt: string | null;
}

export interface SkillStep {
  id: string;
  name: string;
  tools: string[];
  action: string;
  transitions: {
    success: string;
    failed: string;
  };
}

export interface SkillDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
  governance: {
    min_policy_tier: string;
    required_approvals: string[];
    covenant_rules: string[];
  };
  /** Who executes this skill: guardian, agent_loop, or human_chat */
  executor?: SkillExecutor;
  /** Guardian-only: execution interval in ms */
  intervalMs?: number;
  triad_templates: {
    left_hemisphere: string;
    right_hemisphere: string;
    main_hemisphere: string;
  };
  workflow: {
    steps: SkillStep[];
  };
}

export type SkillSessionStatus = "running" | "paused_approval" | "completed" | "failed";

/** Who initiated the skill session */
export type SkillExecutor = "guardian" | "agent_loop" | "human_chat";

/** Full accountability chain for a skill session */
export interface SkillAccountabilityChain {
  characterId: string;
  operatorId: string;
  prismUserId: string;
  operatorEmail: string;
  assignmentId: string;
}

/** Options for creating a new skill session */
export interface SkillSessionCreateOptions {
  skillId: string;
  parentChatSession?: string;
  /** Who is executing this skill — defaults to agent_loop */
  executor?: SkillExecutor;
  /** CAC accountability chain — null = no CAC (dev/warning) */
  accountabilityChain?: SkillAccountabilityChain;
}

/** Result of a CAC permission check for a skill */
export interface SkillPermissionCheck {
  allowed: boolean;
  tier: string;
  reason?: string;
  remediation?: string;
}

export interface SkillSession {
  sessionId: string;
  skillId: string;
  currentStep: string;
  statePayload: Record<string, any>;
  parentChatSession: string | null;
  /** CAC assignment that authorized this session */
  assignmentId: string | null;
  /** Full accountability chain for traceability */
  accountabilityChain: SkillAccountabilityChain | null;
  /** True if the Guardian initiated this session */
  guardianTriggered: boolean;
  /** Who executed this session */
  executor: SkillExecutor;
  stepHistory: Array<{
    stepId: string;
    transitionedTo: string;
    timestamp: string;
    inputHash: string;
    outputHash: string;
  }>;
  status: SkillSessionStatus;
  createdAt: string;
  updatedAt: string;
}
