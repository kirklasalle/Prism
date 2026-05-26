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
} from "../core/config/workspace-resolver.js";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

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
    provider: string;
    apiKey: string;
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

    printBanner();
    console.log(color("  Running in non-interactive mode...", ansi.gray));
    console.log("");

    if (client) {
        // Connected mode: use API endpoints
        const spin = spinner("Configuring via PRISM server...");
        try {
            await client.postSetupProfile(profile);
            await client.postSetupWorkspace(workspace);
            if (args.apiKey && validProvider.needsKey) {
                await client.postProviderKey(provider, args.apiKey);
            }
            const result = await client.postSetupComplete();
            spin.stop(color(`${sym.check} Setup complete via server`, ansi.green));
            printSummary({ profile, workspace, provider, apiKey: args.apiKey || "" }, result.readiness);
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
                setupComplete: true,
            });
            if (workspace) {
                setWorkspaceRoot(workspace);
            }
            ensureWorkspaceStructure(profile === "business" ? "prod" : "dev");
            spin.stop(color(`${sym.check} Configuration saved`, ansi.green));
            printSummary({ profile, workspace, provider, apiKey: args.apiKey || "" }, null);
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
        provider: args.provider || "llamacpp",
        apiKey: args.apiKey || "",
    };

    // ── Step 1: Execution Profile ────────────────────────────────────────────

    printStep(1, 4, "Execution Profile");
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

    printStep(2, 4, "Workspace Directory");
    console.log("");
    printInfo("PRISM stores all data, state, and artifacts in a persistent workspace.");
    console.log("");

    state.workspace = await prompt("Workspace path", state.workspace);

    if (!isAbsolute(state.workspace)) {
        printError("Workspace must be an absolute path.");
        process.exit(2);
    }

    // Save workspace
    if (client) {
        try {
            const result = await client.postSetupWorkspace(state.workspace);
            state.workspace = result.workspaceRoot;
        } catch (err: unknown) {
            printWarning(`Server workspace save failed: ${err instanceof Error ? err.message : String(err)}`);
            // Fall back to standalone save
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

    // Run prerequisite checks
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
        } catch {
            // Local checks already shown
        }
    }
    console.log("");
    printSuccess(`Workspace: ${color(state.workspace, ansi.bold)}`);

    // ── Step 3: LLM Provider ─────────────────────────────────────────────────

    printStep(3, 4, "LLM Provider");
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

    // API key input (if needed)
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
            spin.stop(color(`${sym.cross} Could not test provider (server may not support this endpoint)`, ansi.yellow));
        }
    } else {
        printInfo(`Provider test skipped (standalone mode). Configure connectivity from the dashboard after starting PRISM.`);
    }

    console.log("");
    printSuccess(`Provider: ${color(selectedProvider.label, ansi.bold)}`);

    // ── Step 4: Summary & Complete ───────────────────────────────────────────

    printStep(4, 4, "Summary");
    console.log("");

    // Save profile (in case standalone mode)
    if (!client) {
        writePreferences({
            executionProfileSegment: state.profile,
            setupComplete: true,
        });
    }

    // Finalize via server or standalone
    let readiness: ReadinessSnapshot | Record<string, unknown> | null = null;
    if (client) {
        const spin = spinner("Finalizing setup...");
        try {
            const result = await client.postSetupComplete();
            readiness = result.readiness;
            spin.stop(color(`${sym.check} Setup finalized via server`, ansi.green));
        } catch (err: unknown) {
            spin.stop(color(`${sym.cross} Server finalization failed`, ansi.red));
            printWarning(err instanceof Error ? err.message : String(err));
            // Fall back to standalone save
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
    printCheck("LLM Provider", true, state.provider);
    if (state.apiKey) {
        printCheck("API Key", true, "configured (masked)");
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
