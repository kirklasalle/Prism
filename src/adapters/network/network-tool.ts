import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

const execAsync = promisify(exec);

/** Tier classification for network commands. */
type NetworkTier = "tier1" | "tier2" | "tier3";

interface NetworkCommandDef {
    /** Primary command keyword(s) used for matching. */
    match: string[];
    tier: NetworkTier;
    description: string;
    /** Whether this command mutates network state. */
    mutating: boolean;
    /** Platform availability: "win", "linux", or "both". */
    platform: "win" | "linux" | "both";
}

/**
 * Curated allowlist of network commands with per-command tier classification.
 *
 * Tier 1 — read-only diagnostics (auto-allow)
 * Tier 2 — config inspection / mapped drive management (conditional)
 * Tier 3 — mutating network configuration (approval-gated)
 */
const NETWORK_COMMANDS: readonly NetworkCommandDef[] = [
    // ── Tier 1: Read-only diagnostics ───────────────────────────────────
    { match: ["ipconfig"], tier: "tier1", description: "Display network interface configuration", mutating: false, platform: "win" },
    { match: ["ifconfig"], tier: "tier1", description: "Display network interface configuration", mutating: false, platform: "linux" },
    { match: ["ping"], tier: "tier1", description: "Test host reachability and measure round-trip time", mutating: false, platform: "both" },
    { match: ["nslookup"], tier: "tier1", description: "DNS resolution lookup", mutating: false, platform: "both" },
    { match: ["dig"], tier: "tier1", description: "DNS resolution lookup (detailed)", mutating: false, platform: "linux" },
    { match: ["tracert"], tier: "tier1", description: "Trace route to destination host", mutating: false, platform: "win" },
    { match: ["traceroute"], tier: "tier1", description: "Trace route to destination host", mutating: false, platform: "linux" },
    { match: ["netstat"], tier: "tier1", description: "Display active connections and listening ports", mutating: false, platform: "both" },
    { match: ["arp"], tier: "tier1", description: "Display and manage the ARP cache", mutating: false, platform: "both" },
    { match: ["hostname"], tier: "tier1", description: "Display system hostname", mutating: false, platform: "both" },
    { match: ["nbtstat"], tier: "tier1", description: "NetBIOS over TCP/IP statistics", mutating: false, platform: "win" },
    { match: ["pathping"], tier: "tier1", description: "Combined ping and tracert analysis", mutating: false, platform: "win" },
    { match: ["getmac"], tier: "tier1", description: "Display MAC addresses for all interfaces", mutating: false, platform: "win" },
    { match: ["net", "view"], tier: "tier1", description: "List shared resources visible on the network", mutating: false, platform: "win" },
    { match: ["net", "statistics"], tier: "tier1", description: "Display network workstation/server statistics", mutating: false, platform: "win" },
    { match: ["curl"], tier: "tier1", description: "Transfer data from or to a server", mutating: false, platform: "both" },
    { match: ["wget"], tier: "tier1", description: "Non-interactive network file download", mutating: false, platform: "both" },
    { match: ["ss"], tier: "tier1", description: "Socket statistics (modern netstat)", mutating: false, platform: "linux" },
    { match: ["ip", "addr"], tier: "tier1", description: "Display IP address configuration", mutating: false, platform: "linux" },
    { match: ["ip", "route"], tier: "tier1", description: "Display routing table", mutating: false, platform: "linux" },

    // ── Tier 2: Config inspection and mapped drive management ───────────
    { match: ["route", "print"], tier: "tier2", description: "Display the IP routing table", mutating: false, platform: "win" },
    { match: ["route"], tier: "tier2", description: "Display or manage the IP routing table", mutating: false, platform: "both" },
    { match: ["netsh", "interface", "show"], tier: "tier2", description: "Show network interface details", mutating: false, platform: "win" },
    { match: ["netsh", "wlan", "show"], tier: "tier2", description: "Show wireless network profiles and information", mutating: false, platform: "win" },
    { match: ["netsh", "firewall", "show"], tier: "tier2", description: "Show firewall configuration", mutating: false, platform: "win" },
    { match: ["netsh", "advfirewall", "show"], tier: "tier2", description: "Show advanced firewall configuration", mutating: false, platform: "win" },
    { match: ["net", "use"], tier: "tier2", description: "Map or manage network drives", mutating: true, platform: "win" },
    { match: ["net", "share"], tier: "tier2", description: "View or manage shared folders", mutating: false, platform: "win" },
    { match: ["net", "session"], tier: "tier2", description: "Display active network sessions", mutating: false, platform: "win" },
    { match: ["net", "user"], tier: "tier2", description: "View user accounts", mutating: false, platform: "win" },
    { match: ["net", "localgroup"], tier: "tier2", description: "View local group memberships", mutating: false, platform: "win" },
    { match: ["net", "config"], tier: "tier2", description: "Display workstation or server configuration", mutating: false, platform: "win" },
    { match: ["netsh"], tier: "tier2", description: "Network shell \u2014 show and configure network settings", mutating: false, platform: "win" },

    // ── Tier 3: Mutating network configuration (approval-gated) ─────────
    { match: ["netsh", "interface", "set"], tier: "tier3", description: "Modify network interface settings", mutating: true, platform: "win" },
    { match: ["netsh", "interface", "ip", "set"], tier: "tier3", description: "Set IP address, DHCP, or DNS configuration", mutating: true, platform: "win" },
    { match: ["netsh", "firewall", "set"], tier: "tier3", description: "Modify firewall rules", mutating: true, platform: "win" },
    { match: ["netsh", "advfirewall", "firewall"], tier: "tier3", description: "Advanced firewall rule management", mutating: true, platform: "win" },
    { match: ["netsh", "wlan", "connect"], tier: "tier3", description: "Connect to a wireless network", mutating: true, platform: "win" },
    { match: ["netsh", "wlan", "disconnect"], tier: "tier3", description: "Disconnect from wireless network", mutating: true, platform: "win" },
    { match: ["route", "add"], tier: "tier3", description: "Add a route to the routing table", mutating: true, platform: "both" },
    { match: ["route", "delete"], tier: "tier3", description: "Delete a route from the routing table", mutating: true, platform: "both" },
    { match: ["route", "change"], tier: "tier3", description: "Modify an existing route", mutating: true, platform: "both" },
    { match: ["net", "start"], tier: "tier3", description: "Start a network service", mutating: true, platform: "win" },
    { match: ["net", "stop"], tier: "tier3", description: "Stop a network service", mutating: true, platform: "win" },
    { match: ["ip", "addr", "add"], tier: "tier3", description: "Add an IP address to an interface", mutating: true, platform: "linux" },
    { match: ["ip", "addr", "del"], tier: "tier3", description: "Remove an IP address from an interface", mutating: true, platform: "linux" },
    { match: ["ip", "route", "add"], tier: "tier3", description: "Add a route to the routing table", mutating: true, platform: "linux" },
    { match: ["ip", "route", "del"], tier: "tier3", description: "Delete a route from the routing table", mutating: true, platform: "linux" },
    { match: ["iptables"], tier: "tier3", description: "Manage Linux firewall rules", mutating: true, platform: "linux" },
    { match: ["ufw"], tier: "tier3", description: "Uncomplicated Firewall management", mutating: true, platform: "linux" },
];

/** Patterns permanently blocked regardless of tier. */
const BLOCKED_PATTERNS: readonly string[] = [
    "netsh interface reset",
    "netsh winsock reset",
    "netsh int ip reset",
    "net stop /y",
    "iptables -F",
    "iptables --flush",
    "ip link set dev",
];

export class NetworkTool implements Tool {
    readonly name = "network_exec";
    readonly contract = {
        version: "1.0.0",
        args: {
            command: { type: "string" as const, required: true },
            timeoutMs: { type: "number" as const },
        },
    } as const;

    readonly governance = {
        actions: {
            tier1_diagnostic: { minimumRisk: "low" as const, mutating: false, rollbackRequired: false },
            tier2_inspection: { minimumRisk: "medium" as const, mutating: false, rollbackRequired: false },
            tier3_mutation: { minimumRisk: "high" as const, mutating: true, rollbackRequired: true },
        },
    };

    /**
     * Match a user command string against the curated allowlist.
     * Returns the best (longest-match) command definition, or undefined if not allowed.
     */
    private classifyCommand(command: string): { def: NetworkCommandDef; matchLen: number } | undefined {
        const tokens = command.trim().toLowerCase().split(/\s+/);
        let bestMatch: { def: NetworkCommandDef; matchLen: number } | undefined;

        for (const def of NETWORK_COMMANDS) {
            // Check platform compatibility
            if (def.platform !== "both") {
                const isWin = platform() === "win32";
                if ((def.platform === "win" && !isWin) || (def.platform === "linux" && isWin)) {
                    continue;
                }
            }

            // Check if the command tokens start with the match pattern
            let matches = true;
            for (let i = 0; i < def.match.length; i++) {
                if (i >= tokens.length || tokens[i] !== def.match[i]) {
                    matches = false;
                    break;
                }
            }

            if (matches) {
                // Prefer the longest (most specific) match
                if (!bestMatch || def.match.length > bestMatch.matchLen) {
                    bestMatch = { def, matchLen: def.match.length };
                }
            }
        }

        return bestMatch;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const command = String(request.args.command ?? "").trim();
        const timeoutMs = Number(request.args.timeoutMs ?? 30_000);

        if (!command) {
            return { ok: false, output: { error: "No command supplied." } };
        }

        // Check blocked patterns
        const lower = command.toLowerCase();
        for (const pattern of BLOCKED_PATTERNS) {
            if (lower.includes(pattern)) {
                return {
                    ok: false,
                    output: { error: `Command blocked \u2014 matches unsafe pattern: "${pattern}"` },
                };
            }
        }

        // Classify against allowlist
        const classification = this.classifyCommand(command);
        if (!classification) {
            return {
                ok: false,
                output: {
                    error: "Command not recognized. Only curated network commands are allowed via network_exec. " +
                        "Use shell_exec for arbitrary commands.",
                    allowedPrefixes: NETWORK_COMMANDS
                        .filter(c => c.platform === "both" || (c.platform === "win") === (platform() === "win32"))
                        .map(c => c.match.join(" ")),
                },
            };
        }

        const { def } = classification;

        try {
            const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs });
            return {
                ok: true,
                output: {
                    command,
                    tier: def.tier,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: 0,
                    platform: platform(),
                },
                sideEffects: [
                    {
                        type: "network",
                        description: `network_exec [${def.tier}]: ${command}`,
                        mutating: def.mutating,
                        reversible: !def.mutating,
                    },
                ],
            };
        } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
            return {
                ok: false,
                output: {
                    error: e.message ?? "Unknown error",
                    command,
                    tier: def.tier,
                    stdout: e.stdout?.trim() ?? "",
                    stderr: e.stderr?.trim() ?? "",
                    exitCode: e.code ?? 1,
                    platform: platform(),
                },
            };
        }
    }
}

/**
 * Returns the curated network command definitions for UI display.
 * Exported for use by the dashboard panels.
 */
export function getNetworkCommandCatalog(): Array<{
    name: string;
    tier: NetworkTier;
    description: string;
    mutating: boolean;
    platform: string;
}> {
    return NETWORK_COMMANDS.map(c => ({
        name: c.match.join(" "),
        tier: c.tier,
        description: c.description,
        mutating: c.mutating,
        platform: c.platform,
    }));
}
