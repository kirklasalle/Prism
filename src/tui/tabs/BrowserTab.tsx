/**
 * PRISM TUI — Browser Control tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { useApi } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, KeyValue, Loading, ErrorBox, StatusBadge, SectionHeader } from "../components/ui.js";

export function BrowserTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const session = useApi(client, (c) => c.getBrowserSession(), 5000);
    const [urlInput, setUrlInput] = useState("");
    const [consoleLog, setConsoleLog] = useState<Array<{ level: string; message: string }>>([]);
    const [actionMsg, setActionMsg] = useState<string | null>(null);

    const launchBrowser = useCallback(async (headless: boolean) => {
        try {
            await client.launchBrowser(headless);
            setActionMsg(`Browser launched (${headless ? "headless" : "headed"})`);
            session.refresh();
        } catch (e: unknown) {
            setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [client, session]);

    const closeBrowser = useCallback(async () => {
        try {
            await client.closeBrowser();
            setActionMsg("Browser closed");
            session.refresh();
        } catch (e: unknown) {
            setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [client, session]);

    const navigate = useCallback(async () => {
        if (!urlInput.trim()) return;
        try {
            const result = await client.navigateBrowser(urlInput.trim());
            setActionMsg(`Navigated: ${result.title}`);
            setUrlInput("");
            session.refresh();
        } catch (e: unknown) {
            setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [urlInput, client, session]);

    const refreshConsole = useCallback(async () => {
        try {
            const logs = await client.getBrowserConsole();
            setConsoleLog(logs.slice(-20));
        } catch {
            // ignore
        }
    }, [client]);

    useInput((input, key) => {
        if (!focused) return;
        if (input === "l") launchBrowser(true);
        if (input === "L") launchBrowser(false);
        if (input === "c") closeBrowser();
        if (input === "r") refreshConsole();
    });

    React.useEffect(() => {
        if (!actionMsg) return;
        const t = setTimeout(() => setActionMsg(null), 3000);
        return () => clearTimeout(t);
    }, [actionMsg]);

    return (
        <Box flexDirection="column">
            {actionMsg && (
                <Box marginBottom={1}>
                    <Text color={colors.info}>{symbols.arrow} {actionMsg}</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text color={colors.muted}>
                    l: launch headless | L: launch headed | c: close | r: refresh console
                </Text>
            </Box>

            {/* Session status */}
            <Panel title="Browser Session">
                {session.loading && <Loading />}
                {session.error && <ErrorBox message={session.error} />}
                {session.data && (
                    <Box flexDirection="column">
                        <StatusBadge
                            status={session.data.active ? "active" : "idle"}
                            label={session.data.active ? "Active" : "No active session"}
                        />
                        {session.data.active && (
                            <>
                                <KeyValue label="URL" value={session.data.url ?? "about:blank"} valueColor={colors.info} />
                                <KeyValue label="Title" value={session.data.title ?? ""} />
                                <KeyValue label="Mode" value={session.data.headless ? "Headless" : "Headed"} />
                            </>
                        )}
                    </Box>
                )}
            </Panel>

            {/* Navigation */}
            {session.data?.active && (
                <Box borderStyle="single" borderColor={colors.brand} paddingX={1} marginBottom={1}>
                    <Text color={colors.brand}>URL: </Text>
                    <TextInput
                        value={urlInput}
                        onChange={setUrlInput}
                        onSubmit={navigate}
                        placeholder="https://..."
                        focus={focused && session.data?.active === true}
                    />
                </Box>
            )}

            {/* Console log */}
            <SectionHeader title="Browser Console" />
            <Box flexDirection="column" marginTop={1}>
                {consoleLog.length === 0 && (
                    <Text color={colors.muted}>Press r to load console logs.</Text>
                )}
                {consoleLog.map((entry, i) => (
                    <Box key={i}>
                        <Text color={entry.level === "error" ? colors.error : entry.level === "warn" ? colors.warning : colors.muted}>
                            [{entry.level}]
                        </Text>
                        <Text> {entry.message}</Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
