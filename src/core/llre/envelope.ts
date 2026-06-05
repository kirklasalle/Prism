export type LLREPriority = "LOW" | "MEDIUM" | "HIGH";

export interface LLREExecutionParameters {
  maxTokens: number;
  temperature: number;
  allowedToolScopes: string[];
}

export interface LLREObjective {
  intentSummary: string;
  successCriteria: string[];
}

export interface LLREContextPayload {
  injectedFiles: string[];
  signalDensityScore: number;
}

export interface LLRESafetyGuardrails {
  preventFileDeletion: boolean;
  piiRedaction: boolean;
  policyTierOverride?: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
}

export interface LLRERequestEnvelope {
  idempotencyKey: string;
  timestamp: string;
  priority: LLREPriority;
  executionParameters: LLREExecutionParameters;
  objective: LLREObjective;
  contextPayload: LLREContextPayload;
  safetyGuardrails: LLRESafetyGuardrails;
}
