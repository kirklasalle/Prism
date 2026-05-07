// ─────────────────────────────────────────────────────────────────────────────
// PRISM Tooltips Registry
//
// In-memory catalog of tooltip content keyed by `tipId` (e.g. `character:aria-individual`,
// `tab:workspace`, `button:assign-character`). Seed entries are loaded from
// `docs/tooltips/*.json` files at construction time. The registry is intentionally
// loose: missing entries return undefined so callers can gracefully fall back.
//
// Schema for a registry entry:
//   {
//     tipId:   string,
//     summary: string,
//     dynamic: string[],
//     links:   Array<{ label: string, href: string }>
//   }
//
// Per-tipId overrides from `docs/tooltips/links.json` are merged on top of any
// `links` field defined in a seed file, so a single edit to `links.json` updates
// every tooltip referencing that topic.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface TooltipLink {
    label: string;
    href: string;
}

export interface TooltipEntry {
    tipId: string;
    summary: string;
    dynamic: string[];
    links: TooltipLink[];
    updatedAt: string;
}

export class TooltipsRegistry {
    private readonly entries = new Map<string, TooltipEntry>();
    private readonly linkOverrides = new Map<string, TooltipLink[]>();
    private loaded = false;

    constructor(private readonly seedDir: string) { }

    private ensureLoaded(): void {
        if (this.loaded) return;
        this.loaded = true;
        if (!existsSync(this.seedDir)) return;
        // 1. Load central link map first (so seed-time merge has it).
        const linksPath = join(this.seedDir, "links.json");
        if (existsSync(linksPath)) {
            try {
                const parsed = JSON.parse(readFileSync(linksPath, "utf-8")) as Record<string, TooltipLink[]>;
                for (const [tipId, links] of Object.entries(parsed)) {
                    if (Array.isArray(links)) {
                        this.linkOverrides.set(tipId, links.filter((l) => l && typeof l.href === "string"));
                    }
                }
            } catch { /* ignore malformed links.json */ }
        }
        // 2. Load seed entries from *.json (excluding links.json).
        let files: string[] = [];
        try { files = readdirSync(this.seedDir); } catch { return; }
        for (const fileName of files) {
            if (!fileName.toLowerCase().endsWith(".json")) continue;
            if (fileName === "links.json") continue;
            const fullPath = join(this.seedDir, fileName);
            try {
                if (!statSync(fullPath).isFile()) continue;
                const parsed = JSON.parse(readFileSync(fullPath, "utf-8"));
                this.ingest(parsed);
            } catch { /* ignore malformed seed file */ }
        }
    }

    private ingest(parsed: unknown): void {
        if (!parsed) return;
        const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const raw of items) {
            if (!raw || typeof raw !== "object") continue;
            const obj = raw as Record<string, unknown>;
            const tipId = String(obj.tipId ?? "").trim();
            if (!tipId) continue;
            const summary = String(obj.summary ?? "").trim();
            const dynamic = Array.isArray(obj.dynamic)
                ? obj.dynamic.map((s) => String(s)).filter((s) => s.trim().length > 0)
                : [];
            const seedLinks = Array.isArray(obj.links)
                ? (obj.links as unknown[])
                    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
                    .map((l) => ({ label: String((l as Record<string, unknown>).label ?? ""), href: String((l as Record<string, unknown>).href ?? "") }))
                    .filter((l) => l.href.length > 0)
                : [];
            this.entries.set(tipId, {
                tipId,
                summary,
                dynamic,
                links: seedLinks,
                updatedAt: new Date().toISOString(),
            });
        }
    }

    get(tipId: string): TooltipEntry | undefined {
        this.ensureLoaded();
        const entry = this.entries.get(tipId);
        const override = this.linkOverrides.get(tipId);
        if (!entry && !override) return undefined;
        const summary = entry?.summary ?? "";
        const dynamic = entry?.dynamic ?? [];
        const seedLinks = entry?.links ?? [];
        // Merge: override links take precedence and append any seed-only links not already present.
        const mergedHrefs = new Set<string>();
        const links: TooltipLink[] = [];
        if (override) {
            for (const l of override) {
                if (l.href && !mergedHrefs.has(l.href)) {
                    links.push({ label: String(l.label ?? l.href), href: l.href });
                    mergedHrefs.add(l.href);
                }
            }
        }
        for (const l of seedLinks) {
            if (l.href && !mergedHrefs.has(l.href)) {
                links.push(l);
                mergedHrefs.add(l.href);
            }
        }
        return {
            tipId,
            summary,
            dynamic,
            links,
            updatedAt: entry?.updatedAt ?? new Date().toISOString(),
        };
    }

    list(): TooltipEntry[] {
        this.ensureLoaded();
        return Array.from(this.entries.keys()).map((id) => this.get(id)!).filter(Boolean);
    }

    /** Test/runtime override: register an entry programmatically. */
    register(entry: TooltipEntry): void {
        this.ensureLoaded();
        this.entries.set(entry.tipId, { ...entry, updatedAt: new Date().toISOString() });
    }
}
