/**
 * Tests for Phase G: Plugin Marketplace.
 *
 * Uses workspace-resolver test hook to point at a temp directory.
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setWorkspaceRootForTest } from "../src/core/config/workspace-resolver.js";
import {
    isMarketplaceEnabled,
    readCatalog,
    writeCatalog,
    listEntries,
    findEntry,
    installFromCatalog,
    uninstall,
    listInstalled,
} from "../src/core/plugins/plugin-marketplace.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testPluginMarketplace(): Promise<void> {
    const ws = mkdtempSync(join(tmpdir(), "prism-mkt-"));
    const prevWs = process.env.PRISM_WORKSPACE_ROOT;
    const prevFlag = process.env.PRISM_MARKETPLACE;
    _setWorkspaceRootForTest(ws);
    try {
        // Disabled by default.
        delete process.env.PRISM_MARKETPLACE;
        assert(!isMarketplaceEnabled(), "off by default");
        const r0 = installFromCatalog("anything");
        assert(!r0.ok && r0.code === "marketplace_disabled", "disabled rejects install");

        process.env.PRISM_MARKETPLACE = "on";
        assert(isMarketplaceEnabled(), "enabled when flag set");

        // No catalog yet.
        assert(readCatalog() === null, "no catalog yet");
        assert(installFromCatalog("foo").code === "catalog_missing", "catalog missing");

        // Seed catalog + sample pack file.
        const sampleSrc = join(ws, "samples", "demo.zip");
        mkdirSync(join(ws, "samples"), { recursive: true });
        writeFileSync(sampleSrc, "PK\x03\x04 fake zip", "utf-8");

        writeCatalog({
            version: "1.0.0",
            entries: [
                { id: "demo", name: "Demo", version: "0.1.0", source: "file://samples/demo.zip", trust: "signed", tags: ["demo"] },
                { id: "remote", name: "Remote", version: "0.1.0", source: "https://example.com/pack.zip", trust: "signed" },
                { id: "missing", name: "Missing", version: "0.1.0", source: "file://samples/missing.zip", trust: "signed" },
                { id: "unsigned", name: "Unsigned", version: "0.1.0", source: "file://samples/demo.zip", trust: "unsigned" },
            ],
        });

        const cat = readCatalog();
        assert(cat !== null && cat.entries.length === 4, "catalog round-trip");
        assert(listEntries({ tag: "demo" }).length === 1, "tag filter");
        assert(findEntry("demo")?.id === "demo", "findEntry");
        assert(findEntry("nonexistent") === null, "findEntry missing");

        // file:// install succeeds.
        const r1 = installFromCatalog("demo");
        assert(r1.ok && !!r1.targetPath && existsSync(r1.targetPath), "file install ok");

        // http:// install rejected.
        const r2 = installFromCatalog("remote");
        assert(!r2.ok && r2.code === "installation_unsupported_transport", "http rejected");

        // Missing source rejected.
        const r3 = installFromCatalog("missing");
        assert(!r3.ok && r3.code === "source_missing", "missing source");

        // Business profile rejects unsigned.
        const r4 = installFromCatalog("unsigned", { profile: "business" });
        assert(!r4.ok && r4.code === "rejected_unsigned_business_profile", "business blocks unsigned");

        // Individual profile permits unsigned.
        const r5 = installFromCatalog("unsigned", { profile: "individual" });
        assert(r5.ok, "individual permits unsigned");

        // listInstalled lists both successful installs.
        const installed = listInstalled();
        assert(installed.length === 2, "two installed: " + installed.length);

        // Uninstall archives non-destructively.
        const ur = uninstall(r1.targetPath!);
        assert(ur.ok && !!ur.archivedTo && existsSync(ur.archivedTo), "uninstall archives");
        assert(!existsSync(r1.targetPath!), "original gone");
        assert(listInstalled().length === 1, "installed reduced to 1");

        // Uninstall missing rejected.
        const ur2 = uninstall(join(ws, "nope.zip"));
        assert(!ur2.ok, "uninstall missing rejected");
    } finally {
        if (prevWs === undefined) delete process.env.PRISM_WORKSPACE_ROOT;
        else process.env.PRISM_WORKSPACE_ROOT = prevWs;
        if (prevFlag === undefined) delete process.env.PRISM_MARKETPLACE;
        else process.env.PRISM_MARKETPLACE = prevFlag;
        // NOTE: Intentionally do NOT rmSync(ws) — other tests may have already
        // captured the workspace root reference. OS will reclaim tmp dirs.
    }

    console.log("  ✓ Plugin Marketplace");
}
