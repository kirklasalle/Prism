/**
 * PRISM TUI — Main application entry point.
 *
 * Usage:
 *   npx tsx src/tui/app.tsx [--port 7070]
 *
 * Connects to the running PRISM server as a pure API client.
 */
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { PrismClient } from "./api/prism-client.js";
import { PrismWsClient } from "./api/ws-client.js";
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

function parseArgs(): { port: number; setup: boolean } {
    const args = process.argv.slice(2);
    let port = 7070;
    let setup = false;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
            port = parseInt(args[i + 1]!, 10);
            if (isNaN(port)) port = 7070;
        }
        if (args[i] === "--setup") {
            setup = true;
        }
    }
    if (process.env.PRISM_DASHBOARD_PORT) {
        const envPort = parseInt(process.env.PRISM_DASHBOARD_PORT, 10);
        if (!isNaN(envPort)) port = envPort;
    }
    return { port, setup };
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
/*  Root                                                               */
/* ------------------------------------------------------------------ */

function Root({ client, wsClient, port, forceSetup }: { client: PrismClient; wsClient: PrismWsClient; port: number; forceSetup: boolean }): React.JSX.Element {
    const [ready, setReady] = useState(false);
    const [needsSetup, setNeedsSetup] = useState<boolean | null>(forceSetup || null);

    useEffect(() => {
        if (forceSetup) {
            setNeedsSetup(true);
            return;
        }
        client.getSetupStatus()
            .then((s) => setNeedsSetup(!s.setupComplete))
            .catch(() => setNeedsSetup(false));
    }, [client, forceSetup]);

    if (!ready) {
        return <Splash port={port} onDone={() => setReady(true)} />;
    }

    if (needsSetup) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
                <SetupWizardTab client={client} focused={true} onComplete={() => setNeedsSetup(false)} />
            </Box>
        );
    }

    return <App client={client} wsClient={wsClient} />;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const { port, setup } = parseArgs();
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

render(<Root client={client} wsClient={wsClient} port={port} forceSetup={setup} />);
