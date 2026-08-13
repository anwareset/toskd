// tests/test-otel-smoke.mjs
// Lock-in end-to-end OpenTelemetry export (spec: golden-signals-otel-spec.md):
//   A. In-process — histogram golden-signals `http.server.request.duration`
//      ter-ekspor ke OTLP (mock receiver) dengan status_class 2xx & 4xx,
//      route ternormalisasi muncul di traces, dan `/health` TIDAK masuk metrik.
//   B. Child process — access log Pino memuat `trace_id`/`span_id` (trace
//      correlation via @opentelemetry/instrumentation-pino) dan `/health`
//      TIDAK muncul di access log.
//
// Strategy (sama dgn tests/test-health.mjs): mock OTLP receiver + mock
// PostgREST (node:http), set env OTEL_* SEBELUM import src/server.js (guard
// di otel.js membaca env saat module dievaluasi), lalu pakai app asli. Tiap
// test file berjalan di proses sendiri (node --test) — env tidak mencemari
// file lain.
//
// Run: pnpm test (atau: node --test tests/test-otel-smoke.mjs)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");
const OTEL_PATH = join(__dirname, "..", "src", "otel.js");

// Poll helper: tunggu predicate terpenuhi (maks timeoutMs).
async function waitFor(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}

// Mock OTLP receiver: mengumpulkan body POST /v1/traces & /v1/metrics.
function startMockOtlp() {
  const state = { traces: [], metrics: [] };
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.url?.includes("/v1/traces")) state.traces.push(body);
      if (req.url?.includes("/v1/metrics")) state.metrics.push(body);
      res.writeHead(200, { "Content-Type": "application/x-protobuf" });
      res.end();
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ srv, state })),
  );
}

// Mock PostgREST minimal (cukup utk health check + /api/questions).
function startMockPostgrest() {
  const srv = createServer((req, res) => {
    if (req.url?.includes("/rest/v1/questions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1 }]));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ srv })),
  );
}

// ------------------------------------------------------------------ fixtures

let mockDb;
let mockOtlp;
let otel;
let server;
let baseUrl;

before(async () => {
  mockDb = await startMockPostgrest();
  mockOtlp = await startMockOtlp();

  process.env.SUPABASE_KEY = "test-service-role-key-not-used-by-mock";
  process.env.JWT_SECRET = "x".repeat(64);
  process.env.NODE_ENV = "development"; // skip bootstrap seed
  process.env.VERCEL = "1"; // skip app.listen di server.js (kita listen sendiri)
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockDb.srv.address().port}`;

  process.env.OTEL_SERVICE_NAME = "toskd-smoke";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${mockOtlp.srv.address().port}`;
  process.env.OTEL_TRACE_SAMPLE_RATIO = "1"; // sample semua utk test
  process.env.OTEL_METRIC_EXPORT_INTERVAL = "500";
  process.env.OTEL_BSP_SCHEDULE_DELAY = "500";

  const { default: imported } = await import(`file://${SERVER_PATH}`);
  server = imported.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Handle shutdownTelemetry dari instans otel.js yang SAMA (cache ESM) —
  // wajib dipanggil di after() agar timer BSP/metric reader SDK berhenti dan
  // proses test tidak menggantung.
  otel = await import(`file://${OTEL_PATH}`);
});

after(async () => {
  await otel?.shutdownTelemetry(); // flush + stop timer SDK
  server?.close();
  server?.closeAllConnections?.();
  mockDb?.srv.close();
  mockDb?.srv.closeAllConnections?.(); // socket keep-alive undici → exit deterministik
  mockOtlp?.srv.close();
  mockOtlp?.srv.closeAllConnections?.();
});

// ------------------------------------------------------------------ tests

test("OTLP: golden-signals histogram ter-ekspor (2xx+4xx), route ternormalisasi, /health tidak masuk metrik", async () => {
  const r1 = await fetch(`${baseUrl}/api/questions`); // 200 tracked
  const r2 = await fetch(`${baseUrl}/api/exam/999/results`); // 403 tracked
  const r3 = await fetch(`${baseUrl}/health`); // 200 untracked (spec §2 #7)
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 403);
  assert.equal(r3.status, 200);

  // Content-aware wait: tunggu SAMPAI payload benar-benar memuat histogram
  // golden-signals + route ternormalisasi (bukan sekadar "ada ekspor") —
  // menghindari race dgn tick ekspor pertama (500ms) di CI yang lambat.
  const metricsJoined = () =>
    Buffer.concat(mockOtlp.state.metrics).toString("latin1");
  const tracesJoined = () =>
    Buffer.concat(mockOtlp.state.traces).toString("latin1");
  const exported = await waitFor(
    () =>
      metricsJoined().includes("http.server.request.duration") &&
      tracesJoined().includes("/api/exam/:id/results"),
  );
  assert.ok(exported, "histogram golden-signals + route ternormalisasi harus ter-ekspor");

  const traces = tracesJoined();
  const metrics = metricsJoined();

  // Histogram golden-signals + status_class (2xx dari /api/questions,
  // 4xx dari /api/exam/999/results → 403).
  assert.ok(
    metrics.includes("http.server.request.duration"),
    "histogram http.server.request.duration harus ada di metrics",
  );
  assert.ok(metrics.includes("2xx"), "harus ada observasi status_class 2xx");
  assert.ok(metrics.includes("4xx"), "harus ada observasi status_class 4xx");
  // /health TIDAK di-track: jangan sampai muncul di payload metrik.
  assert.ok(!metrics.includes("/health"), "/health tidak boleh masuk metrik");

  // Route ternormalisasi (pattern Express, bukan id mentah "999") di traces.
  assert.ok(
    traces.includes("/api/exam/:id/results"),
    "trace harus memuat route ternormalisasi /api/exam/:id/results",
  );
});

test("access log: trace_id/span_id ter-inject (trace correlation) + /health tidak di-log", () => {
  // Child process terpisah (spawnSync memblokir event loop parent, jadi child
  // punya mock receiver sendiri) — stdout child berisi JSON pino murni.
  const env = { ...process.env };
  env.NODE_ENV = "production"; // pino JSON murni (bukan pino-pretty)
  // NODE_ENV=production + BOOTSTRAP_ADMIN_* yang ter-expose environment bisa
  // memicu bootstrap ke mock — bersihkan agar child deterministik.
  delete env.BOOTSTRAP_ADMIN_USERNAME;
  delete env.BOOTSTRAP_ADMIN_PASSWORD;

  const script = `
    import { createServer } from "node:http";
    const otlp = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/x-protobuf" });
        res.end();
      });
    });
    await new Promise((r) => otlp.listen(0, "127.0.0.1", r));
    const pg = createServer((req, res) => {
      if (req.url?.includes("/rest/v1/questions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: 1 }]));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
    });
    await new Promise((r) => pg.listen(0, "127.0.0.1", r));
    process.env.SUPABASE_URL = "http://127.0.0.1:" + pg.address().port;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:" + otlp.address().port;
    process.env.OTEL_SERVICE_NAME = "toskd-smoke-child";
    process.env.OTEL_TRACE_SAMPLE_RATIO = "1";
    process.env.OTEL_METRIC_EXPORT_INTERVAL = "60000";
    const { default: app } = await import(${JSON.stringify(`file://${SERVER_PATH}`)});
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    await fetch(base + "/api/questions"); // 200 tracked → access log
    await fetch(base + "/health");        // 200 untracked → TIDAK ada access log
    await new Promise((r) => setTimeout(r, 300)); // biarkan pino flush ke stdout
    server.close();
    pg.close();
    otlp.close();
    process.exit(0);
  `;
  const result = spawnSync("node", ["--input-type=module", "-e", script], {
    env,
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(result.status, 0, `subprocess failed: ${result.stderr?.slice(0, 500)}`);

  const lines = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const access = lines.filter((l) => l.event === "http.request");
  assert.equal(
    access.length,
    1,
    `harus ada tepat 1 access log (route /api/questions) — dapat ${access.length}`,
  );

  const log = access[0];
  assert.equal(log.http?.route, "/api/questions");
  assert.equal(log.http?.status_code, 200);
  assert.match(log.trace_id, /^[0-9a-f]{32}$/, "trace_id 32 hex harus ada di access log");
  assert.match(log.span_id, /^[0-9a-f]{16}$/, "span_id 16 hex harus ada di access log");

  // /health tidak muncul di access log mana pun.
  assert.ok(
    !lines.some((l) => l.http?.route === "/health"),
    "/health tidak boleh muncul di access log",
  );
});
