/**
 * PRISM TUI — Workspace tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { PrismClient, WorkspaceFile } from "../api/prism-client.js";
import { useApi, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, Loading, ErrorBox, KeyValue, SectionHeader } from "../components/ui.js";

export function WorkspaceTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
    const [pathHistory, setPathHistory] = useState<string[]>([]);

    const files = useApi(
        client,
        useCallback((c: PrismClient) => c.getWorkspaceFiles(currentPath), [currentPath]),
        8000,
    );
    const git = useApi(client, (c) => c.getWorkspaceGit(), 15000);

    const fileNav = useListNavigation(files.data?.length ?? 0, focused);

    useInput((input, key) => {
        if (!focused) return;
        // Enter to open directory
        if (key.return && files.data?.[fileNav.selectedIndex]) {
            const item = files.data[fileNav.selectedIndex]!;
            if (item.isDirectory) {
                setPathHistory((h) => [...h, currentPath ?? ""]);
                setCurrentPath(item.path);
            }
        }
        // Backspace or dash to go back
        if (key.backspace || (input === "-" && key.shift)) {
            if (pathHistory.length > 0) {
                const prev = pathHistory[pathHistory.length - 1];
                setPathHistory((h) => h.slice(0, -1));
                setCurrentPath(prev || undefined);
            }
        }
    });

    return (
        <Box flexDirection="column">
            {/* File browser */}
            <Panel title={`Files: ${currentPath ?? "/"}`}>
                <Box marginBottom={1}>
                    <Text color={colors.muted}>
                        Enter: open dir | Backspace: back | j/k: navigate
                    </Text>
                </Box>
                {files.loading && <Loading />}
                {files.error && <ErrorBox message={files.error} />}
                {files.data?.map((file, i) => (
                    <Box key={file.path}>
                        <Text color={i === fileNav.selectedIndex ? colors.brand : colors.muted}>
                            {i === fileNav.selectedIndex ? `${symbols.arrow} ` : "  "}
                        </Text>
                        <Text color={file.isDirectory ? colors.info : colors.text}>
                            {file.isDirectory ? `${symbols.arrowDown} ` : "  "}
                            {file.name}
                        </Text>
                        {file.size !== undefined && !file.isDirectory && (
                            <Text color={colors.muted}>
                                {" "}({(file.size / 1024).toFixed(1)} KB)
                            </Text>
                        )}
                    </Box>
                ))}
                {files.data?.length === 0 && (
                    <Text color={colors.muted}>Empty directory.</Text>
                )}
            </Panel>

            {/* Git status */}
            <SectionHeader title="Git Status" />
            <Box flexDirection="column" marginTop={1}>
                {git.loading && <Loading />}
                {git.error && <ErrorBox message={git.error} />}
                {git.data && (
                    <Box flexDirection="column">
                        {Object.entries(git.data).map(([key, val]) => (
                            <KeyValue key={key} label={key} value={String(val)} />
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
