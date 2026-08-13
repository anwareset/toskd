// tests/test-logger-redact.mjs
// Lock-in tests untuk src/logger.js (specs/golden-signals-otel-spec.md §4.4):
//   - pino-redact menyensor password/token/cookie/authorization/body/answers
//   - field `service` selalu "toskd" + field inti (level/msg/event)
//   - errorField menghasilkan shape { type, code, message, stack }
//   - REDACT_PATHS mencakup daftar sensitif yang disepakati di spec
//
// Strategi: createLogger() dengan destination stream in-memory (bukan
// singleton) — terisolasi, tanpa transport worker, deterministik.
//
// Run: node --test tests/test-logger-redact.mjs (atau via `pnpm test`)
import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createLogger, errorField, REDACT_PATHS } from "../src/logger.js";

function sink() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

test("redact menyensor field sensitif (password/token/cookie/authorization/body/answers/options)", () => {
  const { stream, lines } = sink();
  const logger = createLogger({ level: "info", destination: stream });
  logger.info(
    {
      event: "test.redact",
      password: "s3cret",
      token: "abc123",
      cookie: "toskd_admin_sess=xyz",
      authorization: "Bearer tok",
      body: { answers: { 1: "A" } },
      answers: { 1: "B" },
      nested: { password: "p", options: { A: "jawaban" } },
      http: { method: "POST", route: "/api/x", status_code: 200 },
    },
    "msg",
  );
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.password, "[REDACTED]");
  assert.equal(parsed.token, "[REDACTED]");
  assert.equal(parsed.cookie, "[REDACTED]");
  assert.equal(parsed.authorization, "[REDACTED]");
  // Path `body` (top-level) meredact SELURUH objek body.
  assert.equal(parsed.body, "[REDACTED]");
  assert.equal(parsed.answers, "[REDACTED]");
  assert.equal(parsed.nested.password, "[REDACTED]");
  assert.equal(parsed.nested.options, "[REDACTED]");
  // Field non-sensitif tetap utuh (mis. http.* untuk access log).
  assert.deepEqual(parsed.http, {
    method: "POST",
    route: "/api/x",
    status_code: 200,
  });
});

test("log selalu membawa service=toskd + field inti (level/msg/event)", () => {
  const { stream, lines } = sink();
  const logger = createLogger({ level: "info", destination: stream });
  logger.info({ event: "test.core" }, "hello");
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.service, "toskd");
  assert.equal(parsed.event, "test.core");
  assert.equal(parsed.level, 30); // pino info
  assert.equal(parsed.msg, "hello");
});

test("errorField menghasilkan shape { type, code, message, stack, cause }", () => {
  const e = new Error("boom");
  e.code = "PGRST301";
  assert.deepEqual(errorField(e), {
    type: "Error",
    code: "PGRST301",
    message: "boom",
    stack: e.stack,
    cause: null,
  });
  assert.deepEqual(errorField(null), {
    type: null,
    code: null,
    message: null,
    stack: null,
    cause: null,
  });
  assert.deepEqual(errorField("plain"), {
    type: "Error",
    code: null,
    message: "plain",
    stack: null,
    cause: null,
  });
  // Objek PostgREST (plain object, bukan Error instance).
  const plain = { message: "db down", code: "23505" };
  assert.equal(errorField(plain).code, "23505");
  assert.equal(errorField(plain).message, "db down");
  // Node fetch errors: root cause disimpan di err.cause.
  const fetchErr = Object.assign(new Error("fetch failed"), {
    cause: new Error("ECONNREFUSED 127.0.0.1:5432"),
  });
  assert.equal(errorField(fetchErr).cause, "ECONNREFUSED 127.0.0.1:5432");
});

test("REDACT_PATHS mencakup daftar sensitif yang disepakati", () => {
  const required = [
    "password",
    "*.password",
    "token",
    "*.token",
    "cookie",
    "*.cookie",
    "req.headers.cookie",
    "authorization",
    "*.authorization",
    "req.headers.authorization",
    "body",
    "*.body",
    "answers",
    "*.answers",
    "*.options",
  ];
  for (const p of required) {
    assert.ok(REDACT_PATHS.includes(p), `REDACT_PATHS missing: ${p}`);
  }
});
