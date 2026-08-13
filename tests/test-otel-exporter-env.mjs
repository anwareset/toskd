// Spec: specs/golden-signals-otel-spec.md §4.7 — Pendekatan A (env-driven
// exporters). Lock-in perilaku anti-senyap: nilai OTEL_*_EXPORTER yang tidak
// dikenal harus terdeteksi oleh validateExporterEnv() (dipanggil di module
// body src/otel.js saat init untuk mencetak console.error jelas). Import
// aman tanpa env OTEL: guard di otel.js menonaktifkan SDK (no-op).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateExporterEnv,
  SUPPORTED_TRACE_EXPORTERS,
  SUPPORTED_METRIC_EXPORTERS,
} from "../src/otel.js";

test("nilai valid (otlp/console/none) diterima tanpa error", () => {
  assert.deepEqual(
    validateExporterEnv({ OTEL_TRACES_EXPORTER: "otlp", OTEL_METRICS_EXPORTER: "console" }),
    [],
  );
  assert.deepEqual(validateExporterEnv({ OTEL_TRACES_EXPORTER: "none" }), []);
  assert.deepEqual(validateExporterEnv({ OTEL_METRICS_EXPORTER: "none" }), []);
});

test("nilai tak dikenal memicu error (anti-senyap)", () => {
  const errs = validateExporterEnv({
    OTEL_TRACES_EXPORTER: "otl", // typo
    OTEL_METRICS_EXPORTER: "zipkin",
  });
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.envName === "OTEL_TRACES_EXPORTER" && e.value === "otl"));
  assert.ok(errs.some((e) => e.envName === "OTEL_METRICS_EXPORTER" && e.value === "zipkin"));
});

test("prometheus (metrics) DITOLAK — toskd tidak expose /metrics sendiri (spec §8)", () => {
  const errs = validateExporterEnv({ OTEL_METRICS_EXPORTER: "prometheus" });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].value, "prometheus");
  assert.ok(errs[0].supported.includes("otlp"));
});

test("zipkin (traces) tetap didukung", () => {
  assert.ok(SUPPORTED_TRACE_EXPORTERS.includes("zipkin"));
  assert.deepEqual(validateExporterEnv({ OTEL_TRACES_EXPORTER: "zipkin" }), []);
});

test("set yang diekspor konsisten dgn validasi", () => {
  assert.deepEqual(SUPPORTED_TRACE_EXPORTERS, ["otlp", "zipkin", "console", "none"]);
  assert.deepEqual(SUPPORTED_METRIC_EXPORTERS, ["otlp", "console", "none"]);
});

test("comma-list + whitespace ditangani; var kosong diabaikan", () => {
  assert.deepEqual(
    validateExporterEnv({ OTEL_TRACES_EXPORTER: "otlp, console", OTEL_METRICS_EXPORTER: "" }),
    [],
  );
  assert.deepEqual(validateExporterEnv({ OTEL_TRACES_EXPORTER: "  " }), []);
  assert.deepEqual(validateExporterEnv({}), []);
});
