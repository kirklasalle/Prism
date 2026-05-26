import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SkillsEngine } from "../src/core/skills/skills-engine.js";
import { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import {
    WebPageInitializeTool,
    WebComponentInjectTool,
    WebAssetsOptimizeTool,
    WebVisualAuditTool,
    PrismIdeModifyTool,
    PrismIdeLintTool
} from "../src/adapters/system/web-builder-tools.js";

// Mock LLM Provider Manager for dependency-free, high-speed execution testing
class MockLlmProviderManager extends LlmProviderManager {
  public generateCalled = 0;
  constructor() {
    super(process.env, [], undefined, undefined, undefined, new ActivityBus());
  }

  override async generate(input: any, selection?: any): Promise<any> {
    this.generateCalled++;
    return {
      providerId: "mock-provider",
      model: "mock-model",
      content: 'Step executed successfully! {"theme": "obsidian-glass", "compiledHtml": "<h1>Success</h1>"}',
      toolCalls: []
    };
  }
}

describe("PRISM Autonomous Web Builder & IDE System", () => {
    const workspaceRoot = process.cwd();
    const testProjectDir = join(workspaceRoot, "temp_prism_web_creator_test_dir");
    const testDbFile = join(workspaceRoot, "prism-activity.db");
    
    // Tools
    const pageInitTool = new WebPageInitializeTool();
    const componentInjectTool = new WebComponentInjectTool();
    const assetsOptimizeTool = new WebAssetsOptimizeTool();
    const visualAuditTool = new WebVisualAuditTool();
    const ideModifyTool = new PrismIdeModifyTool();
    const ideLintTool = new PrismIdeLintTool();

    // SkillsEngine Dependencies
    let mockProviderManager: MockLlmProviderManager;
    let activityBus: ActivityBus;
    let skillsEngine: SkillsEngine;

    before(async () => {
        // Clean up any stale test directory
        if (existsSync(testProjectDir)) {
            rmSync(testProjectDir, { recursive: true, force: true });
        }
        mockProviderManager = new MockLlmProviderManager();
        activityBus = new ActivityBus();
        skillsEngine = new SkillsEngine(mockProviderManager, activityBus, workspaceRoot);
    });

    after(async () => {
        skillsEngine.close();
        if (existsSync(testProjectDir)) {
            rmSync(testProjectDir, { recursive: true, force: true });
        }
        if (existsSync(testDbFile)) {
            try {
                await fs.unlink(testDbFile);
            } catch (_) {}
        }
    });

    describe("Prism IDE & Web Builder Tool Actions", () => {
        it("initializes modern obsidian-glass boilerplate successfully", async () => {
            const result = await pageInitTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    path: testProjectDir,
                    theme: "obsidian-glass",
                    title: "Prism Test Site"
                }
            });

            assert.ok(result.ok);
            assert.ok(existsSync(join(testProjectDir, "index.html")));
            assert.ok(existsSync(join(testProjectDir, "style.css")));
            assert.ok(existsSync(join(testProjectDir, "script.js")));

            const html = await fs.readFile(join(testProjectDir, "index.html"), "utf-8");
            assert.ok(html.includes("Prism Test Site"));
            assert.ok(html.includes("PRISM"));
        });

        it("injects component cards and appends layouts cleanly", async () => {
            const indexHtmlPath = join(testProjectDir, "index.html");
            
            // Inject Hero Component
            const heroResult = await componentInjectTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    filePath: indexHtmlPath,
                    componentType: "hero",
                    title: "Visual Consensus Portal",
                    subtitle: "Empowering next-gen operators"
                }
            });
            assert.ok(heroResult.ok);

            // Inject Features Component
            const featResult = await componentInjectTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    filePath: indexHtmlPath,
                    componentType: "features"
                }
            });
            assert.ok(featResult.ok);

            const updatedHtml = await fs.readFile(indexHtmlPath, "utf-8");
            assert.ok(updatedHtml.includes("Visual Consensus Portal"));
            assert.ok(updatedHtml.includes("Logical Hemisphere"));
        });

        it("performs surgical code modifications in Prism IDE", async () => {
            const styleCssPath = join(testProjectDir, "style.css");
            const originalCss = await fs.readFile(styleCssPath, "utf-8");
            
            // Ensure search target exists
            assert.ok(originalCss.includes("--violet-glow: #8b5cf6;"));

            const modifyResult = await ideModifyTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    filePath: styleCssPath,
                    targetContent: "--violet-glow: #8b5cf6;",
                    replacementContent: "--violet-glow: #aa11ff; /* surgically edited */"
                }
            });

            assert.ok(modifyResult.ok);
            const updatedCss = await fs.readFile(styleCssPath, "utf-8");
            assert.ok(updatedCss.includes("--violet-glow: #aa11ff; /* surgically edited */"));
            assert.ok(!updatedCss.includes("--violet-glow: #8b5cf6;"));
        });

        it("detects and flags syntax/structure anomalies via Prism IDE linter", async () => {
            const indexHtmlPath = join(testProjectDir, "index.html");
            
            const lintResult = await ideLintTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    filePath: indexHtmlPath
                }
            });

            assert.ok(lintResult.ok);
            const lintOutput = lintResult.output as any;
            assert.ok(lintOutput.passes);
            assert.ok(lintOutput.diagnostics.isDivBalanced);
            assert.equal(lintOutput.diagnostics.missingStylesheets.length, 0);
            assert.equal(lintOutput.diagnostics.missingScripts.length, 0);
        });

        it("runs comprehensive visual and reference verification audits", async () => {
            const indexHtmlPath = join(testProjectDir, "index.html");
            
            const auditResult = await visualAuditTool.execute({
                operation: "test",
                risk: "low",
                mutatesState: true,
                args: {
                    filePath: indexHtmlPath
                }
            });

            assert.ok(auditResult.ok);
            const auditOutput = auditResult.output as any;
            assert.ok(auditOutput.passes);
            assert.ok(auditOutput.audits.styleReferenced);
            assert.ok(auditOutput.audits.scriptReferenced);
        });
    });

    describe("SkillsEngine Web Creator Integration", () => {
        it("routes semantic prompts correctly to the web creator skill", async () => {
            const routedSkill = await skillsEngine.routeQuery("build me a website");
            assert.ok(routedSkill);
            assert.equal(routedSkill!.id, "prism.skill.web_creator");
        });

        it("guides Prism sequentially through SOTA tool disclosure stages", async () => {
            const session = await skillsEngine.createSession("prism.skill.web_creator", "test-chat-session");
            assert.ok(session);
            assert.equal(session.currentStep, "planning");

            // Execute Planning Step -> transitions to "design_and_code"
            const nextSession = await skillsEngine.executeStep(session.sessionId);
            assert.equal(nextSession.currentStep, "design_and_code");
            assert.equal(nextSession.status, "running");
        });
    });
});
