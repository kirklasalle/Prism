/**
 * PRISM TUI — Main application entry point.
 *
 * Usage:
 *   npx tsx src/tui/app.tsx [--port 7070]
 *
 * Connects to the running PRISM server as a pure API client.
 */
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismClient } from "./api/prism-client.js";
import { PrismWsClient } from "./api/ws-client.js";
import { LoginTab } from "./tabs/LoginTab.js";
import {
    colors, symbols, TABS, PRISM_LOGO, TAB_SHORTCUTS,
} from "./theme.js";
import {
    Header, TabBar, StatusBar, HelpOverlay, Loading,
} from "./components/ui.js";
import { useConnection, useTabNavigation, useQuit } from "./hooks.js";

// Tab components
import { ChatTab } from "./tabs/ChatTab.js";
import { SettingsTab } from "./tabs/SettingsTab.js";
import { ToolsTab } from "./tabs/ToolsTab.js";
import { AgenticTab } from "./tabs/AgenticTab.js";
import { ComputerTab } from "./tabs/ComputerTab.js";
import { BrowserTab } from "./tabs/BrowserTab.js";
import { WorkspaceTab } from "./tabs/WorkspaceTab.js";
import { NetworkTab } from "./tabs/NetworkTab.js";
import { TelemetryTab } from "./tabs/TelemetryTab.js";
import { LogsTab } from "./tabs/LogsTab.js";
import { SchedulerTab } from "./tabs/SchedulerTab.js";
import { SetupWizardTab } from "./tabs/SetupWizardTab.js";

/* ------------------------------------------------------------------ */
/*  Parse CLI arguments                                                */
/* ------------------------------------------------------------------ */

function parseArgs(): { port: number; setup: boolean; autoLogin: boolean } {
    const args = process.argv.slice(2);
    let port = 7070;
    let setup = false;
    let autoLogin = false;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
            port = parseInt(args[i + 1]!, 10);
            if (isNaN(port)) port = 7070;
        }
        if (args[i] === "--setup") {
            setup = true;
        }
        if (args[i] === "--auto-login") {
            autoLogin = true;
        }
    }
    if (process.env.PRISM_DASHBOARD_PORT) {
        const envPort = parseInt(process.env.PRISM_DASHBOARD_PORT, 10);
        if (!isNaN(envPort)) port = envPort;
    }
    return { port, setup, autoLogin };
}

/* ------------------------------------------------------------------ */
/*  App component                                                      */
/* ------------------------------------------------------------------ */

function App({ client, wsClient }: { client: PrismClient; wsClient: PrismWsClient }): React.JSX.Element {
    const [activeTab, setActiveTab] = useState("chat");
    const [showHelp, setShowHelp] = useState(false);
    const [profile, setProfile] = useState("individual");
    const connected = useConnection(wsClient);

    // Detect execution profile from server health
    useEffect(() => {
        client.getHealth().then((h) => {
            const obj = h as unknown as Record<string, unknown>;
            if (obj && "executionProfile" in obj) {
                setProfile(String(obj.executionProfile ?? "individual"));
            }
        }).catch(() => {/* ignore */ });
    }, [client]);

    // Global keyboard
    useInput((input, key) => {
        // Tab shortcuts (1-9, 0, -, =)
        const tabId = TAB_SHORTCUTS[input];
        if (tabId && !showHelp) {
            setActiveTab(tabId);
            return;
        }
        // Help toggle
        if (input === "?") {
            setShowHelp((h) => !h);
            return;
        }
    });

    useQuit();

    // Render active tab content
    const renderTab = () => {
        const focused = !showHelp;
        switch (activeTab) {
            case "chat":
                return <ChatTab client={client} wsClient={wsClient} focused={focused} />;
            case "settings":
                return <SettingsTab client={client} focused={focused} />;
            case "tools":
                return <ToolsTab client={client} wsClient={wsClient} focused={focused} />;
            case "agentic":
                return <AgenticTab client={client} wsClient={wsClient} focused={focused} />;
            case "computer":
                return <ComputerTab client={client} focused={focused} />;
            case "browser":
                return <BrowserTab client={client} focused={focused} />;
            case "workspace":
                return <WorkspaceTab client={client} focused={focused} />;
            case "network":
                return <NetworkTab client={client} focused={focused} />;
            case "telemetry":
                return <TelemetryTab client={client} focused={focused} />;
            case "logs":
                return <LogsTab client={client} wsClient={wsClient} focused={focused} />;
            case "scheduler":
                return <SchedulerTab client={client} focused={focused} />;
            case "characters":
                return <AgenticTab client={client} wsClient={wsClient} focused={focused} />;
            case "setup":
                return <SetupWizardTab client={client} focused={focused} onComplete={() => setActiveTab("chat")} />;
            default:
                return <Text color={colors.muted}>Unknown tab: {activeTab}</Text>;
        }
    };

    return (
        <Box flexDirection="column" flexGrow={1}>
            {/* Header */}
            <Header profile={profile} connected={connected} version="0.2.0" />

            {/* Tab bar */}
            <TabBar tabs={TABS} activeTab={activeTab} onSelect={setActiveTab} />

            {/* Content area */}
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
                {showHelp ? <HelpOverlay /> : renderTab()}
            </Box>

            {/* Status bar */}
            <StatusBar
                left={`${symbols.gear} ${activeTab}`}
                center={connected ? "" : `${symbols.warning} Server disconnected`}
                right={`?: help | q: quit`}
            />
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Splash screen                                                      */
/* ------------------------------------------------------------------ */

function Splash({ port, onDone }: { port: number; onDone: () => void }): React.JSX.Element {
    useEffect(() => {
        const t = setTimeout(onDone, 1500);
        return () => clearTimeout(t);
    }, [onDone]);

    return (
        <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
            <Text color={colors.brand}>{PRISM_LOGO}</Text>
            <Text> </Text>
            <Text color={colors.text} bold>Terminal User Interface</Text>
            <Text color={colors.muted}>Connecting to localhost:{port}...</Text>
            <Box marginTop={1}>
                <Loading label="Initializing..." />
            </Box>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Token Resolution                                                   */
/* ------------------------------------------------------------------ */

function getAdminToken(): string | null {
    // 1. Check environment variable
    const envRoot = process.env.PRISM_WORKSPACE_ROOT;
    if (envRoot) {
        const tokenPath = path.join(envRoot, "state", "admin-token");
        if (fs.existsSync(tokenPath)) {
            return fs.readFileSync(tokenPath, "utf-8").trim();
        }
    }
    // 2. Check preferences for custom root
    const projectDir = process.cwd();
    const prefsPath = path.join(projectDir, ".prism-preferences.json");
    if (fs.existsSync(prefsPath)) {
        try {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
            if (prefs?.workspaceRoot) {
                const tokenPath = path.join(prefs.workspaceRoot, "state", "admin-token");
                if (fs.existsSync(tokenPath)) {
                    return fs.readFileSync(tokenPath, "utf-8").trim();
                }
            }
        } catch { /* ignore */ }
    }
    // 3. Fallback to default OS path
    const home = os.homedir();
    const defaultRoot = path.join(home, "Documents", "Prism_Refraction");
    const tokenPath = path.join(defaultRoot, "state", "admin-token");
    if (fs.existsSync(tokenPath)) {
        return fs.readFileSync(tokenPath, "utf-8").trim();
    }
    return null;
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

function Root({ client, wsClient, port, forceSetup, autoLogin }: { client: PrismClient; wsClient: PrismWsClient; port: number; forceSetup: boolean; autoLogin: boolean }): React.JSX.Element {
    const [ready, setReady] = useState(false);
    const [needsSetup, setNeedsSetup] = useState<boolean | null>(forceSetup || null);
    const [authenticated, setAuthenticated] = useState<boolean>(false);
    const [authenticating, setAuthenticating] = useState<boolean>(true);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    useQuit();

    useEffect(() => {
        if (forceSetup) {
            setNeedsSetup(true);
            setAuthenticating(false);
            return;
        }

        let active = true;
        let timer: NodeJS.Timeout;

        const probePort = async (p: number): Promise<boolean> => {
            const tempClient = new PrismClient({ baseUrl: `http://localhost:${p}`, timeout: 1500 });
            try {
                await tempClient.getSetupStatus();
                return true;
            } catch {
                return false;
            }
        };

        const checkConnection = async () => {
            try {
                let activePort = port;
                const primaryOk = await probePort(port);
                if (!primaryOk) {
                    const altPort = port === 7070 ? 7071 : 7070;
                    const altOk = await probePort(altPort);
                    if (altOk) {
                        activePort = altPort;
                        client.setBaseUrl(`http://localhost:${altPort}`);
                        wsClient.setUrl(`ws://localhost:${altPort}/ws`);
                        wsClient.disconnect();
                        wsClient.connect();
                    } else {
                        throw new Error(`Server not reachable on port ${port} or ${altPort}.`);
                    }
                }

                // 1. Check setup completion
                const s = await client.getSetupStatus();
                if (!active) return;
                setConnectionError(null);

                if (!s.setupComplete) {
                    setNeedsSetup(true);
                    setAuthenticating(false);
                    return;
                }
                setNeedsSetup(false);

                // 2. Setup is complete, try silent login if requested
                if (autoLogin) {
                    const token = getAdminToken();
                    if (token) {
                        client.setToken(token);
                        wsClient.setToken(token);
                        // Reconnect WebSocket to verify connection with token
                        wsClient.disconnect();
                        wsClient.connect();

                        // Verify token against /api/iam/me
                        try {
                            await client.getIamMe();
                            if (!active) return;
                            setAuthenticated(true);
                            setAuthenticating(false);
                            return;
                        } catch {
                            // Token invalid/expired
                            client.setToken(null);
                            wsClient.setToken(null);
                        }
                    }
                }
                setAuthenticating(false);
            } catch (err: any) {
                if (!active) return;
                setConnectionError(`Server not reachable on port ${port} or ${port === 7070 ? 7071 : 7070}. Retrying connection...`);
                // Retry in 3 seconds
                timer = setTimeout(checkConnection, 3000);
            }
        };

        checkConnection();

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [client, wsClient, forceSetup, autoLogin, port]);

    const handleLoginSuccess = useCallback((token: string | null, cookie: string | null) => {
        client.setToken(token);
        client.setCookie(cookie);
        wsClient.setToken(token);
        wsClient.setCookie(cookie);
        wsClient.disconnect();
        wsClient.connect();
        setAuthenticated(true);
    }, [client, wsClient]);

    if (!ready) {
        return <Splash port={port} onDone={() => setReady(true)} />;
    }

    if (connectionError) {
        return (
            <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={4} width="100%">
                <Box marginBottom={1}>
                    <Text color={colors.error} bold>
                        {symbols.warning} CONNECTION ERROR
                    </Text>
                </Box>
                <Text color={colors.text}>{connectionError}</Text>
                <Text color={colors.muted}>Please check if the PRISM server is started and listening.</Text>
                <Box marginTop={1}>
                    <Loading label="Reconnecting..." />
                </Box>
            </Box>
        );
    }

    if (authenticating) {
        return (
            <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
                <Loading label="Verifying security session..." />
            </Box>
        );
    }

    if (needsSetup) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
                <SetupWizardTab
                    client={client}
                    focused={true}
                    onComplete={() => {
                        setNeedsSetup(false);
                        setAuthenticated(false); // Force authentication after setup wizard
                    }}
                />
            </Box>
        );
    }

    if (!authenticated) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
                <LoginTab
                    client={client}
                    focused={true}
                    onSuccess={handleLoginSuccess}
                    onLaunchWizard={() => setNeedsSetup(true)}
                />
            </Box>
        );
    }

    return <App client={client} wsClient={wsClient} />;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

// Resize terminal to 160 columns x 50 lines (100% size increase)
if (process.stdout.isTTY) {
    process.stdout.write("\x1b[8;50;160t");
}

const { port, setup, autoLogin } = parseArgs();
const baseUrl = `http://localhost:${port}`;
const wsUrl = `ws://localhost:${port}/ws`;

const client = new PrismClient({ baseUrl });
const wsClient = new PrismWsClient({ url: wsUrl });
wsClient.connect();

// Graceful shutdown
process.on("SIGINT", () => {
    wsClient.disconnect();
    process.exit(0);
});
process.on("SIGTERM", () => {
    wsClient.disconnect();
    process.exit(0);
});

render(<Root client={client} wsClient={wsClient} port={port} forceSetup={setup} autoLogin={autoLogin} />);
