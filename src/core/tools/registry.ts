import type { Tool } from "./types.js";
import type { ToolRequest } from "./types.js";
import { validateToolContract, validateToolRequestAgainstContract } from "./contracts.js";

export class ToolRegistry {
    private readonly tools = new Map<string, Tool>();

    register(tool: Tool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool already registered: ${tool.name}`);
        }

        if (tool.contract) {
            const contractErrors = validateToolContract(tool.name, tool.contract);
            if (contractErrors.length > 0) {
                throw new Error(contractErrors.join(" "));
            }
        }

        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }

        return tool;
    }

    validateRequest(request: ToolRequest): string[] {
        const tool = this.tools.get(request.operation);
        if (!tool || !tool.contract) {
            return [];
        }

        return validateToolRequestAgainstContract(request, tool.contract);
    }
}
