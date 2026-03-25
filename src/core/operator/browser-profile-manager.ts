import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { workspaceBrowserProfilesDir } from "../config/workspace-resolver.js";
import type { ActivityBus } from "../activity/bus.js";

// ── Profile manifest persisted to disk ──────────────────────────────────
export interface BrowserProfileManifest {
    profileId: string;
    displayName: string;
    prismUserEmail: string;
    executionProfileSegment: "individual" | "business";
    assignmentId?: string;
    operatorEmail?: string;
    clientId?: string;
    createdAt: string;
    lastUsedAt: string;
    updatedAt: string;
    sessionCount: number;
}

// ── Serialized profile info (returned from API) ────────────────────────
export interface BrowserProfileInfo {
    profileId: string;
    displayName: string;
    prismUserEmail: string;
    executionProfileSegment: "individual" | "business";
    assignmentId?: string;
    operatorEmail?: string;
    clientId?: string;
    createdAt: string;
    lastUsedAt: string;
    updatedAt: string;
    sessionCount: number;
    hasStorageState: boolean;
}

// ── Options for creating a profile ──────────────────────────────────────
export interface CreateProfileOptions {
    displayName?: string;
    prismUserEmail: string;
    executionProfileSegment: "individual" | "business";
    assignmentId?: string;
    operatorEmail?: string;
    clientId?: string;
}

const MANIFEST_FILE = "profile-manifest.json";
const STORAGE_STATE_FILE = "storageState.json";

/**
 * Manages persistent browser profiles on disk.
 *
 * Each profile is a directory under `state/browser-profiles/{profileId}/`
 * containing a manifest and optional Playwright storageState JSON.
 *
 * Profiles bind browser identity to the Prism accountability chain:
 *   profileId → prismUserEmail → assignmentId → CharacterAssignment
 *
 * Business tier: profile is required for session launch; email must match
 * accountability chain.
 * Individual tier: profile is optional; advisory email binding.
 */
export class BrowserProfileManager {
    constructor(
        private readonly activityBus?: ActivityBus,
        private readonly sessionId?: string,
    ) {}

    // ── Profile directory helpers ─────────────────────────────────────
    private profilesRoot(): string {
        return workspaceBrowserProfilesDir();
    }

    private profileDir(profileId: string): string {
        return join(this.profilesRoot(), profileId);
    }

    private manifestPath(profileId: string): string {
        return join(this.profileDir(profileId), MANIFEST_FILE);
    }

    private storageStatePath(profileId: string): string {
        return join(this.profileDir(profileId), STORAGE_STATE_FILE);
    }

    // ── Create ────────────────────────────────────────────────────────
    createProfile(options: CreateProfileOptions): BrowserProfileManifest {
        const profileId = `profile-${randomUUID().slice(0, 12)}`;
        const now = new Date().toISOString();

        const manifest: BrowserProfileManifest = {
            profileId,
            displayName: options.displayName || `${options.prismUserEmail} (${options.executionProfileSegment})`,
            prismUserEmail: options.prismUserEmail.toLowerCase().trim(),
            executionProfileSegment: options.executionProfileSegment,
            assignmentId: options.assignmentId,
            operatorEmail: options.operatorEmail?.toLowerCase().trim(),
            clientId: options.clientId,
            createdAt: now,
            lastUsedAt: now,
            updatedAt: now,
            sessionCount: 0,
        };

        const dir = this.profileDir(profileId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(this.manifestPath(profileId), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

        this.emit("browser.profile.created", {
            profileId,
            prismUserEmail: manifest.prismUserEmail,
            executionProfileSegment: manifest.executionProfileSegment,
        });

        return manifest;
    }

    // ── List ──────────────────────────────────────────────────────────
    listProfiles(): BrowserProfileInfo[] {
        const root = this.profilesRoot();
        if (!existsSync(root)) return [];

        const entries = readdirSync(root, { withFileTypes: true });
        const profiles: BrowserProfileInfo[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifest = this.readManifest(entry.name);
            if (!manifest) continue;
            profiles.push({
                ...manifest,
                hasStorageState: existsSync(this.storageStatePath(entry.name)),
            });
        }

        return profiles.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    }

    // ── Get ───────────────────────────────────────────────────────────
    getProfile(profileId: string): BrowserProfileInfo | null {
        const manifest = this.readManifest(profileId);
        if (!manifest) return null;
        return {
            ...manifest,
            hasStorageState: existsSync(this.storageStatePath(profileId)),
        };
    }

    // ── Delete ────────────────────────────────────────────────────────
    deleteProfile(profileId: string): boolean {
        const dir = this.profileDir(profileId);
        if (!existsSync(dir)) return false;

        rmSync(dir, { recursive: true, force: true });

        this.emit("browser.profile.deleted", { profileId });
        return true;
    }

    // ── Storage State I/O ─────────────────────────────────────────────

    /**
     * Load Playwright storageState JSON for a profile.
     * Returns undefined if no stored state exists.
     */
    loadStorageState(profileId: string): Record<string, unknown> | undefined {
        const path = this.storageStatePath(profileId);
        if (!existsSync(path)) return undefined;
        try {
            return JSON.parse(readFileSync(path, "utf-8"));
        } catch {
            return undefined;
        }
    }

    /**
     * Save Playwright storageState JSON for a profile.
     * Called on session close to persist cookies/localStorage.
     */
    saveStorageState(profileId: string, storageState: Record<string, unknown>): void {
        const dir = this.profileDir(profileId);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(
            this.storageStatePath(profileId),
            JSON.stringify(storageState, null, 2) + "\n",
            "utf-8",
        );

        // Update manifest lastUsedAt
        const manifest = this.readManifest(profileId);
        if (manifest) {
            manifest.lastUsedAt = new Date().toISOString();
            manifest.updatedAt = new Date().toISOString();
            writeFileSync(this.manifestPath(profileId), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
        }

        this.emit("browser.profile.saved", { profileId });
    }

    /**
     * Record a session launch against a profile (increments sessionCount).
     */
    recordSessionLaunch(profileId: string): void {
        const manifest = this.readManifest(profileId);
        if (!manifest) return;
        manifest.sessionCount += 1;
        manifest.lastUsedAt = new Date().toISOString();
        manifest.updatedAt = new Date().toISOString();
        writeFileSync(this.manifestPath(profileId), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    }

    // ── Internal helpers ──────────────────────────────────────────────
    private readManifest(profileId: string): BrowserProfileManifest | null {
        const path = this.manifestPath(profileId);
        if (!existsSync(path)) return null;
        try {
            return JSON.parse(readFileSync(path, "utf-8")) as BrowserProfileManifest;
        } catch {
            return null;
        }
    }

    private emit(operation: string, details: Record<string, unknown>): void {
        if (!this.activityBus) return;
        this.activityBus.emit({
            sessionId: this.sessionId ?? "browser-profile",
            layer: "tool_execution",
            operation,
            status: "succeeded",
            details: { ...details, source: "browser-profile-manager" },
        });
    }
}
