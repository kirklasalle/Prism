/**
 * PRISM TUI — Theme constants: colors, symbols, and profile-aware styling.
 */

export const colors = {
    // Brand
    brand: "#7c3aed",
    brandDim: "#5b21b6",

    // Status
    success: "green",
    warning: "yellow",
    error: "red",
    info: "cyan",
    idle: "gray",

    // Execution profile
    individual: "cyan",
    individualDim: "blueBright",
    business: "yellow",
    businessDim: "yellowBright",

    // UI chrome
    border: "gray",
    borderFocused: "white",
    headerBg: "#1e1b4b",
    muted: "gray",
    text: "white",
    textDim: "gray",

    // Risk tiers
    tier1: "green",
    tier2: "yellow",
    tier3: "red",

    // Roles
    user: "cyan",
    assistant: "magenta",
    system: "gray",
} as const;

export const symbols = {
    bullet: "●",
    circle: "○",
    check: "✓",
    cross: "✗",
    arrow: "→",
    arrowUp: "↑",
    arrowDown: "↓",
    bar: "│",
    dash: "─",
    dot: "·",
    ellipsis: "…",
    star: "★",
    warning: "⚠",
    lock: "🔒",
    key: "🔑",
    gear: "⚙",
    lightning: "⚡",
    clock: "⏱",
    refresh: "↻",
    connection: "⬤",
} as const;

export const borders = {
    top: "─",
    bottom: "─",
    left: "│",
    right: "│",
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    teeLeft: "├",
    teeRight: "┤",
    teeTop: "┬",
    teeBottom: "┴",
    cross: "┼",
} as const;

export function profileColor(profile: string): string {
    return profile === "business" ? colors.business : colors.individual;
}

export function tierColor(tier: number): string {
    if (tier === 1) return colors.tier1;
    if (tier === 2) return colors.tier2;
    return colors.tier3;
}

export function statusColor(status: string): string {
    const s = status.toLowerCase();
    if (s === "pass" || s === "healthy" || s === "active" || s === "ok" || s === "approved" || s === "running")
        return colors.success;
    if (s === "warn" || s === "warning" || s === "idle" || s === "pending") return colors.warning;
    if (s === "fail" || s === "error" || s === "unhealthy" || s === "denied" || s === "stopped") return colors.error;
    return colors.muted;
}

export const PRISM_LOGO = `
 ██████╗ ██████╗ ██╗███████╗███╗   ███╗
 ██╔══██╗██╔══██╗██║██╔════╝████╗ ████║
 ██████╔╝██████╔╝██║███████╗██╔████╔██║
 ██╔═══╝ ██╔══██╗██║╚════██║██║╚██╔╝██║
 ██║     ██║  ██║██║███████║██║ ╚═╝ ██║
 ╚═╝     ╚═╝  ╚═╝╚═╝╚══════╝╚═╝     ╚═╝
`.trim();

export const TAB_SHORTCUTS: Record<string, string> = {
    "1": "chat",
    "2": "settings",
    "3": "tools",
    "4": "agentic",
    "5": "computer",
    "6": "browser",
    "7": "workspace",
    "8": "network",
    "9": "telemetry",
    "0": "logs",
    "-": "scheduler",
    "=": "characters",
};

export interface TabDefinition {
    id: string;
    label: string;
    shortcut: string;
}

export const TABS: TabDefinition[] = [
    { id: "chat", label: "Chat", shortcut: "1" },
    { id: "settings", label: "Settings", shortcut: "2" },
    { id: "tools", label: "Tools", shortcut: "3" },
    { id: "agentic", label: "Agents", shortcut: "4" },
    { id: "computer", label: "Computer", shortcut: "5" },
    { id: "browser", label: "Browser", shortcut: "6" },
    { id: "workspace", label: "Workspace", shortcut: "7" },
    { id: "network", label: "Network", shortcut: "8" },
    { id: "telemetry", label: "Telemetry", shortcut: "9" },
    { id: "logs", label: "Logs", shortcut: "0" },
    { id: "scheduler", label: "Scheduler", shortcut: "-" },
    { id: "characters", label: "Characters", shortcut: "=" },
];
