// ─────────────────────────────────────────────────────────────────────────────
// PRISM Tooltips ("Prism Tips") & Guardian Guidance Subsystem
//
// World-class, accessible, ADDITIVE tooltip and ambient guidance layer for
// the PRISM Frontier Console. Every interactive element keeps a real native
// `title` attribute so screen readers, keyboards, and no-JS users always get
// a baseline summary. When JS is available, this module silently *upgrades*
// elements that carry `data-tip-id` into:
//
//   1. Single shared rich floating tooltip panel (#prism-tooltip):
//      - header: icon + label
//      - summary: static description
//      - dynamic: rotated line (Guardian push -> telemetry -> server -> lore)
//      - telemetry: metric chips
//      - footer: quick-disable checkbox and optional wiki/doc links
//
//   2. Decoupled ambient floating companion (#prism-companion):
//      - Active Persona (Glass Prism, Signal Shard, Luma Kite, Aegis Bloom, Vector Ember)
//      - Floating bob & particle shard orbit animations
//      - Real-time Guardian alert pulse indicator
//      - Interactive Persona switcher
//
// Public API:
//   initPrismTooltips()
//   applyTooltipRuntimeSettings(settings)
//   setTooltipsEnabled(enabled, persist)
//   isTooltipsEnabled()
//   getTooltipHelperVariants()
//   registerTooltip(el, descriptor)
//   registerTooltipById(tipId, descriptor)
//   setDynamicProvider(kind, fn)
//   pushGuardianTip(payload)
//   primeServerTip(tipId, payload)
//   autoCoverContainer(root)
//   registerTooltipsByTab(tabId)
// ─────────────────────────────────────────────────────────────────────────────

const TOOLTIP_ID = 'prism-tooltip';
const COMPANION_ID = 'prism-companion';
const DEFAULT_HOVER_DELAY_MS = 250;
const HIDE_GRACE_MS = 100;
const SERVER_FETCH_TTL_MS = 60_000;

const TOOLTIPS_ENABLED_STORAGE_KEY = 'prism.tooltip.enabled';
const HOVER_DELAY_STORAGE_KEY = 'prism.tooltip.hover.delay';
const HELPER_STORAGE_KEY = 'prism.tooltip.helper.variant';
const HELPER_VISIBLE_STORAGE_KEY = 'prism.tooltip.helper.visible';
const HELPER_MOTION_STORAGE_KEY = 'prism.tooltip.helper.motion';

export const HELPER_VARIANTS = {
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

// Module-private state
const descriptorsById = new Map();        // tipId -> descriptor
const descriptorsByEl = new WeakMap();    // element -> descriptor
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
let companionEl = null;
let currentTarget = null;
let showTimer = null;
let hideTimer = null;
let prefersReducedMotion = false;

let tooltipsEnabled = true;
let hoverDelayMs = DEFAULT_HOVER_DELAY_MS;
let helperVariant = 'glass-prism';
let helperVisible = true;
let helperMotionEnabled = true;
let latestGuardianAlert = null;

// ── Bootstrap ────────────────────────────────────────────────────────────────
export function initPrismTooltips() {
    if (initialized) return;
    if (typeof document === 'undefined') return;
    initialized = true;

    tooltipsEnabled = loadTooltipsEnabled();
    hoverDelayMs = loadHoverDelay();
    helperVariant = loadHelperVariant();
    helperVisible = loadHelperVisible();
    helperMotionEnabled = loadHelperMotion();

    ensureOverlay();
    ensureCompanion();

    applyTooltipRuntimeSettings((typeof window !== 'undefined' && window.state && window.state.runtimeSettings)
        ? window.state.runtimeSettings
        : null);

    // Event delegation — one listener set on document.
    document.addEventListener('mouseover', onPointerEnter, true);
    document.addEventListener('mouseout', onPointerLeave, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hideTooltipImmediate, true);
    window.addEventListener('resize', hideTooltipImmediate, true);

    if (overlayEl) {
        overlayEl.addEventListener('click', onOverlayClick, true);
        overlayEl.addEventListener('change', onOverlayChange, true);
    }
    if (companionEl) {
        companionEl.addEventListener('click', onCompanionClick, true);
    }

    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        prefersReducedMotion = !!mq.matches;
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', (e) => { prefersReducedMotion = !!e.matches; });
        }
    }
}

export function isTooltipsEnabled() {
    return tooltipsEnabled;
}

export function setTooltipsEnabled(enabled, persist = true) {
    tooltipsEnabled = enabled !== false;
    if (persist) {
        persistTooltipsEnabled(tooltipsEnabled);
    }
    if (!tooltipsEnabled) {
        hideTooltipImmediate();
    }
    syncRuntimeSettings({ tooltipsEnabled });
}

export function getHoverDelayMs() {
    return hoverDelayMs;
}

export function setHoverDelayMs(ms, persist = true) {
    const parsed = parseInt(ms, 10);
    hoverDelayMs = isNaN(parsed) || parsed < 0 ? DEFAULT_HOVER_DELAY_MS : parsed;
    if (persist) {
        persistHoverDelay(hoverDelayMs);
    }
    syncRuntimeSettings({ tooltipHoverDelayMs: hoverDelayMs });
}

export function getTooltipHelperVariants() {
    return Object.entries(HELPER_VARIANTS).map(([value, meta]) => ({
        value,
        label: meta.label,
    }));
}

export function applyTooltipRuntimeSettings(settings) {
    const cfg = settings && typeof settings === 'object' ? settings : {};

    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipsEnabled')) {
        tooltipsEnabled = cfg.tooltipsEnabled !== false;
        persistTooltipsEnabled(tooltipsEnabled);
    } else {
        tooltipsEnabled = loadTooltipsEnabled();
    }

    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipHoverDelayMs')) {
        const d = parseInt(cfg.tooltipHoverDelayMs, 10);
        if (!isNaN(d) && d >= 0) {
            hoverDelayMs = d;
            persistHoverDelay(d);
        }
    } else {
        hoverDelayMs = loadHoverDelay();
    }

    const requestedVariant = typeof cfg.tooltipHelperVariant === 'string' ? String(cfg.tooltipHelperVariant) : '';
    if (requestedVariant && HELPER_VARIANTS[requestedVariant]) {
        helperVariant = requestedVariant;
        persistHelperVariant(requestedVariant);
    } else if (!requestedVariant) {
        helperVariant = loadHelperVariant();
    }

    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipHelperVisible')) {
        helperVisible = cfg.tooltipHelperVisible !== false;
        persistHelperVisible(helperVisible);
    } else {
        helperVisible = loadHelperVisible();
    }

    if (Object.prototype.hasOwnProperty.call(cfg, 'tooltipHelperMotionEnabled')) {
        helperMotionEnabled = cfg.tooltipHelperMotionEnabled !== false;
        persistHelperMotion(helperMotionEnabled);
    } else {
        helperMotionEnabled = loadHelperMotion();
    }

    applyOverlayPreferenceClasses();
    renderFloatingCompanion();

    if (!tooltipsEnabled) {
        hideTooltipImmediate();
    } else if (currentTarget) {
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

function ensureCompanion() {
    let el = document.getElementById(COMPANION_ID);
    if (el) {
        companionEl = el;
        renderFloatingCompanion();
        return;
    }
    el = document.createElement('div');
    el.id = COMPANION_ID;
    el.className = 'prism-floating-companion';
    el.setAttribute('aria-label', 'PRISM Companion & Guidance');
    if (document.body) {
        document.body.appendChild(el);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (!document.getElementById(COMPANION_ID)) document.body.appendChild(el);
        }, { once: true });
    }
    companionEl = el;
    renderFloatingCompanion();
}

// ── Floating Companion Renderer ──────────────────────────────────────────────
export function renderFloatingCompanion() {
    if (!companionEl) return;
    const helper = HELPER_VARIANTS[helperVariant] || HELPER_VARIANTS['glass-prism'];

    companionEl.style.display = helperVisible ? 'block' : 'none';
    companionEl.className = 'prism-floating-companion prism-companion-' + escapeAttr(helper.accentClass)
        + (!helperMotionEnabled ? ' prism-companion-motion-off' : '')
        + (latestGuardianAlert ? ' has-guardian-alert' : '');

    let html = '';
    html += '<div class="prism-companion-wrapper">';
    html += '  <div class="prism-companion-orb" data-prism-companion-toggle="true" title="' + escapeAttr(helper.label + ' — ' + helper.blurb) + '">';
    html += '    <div class="prism-companion-avatar">';
    html += '      <span class="prism-companion-core">' + escapeHtml(helper.glyph) + '</span>';
    html += '      <span class="prism-companion-shard prism-companion-shard-a"></span>';
    html += '      <span class="prism-companion-shard prism-companion-shard-b"></span>';
    html += '      <span class="prism-companion-shard prism-companion-shard-c"></span>';
    html += '    </div>';
    if (latestGuardianAlert) {
        html += '    <span class="prism-companion-alert-badge" title="Guardian active insight">🛡️</span>';
    }
    html += '  </div>';

    html += '  <div class="prism-companion-popover" id="prism-companion-popover">';
    html += '    <div class="prism-companion-header">';
    html += '      <span class="prism-companion-title">' + escapeHtml(helper.label) + '</span>';
    html += '      <span class="prism-companion-glyph-tag">' + escapeHtml(helper.glyph) + '</span>';
    html += '    </div>';
    html += '    <div class="prism-companion-blurb">' + escapeHtml(helper.blurb) + '</div>';

    if (latestGuardianAlert) {
        html += '    <div class="prism-companion-guardian-alert">';
        html += '      <div class="prism-companion-guardian-alert-title"><span aria-hidden="true">🛡️</span> Guardian Watchpoint</div>';
        html += '      <div class="prism-companion-guardian-alert-msg">' + escapeHtml(latestGuardianAlert.message) + '</div>';
        html += '    </div>';
    }

    html += '    <div class="prism-companion-chooser" role="group" aria-label="Select Persona">';
    for (const [key, value] of Object.entries(HELPER_VARIANTS)) {
        const selected = key === helperVariant ? ' is-selected' : '';
        html += '<button type="button" class="prism-companion-chip' + selected + '" data-prism-helper="' + escapeAttr(key) + '">' + escapeHtml(value.label) + '</button>';
    }
    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    companionEl.innerHTML = html;
}

function onCompanionClick(event) {
    const chip = event.target && event.target.closest ? event.target.closest('[data-prism-helper]') : null;
    if (chip) {
        const variant = chip.getAttribute('data-prism-helper') || '';
        if (HELPER_VARIANTS[variant]) {
            helperVariant = variant;
            persistHelperVariant(variant);
            syncRuntimeSettings({ tooltipHelperVariant: variant });
            renderFloatingCompanion();
            if (typeof window !== 'undefined' && typeof window.renderSettingsPanel === 'function') {
                window.renderSettingsPanel();
            }
        }
        return;
    }

    const toggle = event.target && event.target.closest ? event.target.closest('[data-prism-companion-toggle]') : null;
    if (toggle && companionEl) {
        companionEl.classList.toggle('is-expanded');
    }
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

    const message = String(payload.message || '').trim();
    const entry = {
        message,
        kind: String(payload.kind || 'guardian'),
        ts: Date.now(),
    };
    guardianTips.set(String(tipId), entry);

    if (message) {
        latestGuardianAlert = { tipId: String(tipId), message, ts: Date.now() };
        renderFloatingCompanion();
    }
}

export function primeServerTip(tipId, payload) {
    if (!tipId || !payload) return;
    serverTipCache.set(String(tipId), { data: payload, fetchedAt: Date.now() });
}

// ── Pointer / focus handlers ─────────────────────────────────────────────────
function findTipTarget(node) {
    while (node && node !== document.body) {
        if (node.nodeType === 1) {
            if (descriptorsByEl.has(node)) return node;
            const tipId = node.getAttribute && node.getAttribute('data-tip-id');
            if (tipId) return node;
        }
        node = node.parentNode;
    }
    return null;
}

function onPointerEnter(event) {
    if (!tooltipsEnabled) return;
    const target = findTipTarget(event.target);
    if (!target) return;
    scheduleShow(target);
}

function onPointerLeave(event) {
    const target = findTipTarget(event.target);
    if (!target) return;
    const related = event.relatedTarget;
    if (related && (related === overlayEl || (overlayEl && overlayEl.contains(related)))) return;
    scheduleHide();
}

function onFocusIn(event) {
    if (!tooltipsEnabled) return;
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
    if (event.key === 'Escape') {
        if (currentTarget) hideTooltipImmediate();
        if (companionEl) companionEl.classList.remove('is-expanded');
    }
}

function scheduleShow(target, immediate) {
    if (!tooltipsEnabled) return;
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const fn = () => showTooltip(target);
    if (immediate || prefersReducedMotion) {
        fn();
    } else {
        showTimer = setTimeout(fn, hoverDelayMs);
    }
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
    if (!tooltipsEnabled || !target || !overlayEl) return;
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
    const cursor = (rotationCursors.get(tipId) || 0) % order.length;
    rotationCursors.set(tipId, (cursor + 1) % order.length);

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

    let html = '';
    html += '<div class="prism-tip-shell">';
    html += '  <div class="prism-tip-copy">';

    html += '    <div class="prism-tip-header">';
    if (icon) html += '<span class="prism-tip-icon">' + escapeHtml(icon) + '</span>';
    html += '      <span class="prism-tip-label">' + escapeHtml(label) + '</span>';
    html += '    </div>';

    if (summary && summary !== label) {
        html += '    <div class="prism-tip-summary">' + escapeHtml(summary) + '</div>';
    }

    if (guardian && guardian.text) {
        html += '    <div class="prism-tip-guardian">';
        html += '      <div class="prism-tip-guardian-title"><span aria-hidden="true">🛡️</span><span>Guardian Suggests</span></div>';
        html += '      <div class="prism-tip-guardian-text">' + escapeHtml(guardian.text) + '</div>';
        html += '    </div>';
    }

    if (dynamic && dynamic.text) {
        html += '    <div class="prism-tip-dynamic prism-tip-dynamic-' + escapeHtml(dynamic.kind) + '">';
        html += '      <span class="prism-tip-dynamic-glyph" aria-hidden="true">' + dynamicGlyph(dynamic.kind) + '</span>';
        html += '      <span class="prism-tip-dynamic-text">' + escapeHtml(dynamic.text) + '</span>';
        html += '    </div>';
    }

    if (typeof descriptor.telemetry === 'function') {
        let metrics = null;
        try { metrics = descriptor.telemetry(); } catch (e) { metrics = null; }
        if (metrics && typeof metrics === 'object') {
            const keys = Object.keys(metrics);
            if (keys.length) {
                html += '    <div class="prism-tip-metrics">';
                for (const key of keys) {
                    html += '<span class="prism-tip-metric"><span class="prism-tip-metric-key">' + escapeHtml(key) + '</span>'
                        + '<span class="prism-tip-metric-val">' + escapeHtml(String(metrics[key])) + '</span></span>';
                }
                html += '    </div>';
            }
        }
    }

    if (Array.isArray(descriptor.links) && descriptor.links.length) {
        html += '    <div class="prism-tip-links">';
        for (const link of descriptor.links) {
            if (!link || !link.href) continue;
            html += '<a class="prism-tip-link" href="' + escapeAttr(String(link.href))
                + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(String(link.label || link.href)) + '</a>';
        }
        html += '    </div>';
    }

    html += '    <div class="prism-tip-footer">';
    html += '      <label class="prism-tip-quick-toggle" title="Turn off rich tooltip hover popups">';
    html += '        <input type="checkbox" class="prism-tip-disable-checkbox" data-prism-disable-tip="true" /> Disable tooltips';
    html += '      </label>';
    html += '    </div>';

    html += '  </div>';
    html += '</div>';
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

function onOverlayChange(event) {
    const checkbox = event.target && event.target.closest ? event.target.closest('[data-prism-disable-tip]') : null;
    if (!checkbox) return;
    if (checkbox.checked) {
        setTooltipsEnabled(false, true);
        if (typeof window !== 'undefined' && typeof window.showTransientNotice === 'function') {
            window.showTransientNotice('Tooltips disabled. You can re-enable anytime in Provider & Settings → Tooltips section.', 'info');
        }
        if (typeof window !== 'undefined' && typeof window.renderSettingsPanel === 'function') {
            window.renderSettingsPanel();
        }
    }
}

function onOverlayClick(event) {
    const checkbox = event.target && event.target.closest ? event.target.closest('[data-prism-disable-tip]') : null;
    if (checkbox) {
        return; // Handled by change event
    }
}

function applyOverlayPreferenceClasses() {
    if (!overlayEl) return;
    overlayEl.classList.toggle('prism-tip-no-helper', true);
    overlayEl.classList.toggle('prism-tip-motion-off', !helperMotionEnabled);
}

// ── Storage synchronization ──────────────────────────────────────────────────
function loadTooltipsEnabled() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(TOOLTIPS_ENABLED_STORAGE_KEY);
            if (stored !== null) return stored === 'true';
        }
    } catch (_) { /* ignore */ }
    return true;
}

function persistTooltipsEnabled(enabled) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(TOOLTIPS_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
        }
    } catch (_) { /* ignore */ }
}

function loadHoverDelay() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(HOVER_DELAY_STORAGE_KEY);
            if (stored !== null) {
                const parsed = parseInt(stored, 10);
                if (!isNaN(parsed) && parsed >= 0) return parsed;
            }
        }
    } catch (_) { /* ignore */ }
    return DEFAULT_HOVER_DELAY_MS;
}

function persistHoverDelay(delay) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(HOVER_DELAY_STORAGE_KEY, String(delay));
        }
    } catch (_) { /* ignore */ }
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

function loadHelperVisible() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(HELPER_VISIBLE_STORAGE_KEY);
            if (stored !== null) return stored === 'true';
        }
    } catch (_) { /* ignore */ }
    return true;
}

function persistHelperVisible(visible) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(HELPER_VISIBLE_STORAGE_KEY, visible ? 'true' : 'false');
        }
    } catch (_) { /* ignore */ }
}

function loadHelperMotion() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(HELPER_MOTION_STORAGE_KEY);
            if (stored !== null) return stored === 'true';
        }
    } catch (_) { /* ignore */ }
    return true;
}

function persistHelperMotion(motion) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(HELPER_MOTION_STORAGE_KEY, motion ? 'true' : 'false');
        }
    } catch (_) { /* ignore */ }
}

function syncRuntimeSettings(partial) {
    if (typeof window !== 'undefined' && window.state && window.state.runtimeSettings) {
        Object.assign(window.state.runtimeSettings, partial);
    }
    if (typeof fetch === 'function') {
        try {
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(partial),
            }).catch(() => { /* best-effort sync */ });
        } catch (_) { /* ignore */ }
    }
}

// ── Positioning ──────────────────────────────────────────────────────────────
function positionTooltip(target) {
    if (!overlayEl || !target || !target.getBoundingClientRect) return;
    const rect = target.getBoundingClientRect();
    const tipRect = overlayEl.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    let top = rect.bottom + margin;
    let placement = 'below';
    if (top + tipRect.height > vh - margin) {
        top = rect.top - tipRect.height - margin;
        placement = 'above';
    }
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    left = Math.max(margin, Math.min(left, vw - tipRect.width - margin));
    top = Math.max(margin, top);

    overlayEl.style.top = (top + window.scrollY) + 'px';
    overlayEl.style.left = (left + window.scrollX) + 'px';
    overlayEl.dataset.placement = placement;

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
    if (Date.now() - entry.ts > 10 * 60 * 1000) return null;
    return entry.message || null;
}

function defaultTelemetryProvider(descriptor) {
    if (!descriptor) return null;
    if (typeof descriptor.dynamic === 'function') return null;
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
        // Network failures are non-fatal.
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
        if (companionEl && companionEl.parentNode) companionEl.parentNode.removeChild(companionEl);
        overlayEl = null; arrowEl = null; bodyEl = null; companionEl = null; currentTarget = null;
        if (showTimer) clearTimeout(showTimer);
        if (hideTimer) clearTimeout(hideTimer);
        showTimer = null; hideTimer = null;
        tooltipsEnabled = true;
        hoverDelayMs = DEFAULT_HOVER_DELAY_MS;
        helperVariant = 'glass-prism';
        helperVisible = true;
        helperMotionEnabled = true;
        latestGuardianAlert = null;
    },
    get state() {
        return {
            descriptorsById,
            guardianTips,
            serverTipCache,
            rotationCursors,
            currentTarget,
            overlayEl,
            companionEl,
            tooltipsEnabled,
            hoverDelayMs,
            helperVariant,
            helperVisible,
            helperMotionEnabled,
            latestGuardianAlert,
        };
    },
    triggerQuickDisable() {
        setTooltipsEnabled(false, true);
    },
};
