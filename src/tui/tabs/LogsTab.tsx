/**
 * PRISM TUI — Logs & Debug tab
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import type { PrismWsClient, WsMessage } from "../api/ws-client.js";
import { useApi, useScrollableLog, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Panel, Loading, ErrorBox, SubTabBar, KeyValue, SectionHeader } from "../components/ui.js";

export function LogsTab({
    client,
    wsClient,
    focused,
}: {
    client: PrismClient;
    wsClient: PrismWsClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("live");
    const [filterText, setFilterText] = useState("");
    const [filterMode, setFilterMode] = useState(false);
    const liveLogs = useScrollableLog(200);
    const events = useApi(client, (c) => c.getEvents(50), 10000);

    // Subscribe to WebSocket for live logs
    useEffect(() => {
        const handler = (msg: WsMessage) => {
            const ts = new Date().toLocaleTimeString();
            const type = msg.type ?? "unknown";
            const detail = JSON.stringify(msg).slice(0, 120);
            liveLogs.append(`[${ts}] ${type}: ${detail}`);
        };
        wsClient.on("message", handler);
        return () => {
            wsClient.off("message", handler);
        };
    }, [wsClient]); // intentionally not including liveLogs to avoid re-subscribe loop

    const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
    const eventNav = useListNavigation(events.data?.length ?? 0, focused && subTab === "events");

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab && !filterMode) {
            const tabs = ["live", "events"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
        if (input === "/" && !filterMode) {
            setFilterMode(true);
        }
        if (key.escape && filterMode) {
            setFilterMode(false);
        }
        if (subTab === "live" && input === "c" && !filterMode) {
            liveLogs.clear();
        }
        if (subTab === "events" && key.return) {
            setSelectedEvent(selectedEvent === eventNav.selectedIndex ? null : eventNav.selectedIndex);
        }
    });

    // Filter live logs
    const visibleLogs = filterText
        ? liveLogs.lines.filter((l) => l.toLowerCase().includes(filterText.toLowerCase()))
        : liveLogs.lines;
    const displayLogs = visibleLogs.slice(-30);

    return (
        <Box flexDirection="column" flexGrow={1}>
            <SubTabBar
                tabs={[
                    { id: "live", label: `Live Stream (${liveLogs.lines.length})` },
                    { id: "events", label: `Events (${events.data?.length ?? 0})` },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {/* Filter bar */}
            {filterMode && (
                <Box borderStyle="single" borderColor={colors.info} paddingX={1} marginBottom={1}>
                    <Text color={colors.info}>Filter: </Text>
                    <TextInput
                        value={filterText}
                        onChange={setFilterText}
                        focus={filterMode}
                        placeholder="Type to filter... (Esc to close)"
                    />
                </Box>
            )}

            {!filterMode && (
                <Box marginBottom={1}>
                    <Text color={colors.muted}>
                        /: filter | c: clear | Tab: switch view
                    </Text>
                </Box>
            )}

            {/* Live stream */}
            {subTab === "live" && (
                <Box flexDirection="column" flexGrow={1}>
                    {displayLogs.length === 0 && (
                        <Text color={colors.muted}>Waiting for events...</Text>
                    )}
                    {displayLogs.map((line, i) => {
                        const isError = line.includes("error") || line.includes("Error");
                        const isWarning = line.includes("warn") || line.includes("Warning");
                        return (
                            <Text
                                key={i}
                                color={isError ? colors.error : isWarning ? colors.warning : colors.textDim}
                                wrap="truncate"
                            >
                                {line}
                            </Text>
                        );
                    })}
                </Box>
            )}

            {/* Historical events */}
            {subTab === "events" && (
                <Box flexDirection="column">
                    {events.loading && <Loading />}
                    {events.error && <ErrorBox message={events.error} />}
                    {events.data?.map((evt, i) => (
                        <Box key={evt.id || i} flexDirection="column">
                            <Box>
                                <Text color={i === eventNav.selectedIndex ? colors.brand : colors.muted}>
                                    {i === eventNav.selectedIndex ? `${symbols.arrow} ` : "  "}
                                </Text>
                                <Text color={colors.muted}>
                                    {new Date(evt.timestamp).toLocaleTimeString()}
                                </Text>
                                <Text> </Text>
                                <Text color={colors.info}>{evt.operation}</Text>
                                <Text color={colors.textDim}> [{evt.type}]</Text>
                            </Box>
                            {selectedEvent === i && evt.detail && (
                                <Box marginLeft={4} marginBottom={1}>
                                    <Text color={colors.textDim} wrap="wrap">
                                        {JSON.stringify(evt.detail, null, 2).slice(0, 500)}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}
