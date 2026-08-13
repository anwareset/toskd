// src/otel.js
// Spec: specs/golden-signals-otel-spec.md §4.1-4.3
//
// OpenTelemetry bootstrap untuk toskd (self-hosted). Mengekspor:
//   - recordHttpRequest()   → histogram golden-signals (traffic/latency/errors)
//   - withSpan()            → helper span manual untuk operasi kunci
//   - currentTraceContext() → { trace_id, span_id } untuk korelasi access log
//   - activeServerSpan()    → ref span HTTP server (fallback http.route §7)
//   - shutdownTelemetry()   → forceFlush saat graceful shutdown
//   - validateExporterEnv() + SUPPORTED_TRACE/METRIC_EXPORTERS → validasi env
//     Pendekatan A (di-test di tests/test-otel-exporter-env.mjs)
//
// ⚠️ WAJIB di-import PALING PERTAMA di src/server.js (sebelum express/pino
// dimuat): instrumentations NodeSDK mem-patch node:http, express, undici dan
// pino, dan ESM mengevaluasi import sesuai urutan source (depth-first).
// Import terlambat = trace correlation + HTTP spans senyap hilang.
//
// Guard (spec §2 #16): telemetry AKTIF hanya jika OTEL_SERVICE_NAME DAN
// OTEL_EXPORTER_OTLP_ENDPOINT keduanya terisi. Tanpa keduanya (local dev,
// Vercel serverless, test CI) SDK tidak pernah di-start dan semua helper
// menjadi no-op — `pnpm test` tetap hijau.
//
// Pendekatan A (env-driven): eksporter TIDAK dikonstruksi eksplisit — SDK
// memilihnya sendiri dari OTEL_TRACES_EXPORTER / OTEL_METRICS_EXPORTER,
// OTEL_EXPORTER_OTLP_PROTOCOL, dan OTEL_METRIC_EXPORT_INTERVAL (semua paket
// eksporter OTLP ter-bundle di @opentelemetry/sdk-node). Nilai env tak dikenal
// → peringatan jelas di log (tidak mati senyap).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { metrics, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  SamplingDecision,
} from "@opentelemetry/sdk-trace-base";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";

// ---- Guard ---------------------------------------------------------------

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME?.trim();
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const otelEnabled = Boolean(SERVICE_NAME && OTLP_ENDPOINT);

// Bucket histogram http.server.request.duration (detik): 5ms..10s.
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// Route yang SELALU di-trace (spec §2 #8/#14). Span anak (Supabase fetch,
// span manual) ikut keputusan parent via ParentBasedSampler → tree utuh.
const CRITICAL_ROUTES = ["/api/exam/start", "/api/exam/submit"];

// Root sampler: AlwaysOn untuk route ujian (kritikal), TraceIdRatioBased
// (default 10%, override via OTEL_TRACE_SAMPLE_RATIO) untuk sisanya.
class CriticalRouteRatioSampler {
  constructor(ratio) {
    this._ratioSampler = new TraceIdRatioBasedSampler(ratio);
  }

  shouldSample(context, traceId, spanName, spanKind, attributes, links) {
    const raw =
      attributes?.["url.path"] ?? attributes?.["http.route"] ?? spanName ?? "";
    // spanName dari instrumentation-http berbentuk "POST /api/exam/submit"
    // (prefix method) — strip prefix supaya match dengan CRITICAL_ROUTES
    // walau attribute url.path tidak tersedia saat sampler dipanggil.
    const path = String(raw).replace(/^\S+\s+/, "");
    const critical = CRITICAL_ROUTES.some((r) => path.startsWith(r));
    if (critical) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return this._ratioSampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );
  }

  toString() {
    return `CriticalRouteRatioSampler{${this._ratioSampler.toString()}}`;
  }
}

// ── Validasi eksporter env (Pendekatan A) ──────────────────────────────────
// Set nilai yang DIDUKUNG toskd. Catatan: `prometheus` (metrics) sengaja TIDAK
// didukung — PrometheusMetricExporter membuka port scrape sendiri di aplikasi
// (:9464), kontradiktif dgn arsitektur (spec §8: toskd tidak expose /metrics;
// collector yang mengekspos :8889/metrics). Nilai itu memicu error jelas.
export const SUPPORTED_TRACE_EXPORTERS = ["otlp", "zipkin", "console", "none"];
export const SUPPORTED_METRIC_EXPORTERS = ["otlp", "console", "none"];

// Pure helper — di-test di tests/test-otel-exporter-env.mjs. Return array of
// { envName, value, supported } untuk tiap nilai tak dikenal. Komma-list &
// whitespace ditangani (cocok dgn getStringListFromEnv SDK); var kosong
// tidak divalidasi.
export function validateExporterEnv(env = process.env) {
  const errors = [];
  for (const [envName, supported] of [
    ["OTEL_TRACES_EXPORTER", SUPPORTED_TRACE_EXPORTERS],
    ["OTEL_METRICS_EXPORTER", SUPPORTED_METRIC_EXPORTERS],
  ]) {
    const raw = env[envName];
    if (!raw) continue;
    for (const v of raw.split(",")) {
      const name = v.trim();
      if (name && !supported.includes(name)) {
        errors.push({ envName, value: name, supported });
      }
    }
  }
  return errors;
}

let sdk = null;
let httpDurationHistogram = null;

if (otelEnabled) {
  const rawRatio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO);
  const ratio =
    Number.isFinite(rawRatio) && rawRatio >= 0 && rawRatio <= 1
      ? rawRatio
      : 0.1;

  // Pendekatan A: diag logger SDK dinyalakan level warn supaya peringatan
  // internal SDK (nilai env tak dikenal, protocol unsupported, dst.) terlihat
  // di stderr — jangan biarkan telemetry mati senyap.
  process.env.OTEL_LOG_LEVEL ??= "warn";

  // Validasi dini nilai OTEL_*_EXPORTER. Nilai tak dikenal → console.error
  // jelas (module ini dievaluasi SEBELUM logger pino siap — kategori pre-init
  // fatal, spec §2 #10) + signal tsb non-aktif.
  for (const { envName, value, supported } of validateExporterEnv()) {
    console.error(
      `[otel] Unsupported ${envName} value: "${value}". ` +
        `Supported: ${supported.join(", ")}. Signal telemetry NON-AKTIF.`,
    );
  }

  // Tanpa traceExporter/metricReader → SDK mengonfigurasi span processors +
  // metric readers dari env (Pendekatan A). OTEL_METRIC_EXPORT_INTERVAL juga
  // dibaca SDK sendiri (default 60000) — tidak perlu parsing manual lagi.
  sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    sampler: new ParentBasedSampler({
      root: new CriticalRouteRatioSampler(ratio),
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new UndiciInstrumentation(),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });

  try {
    sdk.start(); // sync (void); throw hanya utk kesalahan konfigurasi fatal
  } catch (err) {
    console.error("[otel] SDK start failed, telemetry disabled:", err?.message || err);
    sdk = null;
  }

  if (sdk) {
    const meter = metrics.getMeter("toskd");
    httpDurationHistogram = meter.createHistogram(
      "http.server.request.duration",
      {
        description: "Duration of HTTP server requests (seconds)",
        unit: "s",
        advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
      },
    );
  }
}

// ---- Exported helpers ----------------------------------------------------

// Catat satu request selesai ke histogram golden-signals. No-op saat
// telemetry mati. Attributes: method + route ternormalisasi + status class.
export function recordHttpRequest({ method, route, statusClass, durationSeconds }) {
  if (!httpDurationHistogram) return;
  httpDurationHistogram.record(durationSeconds, {
    "http.request.method": method,
    "http.route": route,
    "http.response.status_class": statusClass,
  });
}

// Attribute undefined/null dibuang — SDK menolak nilai non-primitif dan
// perilaku undefined bisa berbeda antar versi (defensive, spec §2 #17).
function sanitizeAttributes(attributes) {
  if (!attributes) return attributes;
  const out = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// Bungkus fn (sync atau async) dalam span manual. No-op saat telemetry mati
// (tracer global = no-op → span dibuang, status/exception aman dipanggil).
export function withSpan(name, attributes, fn) {
  const tracer = trace.getTracer("toskd");
  const span = tracer.startSpan(name, { attributes: sanitizeAttributes(attributes) });
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return value;
        },
        (err) => {
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err?.message || String(err),
          });
          span.end();
          throw err;
        },
      );
    }
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return result;
  } catch (err) {
    span.recordException(err);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err?.message || String(err),
    });
    span.end();
    throw err;
  }
}

// Ambil span HTTP server yang aktif — dipanggil middleware observability di
// server.js di AWAL request. Fallback resmi spec §7: ExpressInstrumentation
// 0.69 belum menangkap route utk Express 5 (span hanya berisi url.path mentah
// + nama method saja), jadi middleware menambah `http.route` ternormalisasi +
// rename span di event 'finish' — span MASIH terbuka saat itu (instrumentation
// menutup span di event 'close', yang datang SETELAH 'finish').
export function activeServerSpan() {
  return trace.getActiveSpan() ?? null;
}

// Trace correlation untuk access log (spec §12.2). Dipanggil oleh middleware
// di server.js di AWAL request (span HTTP server masih aktif) — bukan di
// event 'finish' yang bisa terjadi setelah span berakhir. No-op → {}.
export function currentTraceContext() {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

// Flush + shutdown SDK (forceFlush span/metric pending). No-op saat mati.
// Caller mengikat timeout (safety net 5s di graceful shutdown server.js).
export function shutdownTelemetry() {
  if (!sdk) return Promise.resolve();
  return sdk.shutdown();
}
