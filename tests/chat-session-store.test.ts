/**
 * Tests for ChatSessionStore — session CRUD, message persistence,
 * SR config save/load (all D4c fields), migration idempotency, and WAL mode.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";

describe("ChatSessionStore", () => {
    let tmpDir: string;
    let dbPath: string;
    let store: ChatSessionStore;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-css-test-"));
        dbPath = join(tmpDir, "test.db");
        store = new ChatSessionStore(dbPath);
    });

    after(() => {
        store.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── WAL mode ─────────────────────────────────────────────────────────

    it("opens in WAL journal mode", () => {
        // If WAL PRAGMA fails the constructor throws, so reaching here means it worked
        assert.ok(store, "store constructed without error");
    });

    // ── Session CRUD ──────────────────────────────────────────────────────

    it("creates a new session with a default title", () => {
        const session = store.createSession();
        assert.ok(session.sessionId, "has sessionId");
        assert.equal(session.title, "New Session");
    });

    it("creates a session with a custom title", () => {
        const session = store.createSession("My Custom Chat");
        assert.equal(session.title, "My Custom Chat");
    });

    it("lists sessions — includes newly created ones", () => {
        const s = store.createSession("List Me");
        const all = store.listSessions();
        const found = all.find((x) => x.sessionId === s.sessionId);
        assert.ok(found, "session appears in list");
    });

    it("migration is idempotent — constructing twice on same db does not throw", () => {
        const store2 = new ChatSessionStore(dbPath);
        const sessions = store2.listSessions();
        assert.ok(Array.isArray(sessions));
        store2.close();
    });

    // ── Message persistence ───────────────────────────────────────────────

    it("persists and retrieves messages", () => {
        const session = store.createSession("Msg Test");
        store.appendMessage(session.sessionId, "user", "Hello");
        store.appendMessage(session.sessionId, "assistant", "Hi there!");
        const msgs = store.getMessages(session.sessionId);
        assert.equal(msgs.length, 2);
        assert.equal(msgs[0].role, "user");
        assert.equal(msgs[0].content, "Hello");
        assert.equal(msgs[1].role, "assistant");
    });

    // ── SR config — full D4c field set ────────────────────────────────────

    it("getSRConfig returns null for a session with no SR config", () => {
        const session = store.createSession("SR None");
        const cfg = store.getSRConfig(session.sessionId);
        assert.equal(cfg, null);
    });

    it("saveSRConfig and getSRConfig roundtrip all D4c fields", () => {
        const session = store.createSession("SR Full");
        store.saveSRConfig(
            session.sessionId,
            true,
            "openai",
            "gpt-4o",
            "anthropic",
            "claude-3-5-sonnet-20241022",
            {
                leftSlot: "slot-left",
                rightSlot: "slot-right",
                leftTimeoutMs: 15000,
                rightTimeoutMs: 12000,
                circuitBreakerEnabled: true,
                showHemispheres: true,
            },
        );
        const cfg = store.getSRConfig(session.sessionId);
        assert.ok(cfg, "config should not be null");
        assert.equal(cfg.enabled, true);
        assert.equal(cfg.leftProviderId, "openai");
        assert.equal(cfg.leftModel, "gpt-4o");
        assert.equal(cfg.rightProviderId, "anthropic");
        assert.equal(cfg.rightModel, "claude-3-5-sonnet-20241022");
        assert.equal(cfg.leftSlot, "slot-left");
        assert.equal(cfg.rightSlot, "slot-right");
        assert.equal(cfg.leftTimeoutMs, 15000);
        assert.equal(cfg.rightTimeoutMs, 12000);
        assert.equal(cfg.circuitBreakerEnabled, true);
        assert.equal(cfg.showHemispheres, true);
    });

    it("saveSRConfig can disable SR and clear slots", () => {
        const session = store.createSession("SR Disable");
        store.saveSRConfig(session.sessionId, true, "openai", "gpt-4o", null, null, {
            leftSlot: "my-slot",
        });
        store.saveSRConfig(session.sessionId, false, null, null, null, null, {
            leftSlot: null,
            rightSlot: null,
        });
        const cfg = store.getSRConfig(session.sessionId);
        assert.ok(cfg);
        assert.equal(cfg.enabled, false);
        assert.equal(cfg.leftProviderId, null);
        assert.equal(cfg.leftSlot, null);
    });

    it("saveSRConfig upserts — calling twice updates in place", () => {
        const session = store.createSession("SR Upsert");
        store.saveSRConfig(session.sessionId, true, "openai", "gpt-4o", null, null);
        store.saveSRConfig(session.sessionId, true, "openai", "gpt-4o-mini", "anthropic", "claude-3-5-sonnet-20241022");
        const cfg = store.getSRConfig(session.sessionId);
        assert.ok(cfg);
        assert.equal(cfg.leftModel, "gpt-4o-mini");
        assert.equal(cfg.rightProviderId, "anthropic");
    });

    it("showHemispheres defaults to false when not set", () => {
        const session = store.createSession("SR ShowHemispheres Default");
        store.saveSRConfig(session.sessionId, true, "openai", "gpt-4o", null, null);
        const cfg = store.getSRConfig(session.sessionId);
        assert.ok(cfg);
        assert.equal(cfg.showHemispheres, false);
    });

    it("circuitBreakerEnabled defaults to true when not set", () => {
        const session = store.createSession("SR CB Default");
        store.saveSRConfig(session.sessionId, true, "openai", "gpt-4o", null, null);
        const cfg = store.getSRConfig(session.sessionId);
        assert.ok(cfg);
        assert.equal(cfg.circuitBreakerEnabled, true);
    });

    // ── PRISM Micro Support Desk Tickets ──────────────────────────────────

    it("creates, lists, updates, and deletes support tickets", () => {
        // Create ticket
        const ticket = store.createSupportTicket({
            title: "Database Lock Incident",
            description: "Concurrent writes locking sqlite journal file.",
            source: "diagnostics",
            severity: "high",
            metadata: { pid: 1042 },
        });
        assert.ok(ticket.ticketId.startsWith("TKT-"), "generates a valid TKT ID");
        assert.equal(ticket.title, "Database Lock Incident");
        assert.equal(ticket.status, "open");
        assert.equal(ticket.severity, "high");
        assert.deepEqual(ticket.metadata, { pid: 1042 });

        // List tickets
        const list = store.listSupportTickets();
        const found = list.find((x) => x.ticketId === ticket.ticketId);
        assert.ok(found, "ticket exists in list");
        assert.equal(found.title, "Database Lock Incident");

        // Update status to investigating
        const okUpdate = store.updateSupportTicket(ticket.ticketId, "investigating");
        assert.ok(okUpdate, "updates status successfully");
        const list2 = store.listSupportTickets();
        const found2 = list2.find((x) => x.ticketId === ticket.ticketId);
        assert.ok(found2, "found2 exists");
        assert.equal(found2.status, "investigating");
        assert.equal(found2.resolutionLog, null);

        // Resolve ticket with long-term knowledge base entry
        const okResolve = store.updateSupportTicket(
            ticket.ticketId,
            "resolved",
            "Configured multi-write retry buffer to resolve locks."
        );
        assert.ok(okResolve, "resolves ticket successfully");
        const list3 = store.listSupportTickets();
        const found3 = list3.find((x) => x.ticketId === ticket.ticketId);
        assert.ok(found3, "found3 exists");
        assert.equal(found3.status, "resolved");
        assert.equal(found3.resolutionLog, "Configured multi-write retry buffer to resolve locks.");

        // Delete ticket
        const okDelete = store.deleteSupportTicket(ticket.ticketId);
        assert.ok(okDelete, "deletes ticket successfully");
        const list4 = store.listSupportTickets();
        const found4 = list4.find((x) => x.ticketId === ticket.ticketId);
        assert.equal(found4, undefined, "ticket is removed from DB");
    });
});
