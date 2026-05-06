/**
 * Plugin Marketplace (Phase G)
 *
 * Local-first marketplace that reads a JSON catalog from
 * `{workspace}/marketplace/catalog.json` and installs plugin packs by id.
 *
 * This pass:
 *   - `file://` transports only (local copy from a path inside the workspace)
 *   - `http(s)://` returns `installation_unsupported_transport` (deferred to
 *     a later security review)
 *   - Validation delegated to the existing PluginPackValidator pipeline at
 *     install time (caller responsibility — this module exposes the file path)
 *   - Uninstall archives non-destructively to `marketplace/.archive/`
 *
 * Gated by `PRISM_MARKETPLACE=on`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";
import { isApproved, latestDecisionFor, type MarketplaceReviewDecision } from "./marketplace-review-ledger.js";

export interface CatalogEntry {
    id: string;
    name: string;
    version: string;
    description?: string;
    /** Transport URL: `file://relative/path/inside/workspace` or `http(s)://...`. */
    source: string;
    /** Trust class applied to the pack when installed. */
    trust?: "unsigned" | "signed" | "verified";
    /** Tags for filtering. */
    tags?: string[];
    /** Tier: 0=free, 1=premium, etc. Free-form. */
    tier?: number;
    /**
     * Phase G — curation flag. When `true`, the pack has been PRISM-reviewed and
     * appears in `listEntries({ curated: true })`. Authoritative truth lives in
     * the review ledger; this flag is a denormalized hint for catalog browsers.
     */
    curated?: boolean;
    /** Phase G — last reviewer (denormalized from ledger; advisory only). */
    reviewedBy?: string;
    /** Phase G — last review timestamp (denormalized; advisory). */
    reviewedAt?: string;
}

export interface MarketplaceCatalog {
    version: string;
    entries: CatalogEntry[];
}

export interface InstallResult {
    ok: boolean;
    error?: string;
    code?: "marketplace_disabled" | "catalog_missing" | "entry_not_found" | "installation_unsupported_transport" | "source_missing" | "rejected_unsigned_business_profile" | "validation_failed";
    installedAt?: string;
    targetPath?: string;
    advisory?: string;
}

export function isMarketplaceEnabled(): boolean {
    return process.env.PRISM_MARKETPLACE === "on";
}

function catalogPath(): string {
    return workspacePath("marketplace", "catalog.json");
}

function installedDir(): string {
    return workspacePath("plugins", "installed");
}

function archiveDir(): string {
    return workspacePath("marketplace", ".archive");
}

export function readCatalog(): MarketplaceCatalog | null {
    const p = catalogPath();
    if (!existsSync(p)) return null;
    try {
        return JSON.parse(readFileSync(p, "utf-8")) as MarketplaceCatalog;
    } catch {
        return null;
    }
}

export function writeCatalog(catalog: MarketplaceCatalog): void {
    const p = catalogPath();
    mkdirSync(workspacePath("marketplace"), { recursive: true });
    writeFileSync(p, JSON.stringify(catalog, null, 2), "utf-8");
}

export function listEntries(opts: { tag?: string; curated?: boolean } = {}): CatalogEntry[] {
    const cat = readCatalog();
    if (!cat) return [];
    let entries = cat.entries;
    if (opts.tag) {
        entries = entries.filter(e => (e.tags ?? []).includes(opts.tag!));
    }
    if (opts.curated === true) {
        // Trust the ledger over the denormalized flag — flag may drift; ledger is source of truth.
        entries = entries.filter(e => isApproved(e.id, e.version));
    } else if (opts.curated === false) {
        entries = entries.filter(e => !isApproved(e.id, e.version));
    }
    return entries;
}

/**
 * Decorate catalog entries with their latest curation decision. Useful for
 * marketplace UIs that need to render review state without performing a
 * second lookup per entry.
 */
export function listEntriesWithCuration(opts: { tag?: string; curated?: boolean } = {}): Array<CatalogEntry & { curationDecision: MarketplaceReviewDecision | null }> {
    return listEntries(opts).map(e => ({
        ...e,
        curationDecision: latestDecisionFor(e.id, e.version),
    }));
}

export function findEntry(id: string): CatalogEntry | null {
    return listEntries().find(e => e.id === id) ?? null;
}

export interface InstallOptions {
    /** Profile classifier — business profile rejects `unsigned` entries. */
    profile?: "individual" | "business" | "enterprise";
}

/**
 * Install an entry by id. file:// transport only. Returns paths but does NOT
 * invoke PluginPackValidator — caller must do that on the returned `targetPath`.
 */
export function installFromCatalog(id: string, opts: InstallOptions = {}): InstallResult {
    if (!isMarketplaceEnabled()) {
        return { ok: false, error: "marketplace_disabled", code: "marketplace_disabled", advisory: "Set PRISM_MARKETPLACE=on to enable." };
    }
    const cat = readCatalog();
    if (!cat) return { ok: false, error: "catalog_missing", code: "catalog_missing" };
    const entry = cat.entries.find(e => e.id === id);
    if (!entry) return { ok: false, error: "entry_not_found", code: "entry_not_found" };

    if (opts.profile === "business" && entry.trust === "unsigned") {
        return { ok: false, error: "rejected_unsigned_business_profile", code: "rejected_unsigned_business_profile", advisory: "Business profile blocks unsigned entries." };
    }

    if (entry.source.startsWith("http://") || entry.source.startsWith("https://")) {
        return {
            ok: false,
            error: "installation_unsupported_transport",
            code: "installation_unsupported_transport",
            advisory: "HTTP transport is deferred pending security review. Use file:// for now.",
        };
    }

    if (!entry.source.startsWith("file://")) {
        return { ok: false, error: "installation_unsupported_transport", code: "installation_unsupported_transport" };
    }

    const rel = entry.source.replace(/^file:\/\//, "");
    const sourcePath = workspacePath(rel);
    if (!existsSync(sourcePath)) {
        return { ok: false, error: "source_missing", code: "source_missing", advisory: `Source not found: ${sourcePath}` };
    }

    mkdirSync(installedDir(), { recursive: true });
    const targetName = `${entry.id}-${entry.version}-${basename(sourcePath)}`;
    const targetPath = join(installedDir(), targetName);
    copyFileSync(sourcePath, targetPath);

    return {
        ok: true,
        installedAt: new Date().toISOString(),
        targetPath,
    };
}

/** Archive a previously-installed pack (non-destructive). */
export function uninstall(targetPath: string): { ok: boolean; archivedTo?: string; error?: string } {
    if (!existsSync(targetPath)) {
        return { ok: false, error: "not_installed" };
    }
    mkdirSync(archiveDir(), { recursive: true });
    const archived = join(archiveDir(), `${Date.now()}-${basename(targetPath)}`);
    renameSync(targetPath, archived);
    return { ok: true, archivedTo: archived };
}

/** List currently-installed packs (file basenames). */
export function listInstalled(): string[] {
    const dir = installedDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort();
}
