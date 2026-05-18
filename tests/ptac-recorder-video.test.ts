/**
 * PTAC recorder — demo video slideshow unit test.
 *
 * Validates the v0.20 video-recording feature in isolation:
 *   1. A recorder constructed with `recordVideo: true` accumulates a
 *      `videoFrames` entry for each `recordScreenshot` call and emits both
 *      `video-manifest.json` and `video.html` on `finalize()`.
 *   2. The manifest payload contains correct `runId`, `fps`, `frameCount`,
 *      `durationSec` (frameCount/fps), and one entry per recorded frame
 *      with the relative screenshot path.
 *   3. The HTML slideshow embeds the frames as inline JSON, has the
 *      computed `INTERVAL_MS = round(1000/fps)`, and references each
 *      screenshot's relative path so the run folder is portable.
 *   4. With `recordVideo: false` (default), neither artifact is written.
 *
 * Pure unit — no orchestrator, no network, no real screenshots; uses a
 * tiny PNG byte buffer.
 */

import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PtacRecorder } from "../src/ptac/recorder.js";
import type { PtacRunResult } from "../src/ptac/types.js";

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeRun(runId: string, runDir: string): PtacRunResult {
    return {
        runId,
        profile: "sandbox",
        suite: "demo",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        status: "passed",
        scenarios: [],
        reportHtmlPath: join(runDir, "report.html"),
        outputDir: runDir,
    };
}

export async function testPtacRecorderVideo(): Promise<void> {
    // ── Case 1: recordVideo=true emits manifest + slideshow ──────────────
    {
        const runDir = mkdtempSync(join(tmpdir(), "prism-ptac-rec-"));
        const recorder = new PtacRecorder(runDir, { recordVideo: true, recordVideoFps: 4 });
        recorder.recordScreenshot("step-a", FAKE_PNG, "before");
        recorder.recordScreenshot("step-a", FAKE_PNG, "after");
        recorder.recordScreenshot("step-b", FAKE_PNG, "before");
        recorder.finalize(makeRun("run-vid-1", runDir));

        const manifestPath = join(runDir, "video-manifest.json");
        const htmlPath = join(runDir, "video.html");
        assert.ok(existsSync(manifestPath), "video-manifest.json must be emitted");
        assert.ok(existsSync(htmlPath), "video.html must be emitted");

        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        assert.strictEqual(manifest.runId, "run-vid-1", "manifest runId");
        assert.strictEqual(manifest.fps, 4, "manifest fps");
        assert.strictEqual(manifest.frameCount, 3, "manifest frameCount");
        assert.strictEqual(manifest.durationSec, 0.75, "manifest durationSec = 3/4");
        assert.strictEqual(manifest.frames.length, 3, "manifest frames length");
        assert.strictEqual(manifest.frames[0].stepId, "step-a", "frame[0] stepId");
        assert.ok(manifest.frames[0].relPath.startsWith("screenshots/"), "frame relPath under screenshots/");
        assert.strictEqual(manifest.frames[0].bracket, "before", "frame bracket label");

        const html = readFileSync(htmlPath, "utf8");
        assert.ok(html.startsWith("<!doctype html>"), "html starts with doctype");
        assert.ok(html.includes("INTERVAL_MS = 250"), "html INTERVAL_MS = round(1000/4) = 250");
        assert.ok(html.includes("run-vid-1"), "html embeds runId");
        assert.ok(html.includes(manifest.frames[0].relPath), "html references first frame relPath");
        assert.ok(html.includes("\"stepId\":\"step-a\""), "html embeds frames as inline JSON");
        assert.ok(html.includes("setInterval"), "html plays via setInterval");
    }

    // ── Case 2: recordVideo=false emits neither artifact ─────────────────
    {
        const runDir = mkdtempSync(join(tmpdir(), "prism-ptac-rec-"));
        const recorder = new PtacRecorder(runDir, { recordVideo: false });
        recorder.recordScreenshot("step-a", FAKE_PNG, "before");
        recorder.finalize(makeRun("run-vid-2", runDir));

        assert.ok(!existsSync(join(runDir, "video-manifest.json")), "no manifest when recordVideo=false");
        assert.ok(!existsSync(join(runDir, "video.html")), "no slideshow when recordVideo=false");
    }

    // ── Case 3: fps clamped to 1..8 ──────────────────────────────────────
    {
        const runDir = mkdtempSync(join(tmpdir(), "prism-ptac-rec-"));
        const r1 = new PtacRecorder(runDir, { recordVideo: true, recordVideoFps: 99 });
        assert.strictEqual(r1.recordVideoFps, 8, "fps clamps to upper bound 8");
        const r2 = new PtacRecorder(runDir, { recordVideo: true, recordVideoFps: 0 });
        assert.strictEqual(r2.recordVideoFps, 1, "fps clamps to lower bound 1");
        const r3 = new PtacRecorder(runDir, { recordVideo: true });
        assert.strictEqual(r3.recordVideoFps, 2, "fps default 2");
    }
}
