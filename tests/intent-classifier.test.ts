import { describe, test } from "node:test";
import assert from "node:assert";
import { IntentClassifier } from "../src/core/operator/intent-classifier.js";

describe("PRISM IntentClassifier Tests", () => {
    const classifier = new IntentClassifier();

    test("should correctly classify autonomous OS / browser tasks", () => {
        // Shopping e-commerce
        const shoppingResult = classifier.classify("Shop for running shoes on Amazon under $100");
        assert.strictEqual(shoppingResult.intent, "autonomous_os_task");
        assert.strictEqual(shoppingResult.category, "shopping");
        assert.strictEqual(shoppingResult.requiresBrowser, true);
        assert.strictEqual(shoppingResult.requiresComputer, true);

        // Email checking
        const emailResult = classifier.classify("check my Gmail inbox for new updates");
        assert.strictEqual(emailResult.intent, "autonomous_os_task");
        assert.strictEqual(emailResult.category, "email");
        assert.strictEqual(emailResult.requiresBrowser, true);
        assert.strictEqual(emailResult.requiresComputer, false);

        // Computer mouse/keyboard control
        const computerResult = classifier.classify("click on coordinates 300, 500 and take a screenshot");
        assert.strictEqual(computerResult.intent, "autonomous_os_task");
        assert.strictEqual(computerResult.category, "computer");
        assert.strictEqual(computerResult.requiresBrowser, false);
        assert.strictEqual(computerResult.requiresComputer, true);
    });

    test("should correctly classify PRISM internal operating tasks", () => {
        // Spawning agents
        const spawnResult = classifier.classify("spawn a research agent to analyze the logs");
        assert.strictEqual(spawnResult.intent, "prism_operating_task");
        assert.strictEqual(spawnResult.category, "agent_management");

        // Swarm topology
        const swarmResult = classifier.classify("create a pipeline topology swarm with 3 workers");
        assert.strictEqual(swarmResult.intent, "prism_operating_task");
        assert.strictEqual(swarmResult.category, "swarm_coordination");

        // Model Matrix Power settings
        const matrixResult = classifier.classify("change LLM Model Matrix routing to Eco-mode");
        assert.strictEqual(matrixResult.intent, "prism_operating_task");
        assert.strictEqual(matrixResult.category, "settings_routing");
    });

    test("should fall back to standard chat for general Q&A", () => {
        const chatResult = classifier.classify("what is the capital of France?");
        assert.strictEqual(chatResult.intent, "standard_chat");
        assert.strictEqual(chatResult.category, "general");
    });
});
