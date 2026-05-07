// Dynamic Tab Loader
//
// Fetches per-tab HTML fragments from /public/tab-<id>.html on demand.
// - `loadTabHtml(tabId)` injects the fragment into the matching <section id="tab-<id>"> container.
// - `prefetchTabHtml(tabId)` warms the cache without touching the DOM; safe to call during idle time.
// - In-flight fetches are de-duplicated so concurrent clicks resolve to the same promise.

const fragmentCache = new Map(); // tabId -> html string (resolved)
const injectedTabs = new Set();  // tabIds whose HTML has been injected into the DOM
const inflightFetches = new Map(); // tabId -> Promise<string>
const inflightInjections = new Map(); // tabId -> Promise<void>

// Lazy-imported to avoid circular dependency with dashboard-app.js bootstrap.
let _tooltipsModulePromise = null;
function autoRegisterTabTooltips(tabId) {
  if (!tabId) return;
  if (!_tooltipsModulePromise) _tooltipsModulePromise = import('./prism-tooltips.js').catch(() => null);
  _tooltipsModulePromise.then((mod) => {
    if (!mod || typeof mod.registerTooltipsByTab !== 'function') return;
    try { mod.registerTooltipsByTab(tabId); } catch (_) { /* non-fatal */ }
  });
}
function fetchFragment(tabId) {
  if (fragmentCache.has(tabId)) {
    return Promise.resolve(fragmentCache.get(tabId));
  }
  const existing = inflightFetches.get(tabId);
  if (existing) return existing;

  const p = (async () => {
    const response = await fetch(`/public/tab-${tabId}.html`);
    if (!response.ok) {
      throw new Error(`Failed to load tab HTML: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    fragmentCache.set(tabId, html);
    return html;
  })().finally(() => {
    inflightFetches.delete(tabId);
  });

  inflightFetches.set(tabId, p);
  return p;
}

/**
 * Loads and injects the HTML content for a specific tab if it hasn't been injected yet.
 * Shows a lightweight loading placeholder while fetching.
 * @param {string} tabId - The ID of the tab (e.g., 'chat', 'settings')
 * @returns {Promise<void>}
 */
export async function loadTabHtml(tabId) {
  if (injectedTabs.has(tabId)) {
    return;
  }
  const existing = inflightInjections.get(tabId);
  if (existing) return existing;

  const container = document.getElementById(`tab-${tabId}`);
  if (container && !container.innerHTML.trim()) {
    container.setAttribute('aria-busy', 'true');
    container.innerHTML = '<div class="tab-loading muted" style="padding:24px;text-align:center;font-size:12px;">Loading…</div>';
  }

  const p = (async () => {
    try {
      const html = await fetchFragment(tabId);
      const target = document.getElementById(`tab-${tabId}`);
      if (target) {
        target.innerHTML = html;
        target.removeAttribute('aria-busy');
        injectedTabs.add(tabId);
        autoRegisterTabTooltips(tabId);
      } else {
        console.error(`[tab-loader] Container not found for tab: ${tabId}`);
      }
    } catch (error) {
      const target = document.getElementById(`tab-${tabId}`);
      if (target) {
        target.removeAttribute('aria-busy');
        target.innerHTML = '<div class="muted" style="padding:24px;text-align:center;font-size:12px;color:#f87171;">Failed to load this tab. <button class="secondary-button" style="margin-left:8px;font-size:11px;" onclick="location.reload()">Reload</button></div>';
      }
      console.error(`[tab-loader] Error loading tab ${tabId}:`, error);
      throw error;
    } finally {
      inflightInjections.delete(tabId);
    }
  })();

  inflightInjections.set(tabId, p);
  return p;
}

/**
 * Warms the fragment cache for a tab without touching the DOM.
 * Safe to call during idle time (e.g. requestIdleCallback) to make the next click feel instant.
 * Swallows errors — prefetch is best-effort.
 * @param {string} tabId
 * @returns {Promise<void>}
 */
export function prefetchTabHtml(tabId) {
  if (fragmentCache.has(tabId) || injectedTabs.has(tabId)) return Promise.resolve();
  return fetchFragment(tabId).then(() => undefined).catch((err) => {
    console.warn(`[tab-loader] Prefetch failed for ${tabId}:`, err);
  });
}
