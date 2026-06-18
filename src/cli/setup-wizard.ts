#!/usr/bin/env node
/**
 * PRISM CLI Setup Wizard — Pure Node.js readline-based interactive setup.
 *
 * Supports three operating modes:
 *   1. Connected (default): Uses /api/setup/* endpoints when PRISM server is running.
 *   2. Standalone (--standalone or auto-detected if server unreachable):
 *      Imports workspace-resolver.ts directly. No server required.
 *   3. Non-interactive (--non-interactive): Reads all config from CLI flags/env vars.
 *
 * Usage:
 *   npx tsx src/cli/setup-wizard.ts                              # Interactive (auto-detect server)
 *   npx tsx src/cli/setup-wizard.ts --standalone                 # Standalone (no server needed)
 *   npx tsx src/cli/setup-wizard.ts --non-interactive \
 *       --profile individual --provider ollama                   # Non-interactive
 *
 * Exit codes: 0 = success, 1 = failure, 2 = cancelled / missing required args
 */

import { SetupApiClient, type ReadinessSnapshot } from "./api-client.js";
import { runAdvancedInteractive, runAdvancedNonInteractive } from "./setup-wizard-advanced.js";
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
    seedDefaultCharacters,
    workspacePath,
} from "../core/config/workspace-resolver.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// ──────────────────────────────────────────────────────────────────────────────
// Provider definitions (matches web wizard + TUI wizard)
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ──────────────────────────────────────────────────────────────────────────────

interface CliArgs {
    nonInteractive: boolean;
    standalone: boolean;
    advanced: boolean;
    profile: string | null;
    workspace: string | null;
    provider: string | null;
    apiKey: string | null;
    port: number;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        nonInteractive: false,
        standalone: false,
        advanced: false,
        profile: null,
        workspace: null,
        provider: null,
        apiKey: null,
        port: parseInt(process.env.PRISM_DASHBOARD_PORT || "7070", 10),
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--non-interactive":
            case "--noninteractive":
                args.nonInteractive = true;
                break;
            case "--standalone":
                args.standalone = true;
                break;
            case "--advanced":
                args.advanced = true;
                break;
            case "--profile":
                args.profile = argv[++i] ?? null;
                break;
            case "--workspace":
                args.workspace = argv[++i] ?? null;
                break;
            case "--provider":
                args.provider = argv[++i] ?? null;
                break;
            case "--api-key":
                args.apiKey = argv[++i] ?? null;
                break;
            case "--port":
                args.port = parseInt(argv[++i] ?? "7070", 10);
                break;
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
                break;
            default:
                if (arg.startsWith("--")) {
                    printError(`Unknown flag: ${arg}`);
                    printUsage();
                    process.exit(2);
                }
        }
    }

    // Also read from environment variables (CLI flags take precedence)
    if (!args.profile) args.profile = process.env.PRISM_ENV_PROFILE || null;
    if (!args.workspace) args.workspace = process.env.PRISM_WORKSPACE_ROOT || null;
    if (!args.provider) args.provider = process.env.PRISM_LLM_PROVIDER || null;

    return args;
}

function printUsage(): void {
    console.log(`
  ${color("PRISM CLI Setup Wizard", ansi.cyan, ansi.bold)}

  ${color("Usage:", ansi.bold)}
    npx tsx src/cli/setup-wizard.ts [options]
    npm run setup [-- options]

  ${color("Options:", ansi.bold)}
    --profile <individual|business>  Execution profile
    --workspace <path>               Workspace root directory
    --provider <id>                  LLM provider (ollama, openai, anthropic, ...)
    --api-key <key>                  API key for cloud providers
    --port <number>                  Server port (default: 7070)
    --non-interactive                Skip prompts; use flags and env vars
    --standalone                     Run without PRISM server
    --advanced                       8-step advanced wizard (routing, guardian, CAC, scheduler)
    --help, -h                       Show this help

  ${color("Environment Variables:", ansi.bold)}
    PRISM_ENV_PROFILE                Execution profile (individual|business)
    PRISM_WORKSPACE_ROOT             Workspace root directory
    PRISM_LLM_PROVIDER               Default LLM provider
    PRISM_DASHBOARD_PORT             Server port (default: 7070)

  ${color("Exit Codes:", ansi.bold)}
    0  Success
    1  Failure
    2  Cancelled or missing required arguments
`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Wizard State
// ──────────────────────────────────────────────────────────────────────────────

interface WizardState {
    profile: "individual" | "business";
    workspace: string;
    characterId: string;
    operatorEmail: string;
    assistantEmail: string;
    provider: string;
    apiKey: string;
    guardianModel: string;
    guardianTier: string;
    guardianAutoStart: boolean;
    cacAssignmentId: string | null;
}

function getLocalCharacters(profile: string) {
    try {
        seedDefaultCharacters();
        const dir = workspacePath("characters");
        if (!existsSync(dir)) {
            return getFallbackCharacters(profile);
        }
        const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith(".json"));
        const list = [];
        for (const file of files) {
            try {
                const content = JSON.parse(readFileSync(join(dir, file), "utf-8"));
                const id = file.replace(/\.json$/i, "");
                if (content.executionProfile && content.executionProfile !== profile) {
                    continue;
                }
                list.push({
                    id,
                    displayName: content.displayName || content.name || id,
                    persona: content.persona || "",
                });
            } catch {}
        }
        return list.length > 0 ? list : getFallbackCharacters(profile);
    } catch {
        return getFallbackCharacters(profile);
    }
}

function getFallbackCharacters(profile: string) {
    if (profile === "business") {
        return [
            { id: "sentinel-business", displayName: "Sentinel", persona: "Strict guard and validator." },
            { id: "aria-business", displayName: "Aria", persona: "Helpful business assistant." },
            { id: "phoenix-business", displayName: "Phoenix", persona: "Autonomous task solver." },
        ];
    } else {
        return [
            { id: "aria-individual", displayName: "Aria", persona: "Fast personal assistant." },
            { id: "phoenix-individual", displayName: "Phoenix", persona: "Autonomous task solver." },
            { id: "sentinel-individual", displayName: "Sentinel", persona: "Oversight and validation." },
        ];
    }
}

function buildCertificate(state: WizardState): Record<string, unknown> {
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
            strategy: "single",
            roleOverrides: "none",
        },
        guardian: {
            model: state.guardianModel || "not configured",
            authorityTier: state.guardianTier || (state.profile === "business" ? "tier2_conditional" : "tier1_autonomous"),
            autoStart: state.guardianAutoStart,
        },
        agents: {
            defaultSwarmTopology: state.profile === "business" ? "star" : "mesh",
        },
        cac: {
            character: state.characterId || "not assigned",
            operatorEmail: state.operatorEmail || "not set",
            prismUserEmail: state.assistantEmail || "not set",
            assignmentId: state.cacAssignmentId || "pending",
            workspaceHub: "default",
        },
        browserProfile: {
            email: state.operatorEmail || "not set",
            segment: state.profile,
            profileId: "pending",
        },
        scheduler: {
            enabledTasks: state.profile === "business" ? "daily-review, daily-backup, weekly-compliance, weekly-telemetry" : "daily-review",
        },
        readiness: {
            timestamp: new Date().toISOString(),
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Non-Interactive Mode
// ──────────────────────────────────────────────────────────────────────────────

async function runNonInteractive(args: CliArgs, client: SetupApiClient | null): Promise<void> {
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
    if (validProvider.needsKey && !args.apiKey) {
        printWarning(`Provider '${provider}' requires an API key. Use --api-key or set the provider-specific env var.`);
    }

    const characterId = profile === "business" ? "sentinel-business" : "aria-individual";
    const operatorEmail = "operator@yourcompany.com";
    const assistantEmail = `${characterId}@yourcompany.com`;

    const state: WizardState = {
        profile: profile as "individual" | "business",
        workspace,
        characterId,
        operatorEmail,
        assistantEmail,
        provider,
        apiKey: args.apiKey || "",
        guardianModel: "",
        guardianTier: profile === "business" ? "tier2_conditional" : "tier1_autonomous",
        guardianAutoStart: true,
        cacAssignmentId: null,
    };

    printBanner();
    console.log(color("  Running in non-interactive mode...", ansi.gray));
    console.log("");

    if (client) {
        // Connected mode: use API endpoints
        const spin = spinner("Configuring via PRISM server...");
        try {
            await client.postSetupProfile(profile);
            await client.postSetupWorkspace(workspace);
            await client.postSetupCharacter(characterId);
            const cacRes = await client.postSetupCac({
                characterId,
                operatorEmail,
                assistantEmail,
            });
            state.cacAssignmentId = cacRes.cacAssignmentId || null;
            if (args.apiKey && validProvider.needsKey) {
                await client.postProviderKey(provider, args.apiKey);
            }
            const certificate = buildCertificate(state);
            await client.postInitializationSession(certificate);

            const result = await client.postSetupComplete();
            spin.stop(color(`${sym.check} Setup complete via server`, ansi.green));
            printSummary(state, result.readiness);
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Server configuration failed`, ansi.red));
            printError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    } else {
        // Standalone mode: write preferences directly
        const spin = spinner("Writing configuration...");
        try {
            writePreferences({
                executionProfileSegment: profile,
                defaultCharacterId: characterId,
                lastUsedCharacterId: characterId,
                setupComplete: true,
            });
            if (workspace) {
                setWorkspaceRoot(workspace);
            }
            ensureWorkspaceStructure(profile === "business" ? "prod" : "dev");
            spin.stop(color(`${sym.check} Configuration saved`, ansi.green));
            printSummary(state, null);
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Configuration failed`, ansi.red));
            printError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Interactive Mode (4-Step Wizard)
// ──────────────────────────────────────────────────────────────────────────────

async function runInteractive(args: CliArgs, client: SetupApiClient | null): Promise<void> {
    printBanner();

    const mode = client ? color("Connected", ansi.green) : color("Standalone", ansi.yellow);
    printInfo(`Mode: ${mode}`);
    console.log("");

    // Load current state (pre-fill defaults)
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

    const state: WizardState = {
        profile: currentProfile === "business" ? "business" : "individual",
        workspace: currentWorkspace,
        characterId: "",
        operatorEmail: "",
        assistantEmail: "",
        provider: args.provider || "llamacpp",
        apiKey: args.apiKey || "",
        guardianModel: "",
        guardianTier: "",
        guardianAutoStart: true,
        cacAssignmentId: null,
    };

    const TOTAL_STEPS = 5;

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

    if (client) {
        try {
            await client.postSetupProfile(state.profile);
        } catch (err: unknown) {
            printWarning(`Could not save profile to server: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    printSuccess(`Profile set to ${color(state.profile, ansi.bold)}`);

    // ── Step 2: Workspace Directory ──────────────────────────────────────────

    printStep(2, TOTAL_STEPS, "Workspace Directory");
    console.log("");
    printInfo("PRISM stores all data, state, and artifacts in a persistent workspace.");
    console.log("");

    while (true) {
        state.workspace = await prompt("Workspace path", state.workspace);

        if (!isAbsolute(state.workspace)) {
            printError("Workspace must be an absolute path.");
            continue;
        }

        let passed = true;
        if (client) {
            const spin = spinner("Validating workspace via server...");
            try {
                await client.postSetupWorkspace(state.workspace);
                const prereqs = await client.getSetupPrerequisites();
                spin.stop(color(`${sym.check} Workspace configured`, ansi.green));
                console.log("");
                for (const check of prereqs.checks) {
                    printCheck(check.label, check.passed, check.detail);
                    if (!check.passed) passed = false;
                }
                console.log("");
            } catch (err: unknown) {
                spin.stop(color(`${sym.cross} Workspace validation failed`, ansi.red));
                printError(err instanceof Error ? err.message : String(err));
                passed = false;
            }
        } else {
            // Local checks
            const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
            const nodePassed = nodeMajor >= 22;
            const dirExists = existsSync(state.workspace);
            console.log("");
            printCheck("Node.js 22+", nodePassed, `Node.js ${process.version} detected`);
            printCheck("Workspace directory exists", dirExists, state.workspace);
            console.log("");
            if (!nodePassed || !dirExists) {
                passed = false;
            }
            if (passed) {
                try {
                    setWorkspaceRoot(state.workspace);
                    ensureWorkspaceStructure(state.profile === "business" ? "prod" : "dev");
                } catch (err: unknown) {
                    printError(`Failed to create workspace structure: ${err instanceof Error ? err.message : String(err)}`);
                    passed = false;
                }
            }
        }

        if (passed) {
            break;
        } else {
            printError("Workspace prerequisites not satisfied. Please correct or enter a valid absolute path.");
        }
    }
    printSuccess(`Workspace: ${color(state.workspace, ansi.bold)}`);

    // ── Step 3: Choose First Assistant ───────────────────────────────────────

    printStep(3, TOTAL_STEPS, "Choose First Assistant");
    console.log("");
    printInfo("Select the first character identity for your PRISM assistant.");
    console.log("");

    let characters: any[] = [];
    if (client) {
        const spin = spinner("Loading workspace characters...");
        try {
            const data = await client.getWorkspaceCharacters();
            characters = (data.characters || []).filter(c => !c.executionProfile || c.executionProfile === state.profile);
            spin.stop(color(`${sym.check} Loaded ${characters.length} character(s)`, ansi.green));
        } catch {
            spin.stop(color(`${sym.cross} Failed to load characters from server`, ansi.yellow));
        }
    }
    if (characters.length === 0) {
        characters = getLocalCharacters(state.profile);
    }

    const charOptions = characters.map((c) => ({
        label: c.displayName || c.name || c.id,
        value: c.id,
        description: c.persona || "",
    }));

    state.characterId = await select("Select character:", charOptions, 0);

    if (client) {
        try {
            await client.postSetupCharacter(state.characterId);
        } catch (err: unknown) {
            printWarning(`Could not save character to server: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    printSuccess(`Selected Assistant: ${color(state.characterId, ansi.bold)}`);

    // ── Step 4: Identity & First Session ─────────────────────────────────────

    printStep(4, TOTAL_STEPS, "Identity & First Session");
    console.log("");
    printInfo("Establish your Character Assignment Control (CAC) identity.");
    console.log("");

    while (true) {
        const opEmail = await prompt("Operator email (human accountable for decisions)", state.operatorEmail || "operator@yourcompany.com");
        
        // Block placeholder email domains
        const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(opEmail);
        if (isPlaceholder) {
            printError("Placeholder operator email is not allowed. Please enter a real email.");
            continue;
        }

        const opPassword = await maskedInput("Operator password (for console login)");
        if (!opPassword) {
            printError("Password is required.");
            continue;
        }
        if (opPassword.length < 4) {
            printError("Password must be at least 4 characters long.");
            continue;
        }

        const defaultAssistantEmail = `${state.characterId}@yourcompany.com`;
        const asEmail = await prompt("Assistant email (character identity)", state.assistantEmail || defaultAssistantEmail);

        if (client) {
            const spin = spinner("Initializing Character Accountability Chain (CAC)...");
            try {
                const res = await client.postSetupCac({
                    characterId: state.characterId,
                    operatorEmail: opEmail,
                    assistantEmail: asEmail,
                    operatorPassword: opPassword,
                });
                state.cacAssignmentId = res.cacAssignmentId || null;
                state.operatorEmail = opEmail;
                state.assistantEmail = asEmail;
                spin.stop(color(`${sym.check} CAC initialized successfully`, ansi.green));
                break;
            } catch (err: unknown) {
                spin.stop(color(`${sym.cross} CAC initialization failed`, ansi.red));
                printError(err instanceof Error ? err.message : String(err));
            }
        } else {
            state.operatorEmail = opEmail;
            state.assistantEmail = asEmail;
            printSuccess("CAC settings configured locally.");
            break;
        }
    }

    // ── Step 5: Provider & Model Setup + Guardian Setup ──────────────────────

    printStep(5, TOTAL_STEPS, "Provider & Model Setup + Guardian Setup");
    console.log("");
    printInfo("Configure LLM settings and local governance guardian.");
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
    }

    // Guardian
    let availableModels: Array<{ name: string; path: string }> = [];
    if (client) {
        const spin = spinner("Loading available GGUF models...");
        try {
            const data = await client.getGgufModels();
            availableModels = data.models || [];
            spin.stop(color(`${sym.check} Found ${availableModels.length} GGUF model(s)`, ansi.green));
        } catch {
            spin.stop(color(`${sym.cross} Could not load GGUF models`, ansi.yellow));
        }
    }

    if (availableModels.length > 0) {
        const modelOptions = [
            { label: "None (skip guardian)", value: "", description: "Configure later" },
            ...availableModels.map((m) => ({
                label: m.name,
                value: m.path,
                description: m.path.split(/[/\\]/).pop() || "",
            })),
        ];
        state.guardianModel = await select("Select guardian model:", modelOptions, 0);
    } else {
        state.guardianModel = "";
    }

    if (state.guardianModel) {
        const tierOptions = [
            { label: "Tier 1 — Autonomous", value: "tier1_autonomous" },
            { label: "Tier 2 — Conditional", value: "tier2_conditional" },
        ];
        const defaultTierIdx = state.profile === "business" ? 1 : 0;
        state.guardianTier = await select("Select authority tier:", tierOptions, defaultTierIdx);
        state.guardianAutoStart = await confirm("Auto-start guardian on launch?", true);

        if (client) {
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
    }

    // Save profile (in case standalone mode)
    if (!client) {
        writePreferences({
            executionProfileSegment: state.profile,
            defaultCharacterId: state.characterId,
            lastUsedCharacterId: state.characterId,
            setupComplete: true,
        });
    }

    // Submit certificate
    const certificate = buildCertificate(state);
    if (client) {
        try {
            await client.postInitializationSession(certificate);
        } catch (err: unknown) {
            printWarning(`Could not submit initialization certificate: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Finalize setup
    let readiness: ReadinessSnapshot | null = null;
    if (client) {
        const spin = spinner("Finalizing setup...");
        try {
            const result = await client.postSetupComplete();
            readiness = result.readiness;
            spin.stop(color(`${sym.check} Setup finalized via server`, ansi.green));
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Server finalization failed`, ansi.red));
            printWarning(err instanceof Error ? err.message : String(err));
            writePreferences({ setupComplete: true });
        }
    }

    printSummary(state, readiness);

    // Final confirmation
    console.log("");
    printSuccess("PRISM Setup Complete!");
    if (client) {
        printInfo(`Open http://localhost:${args.port}/dashboard to access the PRISM Dashboard.`);
    } else {
        printInfo("Run 'npm start' or 'start_web.bat' to launch the PRISM server.");
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary Display
// ──────────────────────────────────────────────────────────────────────────────

function printSummary(state: WizardState, readiness: Record<string, unknown> | ReadinessSnapshot | null): void {
    console.log("");
    console.log(color("  ╔══════════════════════════════════════╗", ansi.cyan));
    console.log(color("  ║          Configuration Summary       ║", ansi.cyan));
    console.log(color("  ╚══════════════════════════════════════╝", ansi.cyan));
    console.log("");

    printCheck("Execution Profile", true, state.profile);
    printCheck("Workspace Directory", true, state.workspace);
    printCheck("First Assistant", !!state.characterId, state.characterId || "Not selected");
    if (state.operatorEmail) {
        printCheck("Operator Email", true, state.operatorEmail);
    }
    if (state.assistantEmail) {
        printCheck("Assistant Email", true, state.assistantEmail);
    }
    printCheck("LLM Provider", true, state.provider);
    if (state.apiKey) {
        printCheck("API Key", true, "configured (masked)");
    }
    if (state.guardianModel) {
        printCheck("Guardian Agent", true, `${state.guardianTier} — ${state.guardianModel.split(/[/\\]/).pop()}`);
    } else {
        printCheck("Guardian Agent", false, "Not configured");
    }

    if (readiness) {
        console.log("");
        console.log(color("  Readiness Checks:", ansi.bold));
        const reqs = readiness.requirements;
        if (Array.isArray(reqs)) {
            for (const req of reqs) {
                const r = req as { label: string; passed: boolean; detail?: string };
                printCheck(r.label, r.passed, r.detail);
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

// ──────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    // Detect server availability (unless forced standalone)
    let client: SetupApiClient | null = null;
    if (!args.standalone) {
        const apiClient = new SetupApiClient(args.port);
        const spin = spinner("Checking for PRISM server...");
        const running = await apiClient.isServerRunning();
        if (running) {
            client = apiClient;
            spin.stop(color(`${sym.check} PRISM server detected on port ${args.port}`, ansi.green));
        } else {
            spin.stop(color(`${sym.arrow} No PRISM server detected — running in standalone mode`, ansi.yellow));
        }
    }

    // Route to advanced or basic wizard
    if (args.advanced) {
        const advArgs = {
            profile: args.profile,
            workspace: args.workspace,
            provider: args.provider,
            apiKey: args.apiKey,
            routingStrategy: null as string | null,
            guardianTier: null as string | null,
            swarmTopology: null as string | null,
            cacCharacter: null as string | null,
            cacOperatorEmail: null as string | null,
            nonInteractive: args.nonInteractive,
            port: args.port,
        };
        if (args.nonInteractive) {
            await runAdvancedNonInteractive(advArgs, client);
        } else {
            await runAdvancedInteractive(advArgs, client);
        }
    } else if (args.nonInteractive) {
        await runNonInteractive(args, client);
    } else {
        await runInteractive(args, client);
    }

    process.exit(0);
}

main().catch((err: unknown) => {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
