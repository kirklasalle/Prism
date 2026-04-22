/**
 * PRISM TUI — Agentic Control tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import type { PrismWsClient } from "../api/ws-client.js";
import { useApi, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import {
    Panel, DataTable, SubTabBar, StatusBadge,
    Loading, ErrorBox, KeyValue, SectionHeader,
} from "../components/ui.js";

export function AgenticTab({
    client,
    wsClient,
    focused,
}: {
    client: PrismClient;
    wsClient: PrismWsClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("agents");
    const agents = useApi(client, (c) => c.getAgents(), 5000);
    const swarms = useApi(client, (c) => c.getSwarms(), 10000);
    const telemetry = useApi(client, (c) => c.getAgentTelemetry(), 8000);
    const characters = useApi(client, (c) => c.getCharacters(), 15000);

    const agentNav = useListNavigation(agents.data?.length ?? 0, focused && subTab === "agents");
    const [spawnMode, setSpawnMode] = useState(false);
    const [spawnRole, setSpawnRole] = useState("");
    const [actionMsg, setActionMsg] = useState<string | null>(null);

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab && !spawnMode) {
            const tabs = ["agents", "swarms", "telemetry", "characters"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
        if (subTab === "agents" && !spawnMode) {
            if (input === "n") {
                setSpawnMode(true);
                setSpawnRole("");
            }
            if (input === "x" && agents.data?.[agentNav.selectedIndex]) {
                const agent = agents.data[agentNav.selectedIndex]!;
                client.stopAgent(agent.id)
                    .then(() => { setActionMsg(`Stopped ${agent.role}`); agents.refresh(); })
                    .catch((e: Error) => setActionMsg(`Error: ${e.message}`));
            }
            if (input === "p" && agents.data?.[agentNav.selectedIndex]) {
                const agent = agents.data[agentNav.selectedIndex]!;
                client.promoteAgent(agent.id)
                    .then(() => { setActionMsg(`Promoted ${agent.role}`); agents.refresh(); })
                    .catch((e: Error) => setActionMsg(`Error: ${e.message}`));
            }
        }
        if (spawnMode && key.escape) {
            setSpawnMode(false);
        }
    });

    const handleSpawn = useCallback(async () => {
        if (!spawnRole.trim()) return;
        try {
            await client.spawnAgent(spawnRole.trim());
            setActionMsg(`Spawned ${spawnRole}`);
            setSpawnMode(false);
            setSpawnRole("");
            agents.refresh();
        } catch (e: unknown) {
            setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [spawnRole, client, agents]);

    // Clear action message after 3 seconds
    React.useEffect(() => {
        if (!actionMsg) return;
        const t = setTimeout(() => setActionMsg(null), 3000);
        return () => clearTimeout(t);
    }, [actionMsg]);

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "agents", label: `Agents (${agents.data?.length ?? 0})` },
                    { id: "swarms", label: `Swarms (${swarms.data?.length ?? 0})` },
                    { id: "telemetry", label: "Telemetry" },
                    { id: "characters", label: "Characters" },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {actionMsg && (
                <Box marginBottom={1}>
                    <Text color={colors.info}>{symbols.arrow} {actionMsg}</Text>
                </Box>
            )}

            {/* Agents sub-tab */}
            {subTab === "agents" && (
                <Box flexDirection="column">
                    <Box marginBottom={1}>
                        <Text color={colors.muted}>
                            n: spawn | x: stop | p: promote | j/k: navigate
                        </Text>
                    </Box>
                    {spawnMode && (
                        <Box borderStyle="single" borderColor={colors.brand} paddingX={1} marginBottom={1}>
                            <Text color={colors.brand}>Spawn role: </Text>
                            <TextInput
                                value={spawnRole}
                                onChange={setSpawnRole}
                                onSubmit={handleSpawn}
                                focus={spawnMode}
                                placeholder="classifier, chat, planner, coder..."
                            />
                        </Box>
                    )}
                    {agents.loading && <Loading />}
                    {agents.error && <ErrorBox message={agents.error} />}
                    {agents.data && (
                        <DataTable
                            data={agents.data}
                            columns={[
                                { header: "ID", accessor: ((r: Record<string, unknown>) => String(r.id ?? "").slice(0, 8)), width: 10 },
                                { header: "Role", accessor: "role", width: 14 },
                                { header: "Tier", accessor: "tier", width: 14 },
                                { header: "Model", accessor: ((r: Record<string, unknown>) => String(r.model ?? "default")), width: 20 },
                                {
                                    header: "Status",
                                    accessor: "status",
                                    width: 10,
                                    color: ((r: Record<string, unknown>) => {
                                        const s = String(r.status ?? "");
                                        return s === "active" ? colors.success : s === "idle" ? colors.warning : colors.muted;
                                    }),
                                },
                                { header: "Dispatches", accessor: "dispatchCount", width: 12 },
                            ]}
                            selectedIndex={agentNav.selectedIndex}
                        />
                    )}
                </Box>
            )}

            {/* Swarms sub-tab */}
            {subTab === "swarms" && (
                <Box flexDirection="column">
                    {swarms.loading && <Loading />}
                    {swarms.error && <ErrorBox message={swarms.error} />}
                    {swarms.data && (
                        <DataTable
                            data={swarms.data}
                            columns={[
                                { header: "ID", accessor: ((r: Record<string, unknown>) => String(r.id ?? "").slice(0, 8)), width: 10 },
                                { header: "Topology", accessor: "topology", width: 12 },
                                { header: "Agents", accessor: "agentCount", width: 8 },
                                {
                                    header: "Status",
                                    accessor: "status",
                                    width: 10,
                                    color: ((r: Record<string, unknown>) =>
                                        String(r.status) === "active" ? colors.success : colors.muted),
                                },
                                {
                                    header: "Created",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.createdAt ? new Date(r.createdAt as string).toLocaleTimeString() : ""),
                                    width: 14,
                                },
                            ]}
                            emptyMessage="No active swarms."
                        />
                    )}
                </Box>
            )}

            {/* Telemetry sub-tab */}
            {subTab === "telemetry" && (
                <Box flexDirection="column">
                    {telemetry.loading && <Loading />}
                    {telemetry.error && <ErrorBox message={telemetry.error} />}
                    {telemetry.data && (
                        <Box flexDirection="column">
                            <Text color={colors.muted}>Agent Telemetry Data:</Text>
                            <Text wrap="wrap">{JSON.stringify(telemetry.data, null, 2).slice(0, 1000)}</Text>
                        </Box>
                    )}
                </Box>
            )}

            {/* Characters sub-tab */}
            {subTab === "characters" && (
                <Box flexDirection="column">
                    {characters.loading && <Loading />}
                    {characters.error && <ErrorBox message={characters.error} />}
                    {characters.data && (
                        <DataTable
                            data={characters.data}
                            columns={[
                                { header: "Name", accessor: "name", width: 22 },
                                { header: "Display", accessor: "displayName", width: 12 },
                                { header: "Profile", accessor: "executionProfile", width: 12 },
                                { header: "Max Tier", accessor: "maxRiskTier", width: 10 },
                                {
                                    header: "Tags",
                                    accessor: ((r: Record<string, unknown>) =>
                                        Array.isArray(r.tags) ? (r.tags as string[]).join(", ") : ""),
                                    width: 30,
                                },
                            ]}
                            emptyMessage="No characters loaded."
                        />
                    )}
                </Box>
            )}
        </Box>
    );
}
