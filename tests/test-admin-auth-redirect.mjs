// tests/test-admin-auth-redirect.mjs
// Lock-in perilaku auth redirect di requireAdmin (src/server.js):
//   - GET halaman HTML terproteksi TANPA sesi → 302 redirect ke /login.html
//     (termasuk varian case /BANK-SOAL.HTML — R19 fix, /Bank-soal.html tidak
//     boleh bypass daftar lowercase)
//   - API terproteksi tanpa sesi → 401 JSON (BUKAN redirect — review fix:
//     fetch mengirim Accept: */*, jangan pakai content negotiation)
//   - OPTIONS preflight → 204 (tidak pernah diblokir)
//   - Setelah login (cookie sesi valid) → halaman HTML terproteksi 200
//
// Keputusan redirect-vs-401 memakai predikat tracking dari
// src/tracked-request.js (single source of truth, dipakai juga oleh
// middleware observability) dengan path lowercase — konsisten dgn aturan
// tracking metrik/trace/access-log.
//
// Strategy (sama dgn tests/test-health.mjs): mock PostgREST (node:http) +
// import server.js ASLI sekali, share app antar test. requireAdmin tanpa sesi
// TIDAK menyentuh DB (short-circuit sebelum query), jadi mock hanya perlu
// menjawab /rest/v1/admins untuk alur login + /rest/v1/questions utk health.
//
// Run: node tests/test-admin-auth-redirect.mjs (atau via `pnpm test`)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "rahasia-uji-123";

let mockDb;
let app;
let server;
let baseUrl;

// Local mock PostgREST: menjawab /rest/v1/questions (health) + /rest/v1/admins
// (login: GET by username → satu row dgn password_hash bcrypt; PATCH last_login_at
// best-effort → 204). Cukup untuk alur auth yang diuji di sini.
function startMockPostgrest(passwordHash) {
  const srv = createServer((req, res) => {
    if (req.url?.includes("/rest/v1/questions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1 }]));
      return;
    }
    if (req.url?.includes("/rest/v1/admins")) {
      if (req.method === "PATCH") {
        // update last_login_at (best-effort, tanpa .select()) → 204 kosong
        res.writeHead(204);
        res.end();
        return;
      }
      // GET by username → OBJEK TUNGGAL (bukan array). postgrest-js `.single()`
      // (v2.110) hanya set header `Accept: application/vnd.pgrst.object+json`
      // — PostgREST asli yang membalas dgn objek; kalau mock membalas array,
      // client TIDAK me-unwrap (isMaybeSingle false) → row jadi array.
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Range": "0-0/*",
      });
      res.end(
        JSON.stringify({
          id: 1,
          username: ADMIN_USERNAME,
          password_hash: passwordHash,
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve(srv)),
  );
}

before(async () => {
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  mockDb = await startMockPostgrest(passwordHash);
  process.env.SUPABASE_KEY = "test-service-role-key-not-used-by-mock";
  process.env.JWT_SECRET = "x".repeat(64);
  process.env.NODE_ENV = "development"; // skip bootstrap seed
  process.env.VERCEL = "1"; // skip app.listen (kita listen sendiri)
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockDb.address().port}`;

  const { default: imported } = await import(`file://${SERVER_PATH}`);
  app = imported;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  mockDb?.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("GET halaman HTML terproteksi tanpa sesi → 302 ke /login.html", async () => {
  const res = await fetch(`${baseUrl}/bank-soal.html`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.match(
    res.headers.get("location") || "",
    /^\/login\.html\?next=%2Fbank-soal\.html$/,
  );
});

test("GET /BANK-SOAL.HTML (uppercase, R19 fix) tanpa sesi → 302, bukan 401", async () => {
  // R19: sebelum fix, /Bank-soal.html bypass daftar lowercase → dapat 401 JSON.
  const res = await fetch(`${baseUrl}/BANK-SOAL.HTML`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.match(
    res.headers.get("location") || "",
    /^\/login\.html\?next=/,
  );
});

test("API terproteksi tanpa sesi → 401 JSON, BUKAN redirect", async () => {
  const res = await fetch(`${baseUrl}/api/fetch-image`, {
    method: "POST",
    redirect: "manual",
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "admin login required" });

  const del = await fetch(`${baseUrl}/api/scoreboard`, {
    method: "DELETE",
    redirect: "manual",
  });
  assert.equal(del.status, 401);
  assert.deepEqual(await del.json(), { error: "admin login required" });
});

test("OPTIONS preflight pada route terproteksi tidak pernah diblokir auth", async () => {
  // Express otomatis menjawab OPTIONS 200 + Allow utk route yang cocok
  // (sebelum requireAdmin sempat jalan) — yang penting: preflight TIDAK
  // dapat 401 JSON dari auth.
  const res = await fetch(`${baseUrl}/api/fetch-image`, { method: "OPTIONS" });
  assert.ok(
    [200, 204].includes(res.status),
    `preflight harus 200 (Express default) atau 204, dapat ${res.status}`,
  );
  assert.notEqual(res.status, 401, "preflight tidak boleh diblokir auth");
});

test("alur lengkap: login → cookie sesi → halaman HTML terproteksi 200", async () => {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true, username: ADMIN_USERNAME });

  // Ekstrak cookie sesi dari Set-Cookie (undici getSetCookie, fallback tunggal).
  const setCookies =
    login.headers.getSetCookie?.() ??
    [login.headers.get("set-cookie")].filter(Boolean);
  const sessionCookie = setCookies[0].split(";")[0]; // "toskd_admin_sess=..."
  assert.ok(sessionCookie.startsWith("toskd_admin_sess="), "cookie sesi diset");

  const page = await fetch(`${baseUrl}/bank-soal.html`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.length > 0, "halaman HTML terproteksi ter-serve");
});
