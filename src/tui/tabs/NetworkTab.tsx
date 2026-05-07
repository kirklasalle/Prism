/**
 * PRISM TUI — Network tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { useApi, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, DataTable, SubTabBar, Loading, ErrorBox, KeyValue, SectionHeader } from "../components/ui.js";

export function NetworkTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("interfaces");
    const interfaces = useApi(client, (c) => c.getNetworkInterfaces(), 15000);
    const commands = useApi(client, (c) => c.getNetworkCommands(), 30000);
    const [cmdInput, setCmdInput] = useState("");
    const [cmdOutput, setCmdOutput] = useState<string[]>([]);
    const [cmdRunning, setCmdRunning] = useState(false);

    const executeCmd = useCallback(async () => {
        if (!cmdInput.trim() || cmdRunning) return;
        const cmd = cmdInput.trim();
        setCmdInput("");
        setCmdRunning(true);
        setCmdOutput((prev) => [...prev, `> ${cmd}`]);
        try {
            const result = await client.executeNetworkCommand(cmd);
            setCmdOutput((prev) => [...prev, result.output]);
        } catch (e: unknown) {
            setCmdOutput((prev) => [...prev, `[error] ${e instanceof Error ? e.message : String(e)}`]);
        } finally {
            setCmdRunning(false);
        }
    }, [cmdInput, cmdRunning, client]);

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab) {
            const tabs = ["interfaces", "commands", "console"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
    });

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "interfaces", label: "Interfaces" },
                    { id: "commands", label: "Commands" },
                    { id: "console", label: "Console" },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {subTab === "interfaces" && (
                <Box flexDirection="column">
                    {interfaces.loading && <Loading />}
                    {interfaces.error && <ErrorBox message={interfaces.error} />}
                    {interfaces.data && (
                        <DataTable
                            data={interfaces.data}
                            columns={[
                                { header: "Name", accessor: "name", width: 18 },
                                { header: "Address", accessor: "address", width: 20 },
                                { header: "Family", accessor: "family", width: 8 },
                                { header: "MAC", accessor: "mac", width: 20 },
                                {
                                    header: "Type",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.internal ? "internal" : "external"),
                                    width: 10,
                                    color: ((r: Record<string, unknown>) =>
                                        r.internal ? colors.muted : colors.success),
                                },
                            ]}
                        />
                    )}
                </Box>
            )}

            {subTab === "commands" && (
                <Box flexDirection="column">
                    {commands.loading && <Loading />}
                    {commands.error && <ErrorBox message={commands.error} />}
                    {commands.data && (
                        <DataTable
                            data={commands.data}
                            columns={[
                                { header: "Command", accessor: "name", width: 18 },
                                { header: "Tier", accessor: "tier", width: 6 },
                                { header: "Platform", accessor: "platform", width: 10 },
                                { header: "Description", accessor: "description", width: 40 },
                            ]}
                        />
                    )}
                </Box>
            )}

            {subTab === "console" && (
                <Box flexDirection="column" flexGrow={1}>
                    {cmdOutput.slice(-20).map((line, i) => (
                        <Text
                            key={i}
                            color={
                                line.startsWith(">") ? colors.user : line.startsWith("[error]") ? colors.error : colors.text
                            }
                        >
                            {line}
                        </Text>
                    ))}
                    {cmdRunning && <Loading label="Running..." />}
                    <Box borderStyle="single" borderColor={cmdRunning ? colors.muted : colors.brand} paddingX={1}>
                        <Text color={colors.brand}>&gt; </Text>
                        <TextInput
                            value={cmdInput}
                            onChange={setCmdInput}
                            onSubmit={executeCmd}
                            placeholder="Network command..."
                            focus={focused && subTab === "console" && !cmdRunning}
                        />
                    </Box>
                </Box>
            )}
        </Box>
    );
}
