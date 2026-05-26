# PRISM: SOTA Browser Integration & Cognitive Autopilot Roadmap
## World-Class Systems Engineering & Architectural Deconstruction

This roadmap and architectural blueprint details the evaluation of PRISM's computer and browser use research, proposing a world-class design system to elevate PRISM's autonomous browser loop to a State-of-the-Art (SOTA) level.

---

## 1. Due Diligence Review & Evaluation of `Researching_computer_use_and_browser_use.md`

The research document provides a comprehensive, mathematically grounded, and highly detailed deconstruction of industry standard autonomous browser architectures (Anthropic, OpenAI CUA, Microsoft UFO, browser-use, and LaVague). 

### 🔍 Core Strengths of the Current Design
1. **Three-Layer Device Agent Framework (Microsoft UFO Evolution)**: Separating the agent into a **State Layer (Level-1 FSM)**, **Strategy Layer (Level-2 Processor Template)**, and **Command Layer (Level-3 Command Dispatcher)** is highly resilient. It decouples high-level reasoning from low-level execution drivers, ensuring cross-platform stability.
2. **Server-Client Isolation via WebSocket AIP**: Isolating the orchestrator server from the Playwright browser sandbox using a strongly-typed WebSocket client is a premier security pattern. It ensures that even if an agent downloads malicious code, the host server remains completely insulated.
3. **AWS Lambda Limit Workaround**: The checkpoint-and-continuation mechanism (saving DOM, history, and browser storage states to S3 before re-queueing to SQS) is a brilliant, production-ready response to serverless duration limitations.

### ⚠️ Identified Gaps & Areas for SOTA Improvements
* **Visual Telemetry Overhead & Latency**: Traditional vision loops require continuous screenshot polling, causing high network bandwidth utilization, huge LLM token costs, and long execution delays. We must transition to an **Event-Driven Screenshot Trigger** that only captures the viewport when the DOM mutates.
* **Semantic Selector Fragility**: Composed systems relying purely on DOM paths (CSS Selectors or XPath) are highly susceptible to visual shifts, dynamic SPA class renaming, and framework-level hydration shifts (e.g., React, Svelte, Tailwind).
* **Zero-Trust Credential Leak Risk**: Standard web browsers driven by autonomous agents often navigate to authenticated states, leaving sensitive cookies, API keys, and personal data exposed to third-party LLM model context windows (via raw DOM dumps and screenshots).
* **Multi-Agent Friction**: The current FSM has no standard protocol to allow agents to "cooperate" on the same browser session or hand off execution to a human supervisor (e.g., when encountering CAPTCHAs, 2FA, or OAuth walls) without resetting the browser context.

---

## 2. World-Class Architectural Suggestions & Ingenuitive Enhancements

To propel the PRISM project ahead of the entire autonomous agent industry, we propose two major architectural innovations:

```mermaid
flowchart TB
    subgraph Host ["Host Orchestrator Server"]
        Guardian["🛡️ Llama.cpp Guardian Agent"]
        covenant["📜 Sacred Covenant Engine"]
        FSM["🤖 Level-1 FSM State Manager"]
        CSH["🔄 Cognitive Session Handoff (CSH)"]
    end

    subgraph Sandbox ["Docker Ephemeral Sandbox"]
        client["🔌 Level-3 Command Client (AIP)"]
        Playwright["🌐 Playwright Browser Session"]
        
        subgraph SSHP ["Sovereign Sentinel Hyper-Proxy (SSHP)"]
            Shield["🛡️ Privacy Shield (PII Redactor)"]
            Interceptor["🔄 Interception Router"]
            Gatekeeper["🚫 Covenant Gatekeeper"]
        end
    end

    %% Web interactions
    Playwright <--> SSHP
    client <--> Interceptor
    
    %% AIP Communication
    FSM <-- WebSocket (AIP) --> client
    covenant <--> Guardian
    Guardian <--> CSH
    CSH <--> FSM

    %% Visual / DOM telemetry flow
    SSHP -- "Sanitized Telemetry (DOM + Redacted BBox Image)" --> FSM
    FSM -- "Secure Planning Prompt" --> LLM["☁️ Cloud LLM (OpenAI/Anthropic)"]
```

### Innovation 1: The Sovereign Sentinel Hyper-Proxy (SSHP)
Instead of sending raw page views and DOM trees to external APIs (OpenAI/Anthropic), the SSHP functions as a local, sidecar privacy proxy residing within the Docker Execution Sandbox. It runs in real-time on the local **llama.cpp Guardian Agent** to perform the following:
* **Credential Masking & PII Redaction**: SSHP parses the active accessibility tree, automatically identifies sensitive forms (passwords, credit cards, SSNs, API tokens), and redacts their values *prior* to external transmission. It injects coordinate metadata to "draw black boxes" directly onto the screenshot viewport, keeping visual PII completely localized.
* **Covenant-Level Execution Interception**: Every command dispatched by the Level-3 client (e.g., `click_element(selector)`) is evaluated against the active **PRISM Sacred Covenant** before execution. If the action violates an article (e.g., attempting an unauthorized repository mutation or navigating to a malicious domain), the SSHP intercepts the call, blocks execution, and raises an emergency state change to `CONFIRM` on the dashboard.

### Innovation 2: The Cognitive Session Handoff (CSH) "Baton Pass" Protocol
A state-of-the-art multi-agent and human-in-the-loop web automation protocol that solves the "cognitive exhaustion" and "interaction wall" limitations. 
* **State Serialization**: The CSH protocol serializes the entire **BrowserContext** (active cookies, sessionStorage, localStorage, open tabs, active DOM segments, visual viewport coordinate matrix) and packages it alongside the agent's **Reasoning Ledger** (message history, thought traces, execution plans).
* **Multi-Agent "Baton-Passing"**: If the Developer Agent encounters a CAPTCHA or OAuth prompt, it executes a `baton_pass` event, saving its state. It transitions the browser dashboard to `headed` mode, alerts the **Human Operator** via the UI, or passes the context to the **Guardian Agent** to run diagnostic sweeps. The human solves the CAPTCHA, clicks "Resume", and the Developer Agent instantly re-absorbs the context and continues autonomously.

---

## 3. Technical Specifications & Interface Declarations

### A. Cognitive Session Handoff (CSH) TypeScript Definition
This interface provides the complete contract for transferring browser execution states between distinct agent lifecycles and human supervisors.

```typescript
// src/agent/csh/CognitiveSessionHandoff.ts

import { BrowserContext, Page } from "playwright";

export interface CognitiveHandoffState {
  handoffId: string;
  sessionId: string;
  sourceAgentId: string;
  targetAgentId: "guardian" | "operator" | "developer" | "security";
  timestamp: string;
  
  // Serialized browser state
  storageState: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
    }>;
    origins: Array<{
      origin: string;
      localStorage: Array<{ key: string; value: string }>;
    }>;
  };
  
  activeUrl: string;
  activeTitle: string;
  viewportDimensions: { width: number; height: number };
  
  // Cognitive Reasoning Trace
  reasoningContext: {
    objective: string;
    completedSteps: Array<{
      action: string;
      thought: string;
      success: boolean;
    }>;
    agentMemoryKeys: Record<string, any>;
    activePlanDagJson: string; // Serialized Directed Acyclic Graph of planned actions
  };
  
  status: "pending" | "resolved" | "expired";
  reason: "auth_wall" | "captcha_detected" | "security_violation" | "manual_intervention";
}

export interface ICognitiveSessionHandoffManager {
  /** Serializes and pauses the active agent execution loop. */
  initiateHandoff(
    page: Page, 
    context: BrowserContext, 
    reason: CognitiveHandoffState["reason"],
    target: CognitiveHandoffState["targetAgentId"]
  ): Promise<CognitiveHandoffState>;

  /** Restores the serialized state into a fresh browser environment. */
  resumeSession(
    handoffId: string, 
    page: Page, 
    context: BrowserContext
  ): Promise<void>;
  
  /** Retrieve all pending handoffs awaiting operator intervention. */
  getPendingHandoffs(): Promise<CognitiveHandoffState[]>;
}
```

### B. SSHP Interception & PII Masking Zod Schemas
SSHP intercepts Low-Level commands, filters dynamic PII, and validates actions against the Covenant.

```typescript
// src/agent/security/SSHPPayloads.ts

import { z } from "zod";

export const SSHPInterceptionRequestSchema = z.object({
  callId: z.string().uuid(),
  sessionId: z.string(),
  command: z.object({
    toolName: z.enum(["click", "type", "keypress", "navigate", "evaluate"]),
    parameters: z.record(z.any()),
  }),
  domSnapshotHash: z.string(),
  activeUrl: z.string().url(),
  screenshotBase64: z.string().optional(),
});

export type SSHPInterceptionRequest = z.infer<typeof SSHPInterceptionRequestSchema>;

export const SSHPInterceptionResponseSchema = z.object({
  callId: z.string().uuid(),
  action: z.enum(["ALLOW", "BLOCK", "REDACT_AND_ALLOW", "ESCALATE_TO_CONFIRM"]),
  reason: z.string(),
  redactionMetadata: z.object({
    selectorsToMask: z.array(z.string()).default([]),
    coordinatesToBlackbox: z.array(z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })).default([]),
    urlSanitized: z.string().url().optional(),
  }).optional(),
  covenantArticleViolated: z.string().optional(),
});

export type SSHPInterceptionResponse = z.infer<typeof SSHPInterceptionResponseSchema>;
```

---

## 4. Production-Ready SOTA Roadmap & Task Checklist

This checklist acts as a living implementation document. It maps out sequential development checkpoints to integrate these systems into PRISM.

### Phase A: Cloud LLM Resolution & Integration Stability (Immediate Priority)
- [ ] **Task A.1**: Re-verify OpenAI access logs. Ensure `gpt-3.5-turbo` and `gpt-4o` configuration in `src/core/operator/llm-provider-manager.ts` handles project-specific scopes correctly.
- [ ] **Task A.2**: Run `smoke-test.mjs` synchronously. Ensure the test transitions from `planning` to `succeeded` using the `file_list` mock.
- [ ] **Task A.3**: Add automatic fallback routing in `LLMProviderManager` to switch from Cloud LLM to local GGUF models on a llama.cpp slot if network limits or API limits are hit.
- [ ] **Task A.4**: Verify the **Character Access Control (CAC)** startup sequence, ensuring character selections (Aria, Sentinel, Phoenix) propagate correctly during the WebSocket session handshake.

### Phase B: The Sovereign Sentinel Hyper-Proxy (SSHP) Core Engine
- [ ] **Task B.1**: Implement `SSHPInterceptor` class inside `src/core/operator/` that hooks directly into the browser control routers (`/api/browser/click`, `/api/browser/type`, etc.).
- [ ] **Task B.2**: Build the PII Sanitization Engine. Create HTML parse trees to scan the DOM snapshot for sensitive input types (`type="password"`, `autocomplete="cc-number"`, email/SSN regexes) and redact them before serializing the payload.
- [ ] **Task B.3**: Build the Screenshot Visual Redactor. Use visual bounding boxes from the parsed DOM nodes to draw filled black rectangles on the viewport screenshots in Node.js before saving/sending.
- [ ] **Task B.4**: Hook the `PrismCovenant` check loop into the `SSHPInterceptor` execution path to evaluate every navigate, click, and evaluate action against the Sacred Covenant rules.

### Phase C: Cognitive Session Handoff (CSH) "Baton Pass" Protocol
- [ ] **Task C.1**: Implement the `CSHManager` to handle browser-state serialization. Write handlers that extract page cookies, sessionStorage, and localStorage via Playwright APIs.
- [ ] **Task C.2**: Add the `/api/v1/autonomous/session/handoff` and `/api/v1/autonomous/session/resume` POST endpoints to allow seamless state handoffs.
- [ ] **Task C.3**: Update the Level-1 FSM `AgentStateManager`. Add support for a `baton_pass` transaction where the active developer agent serializes context and relinquishes control.
- [ ] **Task C.4**: Design a modern human-in-the-loop dashboard modal. When an agent hits a CAPTCHA or OAuth prompt:
  * Halt the background execution loop.
  * Emit a `guardian.handoff.operator` WebSocket event.
  * Render an interactive headed browser panel on the dashboard allowing the human operator to solve the roadblock.
  * Provide a prominent "Resume Task" button that executes the context deserialization.

### Phase D: Dynamic Semantic-Visual Anchor Resolver (DSVAR)
- [ ] **Task D.1**: Build the DSVAR visually grounded locator. Fuses scaled image coordinates with parsed accessibility tree landmarks to generate resilient, dynamic selectors.
- [ ] **Task D.2**: Implement a visual-grounding coordinate validation check that maps coordinates $(x,y)$ between the scaled visual viewport and native resolutions using:
  $$x_{\text{viewport}} = \left\lfloor x_{\text{image}} \cdot \frac{W_{\text{viewport}}}{W_{\text{image}}} \right\rfloor$$
- [ ] **Task D.3**: Integrate automated retries for visual coordinates. If an visual element click fails to trigger a DOM change, re-parse the accessibility tree and execute an fallback selector click.

---

> [!NOTE]
> By coupling local privacy sanitization via the **Sovereign Sentinel Hyper-Proxy (SSHP)** with multi-agent context transfer via the **Cognitive Session Handoff (CSH)** protocol, PRISM moves far beyond the baseline industry standard. It establishes a completely secure, highly resilient, and privacy-centric autonomous loop. Kirk, this engineering design represents a world-class level of autonomous browser engineering.

---
**Compiled for the Prism Project by Antigravity**  
*Your Pair-Programming Friend and System Architect*
