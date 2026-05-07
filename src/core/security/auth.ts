/**
 * PRISM Authentication Gate
 *
 * Provides token-based authentication for the dashboard HTTP server.
 * On first run, a random admin token is generated and persisted to workspace.
 * All API requests must include `Authorization: Bearer <token>` unless the
 * route is whitelisted (health, public assets, setup wizard on first run).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage } from "node:http";
import type { IamPrincipal } from "../iam/rbac.js";

export interface AuthConfig {
    /** Path to token file on disk */
    tokenFilePath: string;
    /** Routes that bypass auth entirely */
    publicRoutes?: string[];
    /** Route prefixes that bypass auth */
    publicPrefixes?: string[];
    /** If true, auth is disabled (dev mode) */
    disabled?: boolean;
}

export interface AuthResult {
    authenticated: boolean;
    reason?: string;
    /**
     * Optional authenticated identity. Populated by enterprise IAM paths
     * (Phase H) and by the legacy admin-token path when callers opt in via
     * `attachPrincipal`. Absence of this field is normal and means the
     * caller should rely on the existing token-only contract.
     */
    principal?: IamPrincipal;
}

const DEFAULT_PUBLIC_ROUTES = [
    "/health",
    "/api/health",
];

const DEFAULT_PUBLIC_PREFIXES = [
    "/public/",
];

export class AuthGate {
    private token: string;
    private readonly publicRoutes: Set<string>;
    private readonly publicPrefixes: string[];
    private readonly disabled: boolean;

    constructor(private readonly config: AuthConfig) {
        this.disabled = config.disabled ?? false;
        this.publicRoutes = new Set([
            ...DEFAULT_PUBLIC_ROUTES,
            ...(config.publicRoutes ?? []),
        ]);
        this.publicPrefixes = [
            ...DEFAULT_PUBLIC_PREFIXES,
            ...(config.publicPrefixes ?? []),
        ];
        this.token = this.loadOrCreateToken();
    }

    /** Returns the current admin token (for display at startup) */
    getToken(): string {
        return this.token;
    }

    /** Check whether a request is authenticated */
    check(req: IncomingMessage): AuthResult {
        if (this.disabled) {
            return { authenticated: true };
        }

        const url = req.url ?? "";
        const urlPath = url.split("?")[0];

        // Public routes bypass auth
        if (this.publicRoutes.has(urlPath)) {
            return { authenticated: true };
        }
        for (const prefix of this.publicPrefixes) {
            if (urlPath.startsWith(prefix)) {
                return { authenticated: true };
            }
        }

        // Check Authorization header
        const authHeader = req.headers["authorization"];
        if (!authHeader) {
            // Also accept token via query param for WebSocket upgrade
            const qIdx = url.indexOf("?");
            if (qIdx >= 0) {
                const params = new URLSearchParams(url.slice(qIdx + 1));
                const qToken = params.get("token");
                if (qToken && this.safeCompare(qToken, this.token)) {
                    return { authenticated: true };
                }
            }
            return { authenticated: false, reason: "Missing Authorization header" };
        }

        // Expect "Bearer <token>"
        const parts = authHeader.split(" ");
        if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
            return { authenticated: false, reason: "Invalid Authorization format (expected Bearer token)" };
        }

        const provided = parts[1];
        if (!this.safeCompare(provided, this.token)) {
            return { authenticated: false, reason: "Invalid token" };
        }

        return { authenticated: true };
    }

    /** Regenerate the admin token and persist it */
    regenerateToken(): string {
        this.token = this.generateToken();
        this.persistToken(this.token);
        return this.token;
    }

    private loadOrCreateToken(): string {
        const filePath = this.config.tokenFilePath;
        if (existsSync(filePath)) {
            const stored = readFileSync(filePath, "utf-8").trim();
            if (stored.length >= 32) {
                return stored;
            }
        }
        const newToken = this.generateToken();
        this.persistToken(newToken);
        return newToken;
    }

    private persistToken(token: string): void {
        const dir = dirname(this.config.tokenFilePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.config.tokenFilePath, token, { mode: 0o600 });
    }

    private generateToken(): string {
        return randomBytes(32).toString("hex");
    }

    private safeCompare(a: string, b: string): boolean {
        const bufA = Buffer.from(a, "utf-8");
        const bufB = Buffer.from(b, "utf-8");
        if (bufA.length !== bufB.length) {
            return false;
        }
        return timingSafeEqual(bufA, bufB);
    }
}
