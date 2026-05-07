/**
 * Integration tests for the approval queue — list, approve, deny flows
 * using the ApprovalQueue class directly, plus endpoint path verification.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";

describe("ApprovalQueue", () => {
    // ── list ──────────────────────────────────────────────────────────────

    it("list() returns empty array initially", () => {
        const q = new ApprovalQueue();
        assert.deepEqual(q.list(), []);
    });

    it("list() shows a pending item after request()", async () => {
        const q = new ApprovalQueue();
        // Fire-and-forget request with short timeout so it cleans up
        void q.request("session-1", "test.op", { foo: "bar" }, 5000);
        const pending = q.list();
        assert.equal(pending.length, 1);
        assert.equal(pending[0].operation, "test.op");
        assert.equal(pending[0].sessionId, "session-1");
        // Clean up by denying
        q.deny(pending[0].id);
    });

    it("list() shows correct context in pending item", () => {
        const q = new ApprovalQueue();
        void q.request("session-ctx", "ctx.op", { key: "value", num: 42 }, 5000);
        const pending = q.list();
        assert.equal(pending.length, 1);
        assert.deepEqual(pending[0].context, { key: "value", num: 42 });
        q.deny(pending[0].id);
    });

    // ── approve ───────────────────────────────────────────────────────────

    it("approve() resolves the request promise with true", async () => {
        const q = new ApprovalQueue();
        const resultPromise = q.request("session-a", "approve.op", {}, 5000);
        const pending = q.list();
        assert.equal(pending.length, 1);
        const approved = q.approve(pending[0].id);
        assert.equal(approved, true, "approve() returns true on success");
        const result = await resultPromise;
        assert.equal(result, true, "promise resolves to true");
    });

    it("approve() removes the item from the pending list", async () => {
        const q = new ApprovalQueue();
        const p = q.request("session-b", "rm.op", {}, 5000);
        const id = q.list()[0].id;
        q.approve(id);
        await p;
        assert.equal(q.list().length, 0);
    });

    // ── deny ──────────────────────────────────────────────────────────────

    it("deny() resolves the request promise with false", async () => {
        const q = new ApprovalQueue();
        const resultPromise = q.request("session-d", "deny.op", {}, 5000);
        const pending = q.list();
        const denied = q.deny(pending[0].id);
        assert.equal(denied, true, "deny() returns true on success");
        const result = await resultPromise;
        assert.equal(result, false, "promise resolves to false");
    });

    it("deny() removes the item from the pending list", async () => {
        const q = new ApprovalQueue();
        const p = q.request("session-e", "rm2.op", {}, 5000);
        const id = q.list()[0].id;
        q.deny(id);
        await p;
        assert.equal(q.list().length, 0);
    });

    // ── unknown id ────────────────────────────────────────────────────────

    it("approve() returns false for unknown id", () => {
        const q = new ApprovalQueue();
        assert.equal(q.approve("does-not-exist"), false);
    });

    it("deny() returns false for unknown id", () => {
        const q = new ApprovalQueue();
        assert.equal(q.deny("does-not-exist"), false);
    });

    // ── multiple pending ──────────────────────────────────────────────────

    it("handles multiple concurrent pending requests independently", async () => {
        const q = new ApprovalQueue();
        const p1 = q.request("s1", "op1", {}, 5000);
        const p2 = q.request("s2", "op2", {}, 5000);
        const p3 = q.request("s3", "op3", {}, 5000);

        assert.equal(q.list().length, 3);

        const ids = q.list().map((x) => x.id);
        q.approve(ids[0]);
        q.deny(ids[1]);
        // Leave p3 to timeout — deny to clean up
        q.deny(ids[2]);

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        assert.equal(r1, true);
        assert.equal(r2, false);
        assert.equal(r3, false);
        assert.equal(q.list().length, 0);
    });

    // ── timeout ───────────────────────────────────────────────────────────

    it("request times out and resolves to false after timeoutMs", async () => {
        const q = new ApprovalQueue();
        const result = await q.request("session-timeout", "timeout.op", {}, 50); // 50ms
        assert.equal(result, false, "timed out request resolves to false");
        assert.equal(q.list().length, 0, "timed out item removed from list");
    });
});
