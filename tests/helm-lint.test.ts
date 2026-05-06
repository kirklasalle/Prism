/**
 * Helm chart lint test.
 *
 * Validates that:
 *   1. The expected chart files are present at deploy/helm/prism.
 *   2. `helm lint` succeeds against the chart, when the helm binary is
 *      available on the runner. CI without helm installed (e.g. local
 *      dev boxes on Windows) gracefully skips the binary invocation
 *      with a logged warning so the suite stays green.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const CHART_DIR = resolve(process.cwd(), "deploy", "helm", "prism");

const REQUIRED_FILES = [
    "Chart.yaml",
    "values.yaml",
    "templates/_helpers.tpl",
    "templates/deployment.yaml",
    "templates/service.yaml",
    "templates/serviceaccount.yaml",
    "templates/pvc.yaml",
    "templates/ingress.yaml",
    "templates/NOTES.txt",
];

function assertChartFilesExist(): void {
    if (!existsSync(CHART_DIR) || !statSync(CHART_DIR).isDirectory()) {
        throw new Error(`HelmLint: chart directory missing at ${CHART_DIR}`);
    }
    for (const rel of REQUIRED_FILES) {
        const full = resolve(CHART_DIR, rel);
        if (!existsSync(full)) {
            throw new Error(`HelmLint: required chart file missing: ${rel}`);
        }
    }
}

function isHelmAvailable(): boolean {
    try {
        const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["helm"], {
            stdio: "ignore",
        });
        return probe.status === 0;
    } catch {
        return false;
    }
}

export async function testHelmLint(): Promise<void> {
    assertChartFilesExist();

    if (!isHelmAvailable()) {
        console.warn("HelmLint: 'helm' binary not on PATH; skipping `helm lint` invocation.");
        return;
    }

    const result = spawnSync("helm", ["lint", CHART_DIR], {
        encoding: "utf8",
    });

    if (result.error) {
        throw new Error(`HelmLint: failed to spawn helm: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(
            `HelmLint: helm lint exited with code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    }
}
