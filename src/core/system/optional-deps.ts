/**
 * Optional dependency probe.
 *
 * PRISM ships several adapters whose underlying native or third-party modules
 * are declared in `optionalDependencies` so that core install on Linux/macOS/
 * Windows never fails when a binding is missing. Operators need a reliable
 * runtime answer to "are these capabilities actually available right now?"
 * for their installation — that is what this module provides.
 *
 * The `probe()` function is async because it uses dynamic `import()` to load
 * each module without forcing the eager `require()` failure. Results are
 * cached for the process lifetime; callers may pass `{ refresh: true }` to
 * re-evaluate.
 *
 * Surfaced via `/api/health` and the dashboard's System tab so an operator
 * can immediately see whether terminal PTY, container exec, Gmail/Calendar,
 * and Outlook OAuth are present, missing, or broken on this machine.
 */

export type OptionalDepStatus = "available" | "missing" | "error";

export interface OptionalDepResult {
    /** Module specifier passed to `import()`. */
    module: string;
    /** The PRISM capability that depends on this module. */
    capability: string;
    /** Resolution status. `error` means the module exists but threw on load. */
    status: OptionalDepStatus;
    /** `package.json` version when available. */
    version: string | null;
    /** Error message when status === 'error' or 'missing'. */
    error: string | null;
}

interface ProbeSpec {
    module: string;
    capability: string;
}

const SPECS: readonly ProbeSpec[] = [
    { module: "node-pty",            capability: "terminal-pty" },
    { module: "dockerode",           capability: "container-exec" },
    { module: "googleapis",          capability: "gmail-and-calendar-oauth" },
    { module: "@azure/msal-node",    capability: "outlook-oauth" },
];

let cache: OptionalDepResult[] | null = null;
let cachePromise: Promise<OptionalDepResult[]> | null = null;

async function probeOne(spec: ProbeSpec): Promise<OptionalDepResult> {
    // Hard timeout per import. `googleapis` is a large meta-package whose
    // first-time evaluation can occasionally exceed several seconds on cold
    // disk; we cap each probe at 8 s so the overall health endpoint stays
    // responsive and a hung native binding never wedges the dashboard.
    const TIMEOUT_MS = 8_000;
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<OptionalDepResult>((resolve) => {
        timer = setTimeout(() => {
            resolve({
                module: spec.module,
                capability: spec.capability,
                status: "error",
                version: null,
                error: `probe exceeded ${TIMEOUT_MS} ms — native binding may be hung`,
            });
        }, TIMEOUT_MS);
    });
    const result = await Promise.race([loadOne(spec), timeoutPromise]);
    if (timer) clearTimeout(timer);
    return result;
}

async function loadOne(spec: ProbeSpec): Promise<OptionalDepResult> {
    try {
        const mod = await import(spec.module);
        // Best-effort version resolution: prefer the module's own VERSION
        // export, else fall back to its package.json sibling.
        let version: string | null = null;
        if (mod && typeof (mod as { VERSION?: unknown }).VERSION === "string") {
            version = (mod as { VERSION: string }).VERSION;
        }
        if (!version) {
            try {
                const { createRequire } = await import("node:module");
                const req = createRequire(import.meta.url);
                const pkg = req(`${spec.module}/package.json`) as { version?: string };
                if (typeof pkg.version === "string") {
                    version = pkg.version;
                }
            } catch {
                // version is optional
            }
        }
        return {
            module: spec.module,
            capability: spec.capability,
            status: "available",
            version,
            error: null,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isMissing = /Cannot find (module|package)/i.test(message)
            || /ERR_MODULE_NOT_FOUND/i.test(message);
        return {
            module: spec.module,
            capability: spec.capability,
            status: isMissing ? "missing" : "error",
            version: null,
            error: message,
        };
    }
}

export async function probeOptionalDeps(opts: { refresh?: boolean } = {}): Promise<OptionalDepResult[]> {
    if (!opts.refresh && cache) {
        return cache;
    }
    if (!opts.refresh && cachePromise) {
        return cachePromise;
    }
    cachePromise = Promise.all(SPECS.map(probeOne)).then((results) => {
        cache = results;
        cachePromise = null;
        return results;
    });
    return cachePromise;
}

export function getCachedOptionalDeps(): OptionalDepResult[] | null {
    return cache;
}

export function summarizeOptionalDeps(results: OptionalDepResult[]): { available: number; missing: number; error: number } {
    let available = 0;
    let missing = 0;
    let error = 0;
    for (const r of results) {
        if (r.status === "available") available++;
        else if (r.status === "missing") missing++;
        else error++;
    }
    return { available, missing, error };
}
