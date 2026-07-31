// ─────────────────────────────────────────────────────────────────────────────
// PRISM Tooltips ("Prism Tips")
//
// World-class, accessible, ADDITIVE tooltip layer for the PRISM Frontier
// Console. Every interactive element keeps a real native `title` attribute so
// screen readers, keyboards, and no-JS users always get a baseline summary.
// When JS is available, this module silently *upgrades* elements that carry
// `data-tip-id` (and optionally `data-tip-kind`) into a single shared rich
// floating panel containing:
//
//   header  — icon + label
//   summary — static description (also stays in the native `title`)
//   dynamic — one rotated line drawn from four sources, in priority:
//               1. guardian (fresh WebSocket push)
//               2. telemetry (live state selectors)
//               3. server   (ranked tips from /api/tooltips/:tipId)
//               4. lore     (curated content; e.g., character `tooltipTips`)
//   footer  — optional doc/wiki links
//
// Public API:
//   initPrismTooltips()           — idempotent bootstrap (event delegation +
//                                   single `#prism-tooltip` overlay).
//   registerTooltip(el, descriptor)
//                                 — attach descriptor to a specific element.
//   registerTooltipById(tipId, descriptor)
//                                 — attach descriptor by `data-tip-id` value;
//                                   matches all current and future elements.
//   setDynamicProvider(kind, fn)  — install a custom dynamic line provider.
//   pushGuardianTip(payload)      — push a Guardian-agent tip; latest per
//                                   `tipId` is shown until superseded.
//   primeServerTip(tipId, payload)
//                                 — pre-seed a server tip (used by tests / SSR).
//
// Descriptor contract:
//   {
//     id:       string,                       // matches data-tip-id
//     kind?:    string,                       // matches data-tip-kind
//     label?:   string,                       // header label
//     icon?:    string,                       // optional emoji / glyph
//     summary:  string,                       // static one-liner
//     dynamic?: () => string|Promise<string>, // override "lore" provider
//     telemetry?: () => Record<string,string>,// inline metric chips
//     links?:   Array<{label:string, href:string}>,
//   }
//
// Design notes:
//   • Single overlay, single set of listeners (event delegation on document).
//   • Hover-intent debounce: 200 ms before show, 100 ms grace before hide.
//   • Per-tipId in-flight de-dup for server fetches (stale-while-revalidate).
//   • Reduced-motion respected via prefers-reduced-motion.
//   • Keyboard: focus shows tooltip; Escape hides it.
//   • All authoring is ADDITIVE — adding a tooltip never removes existing UI.
// ─────────────────────────────────────────────────────────────────────────────

const TOOLTIP_ID = 'prism-tooltip';
const SHOW_DELAY_MS = 3000;
const HIDE_GRACE_MS = 100;
const SERVER_FETCH_TTL_MS = 60_000;
const HELPER_STORAGE_KEY = 'prism.tooltip.helper.variant';
const HELPER_VARIANTS = {
    'glass-prism': {
        label: 'Glass Prism',
        glyph: '◇',
        accentClass: 'glass-prism',
        blurb: 'Faceted guide for subsystem hints and Guardian watchpoints.',
    },
    'signal-shard': {
        label: 'Signal Shard',
        glyph: '◈',
        accentClass: 'signal-shard',
        blurb: 'Sharper, telemetry-forward callouts for fast operational reads.',
    },
    'luma-kite': {
        label: 'Luma Kite',
        glyph: '✦',
        accentClass: 'luma-kite',
        blurb: 'Softer guide for exploration, docs, and workflow onboarding.',
    },
    'aegis-bloom': {
        label: 'Aegis Bloom',
        glyph: '⬢',
        accentClass: 'aegis-bloom',
        blurb: 'Defensive helper focused on policy-safe next steps and guardrails.',
    },
    'vector-ember': {
        label: 'Vector Ember',
        glyph: '◉',
        accentClass: 'vector-ember',
        blurb: 'Fast tactical helper for triage, diagnostics, and incident pivots.',
    },
};

// State (module-private)
const descriptorsById = new Map();        // tipId -> descriptor
const descriptorsByEl = new WeakMap();    // element -> descriptor (per-element override)
const rotationCursors = new Map();        // tipId -> integer cursor
const guardianTips = new Map();           // tipId -> { message, kind, ts }
const serverTipCache = new Map();         // tipId -> { data, fetchedAt }
const inFlightFetches = new Map();        // tipId -> Promise

const dynamicProviders = {
    guardian: defaultGuardianProvider,
    telemetry: defaultTelemetryProvider,
    server: defaultServerProvider,
    lore: defaultLoreProvider,
};

const ROTATION_ORDER = ['guardian', 'telemetry', 'server', 'lore'];

let initialized = false;
let overlayEl = null;
let arrowEl = null;
let bodyEl = null;
let currentTarget = null;
let showTimer = null;
let hideTimer = null;
let prefersReducedMotion = false;
let helperVariant = 'glass-prism';
let helperVisible = true;
let helperMotionEnabled = true;

// ── Bootstrap ────────────────────────────────────────────────────────────────
export function initPrismTooltips() {
    if (initialized) return;
    if (typeof document === 'undefined') return;
    initialized = true;
    helperVariant = loadHelperVariant();

    ensureOverlay();
    applyTooltipRuntimeSettings((typeof window !== 'undefined' && window.state && window.state.runtimeSettings)
        ? window.state.runtimeSettings
        : null);

    // Event delegation — one listener set, regardless of element count.
    document.addEventListener('mouseover', onPointerEnter, true);
    document.addEventListener('mouseout', onPointerLeave, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hideTooltipImmediate, true);
    window.addEventListener('resize', hideTooltipImmediate, true);
    overlayEl && overlayEl.addEventListener('click', onOverlayClick, true);

    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        prefersReducedMotion = !!mq.matches;
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', (e) => { prefersReducedMotion = !!e.matches; });
        }
    }
}

export function getTooltipHelperVariants() {
    return Object.entries(HELPER_VARIANTS).map(([value, meta]) => ({
        value,
        label: meta.label,
    }));
}

export function applyTooltipRuntimeSettings(settings) {
    const cfg = settings && typeof settings === 'object' ? settings : {};
    const requestedVariant = typeof cfg.tooltipHelperVariant === 'string' ? String(cfg.tooltipHelperVariant) : '';
    if (requestedVariant && HELPER_VARIANTS[requestedVariant]) {
        helperVariant = requestedVariant;
        persistHelperVariant(requestedVariant);
    } else if (!requestedVariant) {
        helperVariant = loadHelperVariant();
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipHelperVisible')) {
        helperVisible = cfg.tooltipHelperVisible !== false;
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipHelperMotionEnabled')) {
        helperMotionEnabled = cfg.tooltipHelperMotionEnabled !== false;
    }
    applyOverlayPreferenceClasses();
    if (currentTarget) {
        void showTooltip(currentTarget);
    }
}

function ensureOverlay() {
    let el = document.getElementById(TOOLTIP_ID);
    if (el) {
        overlayEl = el;
        arrowEl = el.querySelector('.prism-tip-arrow');
        bodyEl = el.querySelector('.prism-tip-body');
        applyOverlayPreferenceClasses();
        return;
    }
    el = document.createElement('div');
    el.id = TOOLTIP_ID;
    el.className = 'prism-tip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="prism-tip-arrow"></div><div class="prism-tip-body"></div>';
    // Append to body when ready.
    if (document.body) {
        document.body.appendChild(el);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (!document.getElementById(TOOLTIP_ID)) document.body.appendChild(el);
        }, { once: true });
    }
    overlayEl = el;
    arrowEl = el.querySelector('.prism-tip-arrow');
    bodyEl = el.querySelector('.prism-tip-body');
    applyOverlayPreferenceClasses();
}

// ── Descriptor registry ──────────────────────────────────────────────────────
export function registerTooltip(el, descriptor) {
    if (!el || !descriptor) return;
    descriptorsByEl.set(el, descriptor);
    if (descriptor.id) {
        el.setAttribute('data-tip-id', descriptor.id);
        if (descriptor.kind && !el.getAttribute('data-tip-kind')) {
            el.setAttribute('data-tip-kind', descriptor.kind);
        }
        descriptorsById.set(descriptor.id, descriptor);
    }
    if (descriptor.summary && !el.getAttribute('title')) {
        el.setAttribute('title', descriptor.summary);
    }
}

export function registerTooltipById(tipId, descriptor) {
    if (!tipId || !descriptor) return;
    descriptorsById.set(tipId, { ...descriptor, id: tipId });
}

// ── Auto-coverage ────────────────────────────────────────────────────────────
// Walks a DOM subtree and registers a *baseline* descriptor for every
// interactive element that does not already have one. The descriptor is
// synthesised from `aria-label || textContent || title || placeholder || alt`
// so even un-curated elements get a Prism tooltip surface (instead of just
// the native browser yellow box, or nothing). Curated descriptors registered
// later via `registerTooltipById` will override these on the next show.
//
// Idempotent: an element already covered (per-element or by a curated
// `data-tip-id` lookup hit) is skipped.

const AUTO_COVER_SELECTOR = [
    'button',
    '[role="button"]',
    '[role="tab"]',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '.kpi-card',
    '.kpi-tile',
    '.panel-header',
    '.collapsible-header',
    '[data-tip-id]',
].join(',');

export function autoCoverContainer(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let registered = 0;
    const candidates = root.matches && root.matches(AUTO_COVER_SELECTOR)
        ? [root, ...root.querySelectorAll(AUTO_COVER_SELECTOR)]
        : [...root.querySelectorAll(AUTO_COVER_SELECTOR)];
    for (const el of candidates) {
        if (!el || descriptorsByEl.has(el)) continue;
        const tipId = el.getAttribute && el.getAttribute('data-tip-id');
        if (tipId && descriptorsById.has(tipId)) continue;
        const descriptor = synthesiseDescriptorFromElement(el);
        if (!descriptor) continue;
        descriptorsByEl.set(el, descriptor);
        if (descriptor.summary && !el.getAttribute('title')) {
            el.setAttribute('title', descriptor.summary);
        }
        registered += 1;
    }
    return registered;
}

export function registerTooltipsByTab(tabId) {
    if (!tabId || typeof document === 'undefined') return 0;
    const container = document.getElementById('tab-' + tabId);
    if (!container) return 0;
    return autoCoverContainer(container);
}

function synthesiseDescriptorFromElement(el) {
    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
    const title = (el.getAttribute && el.getAttribute('title')) || '';
    const placeholder = (el.getAttribute && el.getAttribute('placeholder')) || '';
    const alt = (el.getAttribute && el.getAttribute('alt')) || '';
    let text = '';
    try {
        if (typeof el.textContent === 'string') {
            text = el.textContent.replace(/\s+/g, ' ').trim();
            if (text.length > 80) text = text.slice(0, 77) + '…';
        }
    } catch (_) { /* ignore */ }

    const label = (aria || text || alt || placeholder || title || '').trim();
    const summary = (title || aria || (text && text.length <= 120 ? text : '') || placeholder || alt || '').trim();
    if (!label && !summary) return null;

    const tipId = (el.getAttribute && el.getAttribute('data-tip-id')) || '';
    const kind = (el.getAttribute && el.getAttribute('data-tip-kind')) || 'auto';
    return {
        id: tipId,
        kind,
        label: label || summary,
        summary: summary || label,
    };
}

export function setDynamicProvider(kind, fn) {
    if (!kind || typeof fn !== 'function') return;
    dynamicProviders[kind] = fn;
}

// ── Guardian / Server hooks ──────────────────────────────────────────────────
export function pushGuardianTip(payload) {
    if (!payload || typeof payload !== 'object') return;
    const tipId = payload.tipId || payload.id;
    if (!tipId) return;
    guardianTips.set(String(tipId), {
        message: String(payload.message || ''),
        kind: String(payload.kind || 'guardian'),
        ts: Date.now(),
    });
}

export function primeServerTip(tipId, payload) {
    if (!tipId || !payload) return;
    serverTipCache.set(String(tipId), { data: payload, fetchedAt: Date.now() });
}

// ── Pointer / focus handlers ─────────────────────────────────────────────────
function findTipTarget(node) {
    while (node && node !== document.body) {
        if (node.nodeType === 1) {
            // Per-element descriptor wins.
            if (descriptorsByEl.has(node)) return node;
            const tipId = node.getAttribute && node.getAttribute('data-tip-id');
            if (tipId) return node;
        }
        node = node.parentNode;
    }
    return null;
}

function onPointerEnter(event) {
    const target = findTipTarget(event.target);
    if (!target) return;
    scheduleShow(target);
}

function onPointerLeave(event) {
    const target = findTipTarget(event.target);
    if (!target) return;
    // If we're moving into the tooltip itself, keep open.
    const related = event.relatedTarget;
    if (related && (related === overlayEl || (overlayEl && overlayEl.contains(related)))) return;
    scheduleHide();
}

function onFocusIn(event) {
    const target = findTipTarget(event.target);
    if (!target) return;
    scheduleShow(target, /*immediate*/ true);
}

function onFocusOut(event) {
    const target = findTipTarget(event.target);
    if (!target) return;
    scheduleHide();
}

function onKeyDown(event) {
    if (event.key === 'Escape' && currentTarget) {
        hideTooltipImmediate();
    }
}

function scheduleShow(target, immediate) {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const fn = () => showTooltip(target);
    if (immediate || prefersReducedMotion) fn();
    else showTimer = setTimeout(fn, SHOW_DELAY_MS);
}

function scheduleHide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTooltipImmediate, HIDE_GRACE_MS);
}

function hideTooltipImmediate() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!overlayEl) return;
    overlayEl.classList.remove('visible');
    overlayEl.setAttribute('aria-hidden', 'true');
    if (currentTarget && currentTarget.removeAttribute) {
        const aria = currentTarget.getAttribute('aria-describedby');
        if (aria === TOOLTIP_ID) currentTarget.removeAttribute('aria-describedby');
    }
    currentTarget = null;
}

// ── Render ───────────────────────────────────────────────────────────────────
async function showTooltip(target) {
    if (!target || !overlayEl) return;
    ensureOverlay();
    currentTarget = target;
    const descriptor = resolveDescriptor(target);
    if (!descriptor) { hideTooltipImmediate(); return; }

    const guardian = pickGuardianSuggestion(descriptor);
    const dynamic = await pickDynamicLine(descriptor, target, !!guardian);
    bodyEl.innerHTML = renderTooltipHtml(descriptor, { guardian, dynamic });
    overlayEl.dataset.tipId = descriptor.id || '';
    overlayEl.classList.add('visible');
    overlayEl.setAttribute('aria-hidden', 'false');
    if (target.setAttribute) target.setAttribute('aria-describedby', TOOLTIP_ID);
    positionTooltip(target);
}

function resolveDescriptor(target) {
    if (descriptorsByEl.has(target)) return descriptorsByEl.get(target);
    const tipId = target.getAttribute && target.getAttribute('data-tip-id');
    if (tipId && descriptorsById.has(tipId)) return descriptorsById.get(tipId);
    // Fallback: synthesise from element attributes (title / aria / text).
    const synth = synthesiseDescriptorFromElement(target);
    if (synth && (synth.summary || synth.label)) return synth;
    return null;
}

function pickGuardianSuggestion(descriptor) {
    if (!descriptor) return null;
    if (descriptor.id) {
        const live = guardianTips.get(descriptor.id);
        if (live && Date.now() - live.ts <= 10 * 60 * 1000 && live.message) {
            return { kind: 'guardian-live', text: String(live.message).trim() };
        }
    }
    const hints = Array.isArray(descriptor.guardian)
        ? descriptor.guardian.filter(Boolean)
        : descriptor.guardian
            ? [descriptor.guardian]
            : [];
    if (!hints.length) return null;
    const tipId = (descriptor.id || 'anon') + '::guardian';
    const cursor = (rotationCursors.get(tipId) || 0) % hints.length;
    rotationCursors.set(tipId, (cursor + 1) % hints.length);
    return { kind: 'guardian-curated', text: String(hints[cursor]).trim() };
}

async function pickDynamicLine(descriptor, target, guardianAlreadyShown) {
    const tipId = descriptor.id || '';
    const order = guardianAlreadyShown ? ROTATION_ORDER.filter((kind) => kind !== 'guardian') : ROTATION_ORDER;
    // Advance rotation cursor (per tipId).
    const cursor = (rotationCursors.get(tipId) || 0) % order.length;
    rotationCursors.set(tipId, (cursor + 1) % order.length);

    // Attempt providers starting at cursor; first non-empty wins.
    for (let i = 0; i < order.length; i++) {
        const kind = order[(cursor + i) % order.length];
        const provider = dynamicProviders[kind];
        if (!provider) continue;
        try {
            const result = await provider(descriptor, target);
            if (result && String(result).trim()) return { kind, text: String(result).trim() };
        } catch (e) {
            // Provider failure is non-fatal.
        }
    }
    return null;
}

function renderTooltipHtml(descriptor, content) {
    const guardian = content && content.guardian ? content.guardian : null;
    const dynamic = content && content.dynamic ? content.dynamic : null;
    const label = descriptor.label || descriptor.summary || '';
    const icon = descriptor.icon || '';
    const summary = descriptor.summary || '';
    const helper = HELPER_VARIANTS[helperVariant] || HELPER_VARIANTS['glass-prism'];
    let html = '';
    html += '<div class="prism-tip-shell">';
    html += '<div class="prism-tip-copy">';
    html += '<div class="prism-tip-header">';
    if (icon) html += '<span class="prism-tip-icon">' + escapeHtml(icon) + '</span>';
    html += '<span class="prism-tip-label">' + escapeHtml(label) + '</span>';
    html += '</div>';
    if (summary && summary !== label) {
        html += '<div class="prism-tip-summary">' + escapeHtml(summary) + '</div>';
    }
    if (guardian && guardian.text) {
        html += '<div class="prism-tip-guardian">';
        html += '<div class="prism-tip-guardian-title"><span aria-hidden="true">🛡️</span><span>Guardian suggests</span></div>';
        html += '<div class="prism-tip-guardian-text">' + escapeHtml(guardian.text) + '</div>';
        html += '</div>';
    }
    if (dynamic && dynamic.text) {
        html += '<div class="prism-tip-dynamic prism-tip-dynamic-' + escapeHtml(dynamic.kind) + '">';
        html += '<span class="prism-tip-dynamic-glyph" aria-hidden="true">' + dynamicGlyph(dynamic.kind) + '</span>';
        html += '<span class="prism-tip-dynamic-text">' + escapeHtml(dynamic.text) + '</span>';
        html += '</div>';
    }
    if (typeof descriptor.telemetry === 'function') {
        let metrics = null;
        try { metrics = descriptor.telemetry(); } catch (e) { metrics = null; }
        if (metrics && typeof metrics === 'object') {
            const keys = Object.keys(metrics);
            if (keys.length) {
                html += '<div class="prism-tip-metrics">';
                for (const key of keys) {
                    html += '<span class="prism-tip-metric"><span class="prism-tip-metric-key">' + escapeHtml(key) + '</span>'
                        + '<span class="prism-tip-metric-val">' + escapeHtml(String(metrics[key])) + '</span></span>';
                }
                html += '</div>';
            }
        }
    }
    if (Array.isArray(descriptor.links) && descriptor.links.length) {
        html += '<div class="prism-tip-links">';
        for (const link of descriptor.links) {
            if (!link || !link.href) continue;
            html += '<a class="prism-tip-link" href="' + escapeAttr(String(link.href))
                + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(String(link.label || link.href)) + '</a>';
        }
        html += '</div>';
    }
    html += '</div>';
    if (helperVisible) {
        html += renderHelperHtml(helper);
    }
    html += '</div>';
    return html;
}

function renderHelperHtml(helper) {
    let html = '';
    html += '<aside class="prism-tip-helper prism-tip-helper-' + escapeHtml(helper.accentClass) + '">';
    html += '<div class="prism-tip-helper-stage" aria-hidden="true">';
    html += '<div class="prism-tip-helper-avatar">';
    html += '<span class="prism-tip-helper-core">' + escapeHtml(helper.glyph) + '</span>';
    html += '<span class="prism-tip-helper-shard prism-tip-helper-shard-a"></span>';
    html += '<span class="prism-tip-helper-shard prism-tip-helper-shard-b"></span>';
    html += '<span class="prism-tip-helper-shard prism-tip-helper-shard-c"></span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="prism-tip-helper-name">' + escapeHtml(helper.label) + '</div>';
    html += '<div class="prism-tip-helper-blurb">' + escapeHtml(helper.blurb) + '</div>';
    html += '<div class="prism-tip-helper-chooser" role="group" aria-label="Tooltip helper style">';
    for (const [key, value] of Object.entries(HELPER_VARIANTS)) {
        const selected = key === helperVariant ? ' is-selected' : '';
        html += '<button type="button" class="prism-tip-helper-chip' + selected + '" data-prism-helper="' + escapeAttr(key) + '">' + escapeHtml(value.label) + '</button>';
    }
    html += '</div>';
    html += '</aside>';
    return html;
}

function dynamicGlyph(kind) {
    switch (kind) {
        case 'guardian': return '\u{1F6E1}\uFE0F';
        case 'guardian-live': return '\u{1F6E1}\uFE0F';
        case 'guardian-curated': return '\u{1F6E1}\uFE0F';
        case 'telemetry': return '\u{1F4CA}';
        case 'server': return '\u{1F4DA}';
        case 'lore': return '\u2728';
        default: return '\u00B7';
    }
}

function onOverlayClick(event) {
    const button = event.target && event.target.closest ? event.target.closest('[data-prism-helper]') : null;
    if (!button) return;
    const variant = button.getAttribute('data-prism-helper') || '';
    if (!HELPER_VARIANTS[variant]) return;
    helperVariant = variant;
    persistHelperVariant(variant);
    applyOverlayPreferenceClasses();
    if (currentTarget) {
        void showTooltip(currentTarget);
    }
}

function applyOverlayPreferenceClasses() {
    if (!overlayEl) return;
    overlayEl.classList.toggle('prism-tip-no-helper', !helperVisible);
    overlayEl.classList.toggle('prism-tip-motion-off', !helperMotionEnabled);
}

function loadHelperVariant() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(HELPER_STORAGE_KEY) || '';
            if (stored && HELPER_VARIANTS[stored]) return stored;
        }
    } catch (_) { /* ignore */ }
    return 'glass-prism';
}

function persistHelperVariant(variant) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(HELPER_STORAGE_KEY, variant);
        }
    } catch (_) { /* ignore */ }
}

// ── Positioning ──────────────────────────────────────────────────────────────
function positionTooltip(target) {
    if (!overlayEl || !target || !target.getBoundingClientRect) return;
    const rect = target.getBoundingClientRect();
    const tipRect = overlayEl.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    // Prefer below; flip above if not enough space.
    let top = rect.bottom + margin;
    let placement = 'below';
    if (top + tipRect.height > vh - margin) {
        top = rect.top - tipRect.height - margin;
        placement = 'above';
    }
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    // Clamp to viewport.
    left = Math.max(margin, Math.min(left, vw - tipRect.width - margin));
    top = Math.max(margin, top);

    overlayEl.style.top = (top + window.scrollY) + 'px';
    overlayEl.style.left = (left + window.scrollX) + 'px';
    overlayEl.dataset.placement = placement;

    // Position arrow horizontally relative to target center.
    if (arrowEl) {
        const targetCenter = rect.left + (rect.width / 2);
        const arrowLeft = Math.max(12, Math.min(tipRect.width - 12, targetCenter - left));
        arrowEl.style.left = arrowLeft + 'px';
    }
}

// ── Default dynamic providers ────────────────────────────────────────────────
function defaultGuardianProvider(descriptor) {
    if (!descriptor || !descriptor.id) return null;
    const entry = guardianTips.get(descriptor.id);
    if (!entry) return null;
    // Only treat as "fresh" within 10 minutes of arrival.
    if (Date.now() - entry.ts > 10 * 60 * 1000) return null;
    return entry.message || null;
}

function defaultTelemetryProvider(descriptor) {
    if (!descriptor) return null;
    if (typeof descriptor.dynamic === 'function') return null; // let lore handle
    // No global telemetry — descriptor.telemetry() is a separate metrics chip
    // row. Telemetry-as-dynamic-line is opt-in via descriptor.dynamicTelemetry.
    if (typeof descriptor.dynamicTelemetry === 'function') {
        try { return descriptor.dynamicTelemetry(); } catch (e) { return null; }
    }
    return null;
}

async function defaultServerProvider(descriptor) {
    if (!descriptor || !descriptor.id) return null;
    const tipId = descriptor.id;
    const cached = serverTipCache.get(tipId);
    const fresh = cached && (Date.now() - cached.fetchedAt < SERVER_FETCH_TTL_MS);
    if (!fresh) {
        // Stale-while-revalidate: kick off background fetch, return cached if any.
        if (!inFlightFetches.has(tipId)) {
            const promise = fetchServerTip(tipId).finally(() => inFlightFetches.delete(tipId));
            inFlightFetches.set(tipId, promise);
        }
    }
    const data = cached && cached.data ? cached.data : null;
    if (!data || !Array.isArray(data.dynamic) || !data.dynamic.length) return null;
    const cursor = (rotationCursors.get(tipId + '::server') || 0) % data.dynamic.length;
    rotationCursors.set(tipId + '::server', (cursor + 1) % data.dynamic.length);
    return data.dynamic[cursor];
}

async function fetchServerTip(tipId) {
    try {
        if (typeof fetch !== 'function') return;
        const headers = {};
        // Read the same token source the rest of the dashboard uses:
        // the <meta name="prism-auth-token"> tag injected by the server.
        // Falls back to a window-scoped override for embedding contexts.
        let token = '';
        if (typeof document !== 'undefined') {
            const meta = document.querySelector('meta[name="prism-auth-token"]');
            if (meta) token = meta.getAttribute('content') || '';
        }
        if (!token && typeof window !== 'undefined' && window.PRISM_AUTH_TOKEN) {
            token = window.PRISM_AUTH_TOKEN;
        }
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        const res = await fetch('/api/tooltips/' + encodeURIComponent(tipId), { headers });
        if (!res.ok) return;
        const data = await res.json();
        serverTipCache.set(tipId, { data, fetchedAt: Date.now() });
    } catch (e) {
        // Network failures are non-fatal for tooltips.
    }
}

function defaultLoreProvider(descriptor) {
    if (!descriptor) return null;
    if (typeof descriptor.dynamic === 'function') {
        try { return descriptor.dynamic(); } catch (e) { return null; }
    }
    if (Array.isArray(descriptor.lore) && descriptor.lore.length) {
        const tipId = descriptor.id || 'anon';
        const cursor = (rotationCursors.get(tipId + '::lore') || 0) % descriptor.lore.length;
        rotationCursors.set(tipId + '::lore', (cursor + 1) % descriptor.lore.length);
        return descriptor.lore[cursor];
    }
    return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
    return escapeHtml(s);
}

// Test hook — visible only in non-production.
export const __TEST__ = {
    reset() {
        descriptorsById.clear();
        rotationCursors.clear();
        guardianTips.clear();
        serverTipCache.clear();
        inFlightFetches.clear();
        initialized = false;
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null; arrowEl = null; bodyEl = null; currentTarget = null;
        if (showTimer) clearTimeout(showTimer);
        if (hideTimer) clearTimeout(hideTimer);
        showTimer = null; hideTimer = null;
        helperVariant = 'glass-prism';
        helperVisible = true;
        helperMotionEnabled = true;
    },
    get state() {
        return { descriptorsById, guardianTips, serverTipCache, rotationCursors, currentTarget, overlayEl };
    },
};
