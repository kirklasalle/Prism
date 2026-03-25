import { HttpRequestTool } from "../../adapters/protocol/http-tool.js";
import { ContainerSandboxTool } from "../../adapters/system/container-sandbox-tool.js";
import { FileDeleteTool, FileListTool, FileReadTool, FileWriteTool } from "../../adapters/system/file-tools.js";
import { ShellTool } from "../../adapters/system/shell-tool.js";
import { TerminalSessionTool } from "../../adapters/system/terminal-session-tool.js";
import { Neo4jQueryTool } from "../../adapters/application/neo4j-tool.js";
import {
    CalendarPlanningTool,
    EmailCapabilityTool,
    NotesExtractionTool,
    TasksTimelineTool,
} from "../../adapters/application/individual-capability-tools.js";
import { NetworkTool } from "../../adapters/network/network-tool.js";
import { VisionCaptureTool } from "../../adapters/system/vision-capture-tool.js";
import { BrowserControlTool } from "../../adapters/system/browser-control-tool.js";
import type { Tool } from "./types.js";

export function builtinTools(): Tool[] {
    return [
        // System adapters
        new ShellTool(),
        new TerminalSessionTool(),
        new ContainerSandboxTool(),
        new FileReadTool(),
        new FileWriteTool(),
        new FileDeleteTool(),
        new FileListTool(),
        // Protocol adapters
        new HttpRequestTool(),
        // Network adapters
        new NetworkTool(),
        // Application adapters
        new Neo4jQueryTool(),
        new EmailCapabilityTool(),
        new CalendarPlanningTool(),
        new NotesExtractionTool(),
        new TasksTimelineTool(),
        // Vision adapters
        new VisionCaptureTool(),
        // Browser adapters
        new BrowserControlTool(),
    ];
}
