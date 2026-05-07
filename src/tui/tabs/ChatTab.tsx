/**
 * PRISM TUI — Chat Interface tab
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient, ChatMessage, SessionInfo } from "../api/prism-client.js";
import type { PrismWsClient } from "../api/ws-client.js";
import { useApi } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import { Loading, ErrorBox, KeyValue } from "../components/ui.js";

export function ChatTab({
    client,
    wsClient,
    focused,
}: {
    client: PrismClient;
    wsClient: PrismWsClient;
    focused: boolean;
}): React.JSX.Element {
    const [activeSession, setActiveSession] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<"chat" | "sessions">("chat");
    const [sessionIdx, setSessionIdx] = useState(0);

    const sessionsResult = useApi(client, (c) => c.getSessions(), 10000);

    // Load messages when session changes
    useEffect(() => {
        if (!activeSession) return;
        client
            .getMessages(activeSession)
            .then((msgs) => setMessages(msgs))
            .catch(() => setMessages([]));
    }, [activeSession, client]);

    // Auto-select first session
    useEffect(() => {
        if (!activeSession && sessionsResult.data && sessionsResult.data.length > 0) {
            setActiveSession(sessionsResult.data[0]!.id);
        }
    }, [sessionsResult.data, activeSession]);

    const sendMessage = useCallback(async () => {
        if (!inputValue.trim() || sending) return;
        const text = inputValue.trim();
        setInputValue("");
        setSending(true);
        setError(null);

        // Optimistic: add user message
        setMessages((prev) => [...prev, { role: "user", content: text }]);

        try {
            const resp = await client.sendChat(text, activeSession ?? undefined);
            if (resp.sessionId && !activeSession) {
                setActiveSession(resp.sessionId);
            }
            setMessages((prev) => [...prev, { role: "assistant", content: resp.response }]);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSending(false);
        }
    }, [inputValue, sending, client, activeSession]);

    const createSession = useCallback(async () => {
        try {
            const sess = await client.createSession();
            setActiveSession(sess.id);
            setMessages([]);
            setMode("chat");
            sessionsResult.refresh();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [client, sessionsResult]);

    // Keyboard: Escape toggles sessions view, Enter sends
    useInput(
        (input, key) => {
            if (!focused) return;
            if (key.escape) {
                setMode((m) => (m === "chat" ? "sessions" : "chat"));
                return;
            }
            if (mode === "sessions") {
                if (input === "j" || key.downArrow) {
                    setSessionIdx((i) => Math.min(i + 1, (sessionsResult.data?.length ?? 1) - 1));
                } else if (input === "k" || key.upArrow) {
                    setSessionIdx((i) => Math.max(i - 1, 0));
                } else if (key.return && sessionsResult.data?.[sessionIdx]) {
                    setActiveSession(sessionsResult.data[sessionIdx]!.id);
                    setMode("chat");
                } else if (input === "n") {
                    createSession();
                }
            }
        },
    );

    /* ---- Sessions list view ---- */
    if (mode === "sessions") {
        return (
            <Box flexDirection="column">
                <Box marginBottom={1}>
                    <Text bold color={colors.brand}>Sessions</Text>
                    <Text color={colors.muted}> (j/k navigate, Enter select, n new, Esc back)</Text>
                </Box>
                {sessionsResult.loading && <Loading label="Loading sessions..." />}
                {sessionsResult.error && <ErrorBox message={sessionsResult.error} />}
                {sessionsResult.data?.map((s, i) => (
                    <Box key={s.id}>
                        <Text color={i === sessionIdx ? colors.brand : colors.muted}>
                            {i === sessionIdx ? `${symbols.arrow} ` : "  "}
                        </Text>
                        <Text color={s.id === activeSession ? colors.info : colors.text}>
                            {s.label || s.id.slice(0, 8)}
                        </Text>
                        <Text color={colors.muted}> ({s.messageCount} msgs)</Text>
                    </Box>
                ))}
                {sessionsResult.data?.length === 0 && (
                    <Text color={colors.muted}>No sessions. Press n to create one.</Text>
                )}
            </Box>
        );
    }

    /* ---- Chat view ---- */
    const visibleMessages = messages.slice(-20);

    return (
        <Box flexDirection="column" flexGrow={1}>
            {/* Session info bar */}
            <Box marginBottom={1}>
                <Text color={colors.muted}>
                    Session: {activeSession ? activeSession.slice(0, 8) : "none"} | Esc: sessions
                </Text>
            </Box>

            {/* Messages area */}
            <Box flexDirection="column" flexGrow={1}>
                {visibleMessages.length === 0 && (
                    <Text color={colors.muted}>No messages yet. Type below to start chatting.</Text>
                )}
                {visibleMessages.map((msg, i) => (
                    <Box key={i} marginBottom={0} flexDirection="column">
                        <Text
                            bold
                            color={
                                msg.role === "user"
                                    ? colors.user
                                    : msg.role === "assistant"
                                      ? colors.assistant
                                      : colors.system
                            }
                        >
                            {msg.role === "user" ? "You" : msg.role === "assistant" ? "PRISM" : "System"}:
                        </Text>
                        <Box marginLeft={2}>
                            <Text wrap="wrap">{msg.content}</Text>
                        </Box>
                    </Box>
                ))}
                {sending && <Loading label="Thinking..." />}
            </Box>

            {/* Error display */}
            {error && <ErrorBox message={error} />}

            {/* Input area */}
            <Box borderStyle="single" borderColor={sending ? colors.muted : colors.brand} paddingX={1}>
                <Text color={colors.brand}>{symbols.arrow} </Text>
                <TextInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={sendMessage}
                    placeholder="Type a message..."
                    focus={focused && mode === "chat" && !sending}
                />
            </Box>
        </Box>
    );
}
