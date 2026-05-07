/**
 * PRISM TUI — Telemetry tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { PrismClient } from "../api/prism-client.js";
import { useApi, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import {
    Panel, DataTable, SubTabBar, Sparkline, KeyValue, StatusBadge,
    Loading, ErrorBox, SectionHeader, ProgressBar,
} from "../components/ui.js";

export function TelemetryTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("overview");
    const summary = useApi(client, (c) => c.getTelemetrySummary(), 5000);
    const cohorts = useApi(client, (c) => c.getRetrievalCohorts(), 10000);
    const alerts = useApi(client, (c) => c.getRetrievalAlerts(), 8000);
    const approvals = useApi(client, (c) => c.getPendingApprovals(), 5000);

    const approvalNav = useListNavigation(approvals.data?.length ?? 0, focused && subTab === "approvals");
    const [actionMsg, setActionMsg] = useState<string | null>(null);

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab) {
            const tabs = ["overview", "cohorts", "alerts", "approvals"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
        if (subTab === "approvals" && approvals.data?.[approvalNav.selectedIndex]) {
            const item = approvals.data[approvalNav.selectedIndex]!;
            if (input === "a") {
                client.approveItem(item.id)
                    .then(() => { setActionMsg(`Approved: ${item.operation}`); approvals.refresh(); })
                    .catch((e: Error) => setActionMsg(`Error: ${e.message}`));
            }
            if (input === "d") {
                client.denyItem(item.id)
                    .then(() => { setActionMsg(`Denied: ${item.operation}`); approvals.refresh(); })
                    .catch((e: Error) => setActionMsg(`Error: ${e.message}`));
            }
        }
    });

    React.useEffect(() => {
        if (!actionMsg) return;
        const t = setTimeout(() => setActionMsg(null), 3000);
        return () => clearTimeout(t);
    }, [actionMsg]);

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "overview", label: "Overview" },
                    { id: "cohorts", label: "Retrieval Quality" },
                    { id: "alerts", label: `Alerts (${alerts.data?.length ?? 0})` },
                    { id: "approvals", label: `Approvals (${approvals.data?.length ?? 0})` },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {actionMsg && (
                <Box marginBottom={1}>
                    <Text color={colors.info}>{symbols.arrow} {actionMsg}</Text>
                </Box>
            )}

            {/* Overview */}
            {subTab === "overview" && (
                <Box flexDirection="column">
                    {summary.loading && <Loading />}
                    {summary.error && <ErrorBox message={summary.error} />}
                    {summary.data && (
                        <Panel title="Runtime Telemetry">
                            <Box gap={4}>
                                <Box flexDirection="column">
                                    <KeyValue label="Total Events" value={String(summary.data.totalEvents)} />
                                    <KeyValue
                                        label="Errors"
                                        value={String(summary.data.errorCount)}
                                        valueColor={summary.data.errorCount > 0 ? colors.error : colors.success}
                                    />
                                    <KeyValue label="Avg Latency" value={`${summary.data.avgLatencyMs.toFixed(0)} ms`} />
                                </Box>
                                <Box flexDirection="column">
                                    <KeyValue label="P95 Latency" value={`${summary.data.p95LatencyMs.toFixed(0)} ms`} />
                                    <KeyValue label="Uptime" value={`${(summary.data.uptimeSeconds / 3600).toFixed(1)} hours`} />
                                </Box>
                            </Box>
                        </Panel>
                    )}
                </Box>
            )}

            {/* Retrieval Quality Cohorts */}
            {subTab === "cohorts" && (
                <Box flexDirection="column">
                    {cohorts.loading && <Loading />}
                    {cohorts.error && <ErrorBox message={cohorts.error} />}
                    {cohorts.data && (
                        <DataTable
                            data={cohorts.data}
                            columns={[
                                { header: "Cohort", accessor: "cohortId", width: 14 },
                                {
                                    header: "Hit Rate",
                                    accessor: ((r: Record<string, unknown>) =>
                                        `${((r.hitRate as number) * 100).toFixed(1)}%`),
                                    width: 10,
                                },
                                {
                                    header: "Coverage",
                                    accessor: ((r: Record<string, unknown>) =>
                                        `${((r.coverage as number) * 100).toFixed(1)}%`),
                                    width: 10,
                                },
                                {
                                    header: "Novelty",
                                    accessor: ((r: Record<string, unknown>) =>
                                        `${((r.novelty as number) * 100).toFixed(1)}%`),
                                    width: 10,
                                },
                                {
                                    header: "Utility",
                                    accessor: ((r: Record<string, unknown>) =>
                                        `${((r.utility as number) * 100).toFixed(1)}%`),
                                    width: 10,
                                },
                                {
                                    header: "P95 ms",
                                    accessor: ((r: Record<string, unknown>) =>
                                        (r.p95LatencyMs as number)?.toFixed(0) ?? "-"),
                                    width: 10,
                                },
                            ]}
                            emptyMessage="No cohort data available."
                        />
                    )}
                </Box>
            )}

            {/* Alerts */}
            {subTab === "alerts" && (
                <Box flexDirection="column">
                    {alerts.loading && <Loading />}
                    {alerts.error && <ErrorBox message={alerts.error} />}
                    {alerts.data && (
                        <DataTable
                            data={alerts.data}
                            columns={[
                                {
                                    header: "Priority",
                                    accessor: "priority",
                                    width: 10,
                                    color: ((r: Record<string, unknown>) => {
                                        const p = String(r.priority);
                                        return p === "critical" ? colors.error : p === "high" ? colors.warning : colors.info;
                                    }),
                                },
                                { header: "Metric", accessor: "metric", width: 20 },
                                { header: "Threshold", accessor: "threshold", width: 12 },
                                { header: "Current", accessor: "currentValue", width: 12 },
                                {
                                    header: "Triggered",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.triggeredAt ? new Date(r.triggeredAt as string).toLocaleTimeString() : ""),
                                    width: 12,
                                },
                            ]}
                            emptyMessage="No active alerts."
                        />
                    )}
                </Box>
            )}

            {/* Approval Queue */}
            {subTab === "approvals" && (
                <Box flexDirection="column">
                    <Box marginBottom={1}>
                        <Text color={colors.muted}>
                            a: approve | d: deny | j/k: navigate
                        </Text>
                    </Box>
                    {approvals.loading && <Loading />}
                    {approvals.error && <ErrorBox message={approvals.error} />}
                    {approvals.data && (
                        <DataTable
                            data={approvals.data}
                            columns={[
                                { header: "Operation", accessor: "operation", width: 24 },
                                { header: "Risk", accessor: "riskTier", width: 6 },
                                {
                                    header: "Status",
                                    accessor: "status",
                                    width: 10,
                                    color: ((r: Record<string, unknown>) => {
                                        const s = String(r.status);
                                        return s === "pending" ? colors.warning : s === "approved" ? colors.success : colors.error;
                                    }),
                                },
                                {
                                    header: "Requested",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.requestedAt ? new Date(r.requestedAt as string).toLocaleTimeString() : ""),
                                    width: 12,
                                },
                            ]}
                            selectedIndex={approvalNav.selectedIndex}
                            emptyMessage="No pending approvals."
                        />
                    )}
                </Box>
            )}
        </Box>
    );
}
