/**
 * PRISM TUI — Tools & Plugins tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { PrismClient } from "../api/prism-client.js";
import type { PrismWsClient } from "../api/ws-client.js";
import { useApi, useWsEvent, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import {
    Panel, DataTable, StatusBadge, SubTabBar,
    Loading, ErrorBox, KeyValue, SectionHeader, ProgressBar,
} from "../components/ui.js";

export function ToolsTab({
    client,
    wsClient,
    focused,
}: {
    client: PrismClient;
    wsClient: PrismWsClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("tools");
    const tools = useApi(client, (c) => c.getToolsStatus(), 10000);
    const plugins = useApi(client, (c) => c.getPluginsStatus(), 10000);
    const utilities = useApi(client, (c) => c.getUtilitiesStatus(), 10000);
    const [diagSuite, setDiagSuite] = useState("browser");
    const [diagRunning, setDiagRunning] = useState(false);
    const [diagLog, setDiagLog] = useState<string[]>([]);

    const diagProgress = useWsEvent(wsClient, `${diagSuite}_diagnostics_progress`);
    const diagComplete = useWsEvent(wsClient, `${diagSuite}_diagnostics_complete`);

    const toolNav = useListNavigation(tools.data?.length ?? 0, focused && subTab === "tools");

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab) {
            const tabs = ["tools", "plugins", "utilities", "diagnostics"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
        if (subTab === "diagnostics" && input === "r" && !diagRunning) {
            setDiagRunning(true);
            setDiagLog([]);
            client.runDiagnostics(diagSuite).catch(() => setDiagRunning(false));
        }
    });

    // Watch for diagnostics completion
    React.useEffect(() => {
        if (diagComplete) setDiagRunning(false);
    }, [diagComplete]);

    const DIAG_SUITES = ["browser", "agent", "computer", "network", "knowledge-graph", "workspace", "telemetry", "logs", "scheduler"];

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "tools", label: `Tools (${tools.data?.length ?? 0})` },
                    { id: "plugins", label: `Plugins (${plugins.data?.length ?? 0})` },
                    { id: "utilities", label: `Utilities (${utilities.data?.length ?? 0})` },
                    { id: "diagnostics", label: "Diagnostics" },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {/* Tools sub-tab */}
            {subTab === "tools" && (
                <Box flexDirection="column">
                    {tools.loading && <Loading />}
                    {tools.error && <ErrorBox message={tools.error} />}
                    {tools.data && (
                        <DataTable
                            data={tools.data}
                            columns={[
                                { header: "Tool", accessor: "name", width: 22 },
                                { header: "Category", accessor: "category", width: 14 },
                                { header: "Risk", accessor: "riskTier", width: 6 },
                                {
                                    header: "Calls",
                                    accessor: "invocations",
                                    width: 8,
                                },
                                {
                                    header: "Success",
                                    accessor: ((r: Record<string, unknown>) =>
                                        `${r.successes ?? 0}/${r.invocations ?? 0}`),
                                    width: 12,
                                },
                                {
                                    header: "Avg ms",
                                    accessor: ((r: Record<string, unknown>) =>
                                        (r.avgLatencyMs as number)?.toFixed(0) ?? "-"),
                                    width: 8,
                                },
                                {
                                    header: "Status",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.enabled ? "enabled" : "disabled"),
                                    width: 10,
                                    color: ((r: Record<string, unknown>) =>
                                        r.enabled ? colors.success : colors.muted),
                                },
                            ]}
                            selectedIndex={toolNav.selectedIndex}
                        />
                    )}
                </Box>
            )}

            {/* Plugins sub-tab */}
            {subTab === "plugins" && (
                <Box flexDirection="column">
                    {plugins.loading && <Loading />}
                    {plugins.error && <ErrorBox message={plugins.error} />}
                    {plugins.data && (
                        <DataTable
                            data={plugins.data}
                            columns={[
                                { header: "Plugin", accessor: "name", width: 24 },
                                {
                                    header: "Health",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.healthy ? "healthy" : "unhealthy"),
                                    width: 12,
                                    color: ((r: Record<string, unknown>) =>
                                        r.healthy ? colors.success : colors.error),
                                },
                                { header: "Requests", accessor: "requests", width: 10 },
                                { header: "Errors", accessor: "errors", width: 8 },
                                {
                                    header: "Avg ms",
                                    accessor: ((r: Record<string, unknown>) =>
                                        (r.avgResponseMs as number)?.toFixed(0) ?? "-"),
                                    width: 10,
                                },
                            ]}
                        />
                    )}
                </Box>
            )}

            {/* Utilities sub-tab */}
            {subTab === "utilities" && (
                <Box flexDirection="column">
                    {utilities.loading && <Loading />}
                    {utilities.error && <ErrorBox message={utilities.error} />}
                    {utilities.data && (
                        <DataTable
                            data={utilities.data}
                            columns={[
                                { header: "Utility", accessor: "name", width: 28 },
                                {
                                    header: "Result",
                                    accessor: "lastResult",
                                    width: 10,
                                    color: ((r: Record<string, unknown>) => {
                                        const lr = String(r.lastResult ?? "");
                                        return lr === "pass" ? colors.success : lr === "fail" ? colors.error : colors.muted;
                                    }),
                                },
                                { header: "Runs", accessor: "runCount", width: 8 },
                                {
                                    header: "Last Run",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.lastRun ? new Date(r.lastRun as string).toLocaleTimeString() : "never"),
                                    width: 14,
                                },
                            ]}
                        />
                    )}
                </Box>
            )}

            {/* Diagnostics sub-tab */}
            {subTab === "diagnostics" && (
                <Box flexDirection="column">
                    <Box marginBottom={1} gap={1}>
                        {DIAG_SUITES.map((s) => (
                            <Text
                                key={s}
                                color={s === diagSuite ? colors.info : colors.muted}
                                bold={s === diagSuite}
                                underline={s === diagSuite}
                            >
                                {s}
                            </Text>
                        ))}
                    </Box>
                    <Box marginBottom={1}>
                        <Text color={colors.muted}>
                            Press r to run {diagSuite} diagnostics
                            {diagRunning ? " (running...)" : ""}
                        </Text>
                    </Box>
                    {diagRunning && <Loading label={`Running ${diagSuite} suite...`} />}
                    {diagLog.map((line, i) => (
                        <Text key={i} color={colors.textDim}>{line}</Text>
                    ))}
                </Box>
            )}
        </Box>
    );
}
