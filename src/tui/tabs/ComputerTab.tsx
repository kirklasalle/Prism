/**
 * PRISM TUI — Computer Control tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { useApi } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, KeyValue, Loading, ErrorBox, SectionHeader } from "../components/ui.js";

export function ComputerTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const sysInfo = useApi(client, (c) => c.getSystemInfo(), 15000);
    const [shellInput, setShellInput] = useState("");
    const [shellOutput, setShellOutput] = useState<string[]>([]);
    const [shellRunning, setShellRunning] = useState(false);

    const executeCommand = useCallback(async () => {
        if (!shellInput.trim() || shellRunning) return;
        const cmd = shellInput.trim();
        setShellInput("");
        setShellRunning(true);
        setShellOutput((prev) => [...prev, `$ ${cmd}`]);
        try {
            const result = await client.executeShell(cmd);
            if (result.stdout) setShellOutput((prev) => [...prev, result.stdout]);
            if (result.stderr) setShellOutput((prev) => [...prev, `[stderr] ${result.stderr}`]);
            setShellOutput((prev) => [...prev, `[exit: ${result.exitCode}]`]);
        } catch (e: unknown) {
            setShellOutput((prev) => [...prev, `[error] ${e instanceof Error ? e.message : String(e)}`]);
        } finally {
            setShellRunning(false);
        }
    }, [shellInput, shellRunning, client]);

    const visibleOutput = shellOutput.slice(-20);

    return (
        <Box flexDirection="column" flexGrow={1}>
            {/* System Info */}
            <Panel title="System Information">
                {sysInfo.loading && <Loading />}
                {sysInfo.error && <ErrorBox message={sysInfo.error} />}
                {sysInfo.data && (
                    <Box flexDirection="column">
                        <Box gap={4}>
                            <Box flexDirection="column">
                                <KeyValue label="OS" value={sysInfo.data.os} />
                                <KeyValue label="Arch" value={sysInfo.data.arch} />
                                <KeyValue label="Node" value={sysInfo.data.nodeVersion} />
                            </Box>
                            <Box flexDirection="column">
                                <KeyValue label="CPUs" value={String(sysInfo.data.cpus)} />
                                <KeyValue
                                    label="Memory"
                                    value={`${(sysInfo.data.freeMemory / 1073741824).toFixed(1)} / ${(sysInfo.data.totalMemory / 1073741824).toFixed(1)} GB`}
                                />
                                <KeyValue label="Uptime" value={`${(sysInfo.data.uptime / 3600).toFixed(1)} hours`} />
                            </Box>
                        </Box>
                    </Box>
                )}
            </Panel>

            {/* Shell */}
            <SectionHeader title="Shell Execution" />
            <Box flexDirection="column" flexGrow={1} marginTop={1}>
                {visibleOutput.map((line, i) => (
                    <Text
                        key={i}
                        color={
                            line.startsWith("$")
                                ? colors.user
                                : line.startsWith("[stderr]")
                                    ? colors.error
                                    : line.startsWith("[error]")
                                        ? colors.error
                                        : line.startsWith("[exit:")
                                            ? colors.muted
                                            : colors.text
                        }
                    >
                        {line}
                    </Text>
                ))}
                {shellRunning && <Loading label="Executing..." />}
            </Box>

            <Box borderStyle="single" borderColor={shellRunning ? colors.muted : colors.brand} paddingX={1}>
                <Text color={colors.brand}>$ </Text>
                <TextInput
                    value={shellInput}
                    onChange={setShellInput}
                    onSubmit={executeCommand}
                    placeholder="Enter command..."
                    focus={focused && !shellRunning}
                />
            </Box>
        </Box>
    );
}
