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

export interface SkillSession {
  sessionId: string;
  skillId: string;
  currentStep: string;
  statePayload: Record<string, any>;
  parentChatSession: string | null;
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
