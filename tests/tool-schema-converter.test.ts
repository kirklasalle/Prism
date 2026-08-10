import { describe, it } from "mocha";
import * as assert from "assert";
import { toolToLlmDefinition, toolsToLlmDefinitions } from "../src/core/tools/tool-schema-converter.js";
import type { Tool } from "../src/core/tools/types.js";

/**
 * Regression: Gemini (Google AI Studio) rejects `type: "array"` function
 * parameters that lack an `items` field with a 400 INVALID_ARGUMENT. The
 * `computer` tool's `coordinate` / `coordinate_to` args triggered this and
 * killed autonomous computer-use goals. The converter must always emit `items`.
 */

function mkTool(name: string, args: Record<string, any>): Tool {
    return {
        name,
        contract: { version: "1.0.0", args },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe("Tool schema converter — array params always declare items (Gemini 400 fix)", () => {
    it("emits items for a contract array arg with a declared element type", () => {
        const tool = mkTool("computer", {
            action: { type: "string", required: true },
            coordinate: { type: "array", items: { type: "number" }, required: false },
            coordinate_to: { type: "array", items: { type: "number" }, required: false },
        });
        const def = toolToLlmDefinition(tool);
        assert.ok(def);
        const props = def!.parameters.properties as Record<string, any>;
        assert.strictEqual(props.coordinate.type, "array");
        assert.ok(props.coordinate.items, "coordinate.items must be present");
        assert.strictEqual(props.coordinate.items.type, "number");
        assert.ok(props.coordinate_to.items, "coordinate_to.items must be present");
        assert.strictEqual(props.coordinate_to.items.type, "number");
    });

    it("defaults items to string when an array arg omits its element type", () => {
        const tool = mkTool("legacy", {
            tags: { type: "array" },
        });
        const def = toolToLlmDefinition(tool);
        const props = def!.parameters.properties as Record<string, any>;
        assert.strictEqual(props.tags.type, "array");
        assert.ok(props.tags.items);
        assert.strictEqual(props.tags.items.type, "string");
    });

    it("never leaves any array property without items across a toolset", () => {
        const tools = [
            mkTool("computer", {
                coordinate: { type: "array", items: { type: "number" } },
                coordinate_to: { type: "array", items: { type: "number" } },
            }),
            mkTool("sr", { hemispheres: { type: "array", items: { type: "object" } } }),
            mkTool("legacy", { tags: { type: "array" } }),
        ];
        const defs = toolsToLlmDefinitions(tools);
        for (const def of defs) {
            const props = def.parameters.properties as Record<string, any>;
            for (const [, schema] of Object.entries(props)) {
                if (schema.type === "array") {
                    assert.ok(schema.items, `array property in ${def.name} must have items`);
                    assert.ok(typeof schema.items.type === "string");
                }
            }
        }
    });
});
