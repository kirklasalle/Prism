/**
 * PRISM CLI Advanced Setup Wizard — 8-step deep configuration (Phase S3-M2).
 *
 * Extends the basic 4-step wizard with model routing, guardian agent,
 * CAC identity, browser profile, scheduler, and initialization certificate.
 *
 * Supports connected mode (via API) and non-interactive mode (via flags/env).
 */

import { SetupApiClient, type ReadinessSnapshot } from "./api-client.js";
import {
    ansi,
    color,
    sym,
    printBanner,
    printStep,
    printCheck,
    printInfo,
    printSuccess,
    printError,
    printWarning,
    prompt,
    confirm,
    maskedInput,
    select,
    spinner,
    type SelectOption,
} from "./cli-utils.js";
import {
    readPreferences,
    writePreferences,
    resolveWorkspaceRoot,
    setWorkspaceRoot,
    ensureWorkspaceStructure,
} from "../core/config/workspace-resolver.js";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 8;

interface ProviderDef {
    id: string;
    label: string;
    needsKey: boolean;
    description: string;
}

const PROVIDERS: ProviderDef[] = [
    { id: "llamacpp", label: "Llama.cpp", needsKey: false, description: "Local GGUF CPU/GPU acceleration" },
    { id: "ollama", label: "Ollama", needsKey: false, description: "Local inference server" },
    { id: "openai", label: "OpenAI", needsKey: true, description: "GPT-4o, GPT-4.1, o3" },
    { id: "anthropic", label: "Anthropic", needsKey: true, description: "Claude 4, Sonnet, Haiku" },
    { id: "google", label: "Google AI", needsKey: true, description: "Gemini 2.5 Pro/Flash" },
    { id: "mistral", label: "Mistral", needsKey: true, description: "Mistral Large, Codestral" },
    { id: "groq", label: "Groq", needsKey: true, description: "Ultra-fast inference" },
    { id: "together", label: "Together AI", needsKey: true, description: "Open-source models" },
    { id: "deepseek", label: "DeepSeek", needsKey: true, description: "DeepSeek-V3, R1" },
    { id: "openrouter", label: "OpenRouter", needsKey: true, description: "Multi-provider gateway" },
    { id: "perplexity", label: "Perplexity", needsKey: true, description: "Search-augmented LLM" },
    { id: "fireworks", label: "Fireworks AI", needsKey: true, description: "Fast open-source serving" },
    { id: "cohere", label: "Cohere", needsKey: true, description: "Command R+, Embed" },
];

const ROUTING_ROLES = [
    "chat", "code-generation", "reasoning", "tool-selection",
    "summarization", "classification", "memory-indexing", "vision",
];

interface SchedulerSuggestion {
    id: string;
    label: string;
    cron: string;
    description: string;
    defaultEnabled: boolean;
}

function getSchedulerSuggestions(profile: string): SchedulerSuggestion[] {
    if (profile === "business") {
        return [
            { id: "daily-review", label: "Daily self-review", cron: "0 9 * * *", description: "Daily agent performance review at 9AM", defaultEnabled: true },
            { id: "daily-backup", label: "Daily workspace backup", cron: "0 2 * * *", description: "Nightly workspace backup at 2AM", defaultEnabled: true },
            { id: "weekly-compliance", label: "Weekly compliance audit", cron: "0 6 * * 1", description: "Monday 6AM compliance scan", defaultEnabled: true },
            { id: "weekly-telemetry", label: "Weekly telemetry sync", cron: "0 0 * * 1", description: "Monday midnight telemetry export", defaultEnabled: true },
            { id: "monthly-cert", label: "Monthly certificate renewal check", cron: "0 8 1 * *", description: "First of month cert check", defaultEnabled: false },
        ];
    }
    return [
        { id: "daily-review", label: "Daily self-review", cron: "0 9 * * *", description: "Daily agent performance review at 9AM", defaultEnabled: true },
        { id: "weekly-telemetry", label: "Weekly telemetry sync", cron: "0 0 * * 1", description: "Monday midnight telemetry export", defaultEnabled: false },
    ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Advanced Wizard State
// ──────────────────────────────────────────────────────────────────────────────

interface AdvancedWizardState {
    // Steps 1-3 (shared with basic wizard)
    profile: "individual" | "business";
    workspace: string;
    provider: string;
    apiKey: string;

    // Step 4: Model Routing
    routingStrategy: "single" | "multi" | "modality";
    roleOverrides: Record<string, string>;

    // Step 5: Guardian & Agents
    guardianModel: string;
    guardianTier: string;
    guardianAutoStart: boolean;
    swarmTopology: "mesh" | "star";

    // Step 6: CAC Identity
    cacCharacter: string;
    cacOperatorEmail: string;
    cacPrismEmail: string;
    cacOperatorId: string;
    cacWorkspaceHub: string;
    cacAssignmentId: string | null;

    // Step 7: Browser & Scheduler
    browserUseCac: boolean;
    browserEmail: string;
    browserSegment: string;
    browserProfileId: string | null;
    schedulerSelections: Record<string, boolean>;

    // Step 8: Certificate
    certificateResult: Record<string, unknown> | null;
}

interface AdvancedCliArgs {
    profile: string | null;
    workspace: string | null;
    provider: string | null;
    apiKey: string | null;
    routingStrategy: string | null;
    guardianTier: string | null;
    swarmTopology: string | null;
    cacCharacter: string | null;
    cacOperatorEmail: string | null;
    nonInteractive: boolean;
    port: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Advanced Interactive Wizard (8 Steps)
// ──────────────────────────────────────────────────────────────────────────────

export async function runAdvancedInteractive(
    args: AdvancedCliArgs,
    client: SetupApiClient | null,
): Promise<void> {
    printBanner();
    console.log(color("  Advanced Configuration (8 Steps)", ansi.magenta, ansi.bold));
    console.log("");

    const mode = client ? color("Connected", ansi.green) : color("Standalone", ansi.yellow);
    printInfo(`Mode: ${mode}`);
    console.log("");

    // Load current state for pre-filling defaults
    let currentProfile: string = args.profile || "individual";
    let currentWorkspace: string = args.workspace || "";
    if (client) {
        try {
            const status = await client.getSetupStatus();
            currentProfile = status.executionProfileSegment || "individual";
            currentWorkspace = currentWorkspace || status.workspaceRoot || "";
        } catch {
            // Fall through to defaults
        }
    }
    if (!currentWorkspace) {
        currentWorkspace = resolveWorkspaceRoot();
    }

    const state: AdvancedWizardState = {
        profile: currentProfile === "business" ? "business" : "individual",
        workspace: currentWorkspace,
        provider: args.provider || "llamacpp",
        apiKey: args.apiKey || "",

        routingStrategy: (args.routingStrategy as "single" | "multi" | "modality") || "single",
        roleOverrides: {},

        guardianModel: "",
        guardianTier: args.guardianTier || (currentProfile === "business" ? "tier2_conditional" : "tier1_autonomous"),
        guardianAutoStart: true,
        swarmTopology: (args.swarmTopology as "mesh" | "star") || (currentProfile === "business" ? "star" : "mesh"),

        cacCharacter: args.cacCharacter || "",
        cacOperatorEmail: args.cacOperatorEmail || "",
        cacPrismEmail: "",
        cacOperatorId: "",
        cacWorkspaceHub: "",
        cacAssignmentId: null,

        browserUseCac: true,
        browserEmail: "",
        browserSegment: currentProfile === "business" ? "business" : "individual",
        browserProfileId: null,
        schedulerSelections: {},

        certificateResult: null,
    };

    // ── Step 1: Execution Profile ────────────────────────────────────────────

    printStep(1, TOTAL_STEPS, "Execution Profile");
    console.log("");
    printInfo("Choose how PRISM will operate on this machine.");
    console.log("");

    const profileOptions: SelectOption[] = [
        {
            label: "Individual",
            value: "individual",
            description: "Fast defaults, maximum capability, minimal approval gates",
        },
        {
            label: "Business / Enterprise",
            value: "business",
            description: "Strict governance, approval pathways, audit trails enforced",
        },
    ];
    const defaultProfileIdx = state.profile === "business" ? 1 : 0;
    state.profile = (await select("Select execution profile:", profileOptions, defaultProfileIdx)) as "individual" | "business";

    // Apply profile-aware defaults
    if (state.profile === "business") {
        state.guardianTier = "tier2_conditional";
        state.swarmTopology = "star";
        state.browserSegment = "business";
    } else {
        state.guardianTier = "tier1_autonomous";
        state.swarmTopology = "mesh";
        state.browserSegment = "individual";
    }

    if (client) {
        try { await client.postSetupProfile(state.profile); } catch { /* best-effort */ }
    }
    printSuccess(`Profile set to ${color(state.profile, ansi.bold)}`);

    // ── Step 2: Workspace Directory ──────────────────────────────────────────

    printStep(2, TOTAL_STEPS, "Workspace Directory");
    console.log("");
    printInfo("PRISM stores all data, state, and artifacts in a persistent workspace.");
    console.log("");

    state.workspace = await prompt("Workspace path", state.workspace);

    if (!isAbsolute(state.workspace)) {
        printError("Workspace must be an absolute path.");
        process.exit(2);
    }

    if (client) {
        try {
            const result = await client.postSetupWorkspace(state.workspace);
            state.workspace = result.workspaceRoot;
        } catch (err: unknown) {
            printWarning(`Server workspace save failed: ${err instanceof Error ? err.message : String(err)}`);
            try {
                setWorkspaceRoot(state.workspace);
                ensureWorkspaceStructure(state.profile === "business" ? "prod" : "dev");
            } catch (e2: unknown) {
                printError(`Failed to create workspace: ${e2 instanceof Error ? e2.message : String(e2)}`);
                process.exit(1);
            }
        }
    } else {
        try {
            setWorkspaceRoot(state.workspace);
            ensureWorkspaceStructure(state.profile === "business" ? "prod" : "dev");
        } catch (err: unknown) {
            printError(`Failed to create workspace: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    }

    // Prerequisite checks
    console.log("");
    const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    printCheck("Node.js 22+", nodeMajor >= 22, `Node.js ${process.version} detected`);
    printCheck("Workspace directory exists", existsSync(state.workspace), state.workspace);

    if (client) {
        try {
            const prereqs = await client.getSetupPrerequisites();
            for (const check of prereqs.checks) {
                printCheck(check.label, check.passed, check.detail);
            }
        } catch { /* local checks already shown */ }
    }
    console.log("");
    printSuccess(`Workspace: ${color(state.workspace, ansi.bold)}`);

    // ── Step 3: LLM Provider ─────────────────────────────────────────────────

    printStep(3, TOTAL_STEPS, "LLM Provider");
    console.log("");
    printInfo("Select your primary language model provider.");
    console.log("");

    const providerOptions: SelectOption[] = PROVIDERS.map((p) => ({
        label: p.label,
        value: p.id,
        description: `${p.description}${p.needsKey ? "" : " (no API key needed)"}`,
    }));
    const defaultProviderIdx = Math.max(0, PROVIDERS.findIndex((p) => p.id === state.provider));
    state.provider = await select("Select provider:", providerOptions, defaultProviderIdx);

    const selectedProvider = PROVIDERS.find((p) => p.id === state.provider)!;

    if (selectedProvider.needsKey) {
        if (!state.apiKey) {
            console.log("");
            state.apiKey = await maskedInput(`Enter ${selectedProvider.label} API key`);
        }
        if (state.apiKey && client) {
            try {
                await client.postProviderKey(state.provider, state.apiKey);
                printSuccess("API key saved");
            } catch (err: unknown) {
                printWarning(`Could not save API key: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // Provider connectivity test
    if (client) {
        const spin = spinner(`Testing ${selectedProvider.label} connectivity...`);
        try {
            const test = await client.postProviderTest(state.provider);
            if (test.ok) {
                const latency = test.latencyMs ? ` (${test.latencyMs}ms)` : "";
                const models = test.models.length > 0 ? ` — ${test.models.length} model(s) available` : "";
                spin.stop(color(`${sym.check} ${selectedProvider.label} reachable${latency}${models}`, ansi.green));
            } else {
                spin.stop(color(`${sym.cross} ${selectedProvider.label}: ${test.message}`, ansi.yellow));
                printWarning("Provider test failed. You can reconfigure later from the dashboard.");
            }
        } catch {
            spin.stop(color(`${sym.cross} Could not test provider`, ansi.yellow));
        }
    } else {
        printInfo("Provider test skipped (standalone mode).");
    }

    console.log("");
    printSuccess(`Provider: ${color(selectedProvider.label, ansi.bold)}`);

    // ── Step 4: Model Routing Strategy ───────────────────────────────────────

    printStep(4, TOTAL_STEPS, "Model Routing");
    console.log("");
    printInfo("Configure how PRISM routes prompts to models by role.");
    console.log("");

    const strategyOptions: SelectOption[] = [
        { label: "Single Model", value: "single", description: "All roles use the same model (simplest)" },
        { label: "Multi-Model", value: "multi", description: "Assign different models to different roles" },
        { label: "Modality-Aware", value: "modality", description: "Route by content type (text, vision, code)" },
    ];
    state.routingStrategy = (await select("Select routing strategy:", strategyOptions, 0)) as "single" | "multi" | "modality";

    if (state.routingStrategy !== "single") {
        // Fetch AI-suggested routing if available
        let suggestions: Record<string, string> = {};
        if (client) {
            try {
                const data = await client.getRoutingSuggestions();
                suggestions = data.suggestions || {};
            } catch { /* no suggestions available */ }
        }

        console.log("");
        printInfo("Assign models to roles (press Enter to keep default):");
        console.log("");

        for (const role of ROUTING_ROLES) {
            const suggestion = suggestions[role] || "";
            const defaultHint = suggestion || "default";
            const answer = await prompt(`  ${role}`, defaultHint);
            if (answer && answer !== "default" && answer !== defaultHint) {
                state.roleOverrides[role] = answer;
            } else if (suggestion) {
                state.roleOverrides[role] = suggestion;
            }
        }

        if (Object.keys(suggestions).length > 0) {
            const acceptAll = await confirm("Accept all AI-suggested assignments?", true);
            if (acceptAll) {
                for (const [role, model] of Object.entries(suggestions)) {
                    state.roleOverrides[role] = model;
                }
            }
        }
    }

    // Save routing config
    if (client && state.routingStrategy !== "single") {
        try {
            await client.postRouting(state.routingStrategy, state.roleOverrides);
            printSuccess("Routing configuration saved");
        } catch (err: unknown) {
            printWarning(`Could not save routing config: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const overrideCount = Object.keys(state.roleOverrides).length;
    printSuccess(`Routing: ${color(state.routingStrategy, ansi.bold)}${overrideCount > 0 ? ` (${overrideCount} role override(s))` : ""}`);

    // ── Step 5: Guardian Agent & Swarm ───────────────────────────────────────

    printStep(5, TOTAL_STEPS, "Guardian Agent & Swarm");
    console.log("");
    printInfo("Configure the local guardian agent for governance oversight.");
    console.log("");

    // Load GGUF models
    let availableModels: Array<{ name: string; path: string }> = [];
    if (client) {
        const spin = spinner("Loading available GGUF models...");
        try {
            const data = await client.getGgufModels();
            availableModels = data.models || [];
            spin.stop(color(`${sym.check} Found ${availableModels.length} model(s)`, ansi.green));
        } catch {
            spin.stop(color(`${sym.cross} Could not load models`, ansi.yellow));
        }
    }

    if (availableModels.length > 0) {
        const modelOptions: SelectOption[] = [
            { label: "None (skip guardian)", value: "", description: "Configure later from dashboard" },
            ...availableModels.map((m) => ({
                label: m.name,
                value: m.path,
                description: m.path.split(/[/\\]/).pop() || "",
            })),
        ];
        state.guardianModel = await select("Select guardian model:", modelOptions, 0);
    } else {
        printInfo("No GGUF models found. Guardian can be configured later from the dashboard.");
        state.guardianModel = "";
    }

    if (state.guardianModel) {
        // Authority tier
        console.log("");
        const tierOptions: SelectOption[] = [
            { label: "Tier 1 — Autonomous", value: "tier1_autonomous", description: "Agent acts independently, minimal oversight" },
            { label: "Tier 2 — Conditional", value: "tier2_conditional", description: "Requires approval for sensitive operations" },
            { label: "Tier 3 — Supervised", value: "tier3_supervised", description: "All operations require explicit approval" },
        ];
        const defaultTierIdx = state.guardianTier === "tier2_conditional" ? 1 : state.guardianTier === "tier3_supervised" ? 2 : 0;
        state.guardianTier = await select("Select authority tier:", tierOptions, defaultTierIdx);

        // Auto-start
        state.guardianAutoStart = await confirm("Auto-start guardian on launch?", true);
    }

    // Swarm topology
    console.log("");
    const topoOptions: SelectOption[] = [
        { label: "Mesh", value: "mesh", description: "Peer-to-peer agent communication (flexible)" },
        { label: "Star", value: "star", description: "Centralized hub coordination (controlled)" },
    ];
    const defaultTopoIdx = state.swarmTopology === "star" ? 1 : 0;
    state.swarmTopology = (await select("Default swarm topology:", topoOptions, defaultTopoIdx)) as "mesh" | "star";

    // Save guardian config
    if (client && state.guardianModel) {
        try {
            await client.postGuardianConfigure({
                modelPath: state.guardianModel,
                authorityTier: state.guardianTier,
                autoStart: state.guardianAutoStart,
            });
            printSuccess("Guardian configuration saved");
        } catch (err: unknown) {
            printWarning(`Could not save guardian config: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const guardianLabel = state.guardianModel
        ? `${state.guardianTier} — ${state.guardianModel.split(/[/\\]/).pop()}`
        : "Not configured";
    printSuccess(`Guardian: ${color(guardianLabel, ansi.bold)}`);
    printSuccess(`Swarm topology: ${color(state.swarmTopology, ansi.bold)}`);

    // ── Step 6: CAC Identity Binding ─────────────────────────────────────────

    printStep(6, TOTAL_STEPS, "Character Assignment Control (CAC)");
    console.log("");
    printInfo("Bind a character identity to establish the operator accountability chain.");
    console.log("");

    // Load available characters
    let availableCharacters: Array<{ id?: string; characterId?: string; name?: string; displayName?: string; executionProfile?: string }> = [];
    if (client) {
        try {
            const data = await client.getWorkspaceCharacters();
            availableCharacters = data.characters || [];
        } catch { /* no characters available */ }
    }

    const filteredCharacters = availableCharacters.filter((c) => {
        if (!c.executionProfile) return true;
        return c.executionProfile === state.profile;
    });

    if (filteredCharacters.length > 0) {
        const charOptions: SelectOption[] = [
            { label: "Skip (configure later)", value: "", description: "No character assignment now" },
            ...filteredCharacters.map((c) => {
                const cid = c.id || c.characterId || "";
                const icon = cid.startsWith("aria") ? "\u{1F916}"
                    : cid.startsWith("phoenix") ? "\u{1F985}"
                        : cid.startsWith("sentinel") ? "\u{1F6E1}" : "\u{1F464}";
                return {
                    label: `${icon} ${c.displayName || c.name || cid || "Unknown"}`,
                    value: cid,
                    description: c.executionProfile ? `(${c.executionProfile})` : "",
                };
            }),
        ];
        state.cacCharacter = await select("Select character:", charOptions, 0);
    } else {
        printInfo("No characters found in workspace. CAC assignment can be configured later.");
    }

    if (state.cacCharacter) {
        console.log("");
        let opPassword = "";
        while (true) {
            const opEmail = await prompt("Operator email");
            const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(opEmail);
            if (isPlaceholder) {
                printError("Placeholder operator email is not allowed. Please enter a real email.");
                continue;
            }
            state.cacOperatorEmail = opEmail;
            break;
        }
        while (true) {
            opPassword = await maskedInput("Operator password (for console login)");
            if (!opPassword) {
                printError("Password is required.");
                continue;
            }
            if (opPassword.length < 4) {
                printError("Password must be at least 4 characters long.");
                continue;
            }
            break;
        }
        state.cacPrismEmail = await prompt("PRISM user email (optional)", "");
        state.cacOperatorId = await prompt("Operator ID (optional)", "");
        state.cacWorkspaceHub = await prompt(
            `Workspace hub${state.profile === "business" ? " (required for business)" : " (optional)"}`,
            "",
        );

        // Business profile requires hub
        if (state.profile === "business" && !state.cacWorkspaceHub) {
            printWarning("Business profiles require a workspace hub for accountability.");
        }

        // Create CAC assignment
        if (client && state.cacOperatorEmail) {
            const spin = spinner("Creating CAC assignment...");
            try {
                const result = await client.postCharacterAssign({
                    characterId: state.cacCharacter,
                    operatorEmail: state.cacOperatorEmail,
                    prismUserEmail: state.cacPrismEmail || undefined,
                    operatorId: state.cacOperatorId || undefined,
                    executionProfile: state.profile,
                    workspaceHub: state.cacWorkspaceHub || undefined,
                    operatorPassword: opPassword,
                });
                state.cacAssignmentId = result.assignment?.assignmentId || null;
                if (state.cacAssignmentId) {
                    spin.stop(color(`${sym.check} Assignment created: ${state.cacAssignmentId}`, ansi.green));
                } else {
                    spin.stop(color(`${sym.check} Assignment submitted`, ansi.green));
                }
            } catch (err: unknown) {
                spin.stop(color(`${sym.cross} Assignment failed`, ansi.red));
                printWarning(err instanceof Error ? err.message : String(err));
            }
        }
    }

    const cacLabel = state.cacCharacter
        ? `${state.cacCharacter} ${sym.arrow} ${state.cacOperatorEmail}`
        : "Not configured";
    printSuccess(`CAC: ${color(cacLabel, ansi.bold)}`);

    // ── Step 7: Browser Profile & Scheduler ──────────────────────────────────

    printStep(7, TOTAL_STEPS, "Browser Profile & Scheduler");
    console.log("");
    printInfo("Pre-configure browser automation profile and scheduled tasks.");
    console.log("");

    // Browser profile
    console.log(color("  Browser Profile", ansi.bold));
    console.log("");

    if (state.cacOperatorEmail) {
        state.browserUseCac = await confirm("Use CAC operator email for browser profile?", true);
    } else {
        state.browserUseCac = false;
    }

    if (state.browserUseCac) {
        state.browserEmail = state.cacOperatorEmail;
        state.browserSegment = state.profile;
        printInfo(`Using CAC email: ${state.browserEmail} (${state.browserSegment})`);
    } else {
        while (true) {
            const email = await prompt("Browser profile email (optional)", "");
            if (email) {
                const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(email);
                if (isPlaceholder) {
                    printError("Placeholder browser email is not allowed. Please enter a real email.");
                    continue;
                }
            }
            state.browserEmail = email;
            break;
        }
        if (state.browserEmail) {
            const segOptions: SelectOption[] = [
                { label: "Individual", value: "individual" },
                { label: "Business", value: "business" },
            ];
            state.browserSegment = await select("Browser segment:", segOptions, state.profile === "business" ? 1 : 0);
        }
    }

    // Create browser profile
    if (client && state.browserEmail) {
        try {
            const result = await client.postBrowserProfile(state.browserEmail, state.browserSegment);
            state.browserProfileId = result.profile?.profileId || result.profileId || result.id || null;
            if (state.browserProfileId) {
                printSuccess(`Browser profile created: ${state.browserProfileId}`);
            }
        } catch (err: unknown) {
            printWarning(`Browser profile creation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Scheduler
    console.log("");
    console.log(color("  Scheduled Tasks", ansi.bold));
    console.log("");

    const suggestions = getSchedulerSuggestions(state.profile);

    // Initialize defaults
    for (const s of suggestions) {
        state.schedulerSelections[s.id] = s.defaultEnabled;
    }

    printInfo("Toggle scheduled tasks (Enter to accept defaults):");
    console.log("");

    for (const s of suggestions) {
        const defaultLabel = s.defaultEnabled ? "enabled" : "disabled";
        const answer = await confirm(
            `  ${s.label} — ${color(s.cron, ansi.gray)} (${color(defaultLabel, s.defaultEnabled ? ansi.green : ansi.gray)})`,
            s.defaultEnabled,
        );
        state.schedulerSelections[s.id] = answer;
    }

    // Create scheduled jobs
    if (client) {
        let createdCount = 0;
        for (const s of suggestions) {
            if (state.schedulerSelections[s.id]) {
                try {
                    await client.postSchedulerCron(s.label, s.cron, s.id);
                    createdCount++;
                } catch { /* best-effort */ }
            }
        }
        if (createdCount > 0) {
            printSuccess(`${createdCount} scheduled task(s) created`);
        }
    }

    const enabledTasks = Object.values(state.schedulerSelections).filter(Boolean).length;
    printSuccess(`Scheduler: ${color(`${enabledTasks} task(s) enabled`, ansi.bold)}`);

    // ── Step 8: Summary & Initialization Certificate ─────────────────────────

    printStep(8, TOTAL_STEPS, "Summary & Initialization Certificate");
    console.log("");

    // Save final configuration to server
    if (client) {
        const spin = spinner("Finalizing configuration...");
        try {
            // Ensure profile and workspace are saved
            await client.postSetupProfile(state.profile);
            if (state.workspace) {
                await client.postSetupWorkspace(state.workspace);
            }

            // Mark setup complete
            const result = await client.postSetupComplete();
            spin.stop(color(`${sym.check} Setup finalized`, ansi.green));
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Server finalization failed`, ansi.red));
            printWarning(err instanceof Error ? err.message : String(err));
        }
    } else {
        writePreferences({
            executionProfileSegment: state.profile,
            setupComplete: true,
        });
    }

    // Run readiness check
    let readiness: ReadinessSnapshot | null = null;
    if (client) {
        try {
            readiness = await client.postReadinessRecheck("setup_wizard_advanced_cli");
        } catch { /* best-effort */ }
    }

    // Build and display the initialization certificate
    const certificate = buildCertificate(state, readiness);

    // Submit certificate to server
    if (client) {
        try {
            const certResult = await client.postInitializationSession(certificate);
            state.certificateResult = certResult;
        } catch { /* best-effort */ }
    }

    // Display full summary
    printAdvancedSummary(state, readiness);

    // Display certificate
    console.log("");
    console.log(color("  ╔══════════════════════════════════════╗", ansi.magenta, ansi.bold));
    console.log(color("  ║    Initialization Certificate        ║", ansi.magenta, ansi.bold));
    console.log(color("  ╚══════════════════════════════════════╝", ansi.magenta, ansi.bold));
    console.log("");
    printCheck("Profile", true, `${state.profile} (${state.profile === "business" ? "strict governance" : "minimal governance"})`);
    printCheck("Workspace", true, state.workspace);
    printCheck("Provider", true, `${selectedProvider.label}${state.apiKey ? " (key configured)" : ""}`);
    printCheck("Routing", true, `${state.routingStrategy}${overrideCount > 0 ? ` — ${overrideCount} overrides` : ""}`);
    printCheck("Guardian", !!state.guardianModel, guardianLabel);
    printCheck("Swarm", true, state.swarmTopology);
    printCheck("CAC", !!state.cacAssignmentId, cacLabel);
    printCheck("Browser", !!state.browserProfileId, state.browserEmail ? `${state.browserEmail} (${state.browserSegment})` : "Not configured");
    printCheck("Scheduler", true, `${enabledTasks} task(s)`);
    printCheck("Timestamp", true, new Date().toISOString());

    if (state.certificateResult) {
        console.log("");
        printSuccess("Certificate stored in session.");
    }

    // Final message
    console.log("");
    printSuccess("PRISM Advanced Setup Complete!");
    if (client) {
        printInfo(`Open http://localhost:${args.port}/dashboard to access the PRISM Dashboard.`);
    } else {
        printInfo("Run 'npm start' or 'start_web.bat' to launch the PRISM server.");
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// Non-Interactive Advanced Mode
// ──────────────────────────────────────────────────────────────────────────────

export async function runAdvancedNonInteractive(
    args: AdvancedCliArgs,
    client: SetupApiClient | null,
): Promise<void> {
    const profile = args.profile?.toLowerCase();
    if (profile !== "individual" && profile !== "business") {
        printError("--profile is required in non-interactive mode (individual or business).");
        process.exit(2);
    }

    const workspace = args.workspace || resolveWorkspaceRoot();
    const provider = args.provider || "llamacpp";
    const validProvider = PROVIDERS.find((p) => p.id === provider);
    if (!validProvider) {
        printError(`Unknown provider: ${provider}. Valid: ${PROVIDERS.map((p) => p.id).join(", ")}`);
        process.exit(2);
    }

    printBanner();
    console.log(color("  Running advanced wizard in non-interactive mode...", ansi.gray));
    console.log("");

    if (client) {
        const spin = spinner("Configuring via PRISM server...");
        try {
            await client.postSetupProfile(profile);
            await client.postSetupWorkspace(workspace);
            if (args.apiKey && validProvider.needsKey) {
                await client.postProviderKey(provider, args.apiKey);
            }
            if (args.routingStrategy && args.routingStrategy !== "single") {
                await client.postRouting(args.routingStrategy, {});
            }
            if (args.guardianTier) {
                // Guardian model must be specified separately; just save tier preference
            }
            if (args.cacCharacter && args.cacOperatorEmail) {
                const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(args.cacOperatorEmail);
                if (isPlaceholder) {
                    printError("Placeholder operator email is not allowed. Please enter a real email.");
                    process.exit(2);
                }
                await client.postCharacterAssign({
                    characterId: args.cacCharacter,
                    operatorEmail: args.cacOperatorEmail,
                    executionProfile: profile,
                });
            }
            const result = await client.postSetupComplete();
            spin.stop(color(`${sym.check} Advanced setup complete via server`, ansi.green));
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Server configuration failed`, ansi.red));
            printError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    } else {
        writePreferences({
            executionProfileSegment: profile,
            setupComplete: true,
        });
        if (workspace) {
            setWorkspaceRoot(workspace);
        }
        ensureWorkspaceStructure(profile === "business" ? "prod" : "dev");
        printSuccess("Configuration saved (standalone mode).");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Certificate Builder
// ──────────────────────────────────────────────────────────────────────────────

function buildCertificate(
    state: AdvancedWizardState,
    readiness: ReadinessSnapshot | null,
): Record<string, unknown> {
    return {
        profile: {
            segment: state.profile,
            governance: state.profile === "business" ? "strict" : "minimal",
        },
        workspace: {
            path: state.workspace || "default",
        },
        provider: {
            primary: state.provider,
            hasApiKey: !!state.apiKey,
        },
        routing: {
            strategy: state.routingStrategy,
            roleOverrides: Object.keys(state.roleOverrides).length > 0 ? state.roleOverrides : "none",
        },
        guardian: {
            model: state.guardianModel || "not configured",
            authorityTier: state.guardianTier,
            autoStart: state.guardianAutoStart,
        },
        agents: {
            defaultSwarmTopology: state.swarmTopology,
        },
        cac: {
            character: state.cacCharacter || "not assigned",
            operatorEmail: state.cacOperatorEmail || "not set",
            prismUserEmail: state.cacPrismEmail || "not set",
            assignmentId: state.cacAssignmentId || "pending",
            workspaceHub: state.cacWorkspaceHub || "not set",
        },
        browserProfile: {
            email: state.browserUseCac ? state.cacOperatorEmail : state.browserEmail || "not set",
            segment: state.browserSegment,
            profileId: state.browserProfileId || "pending",
        },
        scheduler: {
            enabledTasks: Object.entries(state.schedulerSelections)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(", ") || "none",
        },
        readiness: {
            timestamp: new Date().toISOString(),
            ready: readiness?.ready ?? false,
        },
        source: "cli",
        version: "advanced-v1",
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary Display
// ──────────────────────────────────────────────────────────────────────────────

function printAdvancedSummary(
    state: AdvancedWizardState,
    readiness: ReadinessSnapshot | null,
): void {
    console.log("");
    console.log(color("  ╔══════════════════════════════════════╗", ansi.cyan));
    console.log(color("  ║      Advanced Configuration Summary  ║", ansi.cyan));
    console.log(color("  ╚══════════════════════════════════════╝", ansi.cyan));
    console.log("");

    printCheck("Execution Profile", true, state.profile);
    printCheck("Workspace Directory", true, state.workspace);
    printCheck("LLM Provider", true, state.provider);
    if (state.apiKey) {
        printCheck("API Key", true, "configured (masked)");
    }
    printCheck("Routing Strategy", true, state.routingStrategy);
    if (Object.keys(state.roleOverrides).length > 0) {
        printCheck("Role Overrides", true, `${Object.keys(state.roleOverrides).length} configured`);
    }
    printCheck("Guardian Agent", !!state.guardianModel, state.guardianModel
        ? `${state.guardianTier} — ${state.guardianModel.split(/[/\\]/).pop()}`
        : "Not configured");
    printCheck("Auto-Start", state.guardianAutoStart, state.guardianAutoStart ? "enabled" : "disabled");
    printCheck("Swarm Topology", true, state.swarmTopology);
    printCheck("CAC Character", !!state.cacCharacter, state.cacCharacter || "Not assigned");
    if (state.cacOperatorEmail) {
        printCheck("Operator Email", true, state.cacOperatorEmail);
    }
    if (state.cacAssignmentId) {
        printCheck("Assignment ID", true, state.cacAssignmentId);
    }
    printCheck("Browser Profile", !!state.browserProfileId, state.browserEmail
        ? `${state.browserEmail} (${state.browserSegment})`
        : "Not configured");

    const enabledCount = Object.values(state.schedulerSelections).filter(Boolean).length;
    printCheck("Scheduled Tasks", enabledCount > 0, `${enabledCount} enabled`);

    if (readiness) {
        console.log("");
        console.log(color("  Readiness Checks:", ansi.bold));
        const reqs = readiness.requirements;
        if (Array.isArray(reqs)) {
            for (const req of reqs) {
                printCheck(req.label, req.passed, req.detail);
            }
        }
        const recommendations = readiness.recommendations;
        if (Array.isArray(recommendations) && recommendations.length > 0) {
            console.log("");
            console.log(color("  Recommendations:", ansi.bold));
            for (const rec of recommendations) {
                printInfo(String(rec));
            }
        }
    }
}
