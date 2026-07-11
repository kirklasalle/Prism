/**
 * PRISM Add-on Boot Loader
 *
 * Discovers, validates, and loads add-ons at PRISM startup.
 * Add-ons are loaded from the `addons/` directory at the workspace root.
 * Each add-on must contain a valid `addon.manifest.json`.
 *
 * "I know Kungfu." — Neo. Add-ons are how PRISM learns new domains.
 *
 * @module addons/addon-loader
 */

import fs from "node:fs";
import path from "node:path";
import type { AddonManifest, AddonInstance, AddonState } from "./types.js";
import { validateAddonManifest } from "./addon-validator.js";

/** In-memory registry of loaded add-ons. */
const addonRegistry: Map<string, AddonInstance> = new Map();

/**
 * Discover and load all add-ons from the addons/ directory.
 *
 * @param workspaceRoot - Absolute path to the PRISM workspace root.
 * @returns Array of loaded add-on instances.
 */
export function loadAddons(workspaceRoot: string): AddonInstance[] {
    const addonsDir = path.join(workspaceRoot, "addons");
    if (!fs.existsSync(addonsDir)) {
        console.log("[addon-loader] No addons/ directory found; skipping add-on loading.");
        return [];
    }

    const entries = fs.readdirSync(addonsDir, { withFileTypes: true });
    const loaded: AddonInstance[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const addonPath = path.join(addonsDir, entry.name);
        const manifestPath = path.join(addonPath, "addon.manifest.json");

        if (!fs.existsSync(manifestPath)) {
            console.warn(`[addon-loader] Skipping ${entry.name}: no addon.manifest.json found`);
            continue;
        }

        try {
            const instance = loadSingleAddon(addonPath, manifestPath);
            addonRegistry.set(instance.manifest.id, instance);
            loaded.push(instance);
            console.log(
                `[addon-loader] ✅ Loaded add-on: ${instance.manifest.name} v${instance.manifest.version} (${instance.manifest.id})`,
            );
        } catch (err) {
            const errorMsg = (err as Error).message;
            console.error(`[addon-loader] ❌ Failed to load add-on from ${entry.name}: ${errorMsg}`);
            // Register as error state so the dashboard can surface it
            addonRegistry.set(entry.name, {
                manifest: {
                    addonFormatVersion: 1,
                    id: entry.name,
                    name: entry.name,
                    version: "0.0.0",
                    author: { name: "unknown" },
                    description: `Failed to load: ${errorMsg}`,
                    license: "unknown",
                    minPrismVersion: "0.0.0",
                    integrationPoints: {
                        memorySubsystem: false,
                        dashboardTab: false,
                        dashboardSubPanels: [],
                        characterExtensions: false,
                        guardianSkills: [],
                        policyExtensions: [],
                        skillDefinitions: [],
                        adapterBridges: [],
                    },
                    dependencies: { addons: [], plugins: [], systemCapabilities: [] },
                    trust: "certified",
                },
                state: "error",
                loadedAt: new Date().toISOString(),
                error: errorMsg,
                rootPath: addonPath,
            });
        }
    }

    console.log(`[addon-loader] Loaded ${loaded.length} add-on(s) from ${addonsDir}`);
    return loaded;
}

/**
 * Load and validate a single add-on from its directory.
 */
function loadSingleAddon(addonPath: string, manifestPath: string): AddonInstance {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("Invalid JSON in addon.manifest.json");
    }

    const validation = validateAddonManifest(parsed);
    if (!validation.valid) {
        throw new Error(`Manifest validation failed:\n  ${validation.errors.join("\n  ")}`);
    }

    if (validation.warnings.length > 0) {
        for (const w of validation.warnings) {
            console.warn(`[addon-loader] ⚠️  ${(parsed as any).id}: ${w}`);
        }
    }

    const manifest = parsed as AddonManifest;

    return {
        manifest,
        state: "active" as AddonState,
        loadedAt: new Date().toISOString(),
        rootPath: addonPath,
    };
}

/* ── Public Query API ───────────────────────────────────────────────── */

/** Get all registered add-on instances. */
export function getLoadedAddons(): AddonInstance[] {
    return Array.from(addonRegistry.values());
}

/** Get a specific add-on by ID. */
export function getAddon(id: string): AddonInstance | undefined {
    return addonRegistry.get(id);
}

/** Get all add-ons that declare a dashboard tab. */
export function getAddonDashboardTabs(): AddonInstance[] {
    return getLoadedAddons().filter((a) => a.state === "active" && a.manifest.integrationPoints.dashboardTab);
}

/** Get all add-ons that extend the memory subsystem. */
export function getMemoryAddons(): AddonInstance[] {
    return getLoadedAddons().filter((a) => a.state === "active" && a.manifest.integrationPoints.memorySubsystem);
}

/** Get all Guardian custodian skills registered by add-ons. */
export function getAddonGuardianSkills(): string[] {
    return getLoadedAddons()
        .filter((a) => a.state === "active")
        .flatMap((a) => a.manifest.integrationPoints.guardianSkills);
}
