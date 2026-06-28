import { MetricsStore } from "../../activity/metrics-store.js";
import { OtelExporter } from "../../activity/otel-exporter.js";
import { ActivityRetentionPolicy, resolveRetentionConfigFromEnv } from "../../activity/retention-policy.js";
import { Soc2EvidenceExporter } from "../../compliance/soc2-exporter.js";
import type { ActivityBus } from "../../activity/bus.js";
import type { SqliteActivityStore } from "../../activity/sqlite-store.js";

export interface ObservabilityConfig {
  metricsStore: MetricsStore;
  otelExporter: OtelExporter;
  soc2Exporter: Soc2EvidenceExporter;
  activityRetentionPolicy: ActivityRetentionPolicy | null;
}

export function bootstrapObservability(activityBus: ActivityBus, activityStore: SqliteActivityStore | null): ObservabilityConfig {
  const metricsStore = new MetricsStore();
  const otelExporter = new OtelExporter(activityBus, metricsStore, {
    serviceName: "prism",
    serviceVersion: "0.2.0",
    endpoint: process.env.PRISM_OTEL_ENDPOINT,
    consoleExport: process.env.PRISM_OTEL_CONSOLE === "true",
  });
  otelExporter.start();

  const soc2Exporter = new Soc2EvidenceExporter(activityBus);
  if (soc2Exporter.isEnabled()) {
    soc2Exporter.start();
  }

  let activityRetentionPolicy: ActivityRetentionPolicy | null = null;
  const retentionCfg = activityStore
    ? resolveRetentionConfigFromEnv(activityStore.dbPath)
    : null;
  if (retentionCfg) {
    activityRetentionPolicy = new ActivityRetentionPolicy(retentionCfg, activityBus);
    activityRetentionPolicy.start();
  }

  return {
    metricsStore,
    otelExporter,
    soc2Exporter,
    activityRetentionPolicy,
  };
}
