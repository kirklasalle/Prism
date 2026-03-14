import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PrismLlmProviderId } from "./llm-provider-manager.js";

export interface ProviderSecretStore {
    hasApiKey(providerId: PrismLlmProviderId): boolean;
    getApiKey(providerId: PrismLlmProviderId): string | null;
    setApiKey(providerId: PrismLlmProviderId, apiKey: string): void;
    clearApiKey(providerId: PrismLlmProviderId): void;
}

export class InMemoryProviderSecretStore implements ProviderSecretStore {
    private readonly apiKeys = new Map<PrismLlmProviderId, string>();

    hasApiKey(providerId: PrismLlmProviderId): boolean {
        return this.apiKeys.has(providerId);
    }

    getApiKey(providerId: PrismLlmProviderId): string | null {
        return this.apiKeys.get(providerId) ?? null;
    }

    setApiKey(providerId: PrismLlmProviderId, apiKey: string): void {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            throw new Error("API key cannot be empty.");
        }
        this.apiKeys.set(providerId, trimmed);
    }

    clearApiKey(providerId: PrismLlmProviderId): void {
        this.apiKeys.delete(providerId);
    }
}

export class WindowsProtectedFileProviderSecretStore implements ProviderSecretStore {
    constructor(private readonly rootDir: string = defaultSecretRoot()) {
        if (process.platform !== "win32") {
            throw new Error("Windows protected provider secret storage is only available on Windows.");
        }
        mkdirSync(this.rootDir, { recursive: true });
    }

    hasApiKey(providerId: PrismLlmProviderId): boolean {
        return existsSync(this.filePath(providerId));
    }

    getApiKey(providerId: PrismLlmProviderId): string | null {
        if (!this.hasApiKey(providerId)) {
            return null;
        }

        const script = [
            `$path = '${escapePowerShell(this.filePath(providerId))}'`,
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

    setApiKey(providerId: PrismLlmProviderId, apiKey: string): void {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            throw new Error("API key cannot be empty.");
        }

        const encoded = Buffer.from(trimmed, "utf8").toString("base64");
        const script = [
            `$path = '${escapePowerShell(this.filePath(providerId))}'`,
            `$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
            "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
            "$encrypted = ConvertFrom-SecureString $secure",
            "Set-Content -LiteralPath $path -Value $encrypted -Encoding UTF8 -NoNewline",
        ].join("; ");

        this.runPowerShell(script);
    }

    clearApiKey(providerId: PrismLlmProviderId): void {
        const path = this.filePath(providerId);
        if (existsSync(path)) {
            rmSync(path, { force: true });
        }
    }

    private filePath(providerId: PrismLlmProviderId): string {
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