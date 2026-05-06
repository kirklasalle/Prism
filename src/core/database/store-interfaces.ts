/**
 * Phase F — Persistence Interfaces (Phase F-A)
 *
 * High-level store interfaces consumed by orchestrators, dashboards, and
 * test harnesses. The two existing concrete stores
 * (`ChatSessionStore`, `SqliteActivityStore`) declare `implements`
 * conformance against these interfaces — this is a structural
 * codification of the public surface, not a behavior change.
 *
 * Backed today by SQLite via the IDatabaseAdapter; a Postgres adapter
 * implementing the same shape lands in F-B.
 *
 * @module core/database/store-interfaces
 */

import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";

// ── ISessionStore ─────────────────────────────────────────────────────────────

/**
 * Minimum ChatSessionStore-compatible surface that orchestrator surfaces
 * depend on. Mirrors the existing concrete methods 1:1 (no narrowing) so
 * `ChatSessionStore implements ISessionStore` is a pure annotation.
 *
 * Method signatures intentionally use `unknown`/`Record<string, unknown>`
 * for payloads consumers don't need to introspect through the interface
 * — the concrete class still has its strongly-typed signatures, and
 * existing callers continue to use the concrete class directly.
 */
export interface ISessionStore {
    createSession(input?: unknown): unknown;
    listSessions(): unknown[];
    getSession(sessionId: string): unknown;
    getMessages(sessionId: string): unknown[];
    appendMessage(...args: unknown[]): unknown;
    updateSessionTitle(sessionId: string, title: string): void;
    deleteSession(sessionId: string): void;
    close(): void;
}

// ── IActivityStore ────────────────────────────────────────────────────────────

/**
 * Activity store contract. `SqliteActivityStore` already exposes this
 * shape via `ActivitySubscriber.onEvent` plus `queryEvents` / `close`.
 */
export interface IActivityStore extends ActivitySubscriber {
    /** Append an event (alias of onEvent for symmetry with future async backends). */
    onEvent(event: ActivityEvent): void;
    /** Query persisted events with optional filters. */
    queryEvents(filter: Record<string, unknown>): ActivityEvent[];
    /** Release underlying connection. */
    close(): void;
}
