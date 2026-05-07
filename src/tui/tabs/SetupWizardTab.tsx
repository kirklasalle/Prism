/**
 * PRISM TUI — Setup Wizard (interactive 4-step onboarding flow).
 *
 * Mirrors the web setup wizard steps:
 *   1. Execution Profile  (individual / business)
 *   2. Workspace directory
 *   3. LLM Provider + optional API key
 *   4. Summary & complete
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient, SetupStatus, PrerequisiteCheck } from "../api/prism-client.js";
import { colors, symbols } from "../theme.js";
import { Panel, Loading, ErrorBox } from "../components/ui.js";

const TOTAL_STEPS = 4;

interface WizardState {
    profile: "individual" | "business" | null;
    workspaceRoot: string;
    provider: string;
    apiKey: string;
}

const PROVIDERS = [
    { id: "ollama", label: "Ollama (local)", needsKey: false },
    { id: "openai", label: "OpenAI", needsKey: true },
    { id: "anthropic", label: "Anthropic", needsKey: true },
    { id: "google", label: "Google AI", needsKey: true },
    { id: "mistral", label: "Mistral", needsKey: true },
    { id: "groq", label: "Groq", needsKey: true },
    { id: "together", label: "Together AI", needsKey: true },
    { id: "deepseek", label: "DeepSeek", needsKey: true },
    { id: "openrouter", label: "OpenRouter", needsKey: true },
];

export function SetupWizardTab({
    client,
    focused,
    onComplete,
}: {
    client: PrismClient;
    focused: boolean;
    onComplete?: () => void;
}): React.JSX.Element {
    const [step, setStep] = useState(1);
    const [wizard, setWizard] = useState<WizardState>({
        profile: null,
        workspaceRoot: "",
        provider: "ollama",
        apiKey: "",
    });
    const [prereqs, setPrereqs] = useState<PrerequisiteCheck[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [editingKey, setEditingKey] = useState(false);
    const [completeSummary, setCompleteSummary] = useState<Record<string, unknown> | null>(null);

    // Load current status on mount
    useEffect(() => {
        (async () => {
            try {
                const [status, prereqData] = await Promise.all([
                    client.getSetupStatus(),
                    client.getSetupPrerequisites(),
                ]);
                setWizard((w) => ({
                    ...w,
                    profile: (status.executionProfileSegment === "business" ? "business" : "individual") as "individual" | "business",
                    workspaceRoot: status.workspaceRoot ?? "",
                }));
                setPrereqs(prereqData.checks ?? []);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoading(false);
            }
        })();
    }, [client]);

    // Navigate
    const goNext = useCallback(async () => {
        if (submitting) return;
        setError(null);

        if (step === 1) {
            if (!wizard.profile) {
                setError("Select a profile before continuing.");
                return;
            }
            setSubmitting(true);
            try {
                await client.postSetupProfile(wizard.profile);
                setStep(2);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setSubmitting(false);
            }
            return;
        }

        if (step === 2) {
            if (!wizard.workspaceRoot.trim()) {
                setError("Workspace path is required.");
                return;
            }
            setSubmitting(true);
            try {
                await client.postSetupWorkspace(wizard.workspaceRoot.trim());
                setSelectedIndex(0);
                setStep(3);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setSubmitting(false);
            }
            return;
        }

        if (step === 3) {
            // Provider step — save via LLM config if key is entered
            if (wizard.apiKey.trim()) {
                setSubmitting(true);
                try {
                    await client.setLlmConfig({
                        provider: wizard.provider,
                        apiKey: wizard.apiKey.trim(),
                    } as any);
                } catch {
                    // Non-fatal — config may already be set
                } finally {
                    setSubmitting(false);
                }
            }
            setStep(4);
            return;
        }

        if (step === 4) {
            setSubmitting(true);
            try {
                const result = await client.postSetupComplete();
                setCompleteSummary(result.readiness ?? {});
                onComplete?.();
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setSubmitting(false);
            }
        }
    }, [step, wizard, submitting, client, onComplete]);

    const goBack = useCallback(() => {
        if (step > 1) {
            setError(null);
            setStep((s) => s - 1);
        }
    }, [step]);

    // Keyboard
    useInput((input, key) => {
        if (!focused || submitting) return;

        // Step 1: profile selection
        if (step === 1) {
            if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
            if (key.downArrow) setSelectedIndex((i) => Math.min(1, i + 1));
            if (input === " " || key.return) {
                setWizard((w) => ({ ...w, profile: selectedIndex === 0 ? "individual" : "business" }));
                if (key.return) goNext();
            }
            if (key.escape) goBack();
            return;
        }

        // Step 2: workspace (TextInput handles typing)
        if (step === 2) {
            if (key.return) goNext();
            if (key.escape) goBack();
            return;
        }

        // Step 3: provider selection + optional API key
        if (step === 3) {
            if (editingKey) {
                if (key.escape) setEditingKey(false);
                // TextInput handles the rest
                return;
            }
            if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
            if (key.downArrow) setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
            if (input === " ") {
                const p = PROVIDERS[selectedIndex];
                if (p) setWizard((w) => ({ ...w, provider: p.id }));
            }
            if (input === "k" || input === "K") {
                const p = PROVIDERS.find((pr) => pr.id === wizard.provider);
                if (p?.needsKey) setEditingKey(true);
            }
            if (key.return) goNext();
            if (key.escape) goBack();
            return;
        }

        // Step 4: summary
        if (step === 4) {
            if (key.return) goNext();
            if (key.escape) goBack();
        }
    });

    if (loading) return <Loading label="Loading setup status..." />;

    return (
        <Box flexDirection="column">
            {/* Progress bar */}
            <Box marginBottom={1}>
                <Text color={colors.brand} bold>
                    {symbols.gear} Setup Wizard
                </Text>
                <Text color={colors.muted}>
                    {" "}— Step {step} of {TOTAL_STEPS}
                </Text>
                <Text color={colors.muted}>  [</Text>
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                    <Text key={i} color={i < step ? colors.brand : colors.muted}>
                        {i < step ? "█" : "░"}
                    </Text>
                ))}
                <Text color={colors.muted}>]</Text>
            </Box>

            {error && <ErrorBox message={error} />}

            {/* Step 1: Profile */}
            {step === 1 && (
                <Panel title="Step 1 — Execution Profile">
                    <Text color={colors.text}>Choose how you will use PRISM:</Text>
                    <Box marginTop={1} flexDirection="column">
                        {(["individual", "business"] as const).map((p, i) => (
                            <Box key={p}>
                                <Text color={wizard.profile === p ? colors.brand : (selectedIndex === i ? colors.text : colors.muted)}>
                                    {wizard.profile === p ? symbols.bullet : symbols.circle} {p === "individual" ? "Individual" : "Business / Enterprise"}
                                </Text>
                                {selectedIndex === i && <Text color={colors.muted}> {symbols.arrow}</Text>}
                            </Box>
                        ))}
                    </Box>
                    <Box marginTop={1}>
                        <Text color={colors.muted}>↑↓ to move, Space to select, Enter to continue</Text>
                    </Box>
                </Panel>
            )}

            {/* Step 2: Workspace */}
            {step === 2 && (
                <Panel title="Step 2 — Workspace Directory">
                    <Text color={colors.text}>Enter your PRISM workspace path:</Text>
                    <Box marginTop={1}>
                        <Text color={colors.brand}>{symbols.arrow} </Text>
                        <TextInput
                            value={wizard.workspaceRoot}
                            onChange={(v) => setWizard((w) => ({ ...w, workspaceRoot: v }))}
                            placeholder="e.g. C:\\Users\\you\\prism-workspace"
                        />
                    </Box>
                    {prereqs.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                            <Text color={colors.muted} bold>Prerequisites:</Text>
                            {prereqs.map((c) => (
                                <Box key={c.id}>
                                    <Text color={c.passed ? colors.success : colors.error}>
                                        {c.passed ? symbols.check : symbols.cross} {c.label}
                                    </Text>
                                    <Text color={colors.muted}> — {c.detail}</Text>
                                </Box>
                            ))}
                        </Box>
                    )}
                    <Box marginTop={1}>
                        <Text color={colors.muted}>Enter to continue, Esc to go back</Text>
                    </Box>
                </Panel>
            )}

            {/* Step 3: Provider */}
            {step === 3 && (
                <Panel title="Step 3 — LLM Provider">
                    <Text color={colors.text}>Select your primary LLM provider:</Text>
                    <Box marginTop={1} flexDirection="column">
                        {PROVIDERS.map((p, i) => (
                            <Box key={p.id}>
                                <Text color={wizard.provider === p.id ? colors.brand : (selectedIndex === i ? colors.text : colors.muted)}>
                                    {wizard.provider === p.id ? symbols.bullet : symbols.circle} {p.label}
                                </Text>
                                {selectedIndex === i && <Text color={colors.muted}> {symbols.arrow}</Text>}
                            </Box>
                        ))}
                    </Box>
                    {PROVIDERS.find((p) => p.id === wizard.provider)?.needsKey && (
                        <Box marginTop={1} flexDirection="column">
                            {editingKey ? (
                                <Box>
                                    <Text color={colors.info}>API Key: </Text>
                                    <TextInput
                                        value={wizard.apiKey}
                                        onChange={(v) => setWizard((w) => ({ ...w, apiKey: v }))}
                                        placeholder="sk-..."
                                        mask="*"
                                    />
                                </Box>
                            ) : (
                                <Text color={colors.muted}>
                                    {wizard.apiKey ? `${symbols.check} API key set` : `Press K to enter API key`}
                                </Text>
                            )}
                        </Box>
                    )}
                    <Box marginTop={1}>
                        <Text color={colors.muted}>↑↓ to move, Space to select, K for API key, Enter to continue</Text>
                    </Box>
                </Panel>
            )}

            {/* Step 4: Summary */}
            {step === 4 && (
                <Panel title="Step 4 — Summary">
                    <Text color={colors.text} bold>Review your configuration:</Text>
                    <Box marginTop={1} flexDirection="column">
                        <Box>
                            <Text color={colors.muted}>Profile:    </Text>
                            <Text color={colors.info}>{wizard.profile ?? "not set"}</Text>
                        </Box>
                        <Box>
                            <Text color={colors.muted}>Workspace:  </Text>
                            <Text color={colors.info}>{wizard.workspaceRoot || "default"}</Text>
                        </Box>
                        <Box>
                            <Text color={colors.muted}>Provider:   </Text>
                            <Text color={colors.info}>{PROVIDERS.find((p) => p.id === wizard.provider)?.label ?? wizard.provider}</Text>
                        </Box>
                        <Box>
                            <Text color={colors.muted}>API Key:    </Text>
                            <Text color={wizard.apiKey ? colors.success : colors.warning}>
                                {wizard.apiKey ? "configured" : PROVIDERS.find((p) => p.id === wizard.provider)?.needsKey ? "not set" : "not required"}
                            </Text>
                        </Box>
                    </Box>
                    {completeSummary && (
                        <Box marginTop={1} flexDirection="column">
                            <Text color={colors.success} bold>{symbols.check} Setup complete!</Text>
                            <Text color={colors.muted}>Press any key to continue to PRISM.</Text>
                        </Box>
                    )}
                    {!completeSummary && (
                        <Box marginTop={1}>
                            <Text color={colors.muted}>Enter to finalize setup, Esc to go back</Text>
                        </Box>
                    )}
                </Panel>
            )}

            {submitting && <Loading label="Saving..." />}

            {/* Navigation hint */}
            <Box marginTop={1}>
                <Text color={colors.muted}>
                    {step > 1 ? "Esc: back  " : ""}Enter: {step === 4 ? (completeSummary ? "finish" : "complete setup") : "next"}
                </Text>
            </Box>
        </Box>
    );
}
