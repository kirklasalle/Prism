import { HttpRequestTool } from "../../adapters/protocol/http-tool.js";
import { ContainerSandboxTool } from "../../adapters/system/container-sandbox-tool.js";
import { FileDeleteTool, FileListTool, FileReadTool, FileWriteTool } from "../../adapters/system/file-tools.js";
import { ShellTool } from "../../adapters/system/shell-tool.js";
import { TerminalSessionTool } from "../../adapters/system/terminal-session-tool.js";
import { ComputerUseTool } from "../../adapters/system/computer-use-tool.js";

import { Neo4jQueryTool } from "../../adapters/application/neo4j-tool.js";
import { PrismDashboardControlTool } from "../../adapters/application/prism-dashboard-tool.js";
import { NetworkTool } from "../../adapters/network/network-tool.js";
import { VisionCaptureTool } from "../../adapters/system/vision-capture-tool.js";
import { BrowserControlTool } from "../../adapters/system/browser-control-tool.js";
import { EmailOpsTool } from "../../adapters/application/email-tool.js";
import { CalendarPlanTool } from "../../adapters/application/calendar-tool.js";
import { NotesExtractTool } from "../../adapters/application/notes-tool.js";
import { TasksTimelineTool } from "../../adapters/application/tasks-tool.js";
import type { GmailOAuthAdapter } from "../../adapters/application/email-oauth-adapter.js";
import type { OutlookOAuthAdapter } from "../../adapters/application/outlook-oauth-adapter.js";
import type { TerminalSessionAdapter } from "../../adapters/application/terminal-session-adapter.js";
import type { ContainerSandboxAdapter } from "../../adapters/application/container-sandbox-adapter.js";
import type { Tool } from "./types.js";

export function builtinTools(
    gmail?: GmailOAuthAdapter,
    outlook?: OutlookOAuthAdapter,
    terminalAdapter?: TerminalSessionAdapter,
    containerAdapter?: ContainerSandboxAdapter,
): Tool[] {
    return [
        // System adapters
        new ShellTool(),
        new TerminalSessionTool(terminalAdapter),
        new ContainerSandboxTool(containerAdapter),
        new FileReadTool(),
        new FileWriteTool(),
        new FileDeleteTool(),
        new FileListTool(),
        // Protocol adapters
        new HttpRequestTool(),
        // Network adapters
        new NetworkTool(),
        // Application adapters
        new PrismDashboardControlTool(),
        new Neo4jQueryTool(),
        new EmailOpsTool(undefined, gmail, outlook),
        new CalendarPlanTool(undefined, gmail, outlook),
        new NotesExtractTool(),
        new TasksTimelineTool(),
        // Vision adapters
        new VisionCaptureTool(),
        // Browser adapters
        new BrowserControlTool(),
        // Computer use (Windows Native)
        new ComputerUseTool(),
    ];
}
