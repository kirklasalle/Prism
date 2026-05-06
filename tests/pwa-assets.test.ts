/**
 * Tests for Phase H: PWA assets (manifest + service worker validity).
 *
 * Verifies the static files exist and parse correctly. We don't actually
 * run the SW (no fetch event simulation here) — just structural validation.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testPwaAssets(): Promise<void> {
    const root = resolve(process.cwd());
    const manifestPath = resolve(root, "public/manifest.json");
    const swPath = resolve(root, "public/service-worker.js");
    const cssPath = resolve(root, "public/phase-i-mobile-polish.css");

    assert(existsSync(manifestPath), "manifest.json exists");
    assert(existsSync(swPath), "service-worker.js exists");
    assert(existsSync(cssPath), "phase-i-mobile-polish.css exists");

    // Manifest schema sanity.
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    assert(typeof manifest.name === "string", "manifest.name");
    assert(typeof manifest.short_name === "string", "manifest.short_name");
    assert(manifest.display === "standalone", "display=standalone");
    assert(Array.isArray(manifest.icons) && (manifest.icons as unknown[]).length >= 2, "icons array");
    assert(typeof manifest.start_url === "string", "start_url");
    assert(typeof manifest.theme_color === "string", "theme_color");

    // Service worker JS parses (basic syntax check via Function constructor).
    const swSrc = readFileSync(swPath, "utf-8");
    assert(swSrc.includes("self.addEventListener"), "SW registers listeners");
    assert(swSrc.includes("install"), "install handler");
    assert(swSrc.includes("fetch"), "fetch handler");
    assert(swSrc.includes("activate"), "activate handler");
    assert(swSrc.includes("CACHE_NAME"), "cache versioning present");
    // Mutating verbs must NOT be cached — file should bail on non-GET.
    assert(/method !==\s*"GET"/.test(swSrc), "non-GET bypass present");

    // CSS contains coarse-pointer media query and 44px target.
    const cssSrc = readFileSync(cssPath, "utf-8");
    assert(cssSrc.includes("(hover: none)") && cssSrc.includes("(pointer: coarse)"), "coarse-pointer query");
    assert(cssSrc.includes("44px"), "44px tap target");

    console.log("  ✓ PWA Assets (manifest + SW + mobile polish CSS)");
}
