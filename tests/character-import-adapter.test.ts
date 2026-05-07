/**
 * Phase E3b — character-import-adapter tests.
 *
 * Each supported shape round-trips to a valid PRISM manifest. Business-target
 * imports auto-harden the denylist and clamp maxRiskTier to 1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    detectShape,
    adaptToPrism,
    importCharacter,
    validatePrismCharacter,
} from "../src/core/characters/character-import-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "character-imports");

function readFixture(name: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8")) as Record<string, unknown>;
}

describe("character-import-adapter — shape detection", () => {
    it("detects openclaw", () => {
        assert.equal(detectShape(readFixture("openclaw-helper.json")), "openclaw");
    });
    it("detects crewai", () => {
        assert.equal(detectShape(readFixture("crewai-analyst.json")), "crewai");
    });
    it("detects autogen", () => {
        assert.equal(detectShape(readFixture("autogen-assistant.json")), "autogen");
    });
    it("detects openai-prompt", () => {
        assert.equal(detectShape(readFixture("openai-prompt.json")), "openai-prompt");
    });
    it("detects prism canonical", () => {
        assert.equal(detectShape({
            name: "x",
            systemPrompt: "y",
            toolPermissions: { allow: [], deny: [] },
        }), "prism");
    });
    it("returns unknown for malformed input", () => {
        assert.equal(detectShape(readFixture("malformed.json")), "unknown");
        assert.equal(detectShape(null), "unknown");
        assert.equal(detectShape("string"), "unknown");
    });
});

describe("character-import-adapter — adaptation", () => {
    it("adapts openclaw → PRISM preserving persona/greeting/tools", () => {
        const raw = readFixture("openclaw-helper.json");
        const pc = adaptToPrism(raw, "openclaw", "individual");
        assert.equal(pc.name, "openclaw-helper");
        assert.ok(pc.systemPrompt.length > 0);
        assert.equal(pc.persona, "analytical, thorough, concise");
        assert.deepEqual(pc.toolPermissions.allow, ["web_search", "semantic_query"]);
        assert.equal(pc.executionProfile, "individual");
        assert.equal(pc._importSource?.shape, "openclaw");
    });

    it("adapts crewai → PRISM concatenating role/goal/backstory", () => {
        const raw = readFixture("crewai-analyst.json");
        const pc = adaptToPrism(raw, "crewai", "individual");
        assert.match(pc.systemPrompt, /Role: Senior Research Analyst/);
        assert.match(pc.systemPrompt, /Goal:/);
        assert.match(pc.systemPrompt, /Backstory:/);
    });

    it("adapts autogen → PRISM using system_message", () => {
        const raw = readFixture("autogen-assistant.json");
        const pc = adaptToPrism(raw, "autogen", "individual");
        assert.equal(pc.systemPrompt, raw.system_message);
    });

    it("adapts openai-prompt (messages[]) → PRISM", () => {
        const raw = readFixture("openai-prompt.json");
        const pc = adaptToPrism(raw, "openai-prompt", "individual");
        assert.match(pc.systemPrompt, /meticulous editor/);
    });
});

describe("character-import-adapter — Business auto-hardening", () => {
    it("adds shell_exec + terminal_session to deny and removes from allow", () => {
        const raw = {
            name: "risky",
            systemPrompt: "dangerous",
            toolPermissions: { allow: ["shell_exec", "web_search"], deny: [] },
            maxRiskTier: 3,
        };
        const pc = adaptToPrism(raw, "prism", "business");
        assert.ok(pc.toolPermissions.deny.includes("shell_exec"));
        assert.ok(pc.toolPermissions.deny.includes("terminal_session"));
        assert.ok(!pc.toolPermissions.allow.includes("shell_exec"));
        assert.equal(pc.maxRiskTier, 1);
        assert.equal(pc.executionProfile, "business");
    });
});

describe("character-import-adapter — validation", () => {
    it("errors when systemPrompt is empty", () => {
        const pc = adaptToPrism({ name: "x" }, "prism", "individual");
        const v = validatePrismCharacter(pc, "individual");
        assert.ok(v.errors.some((e) => /systemPrompt/.test(e)));
    });

    it("importCharacter() returns errors for unknown shape", () => {
        const result = importCharacter(readFixture("malformed.json"));
        assert.equal(result.shape, "unknown");
        assert.ok(result.errors.length > 0);
    });
});

describe("character-import-adapter — end-to-end importCharacter()", () => {
    it("openclaw + business → valid PRISM with warnings for hardening", () => {
        const raw = readFixture("openclaw-helper.json");
        const result = importCharacter(raw, "business");
        assert.equal(result.shape, "openclaw");
        assert.equal(result.errors.length, 0);
        assert.ok(result.character.toolPermissions.deny.includes("shell_exec"));
        assert.equal(result.character.executionProfile, "business");
    });
});
