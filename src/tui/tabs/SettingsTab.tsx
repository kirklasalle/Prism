/**
 * PRISM TUI — Provider & Settings tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { useApi } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, KeyValue, Loading, ErrorBox, DataTable, SectionHeader, SubTabBar } from "../components/ui.js";

export function SettingsTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("llm");
    const llmConfig = useApi(client, (c) => c.getLlmConfig(), 10000);
    const modelMatrix = useApi(client, (c) => c.getModelMatrix(), 15000);
    const auditTrail = useApi(client, (c) => c.getAuditTrail(), 10000);

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab) {
            const tabs = ["llm", "models", "audit"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
    });

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "llm", label: "LLM Config" },
                    { id: "models", label: "Model Matrix" },
                    { id: "audit", label: "Audit Trail" },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {subTab === "llm" && (
                <Box flexDirection="column">
                    {llmConfig.loading && <Loading />}
                    {llmConfig.error && <ErrorBox message={llmConfig.error} />}
                    {llmConfig.data && (
                        <Panel title="LLM Configuration">
                            <KeyValue label="Provider" value={llmConfig.data.provider} valueColor={colors.info} />
                            <KeyValue label="Model" value={llmConfig.data.model} valueColor={colors.info} />
                            <KeyValue label="Temperature" value={String(llmConfig.data.temperature ?? "default")} />
                            <KeyValue label="Max Tokens" value={String(llmConfig.data.maxTokens ?? "default")} />
                            <KeyValue
                                label="API Key"
                                value={llmConfig.data.apiKey ? "••••••••" : "not set"}
                                valueColor={llmConfig.data.apiKey ? colors.success : colors.warning}
                            />
                        </Panel>
                    )}
                </Box>
            )}

            {subTab === "models" && (
                <Box flexDirection="column">
                    {modelMatrix.loading && <Loading />}
                    {modelMatrix.error && <ErrorBox message={modelMatrix.error} />}
                    {modelMatrix.data && (
                        <DataTable
                            data={modelMatrix.data}
                            columns={[
                                { header: "Model", accessor: "model", width: 30 },
                                { header: "Provider", accessor: "provider", width: 14 },
                                { header: "Tier", accessor: "tier", width: 6 },
                                {
                                    header: "Modalities",
                                    accessor: ((r: Record<string, unknown>) =>
                                        Array.isArray(r.modalities) ? (r.modalities as string[]).join(", ") : ""),
                                    width: 24,
                                },
                                {
                                    header: "Status",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.deprecated ? "deprecated" : "active"),
                                    width: 12,
                                    color: ((r: Record<string, unknown>) =>
                                        r.deprecated ? colors.warning : colors.success),
                                },
                            ]}
                        />
                    )}
                </Box>
            )}

            {subTab === "audit" && (
                <Box flexDirection="column">
                    {auditTrail.loading && <Loading />}
                    {auditTrail.error && <ErrorBox message={auditTrail.error} />}
                    {auditTrail.data && auditTrail.data.length === 0 && (
                        <Text color={colors.muted}>No audit entries.</Text>
                    )}
                    {auditTrail.data?.slice(-30).map((entry, i) => (
                        <Box key={i}>
                            <Text color={colors.muted}>
                                {new Date(entry.timestamp).toLocaleTimeString()}
                            </Text>
                            <Text> </Text>
                            <Text color={colors.info}>{entry.action}</Text>
                            <Text color={colors.textDim}>
                                {" "}
                                {JSON.stringify(entry.detail).slice(0, 60)}
                            </Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}
