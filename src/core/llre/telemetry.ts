export interface LLREMetricsSnapshot {
  rsi: number;      // Request Satisfaction Index
  csr: number;      // Context Saturation Ratio
  tca: number;      // Tool Call Accuracy
  teq: number;      // Token Efficacy Quotient
  costUsd: number;
}

export class LLRETelemetry {
  /**
   * Calculates the four core effectiveness metrics for a goal execution path.
   */
  static calculate(params: {
    objective: { successCriteria: string[] };
    steps: Array<{ tool: string; success: boolean; summary?: string }>;
    latencyMs: number;
    tokensConsumed: number;
    costUsd: number;
  }): LLREMetricsSnapshot {
    const totalSteps = params.steps.length;

    // 1. Tool Call Accuracy (TCA): Valid Invocations / Attempted Invocations
    const validCalls = params.steps.filter((s) => s.success).length;
    const tca = totalSteps > 0 ? validCalls / totalSteps : 1.0;

    // 2. Request Satisfaction Index (RSI): Passed Success Criteria / Total Success Criteria
    // In Prism's native runtime, we map this to whether steps completed successfully
    const rsi = totalSteps > 0 ? validCalls / totalSteps : 1.0;

    // 3. Context Saturation Ratio (CSR): Ratio of direct instructions vs absolute context
    // This is proportional to token efficiency in prompt attention mechanisms
    const csr = params.tokensConsumed > 0 ? Math.min(1.0, 500 / params.tokensConsumed) : 1.0;

    // 4. Token Efficacy Quotient (TEQ): (RSI * TCA) / (Cost * Latency(s))
    // The master metric linking speed, quality, and economic efficiency.
    const latencySec = params.latencyMs / 1000;
    const divisor = params.costUsd * latencySec;
    const teq = divisor > 0 ? (rsi * tca) / divisor : 0.0;

    return { rsi, csr, tca, teq, costUsd: params.costUsd };
  }
}
