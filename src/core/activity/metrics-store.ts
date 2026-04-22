/**
 * MetricsStore — Zero-dependency Prometheus-format metrics for PRISM
 *
 * Implements counters, histograms, and gauges that export Prometheus text
 * format from `GET /metrics`.  No npm package required — we emit the text
 * format directly.
 *
 * Histogram buckets follow the standard Prometheus convention (cumulative, +Inf).
 *
 * Thread-safety: Node.js single-threaded event loop; no synchronisation needed.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LabelSet {
    [key: string]: string;
}

// Internal counter entry
interface CounterEntry {
    help: string;
    values: Map<string, number>; // serialised labels → value
    labels: Map<string, LabelSet>;
}

// Internal histogram entry
interface HistogramEntry {
    help: string;
    buckets: number[]; // upper bounds, NOT including +Inf
    // key = serialised labels
    counts: Map<string, number[]>; // bucket counts (length === buckets.length)
    sums: Map<string, number>;
    observations: Map<string, number>;
    labelMap: Map<string, LabelSet>;
}

// Internal gauge entry
interface GaugeEntry {
    help: string;
    values: Map<string, number>;
    labels: Map<string, LabelSet>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeLabels(labels: LabelSet): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${labels[k]}"`).join(",");
}

function formatLabels(labels: LabelSet): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return "";
    return "{" + keys.map((k) => `${k}="${escapeLabel(labels[k])}"`).join(",") + "}";
}

function escapeLabel(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ── MetricsStore ─────────────────────────────────────────────────────────────

export class MetricsStore {
    private readonly counters = new Map<string, CounterEntry>();
    private readonly histograms = new Map<string, HistogramEntry>();
    private readonly gauges = new Map<string, GaugeEntry>();

    // ── Counter ──────────────────────────────────────────────────────────────

    /** Register a counter (idempotent). Must be called before `inc()`. */
    registerCounter(name: string, help: string): void {
        if (!this.counters.has(name)) {
            this.counters.set(name, { help, values: new Map(), labels: new Map() });
        }
    }

    /**
     * Increment a counter.
     * Auto-registers with empty help if not yet registered.
     */
    inc(name: string, labels: LabelSet = {}, by = 1): void {
        if (!this.counters.has(name)) this.registerCounter(name, "");
        const entry = this.counters.get(name)!;
        const key = serializeLabels(labels);
        entry.values.set(key, (entry.values.get(key) ?? 0) + by);
        entry.labels.set(key, labels);
    }

    // ── Histogram ────────────────────────────────────────────────────────────

    /** Default latency buckets (ms). */
    static readonly DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

    /**
     * Register a histogram.
     * `buckets` are upper-bound values in ascending order (do NOT include +Inf).
     */
    registerHistogram(name: string, help: string, buckets = MetricsStore.DEFAULT_LATENCY_BUCKETS): void {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, {
                help,
                buckets: [...buckets].sort((a, b) => a - b),
                counts: new Map(),
                sums: new Map(),
                observations: new Map(),
                labelMap: new Map(),
            });
        }
    }

    /**
     * Observe a value on a histogram.
     * Auto-registers with default buckets if not yet registered.
     */
    observe(name: string, value: number, labels: LabelSet = {}): void {
        if (!this.histograms.has(name)) this.registerHistogram(name, "");
        const entry = this.histograms.get(name)!;
        const key = serializeLabels(labels);

        if (!entry.counts.has(key)) {
            entry.counts.set(key, new Array(entry.buckets.length).fill(0));
            entry.sums.set(key, 0);
            entry.observations.set(key, 0);
            entry.labelMap.set(key, labels);
        }

        const bucketCounts = entry.counts.get(key)!;
        for (let i = 0; i < entry.buckets.length; i++) {
            if (value <= entry.buckets[i]) bucketCounts[i]++;
        }
        entry.sums.set(key, (entry.sums.get(key) ?? 0) + value);
        entry.observations.set(key, (entry.observations.get(key) ?? 0) + 1);
    }

    // ── Gauge ────────────────────────────────────────────────────────────────

    /** Register a gauge (idempotent). */
    registerGauge(name: string, help: string): void {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, { help, values: new Map(), labels: new Map() });
        }
    }

    /**
     * Set a gauge to an absolute value.
     * Auto-registers if not yet registered.
     */
    set(name: string, value: number, labels: LabelSet = {}): void {
        if (!this.gauges.has(name)) this.registerGauge(name, "");
        const entry = this.gauges.get(name)!;
        const key = serializeLabels(labels);
        entry.values.set(key, value);
        entry.labels.set(key, labels);
    }

    // ── Render ───────────────────────────────────────────────────────────────

    /**
     * Render all metrics in Prometheus text exposition format (0.0.4).
     * https://prometheus.io/docs/instrumenting/exposition_formats/
     */
    render(): string {
        const lines: string[] = [];

        // Counters
        for (const [name, entry] of this.counters) {
            if (entry.help) lines.push(`# HELP ${name} ${entry.help}`);
            lines.push(`# TYPE ${name} counter`);
            if (entry.values.size === 0) {
                lines.push(`${name} 0`);
            } else {
                for (const [key, value] of entry.values) {
                    const lbls = entry.labels.get(key) ?? {};
                    lines.push(`${name}${formatLabels(lbls)} ${value}`);
                }
            }
        }

        // Histograms
        for (const [name, entry] of this.histograms) {
            if (entry.help) lines.push(`# HELP ${name} ${entry.help}`);
            lines.push(`# TYPE ${name} histogram`);
            for (const [key, bucketCounts] of entry.counts) {
                const lbls = entry.labelMap.get(key) ?? {};
                for (let i = 0; i < entry.buckets.length; i++) {
                    // bucketCounts[i] is already a cumulative count (observe() increments
                    // ALL buckets where value <= upper_bound), so use directly — no re-summing.
                    const bucketLabels = { ...lbls, le: String(entry.buckets[i]) };
                    lines.push(`${name}_bucket${formatLabels(bucketLabels)} ${bucketCounts[i]}`);
                }
                // +Inf bucket = total observations
                const infLabels = { ...lbls, le: "+Inf" };
                const total = entry.observations.get(key) ?? 0;
                lines.push(`${name}_bucket${formatLabels(infLabels)} ${total}`);
                lines.push(`${name}_sum${formatLabels(lbls)} ${entry.sums.get(key) ?? 0}`);
                lines.push(`${name}_count${formatLabels(lbls)} ${total}`);
            }
        }

        // Gauges
        for (const [name, entry] of this.gauges) {
            if (entry.help) lines.push(`# HELP ${name} ${entry.help}`);
            lines.push(`# TYPE ${name} gauge`);
            if (entry.values.size === 0) {
                lines.push(`${name} 0`);
            } else {
                for (const [key, value] of entry.values) {
                    const lbls = entry.labels.get(key) ?? {};
                    lines.push(`${name}${formatLabels(lbls)} ${value}`);
                }
            }
        }

        return lines.join("\n") + "\n";
    }

    // ── Histogram Snapshot ───────────────────────────────────────────────────

    /** Shape returned by getHistogramSnapshot(). */
    getHistogramSnapshot(): HistogramSnapshot[] {
        const result: HistogramSnapshot[] = [];
        for (const [name, entry] of this.histograms) {
            for (const [key, bucketCounts] of entry.counts) {
                const labels = entry.labelMap.get(key) ?? {};
                result.push({
                    name,
                    labels,
                    buckets: [...entry.buckets],
                    counts: [...bucketCounts],
                    sum: entry.sums.get(key) ?? 0,
                    totalObservations: entry.observations.get(key) ?? 0,
                });
            }
        }
        return result;
    }
}

/** A snapshot of a single histogram series (one label combination). */
export interface HistogramSnapshot {
    name: string;
    labels: LabelSet;
    /** Upper-bound values in ascending order (excluding +Inf). */
    buckets: number[];
    /** Cumulative bucket counts (same length as buckets). */
    counts: number[];
    sum: number;
    totalObservations: number;
}
