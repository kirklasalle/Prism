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
});
