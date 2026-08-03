// tests/test-health.mjs
// Lock-in tests for the GET /health readiness probe in src/server.js:
//   - 200 { status: "ready", version: "<short-sha>" } when DB is reachable
//   - 503 { status: "unavailable", version, error } when DB check fails
//   - version fallback chain: VERCEL_GIT_COMMIT_SHA → GIT_COMMIT_SHA →
//     `git rev-parse --short HEAD` → "unknown"
//
// Strategy (no module-mocking framework): spin up a local mock PostgREST
// (plain node:http) and point SUPABASE_URL at it, then import the REAL
// src/server.js ONCE and share the app across tests. The mock can be
// toggled to "down" mode so the same app instance exercises the 503 path.
//
// Note: imports src/server.js, which imports src/db.js (throws without
// SUPABASE_* env) and throws on startup without a >=32-char JWT_SECRET —
// both are provided via process.env before the dynamic import.
//
// Run: node tests/test-health.mjs (or via `pnpm test`)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");

// ---------------------------------------------------------------------------
// Shared fixtures (before/after hooks)
// ---------------------------------------------------------------------------

let mockDb; // toggle-able mock PostgREST
let app;
let server;
let baseUrl;

// Local mock PostgREST: answers GET /rest/v1/questions?select=id&limit=1
// with a minimal row while "up"; returns 500 while "down". Mimics Supabase's
// REST layer well enough for the health smoke-test
// (`supabase.from("questions").select("id").limit(1)`).
function startMockPostgrest() {
  const state = { down: false };
  const srv = createServer((req, res) => {
    if (state.down) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "connection terminated (simulated)" }));
      return;
    }
    if (req.url?.includes("/rest/v1/questions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1 }]));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ srv, state })),
  );
}

before(async () => {
  const fixture = await startMockPostgrest();
  mockDb = fixture;
  process.env.SUPABASE_KEY = "test-service-role-key-not-used-by-mock";
  process.env.JWT_SECRET = "x".repeat(64);
  process.env.NODE_ENV = "development"; // skip bootstrap seed
  process.env.VERCEL = "1"; // skip app.listen in server.js (we listen ourselves)
  process.env.SUPABASE_URL = `http://127.0.0.1:${fixture.srv.address().port}`;
  process.env.GIT_COMMIT_SHA = "0123456789abcdef"; // 16 chars → short = first 7

  const { default: imported } = await import(`file://${SERVER_PATH}`);
  app = imported;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  mockDb?.srv.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("GET /health → 200 { status: ready, version } when DB reachable", async () => {
  mockDb.state.down = false;
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // GIT_COMMIT_SHA 16-char "0123456789abcdef" → short = "0123456"
  assert.deepEqual(body, { status: "ready", version: "0123456" });
});

test("GET /health → 503 { status: unavailable, version, error } when DB check fails", async () => {
  mockDb.state.down = true; // DB unreachable → smoke query fails
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.version, "0123456");
  assert.ok(
    typeof body.error === "string" && body.error.length > 0,
    "503 response should carry an error detail",
  );
});

test("version falls back to 'unknown' when no SHA env and git unavailable", async () => {
  // Spawn the REAL server in a child process whose cwd is NOT a git repo,
  // with both SHA env vars removed. getShortCommitSha() then bottoms out at
  // "unknown" (`git rev-parse --short HEAD` fails; try/catch catches it).
  // This exercises the actual fallback in src/server.js — not a re-implementation.
  //
  // The child runs its OWN mock PostgREST (NOT the parent's): spawnSync blocks
  // the parent event loop, so the parent's mock couldn't answer the child's
  // request (deadlock → health timeout 503). Self-contained child avoids that.
  const nonGitDir = mkdtempSync(join(tmpdir(), "toskd-health-unknown-"));
  const env = { ...process.env }; // inherit PATH, TZ, etc.
  delete env.SUPABASE_URL; // child sets its own below
  delete env.GIT_COMMIT_SHA;
  delete env.VERCEL_GIT_COMMIT_SHA;
  env.JWT_SECRET = "x".repeat(64);
  env.NODE_ENV = "development";
  env.VERCEL = "1";

  const script = `
    import { createServer } from "node:http";
    const mock = createServer((req, res) => {
      if (req.url?.includes("/rest/v1/questions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: 1 }]));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
    });
    await new Promise((r) => mock.listen(0, "127.0.0.1", r));
    process.env.SUPABASE_URL = "http://127.0.0.1:" + mock.address().port;
    const { default: app } = await import(${JSON.stringify(`file://${SERVER_PATH}`)});
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const res = await fetch("http://127.0.0.1:" + server.address().port + "/health");
    console.log(JSON.stringify({ status: res.status, body: await res.json() }));
    server.close();
    mock.close();
    process.exit(0);
  `;
  const result = spawnSync(
    "node",
    ["--input-type=module", "-e", script],
    { cwd: nonGitDir, env, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, `subprocess failed: ${result.stderr}`);
  const { status, body } = JSON.parse(result.stdout.trim());
  assert.equal(status, 200);
  assert.equal(body.status, "ready");
  assert.equal(body.version, "unknown");
});
