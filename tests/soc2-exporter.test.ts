/**
 * Soc2EvidenceExporter unit tests.
 *
 * Exercises:
 *   - classifyEventForSoc2 maps each control bucket correctly
 *   - mapEventToSoc2 preserves principal + sourceHash + filters non-mutating side-effects
 *   - FileTransport rotates daily and writes one JSONL record per event
 *   - WebhookTransport batches, fires the injected httpPoster with the configured flavor,
 *     and writes to DLQ on failure
 *   - End-to-end: exporter only subscribes when mode != off; off-mode is a no-op
 *   - backfillFromEvents respects since/until and skips off-bucket events
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import {
    Soc2EvidenceExporter,
    classifyEventForSoc2,
    mapEventToSoc2,
    backfillFromEvents,
} from "../src/core/compliance/soc2-exporter.js";
import type { ActivityEvent } from "../src/core/activity/types.js";

function makeEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
    return {
        id: overrides.id ?? "evt-1",
        timestamp: overrides.timestamp ?? "2026-05-07T12:00:00.000Z",
        sessionId: overrides.sessionId ?? "sess-1",
        layer: overrides.layer ?? "agent",
        operation: overrides.operation ?? "tool.invoke",
        status: overrides.status ?? "succeeded",
        details: overrides.details ?? {},
        hash: overrides.hash ?? "abc123",
        ...overrides,
    } as ActivityEvent;
}

export async function testSoc2Exporter(): Promise<void> {
    // ── classifyEventForSoc2 ─────────────────────────────────────────────────
    {
        const auth = makeEvent({ operation: "auth.login.success", layer: "agent" });
        assert.deepEqual(classifyEventForSoc2(auth), ["CC6.1"], "auth.* maps to CC6.1");

        const gov = makeEvent({ layer: "governance", operation: "policy.evaluate", policyDecision: "allow" });
        const govControls = new Set(classifyEventForSoc2(gov) ?? []);
        assert.ok(govControls.has("CC6.6"), "governance layer maps to CC6.6");

        const denied = makeEvent({ operation: "policy.deny", layer: "governance", policyDecision: "deny" });
        const deniedControls = new Set(classifyEventForSoc2(denied) ?? []);
        assert.ok(deniedControls.has("CC6.6"), "policy decision still CC6.6");
        assert.ok(deniedControls.has("CC7.2"), "deny decisions are CC7.2 anomalies");

        const failed = makeEvent({ operation: "tool.invoke", status: "failed" });
        assert.deepEqual(classifyEventForSoc2(failed), ["CC7.2"], "failed status → CC7.2");

        const mutating = makeEvent({
            operation: "tool.invoke",
            sideEffects: [{ type: "file", description: "wrote file", mutating: true }],
        });
        assert.deepEqual(classifyEventForSoc2(mutating), ["CC8.1"], "mutating side-effect → CC8.1");

        const noise = makeEvent({ operation: "retrieval.lookup", layer: "retrieval" });
        assert.equal(classifyEventForSoc2(noise), null, "non-soc2 events are filtered out");
    }

    // ── mapEventToSoc2 ───────────────────────────────────────────────────────
    {
        const ev = makeEvent({
            operation: "auth.login.success",
            prismUserId: "user-1",
            prismUserEmail: "u@example.com",
            sideEffects: [
                { type: "file", description: "audit", mutating: true },
                { type: "network", description: "lookup", mutating: false },
            ],
            details: { ip: "127.0.0.1" },
        });
        const rec = mapEventToSoc2(ev, ["CC6.1"]);
        assert.equal(rec.id, "evt-1");
        assert.equal(rec.sourceHash, "abc123");
        assert.equal(rec.principal.userId, "user-1");
        assert.equal(rec.principal.userEmail, "u@example.com");
        assert.equal(rec.sideEffects?.length, 1, "non-mutating side-effects pruned");
        assert.equal(rec.sideEffects?.[0]?.type, "file");
        assert.equal(rec.schemaVersion, 1);
    }

    // ── FileTransport rotation ───────────────────────────────────────────────
    const tmp = mkdtempSync(join(tmpdir(), "prism-soc2-"));
    try {
        const bus = new ActivityBus();
        let day = "2026-05-07";
        const exporter = new Soc2EvidenceExporter(bus, {
            mode: "file",
            outputDir: tmp,
            now: () => new Date(`${day}T10:00:00.000Z`),
        });
        exporter.start();

        bus.emit({
            sessionId: "s1",
            layer: "agent",
            operation: "auth.login.success",
            status: "succeeded",
            details: {},
        });

        day = "2026-05-08";
        bus.emit({
            sessionId: "s1",
            layer: "governance",
            operation: "policy.deny",
            status: "succeeded",
            policyDecision: "deny",
            details: {},
        });

        await exporter.stop();

        const day1 = join(tmp, "2026-05-07.jsonl");
        const day2 = join(tmp, "2026-05-08.jsonl");
        assert.ok(existsSync(day1), "day1 file written");
        assert.ok(existsSync(day2), "day2 file written");
        const day1Lines = readFileSync(day1, "utf8").trim().split("\n");
        assert.equal(day1Lines.length, 1, "day1 has exactly one record");
        const parsed = JSON.parse(day1Lines[0]!);
        assert.equal(parsed.controls[0], "CC6.1");
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }

    // ── WebhookTransport batching + DLQ ──────────────────────────────────────
    const tmp2 = mkdtempSync(join(tmpdir(), "prism-soc2-"));
    try {
        const bus = new ActivityBus();
        const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
        let failNext = false;

        const exporter = new Soc2EvidenceExporter(bus, {
            mode: "webhook",
            outputDir: tmp2,
            webhookUrl: "https://example.invalid/soc2",
            webhookToken: "tok123",
            webhookFlavor: "vanta",
            batchSize: 2,
            flushIntervalMs: 60_000,
            httpPoster: async (url, body, headers) => {
                calls.push({ url, body, headers });
                if (failNext) {
                    failNext = false;
                    throw new Error("simulated webhook failure");
                }
            },
        });
        exporter.start();

        // Two SOC 2 events → triggers immediate flush at batchSize=2.
        bus.emit({ sessionId: "s", layer: "agent", operation: "auth.login.success", status: "succeeded", details: {} });
        bus.emit({ sessionId: "s", layer: "governance", operation: "policy.deny", status: "succeeded", policyDecision: "deny", details: {} });

        await exporter.stop();

        assert.equal(calls.length, 1, "exactly one batched POST");
        assert.equal(calls[0]!.url, "https://example.invalid/soc2");
        assert.equal(calls[0]!.headers["authorization"], "Bearer tok123");
        const payload = JSON.parse(calls[0]!.body);
        assert.equal(payload.source, "prism", "vanta flavor envelope");
        assert.equal(payload.evidence.length, 2);

        // Failure path → DLQ.
        const exporter2 = new Soc2EvidenceExporter(bus, {
            mode: "webhook",
            outputDir: tmp2,
            webhookUrl: "https://example.invalid/soc2",
            batchSize: 1,
            flushIntervalMs: 60_000,
            httpPoster: async () => { throw new Error("boom"); },
        });
        exporter2.start();
        bus.emit({ sessionId: "s", layer: "agent", operation: "iam.role.grant", status: "succeeded", details: {} });
        await exporter2.stop();

        const dlqPath = join(tmp2, "_dlq.jsonl");
        assert.ok(existsSync(dlqPath), "DLQ file created on webhook failure");
        const dlqLines = readFileSync(dlqPath, "utf8").trim().split("\n");
        assert.equal(dlqLines.length, 1, "one record in DLQ");
        // Quiet unused-var lint
        void failNext;
    } finally {
        rmSync(tmp2, { recursive: true, force: true });
    }

    // ── off mode is a no-op ──────────────────────────────────────────────────
    {
        const bus = new ActivityBus();
        const exporter = new Soc2EvidenceExporter(bus, { mode: "off" });
        assert.equal(exporter.isEnabled(), false);
        exporter.start();
        bus.emit({ sessionId: "s", layer: "agent", operation: "auth.login.success", status: "succeeded", details: {} });
        await exporter.stop();
        // No assertions on file system because off mode never instantiates a transport.
    }

    // ── backfillFromEvents ───────────────────────────────────────────────────
    {
        const events: ActivityEvent[] = [
            makeEvent({ id: "a", timestamp: "2026-05-01T00:00:00.000Z", operation: "auth.login.success" }),
            makeEvent({ id: "b", timestamp: "2026-05-05T00:00:00.000Z", operation: "retrieval.lookup", layer: "retrieval" }),
            makeEvent({ id: "c", timestamp: "2026-05-10T00:00:00.000Z", operation: "policy.deny", policyDecision: "deny", layer: "governance" }),
        ];
        const records = backfillFromEvents(events, {
            since: new Date("2026-05-04T00:00:00.000Z"),
            until: new Date("2026-05-15T00:00:00.000Z"),
        });
        assert.equal(records.length, 1, "filters by date and bucket");
        assert.equal(records[0]!.id, "c");
    }
}
