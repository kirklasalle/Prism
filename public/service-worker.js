/* PRISM Service Worker (Phase H)
 *
 * Strategy:
 *   - Static assets (manifest, icons, CSS, fonts): cache-first
 *   - GET /api/* requests: network-first with cache fallback
 *   - Mutating verbs (POST/PUT/PATCH/DELETE): never cached
 *   - HTML navigations: network-first (always serve fresh dashboard)
 *
 * Versioning: bump CACHE_NAME to invalidate.
 */

const CACHE_NAME = "prism-static-v1";
const STATIC_PATTERNS = [
    "/public/manifest.json",
    "/public/phase-i-mobile-polish.css",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PATTERNS).catch(() => undefined))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") {
        // Mutating requests: bypass cache entirely.
        return;
    }
    const url = new URL(req.url);

    // HTML navigations — network-first, no cache fallback (live dashboard only).
    if (req.mode === "navigate") {
        event.respondWith(fetch(req).catch(() => new Response("Offline", { status: 503 })));
        return;
    }

    // API GETs — network-first with cache fallback.
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => undefined);
                    }
                    return res;
                })
                .catch(() => caches.match(req).then((c) => c ?? new Response("Offline", { status: 503 })))
        );
        return;
    }

    // Static assets — cache-first.
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res.ok && res.type === "basic") {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => undefined);
                }
                return res;
            });
        })
    );
});
