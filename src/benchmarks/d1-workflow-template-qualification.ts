import fs from "fs";
import path from "path";
import { createDomainWorkflowTemplates } from "../core/runtime/domain-workflow-templates.js";
import { WorkflowExecutor } from "../core/runtime/workflow.js";

interface CheckResult {
    name: string;
    passed: boolean;
    details: string;
}

function run(): void {
    const executor = new WorkflowExecutor();
    const templates = createDomainWorkflowTemplates(executor);

    const checks: CheckResult[] = [
        {
            name: "Email template includes triage workflow",
            passed:
                templates.email.steps.some(
                    (step) => step.id === "email_scan" && step.args.action === "triage_inbox"
                ) &&
                templates.email.steps.some(
                    (step) => step.id === "email_draft_fallback" && step.args.action === "draft_reply"
                ),
            details: "Expected email_scan=triage_inbox and fallback draft_reply",
        },
        {
            name: "Calendar template includes conflict detection and day planning",
            passed:
                templates.calendar.steps.some(
                    (step) => step.id === "calendar_fetch" && step.args.action === "detect_conflicts"
                ) &&
                templates.calendar.steps.some(
                    (step) => step.id === "calendar_commit" && step.args.action === "commit_day_plan"
                ),
            details: "Expected detect_conflicts + commit_day_plan actions",
        },
        {
            name: "Notes template includes action/deadline extraction",
            passed: templates.notes.steps.some(
                (step) => step.id === "notes_persist" && step.args.action === "extract_actions_deadlines"
            ),
            details: "Expected notes_persist action extract_actions_deadlines",
        },
        {
            name: "Tasks template includes chronological timeline planning",
            passed:
                templates.tasks.steps.some(
                    (step) =>
                        step.id === "tasks_analyze" && step.args.action === "build_chronological_plan"
                ) &&
                templates.tasks.steps.some(
                    (step) =>
                        step.id === "tasks_commit" && step.args.action === "commit_chronological_timeline"
                ),
            details: "Expected chronological plan + commit actions",
        },
        {
            name: "All templates define governance fallback paths",
            passed: Object.values(templates).every((dag) => dag.fallbacks.length > 0),
            details: "Each template must include on_failure or on_timeout fallback",
        },
    ];

    const passed = checks.every((check) => check.passed);

    const artifact = {
        generatedAt: new Date().toISOString(),
        stage: "d1-workflow-template-qualification",
        checks,
        passed,
    };

    const outputPath = path.resolve("prism-output", "d1-workflow-template-qualification.json");
    fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf8");

    for (const check of checks) {
        const status = check.passed ? "PASS" : "FAIL";
        console.log(`- [${status}] ${check.name}: ${check.details}`);
    }
    console.log(`- Artifact: ${outputPath}`);

    if (!passed) {
        process.exit(1);
    }
}

run();
