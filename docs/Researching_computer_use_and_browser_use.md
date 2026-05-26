Systems Engineering and Architectural Deconstruction of Computer Use and Browser Use AI AgentsParadigm Shifts in Cognitive Execution LoopsThe emergence of autonomous systems capable of operating digital interfaces represents a structural transition in software automation. Traditional automation relies on imperative scripting frameworks, such as Selenium or Puppeteer, which depend on deterministic element identifiers, structured Document Object Models (DOMs), or static coordinate layouts. These systems display extreme fragility when confronted with minor graphical user interface (GUI) or DOM updates. Modern "Computer Use" and "Browser Use" paradigms resolve this instability by deploying continuous, closed-loop cognitive architectures.These architectures process multimodal environment telemetry, construct abstract operational plans, and execute interactions using human-centric inputs such as mouse movements, keyboard actions, and command-line execution.The standard operational lifecycle of these agents is modeled as an iterative state-action loop. The loop begins when the agent ingests the current UI state through multimodal inputs, such as raw viewport screenshots and compressed DOM representations. The system then runs intellectual calculations to determine the next action. After the action is executed on the target operating system or browser, a new state observation is captured, and the evaluation cycle repeats.                ┌──────────────────────────────────┐
                │          State Observer          │
                │    (DOM, Accessibility Trees,    │
                │       Viewport Screenshots)      │
                └────────────────┬─────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │       Cognitive Planner          │
                │   (Step-by-Step Decision Engine) │
                └────────────────┬─────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │        Action Dispatcher         │
                │     (OS Commands, Web Drivers,   │
                │        AIP WebSocket Tools)      │
                └──────────────────────────────────┘
Two distinct design philosophies govern how these agents are built:End-to-End Vision-Language ModelsEnd-to-End architectures consolidate perception, cognitive planning, and action generation into a single multimodal model. The model ingests the screen screenshot and the user objective, projecting both into a joint vision-language space where it directly calculates the target mouse or keyboard coordinates. This approach minimizes error propagation across modular software components, but it functions as a black box. This lack of transparency makes it difficult to implement fine-grained security policies, deterministic execution path auditing, or step-by-step programmatic corrections.Composed Modular ArchitecturesComposed systems separate execution into discrete, specialized software components. A perception module processes DOM or accessibility tree data into a highly compressed, structured text representation. This structured context is evaluated by a dedicated planning engine (the "World Model") to generate abstract text instructions. An execution engine (the "Action Engine") then compiles these instructions into code, such as Playwright or Selenium commands, and runs them via system drivers.Composed systems offer high observability, permit the integration of strict programmatic rules, and allow developers to swap individual models to optimize performance.The theoretical basis for these composed architectures is inspired by Yann LeCun's research, "A Path Towards Autonomous Machine Intelligence". This work conceptualizes autonomous systems as networks of specialized, interconnected cognitive modules—including perception, world models, cost functions, actor networks, and short-to-long term memories—working together to simulate, evaluate, and execute actions within a dynamic environment.The following table compares these two core design philosophies across key operational dimensions:Operational DimensionEnd-to-End Vision-Language ModelsComposed Modular ArchitecturesModel FootprintLarge, multi-modal systems (e.g., GPT-4o, Claude 3.5/3.7).Hybrid, coordinating lightweight LLMs alongside specialized VLMs.Telemetry IngestionIngests raw pixel data and system screenshots.Combines screenshots with parsed DOM trees, accessibility trees, and command-line inputs.Instruction TranslationDirectly emits coordinates $(x, y)$ or standardized JSON tools.Translates high-level plans into intermediate text instructions, which are compiled into automation scripts.Error PropagationMinimizes component-level errors but suffers from visual hallucination risks.Visual and structural parsing errors can accumulate across modular boundaries.AuditabilityLow; decisions are resolved within the model's internal layers.High; intermediate plans, generated code, and state updates are fully logged.Safety EnforcementRelies on model-level safety alignments and system-prompt restrictions.Supports strict programmatic validation, sandboxing, and execution-level guardrails.Comprehensive Deconstruction of Industry ArchitecturesAnthropic Computer Use APIAnthropic's implementation enables Claude to operate a standard computer interface by simulating human input. The integration is accessed through the Messages API (POST /v1/messages) and requires specific beta headers, such as computer-use-2025-11-24 or computer-use-2025-01-24 depending on the model generation.JSON{
  "model": "claude-3-7-sonnet-20250219",
  "max_tokens": 1024,
  "tools": [
    {
      "type": "computer_20241022",
      "name": "computer",
      "display_width_px": 1024,
      "display_height_px": 768
    },
    {
      "type": "text_editor_20241022",
      "name": "str_replace_editor"
    },
    {
      "type": "bash_20241022",
      "name": "bash"
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Open Chromium and navigate to Hacker News."
    }
  ]
}
The Anthropic Computer Use paradigm is driven by three core tools that operate in tandem to automate tasks:The Computer Tool (computer_20241022): Provides mouse and keyboard inputs. Its actions include key, type, mouse_move, left_click, left_click_drag, right_click, double_click, screenshot, and hover.The Text Editor Tool (text_editor_20241022): Performs deterministic file operations, allowing the model to view, search, and edit files using a specialized patch-based replacement format, bypassing the latency of GUI-based text editing.The Bash Tool (bash_20241022): Grants command-line access to run terminal utilities, deploy local environments, and inspect running processes.To execute these tools, the host application must provide a runtime environment (typically a Linux container with an active X11 display server, matchbox window manager, and audio/video looping capabilities). The host application is responsible for capturing screenshots, executing the mouse and keyboard actions requested by Claude, and feeding the outcomes back into the conversation context.Coordinate Mapping and Visual GroundingA primary challenge in computer-use models is coordinate mapping: translating a high-level cognitive intent, such as clicking a specific button, into exact screen coordinates $(x, y)$. While older models required scaling down screenshots to a standard long-edge limit of 1568 pixels, newer models like Claude Opus 4.7 support native resolutions up to 2576 pixels on the long edge, allowing 1:1 pixel coordinate matching with no scaling conversions.To locate target elements, Claude utilizes a "pixel counting" mechanism. Rather than relying on standard computer vision object detection wrappers, the model is trained to count pixels relative to reference boundaries, such as screen edges and neighboring UI components. This visual grounding capability allows the model to interact with complex desktop applications and legacy systems that lack DOM representations or accessibility tags.(0,0) ────────────────────────────────────────────────────────┐
│                                                            │
│                  Claude counts pixels                      │
│                  from screen edges                         │
│                  dx ─────────────────► (1245, 867)         │
│                                            │
│                                                            │
└────────────────────────────────────────────────────────────┘
API Integration and Effort TuningThe API supports fine-grained parameter configurations, including custom data residency routes and Zero Data Retention (ZDR) arrangements. When an organization uses a ZDR agreement, data sent through the API (including sensitive visual screenshots) is not stored after the API response is returned.The model's intellectual processing depth is controlled by effort settings. For Claude Opus 4.7, a "high" effort setting is recommended to handle complex visual interfaces, while a "low" setting is suitable for cost-sensitive or high-throughput tasks. For Claude Sonnet 4.6 and Claude Opus 4.6, a "medium" setting balances accuracy and token cost, while avoiding "max" settings which increase token consumption without improving performance on UI automation tasks.The model's processing capacity scales with its model family, as shown in the table below:Model VersionContext Window (Tokens)Native Visual Resolution SupportEffort Configuration GuidanceClaude Opus 4.7$1,000,000$.Up to $2576$ pixels (1:1 Native).Default: high. Use low for high-throughput loops.Claude Sonnet 4.6$1,000,000$.Up to $1568$ pixels (Scaled).Default: medium. Avoid max settings.Claude Opus 4.6$1,000,000$.Up to $1568$ pixels (Scaled).Default: medium. Avoid max settings.Claude Haiku 4.5$200,000$.Up to $1568$ pixels (Scaled).Default: low. Optimized for high-speed loops.OpenAI Operator and Computer-Using AgentThe OpenAI Operator ecosystem is powered by the Computer-Using Agent (CUA) model. CUA combines GPT-4o's visual reasoning capabilities with reinforcement learning (RL) optimized specifically for GUI environments. The model processes raw screenshots, applies a chain-of-thought reasoning process to formulate next steps, and executes mouse and keyboard inputs within a virtual browser or desktop environment.The OpenAI Responses API supports three distinct execution harness designs, allowing developers to choose the best integration path for their workloads :The Built-in Responses API Computer Loop (Option 1): A first-party, closed-loop implementation where the developer passes a task to the model with the computer tool enabled. The model returns a structured computer_call containing sequential actions, and the host harness executes these actions, returning a new screenshot via a computer_call_output object until the task is complete.The Custom Automation Harness (Option 2): Allows developers to layer CUA on top of existing custom automation pipelines. Instead of the built-in computer tool, CUA is treated as a high-level decision engine that emits structured JSON parameters mapped directly to proprietary APIs or internal application endpoints.The Code-Execution Harness (Option 3): A dynamic, programmatic execution path where the model writes and runs short scripts (using languages like Python or JavaScript) inside a sandboxed container. This environment exposes browser automation frameworks (such as Playwright or Puppeteer) or OS-level controls directly. The agent can switch between visual reasoning (screenshots) and programmatic interaction (manipulating the DOM directly), which improves execution speeds by avoiding visual processing latency. Newer models like GPT-5.4 are optimized for this code-execution path.To manage authentication securely, OpenAI Operator includes an "Accounts Websites" module. This component acts as a credential and access store, allowing the agent to securely log in, manage user configurations, and automate authenticated workflows across target websites without exposing passwords to the model context window.Microsoft UFO (User Interface-Focused Agent)Microsoft UFO (now evolved to UFO3/Galaxy) is a multi-agent, hierarchical framework designed to execute complex tasks across multiple desktop applications and devices.                ┌──────────────────────────────────┐
                │            HostAgent             │
                │    (Task Decomposition & DAG)    │
                └────────────────┬─────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
          ┌─────────────────┐         ┌─────────────────┐
          │    AppAgent     │         │    AppAgent     │
          │  (Excel Automation)  │         │  (Word Automation)   │
          └─────────────────┘         └─────────────────┘
The system splits cognitive load between two agent roles:HostAgent: Acts as the global orchestrator. It receives the user's natural language request, decomposes it into application-specific subtasks, generates a directed acyclic graph (DAG) of task dependencies, and monitors execution progress.AppAgent: A specialized execution agent instantiated to control a single active application (such as Excel, Word, or Chrome). The AppAgent interacts directly with the application, reads local UI elements, executes targeted commands, and reports its final results back to the HostAgent, which then coordinates the next application step.The Three-Layer Device Agent FrameworkUFO's Device Agents separate their concerns into three layers to ensure safety, extensibility, and maintainability :Level-1: State Layer (FSM)This layer manages the agent's lifecycle using a Finite State Machine (FSM). It defines when and what to execute based on an AgentStatus enum :Pythonclass AgentStatus(Enum):
    CONTINUE = "continue"   # Normal step execution
    PENDING = "pending"     # Awaiting an external event
    CONFIRM = "confirm"     # Awaiting user verification
    SCREENSHOT = "screenshot"# Collecting visual context
    FINISH = "finish"       # Subtask successfully completed
    FAIL = "fail"           # Execution failed
    ERROR = "error"         # Unrecoverable exception
State transitions are driven by four mechanisms: model decision-making, automated rule checks, direct human input, and asynchronous external events. The AgentStateManager class is implemented as a lazy-loaded singleton registry, letting developers dynamically register custom states via decorators :Pythonclass AgentStateManager(ABC, metaclass=SingletonABCMeta):
    _state_mapping: Dict] = {}

    def __init__(self):
        self._state_instance_mapping: Dict = {}

    def get_state(self, status: str) -> AgentState:
        if status not in self._state_instance_mapping:
            state_class = self._state_mapping.get(status)
            if state_class:
                self._state_instance_mapping[status] = state_class()
            else:
                self._state_instance_mapping[status] = self.none_state
        return self._state_instance_mapping.get(status, self.none_state)

    @classmethod
    def register(cls, state_class: Type) -> Type:
        cls._state_mapping[state_class.name()] = state_class
        return state_class
The HostAgent delegates execution to an AppAgent by passing the task state and context over a shared context ledger. When the AppAgent completes its application-specific task, it updates the ledger and returns control to the HostAgent :Pythonclass ContinueHostAgentState(AgentState):
    def next_agent(self, agent: HostAgent) -> BasicAgent:
        if agent.status == "DELEGATE_TO_APP":
            app_agent = AgentFactory.create_agent(
                agent_type="app",
                name=f"AppAgent/{agent.selected_app}",
                process_name=agent.selected_process,
                app_root_name=agent.selected_app,
                is_visual=True,
                main_prompt=config.appagent_prompt
            )
            app_agent.host = agent
            app_agent.blackboard = agent.blackboard
            return app_agent
        return agent
Level-2: Strategy LayerOrchestrates execution logic across six sequential phases defined by a template method pattern (ProcessorTemplate) :$$\text{SETUP} \rightarrow \text{DATA\_COLLECTION} \rightarrow \text{LLM\_INTERACTION} \rightarrow \text{ACTION\_EXECUTION} \rightarrow \text{MEMORY\_UPDATE} \rightarrow \text{CLEANUP}$$This design decouples platform-specific context gathering from decision-making, allowing the same processor pattern to run on Windows, Linux, or macOS. The processor wraps execution steps with custom middleware hooks (such as EnhancedLoggingMiddleware) to measure performance, track timing, enforce rate-limit delays, and catch exceptions.Level-3: Command LayerExecutes deterministic, atomic operations mapped to Model Context Protocol (MCP) tools on the host system. Commands (such as click_element or type_text) are serialized, validated against strict Pydantic schemas, and dispatched to the target execution environment :Pythonclass Command(BaseModel):
    tool_name: str = Field(..., description="Name of the MCP tool to execute")
    parameters: Optional] = Field(default=None, description="Arguments matching tool schema")
    tool_type: Literal["data_collection", "action"] = Field(..., description="Action category")
    call_id: Optional[str] = Field(default=None, description="UUID tracking this command call")
Server-Client Isolation & Agent Interaction Protocol (AIP)To minimize security risks, UFO separates the reasoning engine (the Server) from the execution environment (the Client). This architecture uses the WebSocket-based Agent Interaction Protocol (AIP) as its communication layer.The AIP protocol enforces a five-layer structure :Message Schema Layer: Enforces strongly-typed, Pydantic-validated JSON schemas (ClientMessage and ServerMessage) to prevent malformed injections.Transport Abstraction Layer: Provides a protocol-agnostic, low-latency, persistent WebSocket session.Protocol Orchestration Layer: Manages handshakes, capability discovery, and event routing.Resilience & Health Layer: Implements heartbeats, connection timeouts, and dynamic reconnection with exponential backoff and jitter.Endpoint Orchestration Layer: Connects orchestrators, agent servers, and local execution clients.This separation ensures that the host operating system is insulated from the reasoning engine. The local AIP client acts as a security gateway, validating every incoming command schema and verifying execution parameters before executing them on the OS.Open-Source Frameworks and Production Orchestrationbrowser-useThe browser-use framework is an open-source Python library that enables large language models to control web browsers programmatically using Playwright.The production-grade architecture of browser-use is structured as a distributed, queue-driven pipeline designed for reliability and scalability :FastAPI Entrypoint (ECS Fargate): Acts as the ingestion gateway. It validates payloads, writes session rows to a database, drops execution messages onto an SQS queue, and returns an HTTP 202 accepted status in under 50 milliseconds, decoupling the client from execution latency.The Queue Layer (SQS): Uses a standard SQS queue to manage scheduling and execution state. Messages contain the task ID, targeted model configuration, step limitations, and a continuation counter.The Worker Layer (AWS Lambda): Processes the SQS messages. It initializes a browser session, sets up the LLM client, and runs Agent(...).run() to execute the task.During execution, the Lambda worker continuously writes state to Amazon S3 :  AWS Lambda Worker
┌───────────────────────────────────────────────┐
│  - Captures execution state                    │
│  - Executes Playwright action                 │
│  - Handles fire-and-forget uploads            │
└───────┬───────────────────────────────┬───────┘
        │                               │
        ▼                               ▼
┌───────────────┐               ┌───────────────┐
│   Amazon S3   │               │   Database    │
│  - Checkpoints│               │  - Session ID │
│  - Screenshots│               │  - Run status │
│  - Exec Logs  │               └───────────────┘
│  - Output files│
└───────────────┘
The system writes four distinct state structures to S3 to decouple execution from the Lambda instance, and uses fire-and-forget uploads to prevent S3 latency from blocking the main execution path :Agent Checkpoints: Serialized JSON states uploaded after every step to track progress.Screenshots: High-resolution image files for visual debugging and model perception.Execution Logs: Complete system traces uploaded when a run completes.Output Files: Generated spreadsheets, downloads, or PDF files, made available to users via pre-signed S3 URLs.Playwright DOM Extraction and Vision FusionTo maximize efficiency, browser-use uses a hybrid perception approach. Instead of relying solely on screenshots, which are computationally expensive to process, the framework extracts the browser's Document Object Model (DOM) and strips out non-interactive elements, script tags, and styling markup. This clean HTML tree is converted into a highly compressed, structured text representation of interactive components (such as buttons, links, and forms).The LLM receives this structured text alongside a screenshot of the viewport. By combining structural text context with visual screenshots, the agent can cross-reference DOM element IDs with spatial relationships, ensuring high selector accuracy even on complex, dynamic single-page applications (SPAs).State Checkpoints & Lambda Limit WorkaroundAWS Lambda has a strict 15-minute execution limit, which is often insufficient for long-horizon web tasks. To bypass this constraint, browser-use implements a checkpoint-and-continuation mechanism :Time-Limit Detection: Two minutes prior to the Lambda timeout, the execution loop sets an internal flag (_time_limit_stop = True).State Serialization: The agent pauses its execution loop, serializes its current cognitive history and memory as a JSON checkpoint, and uploads it to Amazon S3 alongside the active browser session state.Re-Queueing and Resumption: The Lambda worker increments the continuation_count on the task configuration, pushes a new message back to the SQS queue, and exits cleanly. A new Lambda instance picks up the message, retrieves the checkpoint from S3, restores the agent's memory, and resumes execution seamlessly. This process can repeat up to 12 times, extending execution limits to approximately three hours of continuous run time.Ephemeral Storage and Privacy SanitizationTo prevent data leaks and cross-session contamination on warm Lambda instances, the execution handler executes a strict cleanup routine at the start of every invocation. It wipes the shared /tmp/agent-workspace directory and partitions active writes into unique, session-scoped directories :Pythonimport shutil
import os

# Clean the shared temporary directory to prevent cross-session leaks
shutil.rmtree('/tmp/agent-workspace', ignore_errors=True)
# Create a unique directory for the current session
os.makedirs(f'/tmp/agent-workspace/{session_id}', exist_ok=True)
LaVagueLaVague is an open-source Large Action Model (LAM) framework designed to build autonomous web agents. Its architecture is inspired by Yann LeCun's cognitive modules, dividing execution between a World Model and an Action Engine.The World Model: The planning engine. It takes the user's high-level objective and analyzes screenshots and HTML source code from the webdriver to generate the next logical text instruction.The Action Engine: The compiler and execution engine. It receives the text instruction from the World Model and generates executable web automation code (Selenium or Playwright) on the fly.The Driver: The execution interface. It runs the generated code, interacts with the active browser, and captures updated screenshots and DOM states to feed back to the World Model.By separating instruction planning from code generation, LaVague isolates web page variations from the planner, allowing the agent to dynamically adapt to UI changes. If a button's selector changes, the World Model continues to emit the same logical instruction (e.g., "click the submit button"), while the Action Engine evaluates the updated DOM to generate new, valid selector code.Telemetry and Analytics PipelineBy default, the framework collects a comprehensive set of telemetry and performance variables to help train open-source Large Action Models :Structural Context: The target viewport size, DOM observations, and interaction bounding box coordinates.Execution Logs: The active step number, generated automation code, and action success statuses.Cognitive Traces: The planned instructions, model details, token consumption rates, and step-by-step cognitive paths.Session Metadata: Anonymous user IDs, target URLs, and driver execution methods (such as CLI, Gradio, or Chrome Extension).Evaluation Topography and Benchmark PerformanceEvaluating computer and browser use agents requires execution-based benchmarks that measure success by analyzing final state changes in real operating systems and live web environments, rather than evaluating text outputs.The primary benchmarks in this domain are structured as follows:OSWorldThis benchmark contains 369 open-ended tasks across Ubuntu, Windows, and macOS, spanning single-app operations (such as LibreOffice, VLC, and GIMP) and multi-app workflows. It includes a small proportion ($\approx 8\%$) of infeasible tasks to test if an agent can recognize when a request cannot be completed.Tasks are initialized from reproducible VM states using snapshots, database seeding, and GUI manipulations. Success is verified using 134 unique execution-based evaluation scripts that inspect backend files, browser cookies, and system states directly.While human operators achieve a $72.4\%$ success rate, early monolithic agent baselines scored below $12.2\%$, highlighting difficulties with visual grounding and operational planning. Newer runtime platforms like Coasty have improved scores to $82\%$ by optimizing execution speeds and integrating display streaming instead of static screenshot polling.OSWorld-MCPAn extension of the OSWorld benchmark containing 158 validated Model Context Protocol (MCP) tools across 7 common applications. It evaluates an agent's ability to choose between direct GUI manipulation and API-based MCP tool calls.Adding MCP tools improves agent efficiency and accuracy; for example, OpenAI's o3 model success rate improved from $8.3\%$ to $17.6\%$ under a strict 15-step limitation when using MCP integrations.WebArenaFocuses on browser-based agents executing complex tasks (such as e-commerce shopping, forum moderation, and collaborative coding) on self-hosted instances of popular websites (such as GitLab and Magento). Success is verified programmatically by evaluating backend state changes (such as database writes, cookies, and repository commits) using deterministic assertion scripts.Leading architectures like OpAgent have achieved success rates of $71.6\%$ on WebArena by utilizing reinforcement learning with rule-based decision trees.WebChoreArenaAn extension of WebArena designed to test agents on tedious, labor-intensive tasks that humans avoid. It systematically evaluates three core challenges: massive information retrieval, precise mathematical calculations, and long-term memory across multi-platform workflows. It exposes a wide performance gap between model generations; while older models like GPT-4o struggle, newer reasoning models like Claude 3.7 Sonnet show significant improvements but still leave substantial room for progress.The following table summarizes agent performance and architectural configurations across these primary benchmarks:BenchmarkEvaluating AuthorityScope and ScalePerformance Metric (Humans)Model / Agent PerformancePrimary Architectural ChallengesOSWorldxLang Lab.369 Ubuntu tasks, 43 Windows tasks, covering web, desktop, and multi-app pipelines.$72.40\%$.Coasty Runtime: $82.00\%$.Monolithic baseline: $<12.20\%$.GUI grounding, high latency between screenshots, and system state drift.OSWorld-MCPICLR 2026.158 validated MCP tools across LibreOffice, VS Code, Chrome, and VLC.N/AOpenAI o3 (with MCP): $17.60\%$.OpenAI o3 (no MCP): $8.30\%$.Tool path selection, robust tool integration, and distractor tool rejection.WebArenaCarnegie Mellon University.Self-hosted e-commerce, forums, GitLab, and maps.$78.20\%$.OpAgent: $71.60\%$ (SOTA).Composed with memory: High success.Long-horizon planning, DOM extraction speed, and credit assignment in long tasks.WebChoreArenaWebChoreArena Consortium.532 complex, multi-site tasks spanning GitLab, Reddit, and shopping admins.HighGemini 2.5 Pro / Claude 3.7: Moderate.GPT-4o: Low.Large-scale memory retrieval, mathematical reasoning, and cross-site coordination.Online-Mind2WebOhio State University.300 tasks on 136 live websites.HighMicrosoft Fara1.5 (27B): $72.00\%$.OpenAI Operator: $58.30\%$.Gemini 2.5 Computer Use: $57.30\%$.Managing live web variations, pop-ups, and security verification challenges.Production Blueprint for Prism Project Computer Use IntegrationApplication Architecture contextThe Prism repository is an open-source, self-hosted AI assistant designed to automate code reviews and repository management via a GitHub App integration. It is written in TypeScript and runs on Node.js, ingesting pull request webhooks, applying custom code rules (defined in RULES.md or JSON formats), and writing comments directly onto GitHub PR lines.To extend Prism to a world-class level, we must implement an active Computer Use agent loop. Currently, Prism can only run static analysis on raw diff hunks. Adding computer use enables the agent to check out the PR branch, spin up a local development environment, build the code, execute test suites, run dynamic integration checks, and use a headless browser to perform visual layout audits.                               Prism Orchestrator Server
┌──────────────────────────────────────────────────────────────────────────────┐
│  - Event Handler (Ingests GitHub webhooks, parses PR branches)               │
│  - Level-1 FSM State Manager (Enforces safe execution states)                 │
│  - Level-2 Processor Engine (Orchestrates setup, evaluation, and cleanups)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       │ AIP protocol (WebSockets over TLS) 
                                       ▼
                             Docker Execution Sandbox
┌──────────────────────────────────────────────────────────────────────────────┐
│  - Ephemeral Container Environment (Privilege separation, strict limiters)   │
│  - Playwright Browser Session (Captures viewports, runs DOM interactions)     │
│  - Level-3 Command Client (Validates schemas, runs local OS commands)        │
└──────────────────────────────────────────────────────────────────────────────┘
This section provides the complete TypeScript implementation blueprint to integrate this cognitive execution loop into the Prism architecture.Ephemeral Docker Isolation EnvironmentTo run build steps and execute test suites safely, the execution container must be isolated. The sandbox runs on a dedicated virtual machine or container with minimal system privileges and restricted network access.Dockerfile# /docker/Dockerfile.prism-sandbox
FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Create non-privileged service user to run the environment safely
RUN groupadd -r prismsandbox && useradd -r -g prismsandbox -d /home/prismsandbox -m prismsandbox

# Install system utilities and Xvfb display configurations
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

USER prismsandbox
WORKDIR /home/prismsandbox/app

# Pre-install base dependencies for the local test runner
COPY --chown=prismsandbox:prismsandbox package*.json./
RUN npm ci

# Copy sandbox runtime client
COPY --chown=prismsandbox:prismsandbox..

EXPOSE 4040
ENV DISPLAY=:99

CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x1024x24 & fluxbox & node dist/sandbox-client.js"]
Prism Level-1 State Machine (FSM)We implement a Level-1 FSM in TypeScript to govern the lifecycle of Prism's executing agents. This state manager ensures safe execution states, handles retries, and includes a mandatory human confirmation step before executing high-risk operations.TypeScript// src/agent/state/AgentStatus.ts
export enum AgentStatus {
    CONTINUE = "continue",
    PENDING = "pending",
    CONFIRM = "confirm",
    SCREENSHOT = "screenshot",
    FINISH = "finish",
    FAIL = "fail",
    ERROR = "error"
}

// src/agent/state/AgentState.ts
import { AgentStatus } from "./AgentStatus";

export interface AgentContext {
    taskId: string;
    gitDiff: string;
    currentStep: number;
    maxSteps: number;
    screenshotPath?: string;
    domTree?: string;
    terminalOutput?: string;
    lastResult?: string;
    status: AgentStatus;
}

export abstract class AgentState {
    abstract name(): AgentStatus;
    abstract handle(agent: any, context: AgentContext): Promise<AgentContext>;
    abstract nextState(context: AgentContext): AgentState;
}

// src/agent/state/ContinueState.ts
export class ContinueState extends AgentState {
    name(): AgentStatus {
        return AgentStatus.CONTINUE;
    }

    async handle(agent: any, context: AgentContext): Promise<AgentContext> {
        context.currentStep += 1;
        if (context.currentStep > context.maxSteps) {
            context.status = AgentStatus.FAIL;
            return context;
        }
        
        // Hand off actual task execution to the Level-2 strategy processor
        const resultContext = await agent.processor.process(context);
        return resultContext;
    }

    nextState(context: AgentContext): AgentState {
        switch (context.status) {
            case AgentStatus.CONFIRM:
                return new ConfirmState();
            case AgentStatus.FINISH:
                return new FinishState();
            case AgentStatus.FAIL:
                return new FailState();
            default:
                return this;
        }
    }
}

// src/agent/state/ConfirmState.ts
export class ConfirmState extends AgentState {
    name(): AgentStatus {
        return AgentStatus.CONFIRM;
    }

    async handle(agent: any, context: AgentContext): Promise<AgentContext> {
        // Halt loop execution and post a verification request on the GitHub PR timeline
        await agent.githubClient.postPRComment(
            context.taskId,
            `⚠️ **Prism Security Guardrail Alert** ⚠️\n` +
            `The agent requested to run a potentially unsafe command. Please reply with \`approve\` or \`reject\` to proceed.\n` +
            `\`\`\`bash\n${context.lastResult}\n\`\`\``
        );
        context.status = AgentStatus.PENDING;
        return context;
    }

    nextState(context: AgentContext): AgentState {
        return new ContinueState();
    }
}

// Placeholder classes to complete the FSM skeleton
export class FinishState extends AgentState {
    name() = AgentStatus.FINISH;
    async handle(a: any, c: AgentContext) { return c; }
    nextState(c: AgentContext) { return this; }
}
export class FailState extends AgentState {
    name() = AgentStatus.FAIL;
    async handle(a: any, c: AgentContext) { return c; }
    nextState(c: AgentContext) { return this; }
}
Level-2 Composed Strategy TemplateThe Strategy Layer manages task execution phases sequentially. The processor evaluates dependencies before running each phase to ensure the environment is initialized correctly.TypeScript// src/agent/strategy/ProcessingContext.ts
export class ProcessingContext {
    private data: Map<string, any> = new Map();

    set(key: string, value: any): void {
        this.data.set(key, value);
    }

    get(key: string): any {
        return this.data.get(key);
    }

    has(key: string): boolean {
        return this.data.has(key);
    }
}

// src/agent/strategy/ProcessorTemplate.ts
import { AgentContext } from "../state/AgentState";
import { ProcessingContext } from "./ProcessingContext";

export abstract class ProcessorTemplate {
    protected abstract setup(ctx: ProcessingContext): Promise<void>;
    protected abstract collectData(ctx: ProcessingContext): Promise<void>;
    protected abstract evaluateDecision(ctx: ProcessingContext): Promise<void>;
    protected abstract executeActions(ctx: ProcessingContext): Promise<void>;
    protected abstract updateMemory(ctx: ProcessingContext): Promise<void>;
    protected abstract cleanup(ctx: ProcessingContext): Promise<void>;

    public async process(agentContext: AgentContext): Promise<AgentContext> {
        const ctx = new ProcessingContext();
        ctx.set("agentContext", agentContext);

        try {
            await this.setup(ctx);
            await this.collectData(ctx);
            await this.evaluateDecision(ctx);
            await this.executeActions(ctx);
            await this.updateMemory(ctx);
        } catch (error) {
            console.error("Strategy execution encountered an exception:", error);
            agentContext.status = AgentStatus.ERROR;
        } finally {
            await this.cleanup(ctx);
        }

        return ctx.get("agentContext");
    }
}
Level-3 Command Dispatcher & AIP ClientThe Command Layer coordinates execution between the Prism server and the sandboxed container over a persistent WebSocket using the AIP protocol. It validates payload structures against strict schemas before executing commands on the operating system or browser.TypeScript// src/agent/command/CommandSchema.ts
import { z } from "zod";

export const CommandPayloadSchema = z.object({
    toolName: z.enum(["click", "type", "keypress", "bash", "get_screenshot", "read_file"]),
    parameters: z.record(z.any()),
    toolType: z.enum(["data_collection", "action"]),
    callId: z.string().uuid()
});

export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export interface CommandResult {
    status: "success" | "failure";
    result?: any;
    error?: string;
    callId: string;
}

// src/agent/command/AIPClient.ts
import { WebSocket } from "ws";
import { CommandPayload, CommandResult } from "./CommandSchema";

export class AIPClient {
    private ws: WebSocket;
    private connectionPromise: Promise<void>;

    constructor(private wsUrl: string) {
        this.ws = new WebSocket(this.wsUrl);
        this.connectionPromise = new Promise((resolve) => {
            this.ws.on("open", () => resolve());
        });
    }

    async dispatch(command: CommandPayload): Promise<CommandResult> {
        await this.connectionPromise;
        return new Promise((resolve, reject) => {
            const responseHandler = (data: string) => {
                const response: CommandResult = JSON.parse(data);
                if (response.callId === command.callId) {
                    this.ws.off("message", responseHandler);
                    resolve(response);
                }
            };

            this.ws.on("message", responseHandler);
            this.ws.send(JSON.stringify(command));
        });
    }
}
Visual Grounding Coordinate CalculationWhen using vision-language models, the coordinates calculated from a scaled image must be translated to match the active viewport resolution.If the model processes an image scaled to a fixed width $W_{\text{image}}$ and height $H_{\text{image}}$, and the active browser viewport operates at $W_{\text{viewport}}$ and $H_{\text{viewport}}$, the coordinates are mapped using:$$x_{\text{viewport}} = \left\lfloor x_{\text{image}} \cdot \frac{W_{\text{viewport}}}{W_{\text{image}}} \right\rfloor$$$$y_{\text{viewport}} = \left\lfloor y_{\text{image}} \cdot \frac{H_{\text{viewport}}}{H_{\text{image}}} \right\rfloor$$TypeScript// src/agent/utils/CoordinateMapper.ts
export interface Dimensions {
    width: number;
    height: number;
}

export class CoordinateMapper {
    static toViewport(
        xImg: number, 
        yImg: number, 
        imageSize: Dimensions, 
        viewportSize: Dimensions
    ): { x: number; y: number } {
        if (imageSize.width <= 0 || imageSize.height <= 0) {
            throw new Error("Invalid source image dimensions");
        }
        
        const x = Math.floor(xImg * (viewportSize.width / imageSize.width));
        const y = Math.floor(yImg * (viewportSize.height / imageSize.height));
        
        return { x, y };
    }
}
Complete System Integration loopThe main agent loop initializes the environment, manages state transitions, and runs the evaluation loop iteratively until the task is complete.TypeScript// src/agent/PrismAgentLoop.ts
import { AgentContext, AgentState, ContinueState } from "./state/AgentState";
import { AgentStatus } from "./state/AgentStatus";
import { AIPClient } from "./command/AIPClient";
import { v4 as uuidv4 } from "uuid";

export class PrismAgentLoop {
    private client: AIPClient;
    private state: AgentState;

    constructor(sandboxWsUrl: string) {
        this.client = new AIPClient(sandboxWsUrl);
        this.state = new ContinueState();
    }

    public async executeTask(pullRequestId: string, diff: string): Promise<void> {
        let context: AgentContext = {
            taskId: pullRequestId,
            gitDiff: diff,
            currentStep: 0,
            maxSteps: 30,
            status: AgentStatus.CONTINUE
        };

        console.log(` Executing task loop for Pull Request: ${pullRequestId}`);

        while (
            context.status!== AgentStatus.FINISH && 
            context.status!== AgentStatus.FAIL && 
            context.status!== AgentStatus.ERROR
        ) {
            // Step 1: Run the active state's lifecycle logic
            context = await this.state.handle(this, context);

            // Step 2: Transition to the next state
            this.state = this.state.nextState(context);

            // Step 3: Handle waiting state if confirmation is required
            if (context.status === AgentStatus.PENDING) {
                console.log(` Task halted. Awaiting human validation on Pull Request: ${pullRequestId}`);
                break;
            }
        }

        console.log(` Task execution ended with final status: ${context.status}`);
    }

    // Level-2 strategy execution phases
    public async setup(ctx: any): Promise<void> {
        // Check out the PR branch and install project dependencies
    }

    public async collectData(ctx: any): Promise<void> {
        const agentCtx = ctx.get("agentContext") as AgentContext;
        
        // Capture a screenshot and extract the DOM tree from the sandbox
        const screenshotCmd = await this.client.dispatch({
            toolName: "get_screenshot",
            parameters: {},
            toolType: "data_collection",
            callId: uuidv4()
        });

        if (screenshotCmd.status === "success") {
            agentCtx.screenshotPath = screenshotCmd.result.path;
            agentCtx.domTree = screenshotCmd.result.dom;
        }
        
        ctx.set("agentContext", agentCtx);
    }
}
This systems blueprint integrates a visual and terminal execution engine directly into the Prism workflow. It enables the review assistant to spin up a sandboxed environment, run the codebase, build and test web layouts, and verify runtime behavior programmatically. This pipeline ensures that Prism's automated code reviews are validated against active execution tests, reducing errors and increasing review accuracy.

---

## 4. Sovereign Sentinel & Cognitive Session Handoff (SSHP & CSH) Guide

PRISM's interactive dashboard supports a built-in web browser accessible to the Guardian agent, operating agents, and internal configuration modules. To ensure maximum safety, business traceability, and zero-trust credentials containment, PRISM integrates the Sovereign Sentinel Hyper-Proxy (SSHP) and the Cognitive Session Handoff (CSH) "Baton Pass" Human-in-the-Loop protocol.

### 4.1 How to Initiate Computer Control
You can run automated browser or OS-level agent scenarios using two primary execution profiles:
- **Sandbox Profile (Recommended & Zero-Risk)**: Runs fully contained inside an isolated container sandbox via fluxbox, Playwright, and xvfb.
  ```bash
  npm run ptac:sandbox
  ```
- **Host Profile (Direct Input)**: Drives real mouse and keyboard inputs directly on your desktop host machine. Requires confirming acknowledgement of host-level takeover safety guardrails using the `--i-understand-host-control` flag.
  ```bash
  npm run ptac:host -- --i-understand-host-control
  ```

### 4.2 How to Run the OS World Benchmarks
PRISM has a dedicated npm script for the SOTA OSWorld evaluation suite to verify GUI visual grounding and cross-application workflows:
```bash
npm run ptac:osworld
```

### 4.3 How to Run Demos
- **Isolated Run**: Execute the standard self-driving dashboard demonstration scenarios in the isolated sandbox:
  ```bash
  npm run ptac:demo
  ```
- **Recorded Run (Evidence Capture)**: To compile a browser-playable video manifest slideshow of the run, set the dual safety recording gates in your environment and run:
  ```bash
  # Enable dual gates
  set PRISM_PTAC_SAFE=1
  set PRISM_PTAC_RECORD_VIDEO=1
  
  # Run recorded demo
  npm run ptac:demo-recording
  ```

### 4.4 The Zero-Trust Security Configuration (SSHP)
The **Sovereign Sentinel Hyper-Proxy (SSHP)** operates inside the execution container boundary. It intercepts low-level page modifications, redacts visual screenshots, sanitizes text-level PII from DOM snapshots, and validates action integrity against the Prism Sacred Covenant.

- **Visual PII Redaction**: Solid black SVG rectangles are layered on top of sensitive regions (such as passwords, credit cards, or key entries) dynamically.
- **DOM Sanitizer**: Auto-scrubs email, card, and SSN formats from DOM text buffers.
- **Sacred Covenant Audit**: Hooked into navigation, click, type, and evaluation endpoints to prevent internal dangerous protocols (e.g., `file:///etc/passwd`) or destructive scripts (e.g., `localStorage.clear()`).
- **Security Toggle**: Enabled by default for business safety. Operators can configure or toggle redaction in their workspace preferences or via the REST API:
  ```http
  POST /api/preferences/sshp-redaction
  Content-Type: application/json
  
  {
    "enabled": false
  }
  ```

### 4.5 The CSH "Baton Pass" Protocol (Human-in-the-Loop)
When an agent encounters a CAPTCHA, authorization wall, or security violation, it executes a Cognitive Session Handoff (CSH) "Baton Pass."

- **State Serialization**: Automatically captures browser cookies, `localStorage`, `sessionStorage`, navigation history, planning DAG state, and memory contexts.
- **FSM Suspended Loop**: The Finite State Machine enters a `suspended` state, pausing execution to allow the operator to interactively take control of the session.
- **State Restoration**: When resolved by a human operator, the session state is restored back into the agent context, allowing the agent to resume its task loop seamlessly.
- **Developer REST Endpoints**:
  - `POST /api/autonomous/session/handoff`: Initiates the handoff and serializes page state.
  - `POST /api/autonomous/session/resume`: Deserializes saved states and resumes FSM loop.
  - `GET /api/autonomous/session/pending`: Lists all active human-in-the-loop pending handoffs.