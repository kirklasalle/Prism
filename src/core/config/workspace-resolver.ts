import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tenantSubroot } from "./tenant-context.js";

// ──────────────────────────────────────────────────────────────────────────────
// Workspace Manifest
// ──────────────────────────────────────────────────────────────────────────────

export interface WorkspaceManifest {
    version: string;
    created: string;
    lastAccessed: string;
    profile: string;
    platform: string;
}

const MANIFEST_VERSION = "1.0.0";
const MANIFEST_FILE = "prism-workspace.json";

// ──────────────────────────────────────────────────────────────────────────────
// Workspace subdirectory structure
// ──────────────────────────────────────────────────────────────────────────────

const WORKSPACE_SUBDIRS = [
    "config",
    "artifacts",
    "artifacts/benchmarks",
    "artifacts/releases",
    "artifacts/self-review",
    "artifacts/contracts",
    "artifacts/ci-gates",
    "artifacts/packages",
    "data",
    "data/tasks",
    "data/notes",
    "data/email",
    "data/calendar",
    "state",
    "state/container-snapshots",
    "state/framebuffer-screengrabs",
    "state/browser-profiles",
    "characters",
    "skills",
    "logs",
    "workspace",
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the default workspace root based on OS conventions.
 *
 * - Windows: %USERPROFILE%\Documents\Prism_Refraction
 * - macOS:   ~/Documents/Prism_Refraction
 * - Linux:   $XDG_DATA_HOME/Prism_Refraction (fallback: ~/.local/share/Prism_Refraction)
 */
function defaultWorkspaceRoot(): string {
    const os = platform();
    if (os === "win32") {
        const userProfile = process.env.USERPROFILE?.trim();
        const base = userProfile || homedir();
        return join(base, "Documents", "Prism_Refraction");
    }
    if (os === "darwin") {
        return join(homedir(), "Documents", "Prism_Refraction");
    }
    // Linux / other: XDG_DATA_HOME or ~/.local/share
    const xdgData = process.env.XDG_DATA_HOME?.trim();
    if (xdgData) {
        return join(xdgData, "Prism_Refraction");
    }
    return join(homedir(), ".local", "share", "Prism_Refraction");
}

let _resolvedRoot: string | undefined;

// ──────────────────────────────────────────────────────────────────────────────
// Preferences persistence
// ──────────────────────────────────────────────────────────────────────────────

export interface PrismPreferences {
    workspaceRoot?: string;
    runtimeSettings?: Record<string, unknown>;
    setupComplete?: boolean;
    executionProfileSegment?: "individual" | "business";
    /** UI mode preference — "simple" for non-technical users, "advanced" for operator dashboard. */
    uiMode?: "simple" | "advanced";
    /** Phase E3b: workspace-level default character bound to new chat sessions. */
    defaultCharacterId?: string;
    /** Phase E3b: most recent character used for a new session (prefills modal). */
    lastUsedCharacterId?: string;
    /** Phase E3b: the CAC assignment id the first-run wizard created. */
    cacBootstrapAssignmentId?: string;
    /** v0.20.5: persisted Guardian Agent configuration (model selection, autoStart, etc.).
     * Stored as a free-form record so we don't have to import the GuardianConfig type into
     * the workspace-resolver layer; dashboard-service shape-checks before applying. */
    guardianConfig?: Record<string, unknown>;
    /** Phase 4: Dynamic power mode preference for LLM execution routing. */
    powerMode?: "performance" | "eco" | "adaptive";
    lastModified: string;
}

const PREFERENCES_FILE = ".prism-preferences.json";

function projectRoot(): string {
    // Walk up from this module until we find package.json (works from both src/ and dist/)
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(dir, "package.json"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    // Fallback: 3 levels up from config/ -> core/ -> src/ -> repo
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function preferencesPath(): string {
    // Test/multi-workspace override — when set, the preferences file lives
    // at the absolute path provided. Lets integration tests run in isolation
    // without inheriting the developer's local prefs file (and lets backup /
    // migration tooling target an alternate workspace cleanly).
    const override = process.env.PRISM_PREFERENCES_PATH?.trim();
    if (override) return override;
    return join(projectRoot(), PREFERENCES_FILE);
}

export function readPreferences(): PrismPreferences | null {
    const p = preferencesPath();
    if (!existsSync(p)) return null;
    try {
        return JSON.parse(readFileSync(p, "utf-8")) as PrismPreferences;
    } catch {
        return null;
    }
}

export function writePreferences(prefs: Partial<PrismPreferences>): void {
    const existing = readPreferences() || { lastModified: "" };
    const merged = { ...existing, ...prefs, lastModified: new Date().toISOString() };
    writeFileSync(preferencesPath(), JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

/**
 * Resolve the workspace root path.
 * Priority: persisted preference (most recent user choice) > PRISM_WORKSPACE_ROOT env var > OS default.
 * Result is cached for the process lifetime.
 */
export function resolveWorkspaceRoot(): string {
    if (_resolvedRoot !== undefined) {
        return _resolvedRoot;
    }
    // Check persisted preference first (most recent user choice in dashboard)
    const prefs = readPreferences();
    if (prefs?.workspaceRoot && isAbsolute(prefs.workspaceRoot) && existsSync(prefs.workspaceRoot)) {
        _resolvedRoot = prefs.workspaceRoot;
        return _resolvedRoot;
    }
    // Fall back to env var 
    const envOverride = process.env.PRISM_WORKSPACE_ROOT?.trim();
    if (envOverride) {
        _resolvedRoot = envOverride;
        return _resolvedRoot;
    }
    _resolvedRoot = defaultWorkspaceRoot();
    return _resolvedRoot;
}

/**
 * Join segments onto the workspace root to build a full path.
 *
 * When multi-tenant mode is active (`PRISM_MULTI_TENANT=on`) and a
 * non-default tenant is on the AsyncLocalStorage stack, the tenant's
 * subroot (`{root}/.tenants/{id}/`) is used instead of the bare root.
 * Default tenant + flag-off path returns the legacy result unchanged.
 *
 * @example workspacePath("state", "prism-activity.db")
 */
export function workspacePath(...segments: string[]): string {
    return join(tenantSubroot(resolveWorkspaceRoot()), ...segments);
}

/**
 * Like `workspacePath()` but always resolves against the bare workspace
 * root, ignoring any active tenant scope. Use for cross-tenant assets
 * (e.g. shared installer artifacts) that must NOT be tenant-isolated.
 */
export function untenantedWorkspacePath(...segments: string[]): string {
    return join(resolveWorkspaceRoot(), ...segments);
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience accessors for common resolved paths
// ──────────────────────────────────────────────────────────────────────────────

export function workspaceDbPath(): string {
    return workspacePath("state", "prism-activity.db");
}

export function workspaceArtifactsDir(): string {
    return workspacePath("artifacts");
}

export function workspaceDataDir(): string {
    return workspacePath("data");
}

export function workspaceConfigDir(): string {
    return workspacePath("config");
}

export function workspaceCharactersDir(): string {
    return workspacePath("characters");
}

export function workspaceLogsDir(): string {
    return workspacePath("logs");
}

export function workspaceStateDir(): string {
    return workspacePath("state");
}

export function workspaceFramebufferDir(): string {
    return workspacePath("state", "framebuffer-screengrabs");
}

export function workspaceBrowserProfilesDir(): string {
    return workspacePath("state", "browser-profiles");
}

// ──────────────────────────────────────────────────────────────────────────────
// Structure initialization
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create the workspace directory tree if it doesn't exist.
 * Writes (or updates) the workspace manifest.
 * Safe to call multiple times — idempotent.
 */
export function ensureWorkspaceStructure(environmentProfile = "dev"): void {
    const root = resolveWorkspaceRoot();

    // Create root and all subdirectories
    for (const subdir of WORKSPACE_SUBDIRS) {
        const fullPath = join(root, subdir);
        if (!existsSync(fullPath)) {
            mkdirSync(fullPath, { recursive: true });
        }
    }

    // Ensure root itself exists (handles the case of empty WORKSPACE_SUBDIRS)
    if (!existsSync(root)) {
        mkdirSync(root, { recursive: true });
    }

    // Write or update manifest
    const manifestPath = join(root, MANIFEST_FILE);
    const now = new Date().toISOString();
    if (existsSync(manifestPath)) {
        // Update lastAccessed
        const existing = readWorkspaceManifest();
        if (existing) {
            existing.lastAccessed = now;
            writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
        }
    } else {
        const manifest: WorkspaceManifest = {
            version: MANIFEST_VERSION,
            created: now,
            lastAccessed: now,
            profile: environmentProfile,
            platform: platform(),
        };
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    }

    // Seed default skills
    seedDefaultSkills();
}

// ──────────────────────────────────────────────────────────────────────────────
// Manifest I/O
// ──────────────────────────────────────────────────────────────────────────────

export function readWorkspaceManifest(): WorkspaceManifest | null {
    const manifestPath = join(resolveWorkspaceRoot(), MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(manifestPath, "utf-8")) as WorkspaceManifest;
    } catch {
        return null;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy detection (for migration notices)
// ──────────────────────────────────────────────────────────────────────────────

export interface LegacyPathDetection {
    found: boolean;
    paths: string[];
}

/**
 * Detect legacy CWD-relative persistence paths.
 * Returns a list of paths that exist so callers can log a migration notice.
 */
export function detectLegacyPaths(): LegacyPathDetection {
    const candidates = [
        "prism-output",
        "prism-data",
        "prism-activity.db",
        ".mcp/mcp-settings.json",
    ];
    const found = candidates.filter((p) => existsSync(p));
    return { found: found.length > 0, paths: found };
}

/**
 * Set the workspace root at runtime without requiring a restart.
 * Updates both the in-process cache and the PRISM_WORKSPACE_ROOT env var.
 * Throws if the path is not absolute.
 */
export function setWorkspaceRoot(newPath: string): void {
    if (!newPath || !isAbsolute(newPath)) {
        throw new Error("Workspace path must be an absolute path.");
    }
    _resolvedRoot = newPath;
    process.env.PRISM_WORKSPACE_ROOT = newPath;
    try {
        const filePath = preferencesPath();
        writePreferences({ workspaceRoot: newPath });
        // Verify the write was successful by reading back
        const verified = readPreferences();
        if (verified?.workspaceRoot !== newPath) {
            console.warn(`[PRISM][workspace] Preference write verification failed — written path does not match.`);
        } else {
            console.log(`[PRISM][workspace] Workspace preference persisted to ${filePath}: ${newPath}`);
        }
    } catch (err: unknown) {
        console.warn(`[PRISM][workspace] Failed to persist workspace preference to ${preferencesPath()}: ${String(err)}`);
    }
}

/**
 * Reset the cached workspace root. Only needed for testing.
 */
export function _resetWorkspaceRootCache(): void {
    _resolvedRoot = undefined;
}

/**
 * Override the cached workspace root without persisting to preferences.
 * Only needed for testing to isolate workspace from a running server.
 */
export function _setWorkspaceRootForTest(newPath: string): void {
    _resolvedRoot = newPath;
    process.env.PRISM_WORKSPACE_ROOT = newPath;
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace Hub
// ──────────────────────────────────────────────────────────────────────────────

interface WorkspaceHubConfig {
    workspaceHub: string;
    updatedAt: string;
}

const HUB_CONFIG_FILE = "workspace-hub.json";

export function getWorkspaceHub(): string {
    const configPath = join(resolveWorkspaceRoot(), "config", HUB_CONFIG_FILE);
    if (!existsSync(configPath)) return "";
    try {
        const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as WorkspaceHubConfig;
        return String(parsed.workspaceHub ?? "").trim();
    } catch {
        return "";
    }
}

export function setWorkspaceHub(hub: string): void {
    const configDir = join(resolveWorkspaceRoot(), "config");
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }
    const configPath = join(configDir, HUB_CONFIG_FILE);
    const config: WorkspaceHubConfig = {
        workspaceHub: hub.trim(),
        updatedAt: new Date().toISOString(),
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// Default Character Seeding
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Seed the workspace characters/ directory with default character definitions
 * from the repo characters/ directory if the workspace has no character files.
 * Safe to call multiple times — only seeds when the directory is empty.
 */
export function seedDefaultCharacters(): void {
    const workspaceDir = workspacePath("characters");
    if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
    }

    // Check if any JSON files already exist
    const existing = readdirSync(workspaceDir).filter((f) => f.toLowerCase().endsWith(".json"));
    if (existing.length > 0) return;

    // Locate repo characters/ directory
    const repoRoot = projectRoot();
    const repoCharsDir = join(repoRoot, "characters");
    if (!existsSync(repoCharsDir)) return;

    const repoFiles = readdirSync(repoCharsDir).filter((f) => f.toLowerCase().endsWith(".json"));
    for (const fileName of repoFiles) {
        const src = join(repoCharsDir, fileName);
        const dest = join(workspaceDir, fileName);
        try {
            copyFileSync(src, dest);
        } catch {
            // Skip files that fail to copy
        }
    }

    if (repoFiles.length > 0) {
        console.log(`[PRISM][workspace] Seeded ${repoFiles.length} default character(s) into ${workspaceDir}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Default Skills Seeding
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Seed the workspace skills/ directory with default skill definitions
 * from the repo skills/ directory if the workspace has no skill files.
 * Safe to call multiple times — only seeds when the directory is empty.
 */
export function seedDefaultSkills(): void {
    const workspaceDir = workspacePath("skills");
    if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
    }

    // Check if any JSON or YAML files already exist
    const existing = readdirSync(workspaceDir).filter((f) => {
        const lower = f.toLowerCase();
        return lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml");
    });
    if (existing.length > 0) return;

    // Locate repo skills/ directory
    const repoRoot = projectRoot();
    const repoSkillsDir = join(repoRoot, "skills");
    if (!existsSync(repoSkillsDir)) return;

    const repoFiles = readdirSync(repoSkillsDir).filter((f) => {
        const lower = f.toLowerCase();
        return lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml");
    });
    for (const fileName of repoFiles) {
        const src = join(repoSkillsDir, fileName);
        const dest = join(workspaceDir, fileName);
        try {
            copyFileSync(src, dest);
        } catch {
            // Skip files that fail to copy
        }
    }

    if (repoFiles.length > 0) {
        console.log(`[PRISM][workspace] Seeded ${repoFiles.length} default skill(s) into ${workspaceDir}`);
    }
}
