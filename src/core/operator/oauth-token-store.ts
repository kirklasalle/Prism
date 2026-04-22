/**
 * OAuthTokenStore — Secure storage for OAuth 2.0 access/refresh tokens.
 *
 * Provides a provider-keyed token store that is decoupled from the LLM
 * ProviderSecretStore.  Uses the same underlying Windows DPAPI mechanism
 * on Windows, with an in-memory fallback for tests / non-Windows platforms.
 *
 * Token keys are plain strings of the form "{provider}:{slot}" e.g.:
 *   "gmail:access_token"    "gmail:refresh_token"    "gmail:token_expiry"
 *   "outlook:access_token"  "outlook:refresh_token"
 */

import {
    existsSync,
    mkdirSync,
    rmSync,
    readdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Public interface ──────────────────────────────────────────────────────────

export interface OAuthToken {
    accessToken: string;
    refreshToken: string | null;
    /** ISO-8601 UTC expiry timestamp, or null if the token has no expiry. */
    expiresAt: string | null;
    /** Raw scopes granted by the provider. */
    scopes: string[];
    /** Provider that issued the token, e.g. "gmail" or "outlook". */
    provider: string;
}

export interface OAuthTokenStore {
    has(provider: string): boolean;
    get(provider: string): OAuthToken | null;
    set(provider: string, token: OAuthToken): void;
    clear(provider: string): void;
    listProviders(): string[];
}

// ── In-memory store (tests + non-Windows) ────────────────────────────────────

export class InMemoryOAuthTokenStore implements OAuthTokenStore {
    private readonly tokens = new Map<string, OAuthToken>();

    has(provider: string): boolean {
        return this.tokens.has(provider);
    }

    get(provider: string): OAuthToken | null {
        return this.tokens.get(provider) ?? null;
    }

    set(provider: string, token: OAuthToken): void {
        this.tokens.set(provider, token);
    }

    clear(provider: string): void {
        this.tokens.delete(provider);
    }

    listProviders(): string[] {
        return Array.from(this.tokens.keys());
    }
}

// ── Windows DPAPI-backed store ────────────────────────────────────────────────

function defaultTokenRoot(): string {
    return join(homedir(), ".prism", "oauth-tokens");
}

function escapePowerShell(s: string): string {
    return s.replace(/'/g, "''");
}

/**
 * Windows DPAPI-backed OAuth token store.
 * Tokens are stored as DPAPI-encrypted JSON files under ~/.prism/oauth-tokens/.
 * Only available on Windows.
 */
export class WindowsOAuthTokenStore implements OAuthTokenStore {
    constructor(private readonly rootDir: string = defaultTokenRoot()) {
        if (process.platform !== "win32") {
            throw new Error("WindowsOAuthTokenStore is only available on Windows.");
        }
        mkdirSync(this.rootDir, { recursive: true });
    }

    private filePath(provider: string): string {
        // Sanitize provider name for use as a filename.
        const safe = provider.replace(/[^a-zA-Z0-9_-]/g, "_");
        return join(this.rootDir, `${safe}.tok`);
    }

    has(provider: string): boolean {
        return existsSync(this.filePath(provider));
    }

    get(provider: string): OAuthToken | null {
        if (!this.has(provider)) return null;
        try {
            const script = [
                `$path = '${escapePowerShell(this.filePath(provider))}'`,
                "if (-not (Test-Path -LiteralPath $path)) { exit 0 }",
                "$encrypted = Get-Content -LiteralPath $path -Raw",
                "if ([string]::IsNullOrWhiteSpace($encrypted)) { exit 0 }",
                "$secure = ConvertTo-SecureString $encrypted",
                "$cred = New-Object System.Management.Automation.PSCredential('prism', $secure)",
                "$plain = $cred.GetNetworkCredential().Password",
                "[Console]::Out.Write($plain)",
            ].join("; ");
            const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
                encoding: "utf8",
                windowsHide: true,
                timeout: 10000,
            }).trim();
            if (!raw) return null;
            return JSON.parse(raw) as OAuthToken;
        } catch {
            return null;
        }
    }

    set(provider: string, token: OAuthToken): void {
        const json = JSON.stringify(token);
        const b64 = Buffer.from(json, "utf8").toString("base64");
        const script = [
            `$path = '${escapePowerShell(this.filePath(provider))}'`,
            `$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`,
            "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
            "$encrypted = ConvertFrom-SecureString $secure",
            "Set-Content -LiteralPath $path -Value $encrypted -Encoding UTF8 -NoNewline",
        ].join("; ");
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
            windowsHide: true,
            timeout: 10000,
        });
    }

    clear(provider: string): void {
        const p = this.filePath(provider);
        if (existsSync(p)) rmSync(p, { force: true });
    }

    listProviders(): string[] {
        try {
            return readdirSync(this.rootDir)
                .filter((f) => f.endsWith(".tok"))
                .map((f) => f.slice(0, -4));
        } catch {
            return [];
        }
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the appropriate OAuthTokenStore for the current platform.
 * Uses Windows DPAPI store on Windows, in-memory store everywhere else.
 */
export function createOAuthTokenStore(rootDir?: string): OAuthTokenStore {
    if (process.platform === "win32") {
        return new WindowsOAuthTokenStore(rootDir);
    }
    return new InMemoryOAuthTokenStore();
}
