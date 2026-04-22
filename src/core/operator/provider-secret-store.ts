import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PrismLlmProviderId } from "./llm-provider-manager.js";

export interface ProviderSecretStore {
    hasApiKey(providerId: PrismLlmProviderId, slot?: string): boolean;
    getApiKey(providerId: PrismLlmProviderId, slot?: string): string | null;
    setApiKey(providerId: PrismLlmProviderId, apiKey: string, slot?: string): void;
    clearApiKey(providerId: PrismLlmProviderId, slot?: string): void;
    /** List all slot names configured for a provider (default slot not included). */
    listSlots(providerId: PrismLlmProviderId): string[];
}

/** Compose a storage key from providerId + optional slot. */
function slotKey(providerId: PrismLlmProviderId, slot?: string): string {
    return slot ? `${providerId}:${slot}` : providerId;
}

export class InMemoryProviderSecretStore implements ProviderSecretStore {
    private readonly apiKeys = new Map<string, string>();

    hasApiKey(providerId: PrismLlmProviderId, slot?: string): boolean {
        return this.apiKeys.has(slotKey(providerId, slot));
    }

    getApiKey(providerId: PrismLlmProviderId, slot?: string): string | null {
        return this.apiKeys.get(slotKey(providerId, slot)) ?? null;
    }

    setApiKey(providerId: PrismLlmProviderId, apiKey: string, slot?: string): void {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            throw new Error("API key cannot be empty.");
        }
        this.apiKeys.set(slotKey(providerId, slot), trimmed);
    }

    clearApiKey(providerId: PrismLlmProviderId, slot?: string): void {
        this.apiKeys.delete(slotKey(providerId, slot));
    }

    listSlots(providerId: PrismLlmProviderId): string[] {
        const prefix = `${providerId}:`;
        const slots: string[] = [];
        for (const key of this.apiKeys.keys()) {
            if (key.startsWith(prefix)) {
                slots.push(key.slice(prefix.length));
            }
        }
        return slots;
    }
}

export class WindowsProtectedFileProviderSecretStore implements ProviderSecretStore {
    constructor(private readonly rootDir: string = defaultSecretRoot()) {
        if (process.platform !== "win32") {
            throw new Error("Windows protected provider secret storage is only available on Windows.");
        }
        mkdirSync(this.rootDir, { recursive: true });
    }

    hasApiKey(providerId: PrismLlmProviderId, slot?: string): boolean {
        return existsSync(this.filePath(providerId, slot));
    }

    getApiKey(providerId: PrismLlmProviderId, slot?: string): string | null {
        if (!this.hasApiKey(providerId, slot)) {
            return null;
        }

        const script = [
            `$path = '${escapePowerShell(this.filePath(providerId, slot))}'`,
            "if (-not (Test-Path -LiteralPath $path)) { exit 0 }",
            "$encrypted = Get-Content -LiteralPath $path -Raw",
            "if ([string]::IsNullOrWhiteSpace($encrypted)) { exit 0 }",
            "$secure = ConvertTo-SecureString $encrypted",
            "$credential = New-Object System.Management.Automation.PSCredential('prism', $secure)",
            "$plain = $credential.GetNetworkCredential().Password",
            "[Console]::Out.Write($plain)",
        ].join("; ");

        return this.runPowerShell(script) || null;
    }

    setApiKey(providerId: PrismLlmProviderId, apiKey: string, slot?: string): void {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            throw new Error("API key cannot be empty.");
        }

        const encoded = Buffer.from(trimmed, "utf8").toString("base64");
        const script = [
            `$path = '${escapePowerShell(this.filePath(providerId, slot))}'`,
            `$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
            "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
            "$encrypted = ConvertFrom-SecureString $secure",
            "Set-Content -LiteralPath $path -Value $encrypted -Encoding UTF8 -NoNewline",
        ].join("; ");

        this.runPowerShell(script);
    }

    clearApiKey(providerId: PrismLlmProviderId, slot?: string): void {
        const path = this.filePath(providerId, slot);
        if (existsSync(path)) {
            rmSync(path, { force: true });
        }
    }

    listSlots(providerId: PrismLlmProviderId): string[] {
        const prefix = `${providerId}-`;
        const suffix = ".secret";
        const slots: string[] = [];
        try {
            for (const name of readdirSync(this.rootDir)) {
                if (name.startsWith(prefix) && name.endsWith(suffix)) {
                    const slot = name.slice(prefix.length, -suffix.length);
                    if (slot) slots.push(slot);
                }
            }
        } catch {
            // directory not yet created or not readable — return empty
        }
        return slots;
    }

    private filePath(providerId: PrismLlmProviderId, slot?: string): string {
        if (slot) {
            return join(this.rootDir, `${providerId}-${slot}.secret`);
        }
        return join(this.rootDir, `${providerId}.secret`);
    }

    private runPowerShell(script: string): string {
        try {
            return execFileSync(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
                { encoding: "utf8" },
            ).trim();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Provider secret store operation failed: ${message}`);
        }
    }
}

function defaultSecretRoot(): string {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
        return join(appData, "Prism", "provider-secrets");
    }
    return join(homedir(), "AppData", "Roaming", "Prism", "provider-secrets");
}

function escapePowerShell(value: string): string {
    return value.replace(/'/g, "''");
}