// tests/test-admin-password-change.mjs
// Regression lock-in untuk fitur ganti kata sandi admin (self-service):
//   POST /api/admin/change-password (requireAdmin)
//     - 401 tanpa sesi / token invalid/expired (HS256 pin)
//     - OPTIONS preflight tidak diblokir (200/204)
//     - 400 body invalid (missing/non-string/too long/min 8 karakter)
//     - 400 current password salah (hash tidak berubah)
//     - 400 new == current (R4-Q1, hash tidak berubah)
//     - 200 { ok: true } + hash bcrypt ter-update
//     - 404 admin row hilang (TRUNCATE) walau sesi valid
//     - 500 DB error saat UPDATE (mock forced-failure)
//     - Sesi stateless tetap valid setelah change (R2-Q1): /api/admin/me 200
//     - Edge multi-tab: perubahan berurutan (current stale → 400), password
//       baru jadi current berikutnya, dua sesi independen tetap valid
//     - Login flow end-to-end: login lama → change → login lama gagal →
//       login baru sukses
//
// Strategy: sama seperti test-scoreboard-delete.mjs — local stateful mock
// PostgREST (plain node:http) via SUPABASE_URL, lalu REAL src/server.js
// di-import ONCE dan di-exercise via HTTP. Mock bersifat MUTATIF pada
// password_hash (perubahan dari satu request terlihat oleh request berikutnya)
// dan menyediakan flag forced-failure utk PATCH admins (test DB-down).
//
// Run: node tests/test-admin-password-change.mjs (atau via `pnpm test`)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "rahasia-uji-123";
const NEW_PASSWORD = "rahasia-uji-456";
const NEW_PASSWORD_2 = "rahasia-uji-789";

let fixture;
let app;
let server;
let baseUrl;

// Local stateful mock PostgREST: melayani tabel admins.
//   GET   /rest/v1/admins  (filter eq.id / eq.username; single via Accept
//                           pgrst.object; count untuk auto-bootstrap dev)
//   PATCH /rest/v1/admins  (update password_hash / last_login_at; flag
//                           forced-failure → 500 utk test DB-down)
function startMockPostgrest(initialPasswordHash) {
  const admins = [
    { id: 1, username: ADMIN_USERNAME, password_hash: initialPasswordHash },
  ];
  let failUpdate = false;

  function eqFilter(params, name) {
    const v = params.get(name);
    if (!v || !v.startsWith("eq.")) return null;
    const raw = decodeURIComponent(v.slice(3));
    const num = Number(raw);
    return Number.isFinite(num) && raw.trim() !== "" ? num : raw;
  }

  const srv = createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock");
    const params = url.searchParams;
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readBody = () =>
      new Promise((resolve) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            resolve(JSON.parse(body || "{}"));
          } catch {
            resolve({});
          }
        });
      });

    // --- auto-bootstrap dev count check (server.js maybeBootstrapAdmin) ---
    // `select("*", { count: "exact", head: true })` → HEAD + Prefer: count=exact.
    // Balas Content-Range 0-0/1 → count=1 → bootstrap skip (table tidak kosong).
    if (
      req.url?.includes("/rest/v1/admins") &&
      (req.method === "HEAD" ||
        (req.headers.prefer || "").includes("count=exact"))
    ) {
      res.writeHead(200, { "Content-Range": "0-0/1" });
      res.end();
      return;
    }

    // --- GET /rest/v1/admins (change-password by id; login by username) ---
    if (req.method === "GET" && url.pathname === "/rest/v1/admins") {
      const id = eqFilter(params, "id");
      const username = eqFilter(params, "username");
      let rows = admins.filter(
        (a) =>
          (id == null || a.id === id) &&
          (username == null || a.username === username),
      );
      const wantObject = (req.headers.accept || "").includes(
        "application/vnd.pgrst.object",
      );
      if (wantObject) {
        if (rows.length === 0) return json(406, { message: "Not Found" });
        return json(200, rows[0]);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Range": `0-${rows.length - 1}/${rows.length}`,
      });
      res.end(JSON.stringify(rows));
      return;
    }

    // --- PATCH /rest/v1/admins (change-password update + last_login_at) ---
    if (req.method === "PATCH" && url.pathname === "/rest/v1/admins") {
      if (failUpdate) {
        return json(500, { message: "db down" });
      }
      const id = eqFilter(params, "id");
      const body = await readBody();
      const admin = admins.find((a) => id == null || a.id === id);
      if (!admin) return json(404, { message: "Not Found" });
      if (typeof body.password_hash === "string") {
        admin.password_hash = body.password_hash;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    json(404, { message: "not found: " + req.method + " " + url.pathname });
  });

  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        srv,
        admins,
        setFailUpdate: (v) => {
          failUpdate = v;
        },
      }),
    ),
  );
}

before(async () => {
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  fixture = await startMockPostgrest(passwordHash);
  process.env.SUPABASE_KEY = "test-service-role-key-not-used-by-mock";
  process.env.JWT_SECRET = "x".repeat(64);
  process.env.NODE_ENV = "development"; // skip bootstrap seed
  process.env.VERCEL = "1"; // skip app.listen in server.js (we listen ourselves)
  process.env.SUPABASE_URL = `http://127.0.0.1:${fixture.srv.address().port}`;

  const { default: imported } = await import(`file://${SERVER_PATH}`);
  app = imported;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fixture?.srv.close();
});

// Reset password_hash di mock LANGSUNG (bypass endpoint) supaya tiap test
// order-independent — state awal selalu diketahui.
function setAdminPassword(pw) {
  fixture.admins[0].password_hash = bcrypt.hashSync(pw, 10);
}

function makeCookie(payload = { adminId: 1, username: ADMIN_USERNAME }) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
  return `toskd_admin_sess=${token}`;
}

function adminCookie() {
  return makeCookie();
}

async function post(path, body, { cookie } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function login(password) {
  return post("/api/admin/login", { username: ADMIN_USERNAME, password });
}

// ============================================================================
// Auth gate + preflight
// ============================================================================

test("POST /api/admin/change-password tanpa sesi → 401 { admin login required }", async () => {
  const res = await post("/api/admin/change-password", {
    current_password: ADMIN_PASSWORD,
    new_password: NEW_PASSWORD,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "admin login required" });
});

test("OPTIONS preflight tidak diblokir auth (200 Express default / 204)", async () => {
  const res = await fetch(`${baseUrl}/api/admin/change-password`, {
    method: "OPTIONS",
  });
  assert.ok(
    [200, 204].includes(res.status),
    `preflight harus 200/204, dapat ${res.status}`,
  );
  assert.notEqual(res.status, 401, "preflight tidak boleh diblokir auth");
});

test("sesi kedaluwarsa / token invalid saat submit → 401 (HS256 pin)", async () => {
  const expired = jwt.sign(
    { adminId: 1, username: ADMIN_USERNAME },
    process.env.JWT_SECRET,
    { expiresIn: "-1h" },
  );
  const resExpired = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: `toskd_admin_sess=${expired}` },
  );
  assert.equal(resExpired.status, 401);

  const wrongSecret = jwt.sign(
    { adminId: 1, username: ADMIN_USERNAME },
    "another-secret-that-is-long-enough-1234567890",
    { expiresIn: "1h" },
  );
  const resWrongSecret = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: `toskd_admin_sess=${wrongSecret}` },
  );
  assert.equal(resWrongSecret.status, 401);
  assert.deepEqual(await resWrongSecret.json(), {
    error: "admin login required",
  });
});

// ============================================================================
// Validasi input (400)
// ============================================================================

test("body invalid → 400 (missing field / non-string / > 1000 chars)", async () => {
  const cases = [
    {},
    { current_password: "x" },
    { new_password: "y" },
    { current_password: 12345, new_password: NEW_PASSWORD }, // non-string
    { current_password: ADMIN_PASSWORD, new_password: 67890 }, // non-string
    { current_password: "x".repeat(1001), new_password: NEW_PASSWORD }, // current > 1000
    { current_password: ADMIN_PASSWORD, new_password: "x".repeat(1001) }, // new > 1000
  ];
  for (const body of cases) {
    const res = await post("/api/admin/change-password", body, {
      cookie: adminCookie(),
    });
    assert.equal(res.status, 400, `harus 400: ${JSON.stringify(body).slice(0, 50)}`);
    const data = await res.json();
    assert.ok(typeof data.error === "string" && data.error.length > 0);
  }
});

test("new_password < 8 karakter → 400 + hash tidak berubah", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const before = fixture.admins[0].password_hash;
  const res = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: "short" },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 400);
  assert.equal(fixture.admins[0].password_hash, before);
});

test("current password salah → 400 + hash tidak berubah", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const before = fixture.admins[0].password_hash;
  const res = await post(
    "/api/admin/change-password",
    { current_password: "salah-salah", new_password: NEW_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "current password incorrect");
  assert.equal(fixture.admins[0].password_hash, before);
});

test("new == current → 400 + hash tidak berubah (keputusan R4-Q1)", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const before = fixture.admins[0].password_hash;
  const res = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: ADMIN_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 400);
  assert.equal(
    (await res.json()).error,
    "new password must be different from the current password",
  );
  assert.equal(fixture.admins[0].password_hash, before);
});

// ============================================================================
// Happy path + state
// ============================================================================

test("valid → 200 { ok: true } + hash bcrypt ter-update", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const res = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const newHash = fixture.admins[0].password_hash;
  assert.ok(bcrypt.compareSync(NEW_PASSWORD, newHash), "hash cocok dgn password baru");
  assert.ok(!bcrypt.compareSync(ADMIN_PASSWORD, newHash), "hash bukan password lama");
});

test("sesi tetap valid setelah change (R2-Q1) → /api/admin/me 200", async () => {
  // State mock saat ini sudah NEW_PASSWORD (test sebelumnya) — sesi JWT
  // stateless TIDAK disentuh oleh change-password.
  const res = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { Cookie: adminCookie() },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { username: ADMIN_USERNAME });
});

test("row admin tidak ada (TRUNCATE) walau sesi valid → 404 { admin not found }", async () => {
  const ghostCookie = makeCookie({ adminId: 999, username: "ghost" });
  const res = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: ghostCookie },
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "admin not found");
});

// ============================================================================
// Edge case multi-tab (mock mutatif) — spec §6 test 12-14
// ============================================================================

test("multi-tab: perubahan berurutan — current stale (password lama) → 400, hash tetap yang terbaru", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  // Tab A: A→B sukses.
  const first = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(first.status, 200);
  // Tab B (halaman lama, masih pakai password lama sebagai current) → 400.
  const stale = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD_2 },
    { cookie: adminCookie() },
  );
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).error, "current password incorrect");
  // Hash tetap B (bukan A, bukan C).
  assert.ok(bcrypt.compareSync(NEW_PASSWORD, fixture.admins[0].password_hash));
});

test("multi-tab: password baru menjadi current berikutnya → change lanjutan 200", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const first = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(first.status, 200);
  // Tab yang sudah refresh: current = B → ganti ke C.
  const second = await post(
    "/api/admin/change-password",
    { current_password: NEW_PASSWORD, new_password: NEW_PASSWORD_2 },
    { cookie: adminCookie() },
  );
  assert.equal(second.status, 200);
  assert.ok(bcrypt.compareSync(NEW_PASSWORD_2, fixture.admins[0].password_hash));
});

test("dua sesi independen tetap valid setelah change (R2-Q1, tanpa invalidasi)", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const cookie1 = adminCookie();
  const cookie2 = makeCookie({ adminId: 1, username: ADMIN_USERNAME });
  const change = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: cookie1 },
  );
  assert.equal(change.status, 200);
  // Cookie #2 (tab lain) tidak di-invalidasi.
  const me = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { Cookie: cookie2 },
  });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { username: ADMIN_USERNAME });
});

// ============================================================================
// DB error mid-submit (mock forced-failure) — spec §6 test 16
// ============================================================================

test("DB error saat UPDATE → 500 { change password failed } + hash tidak berubah", async () => {
  setAdminPassword(ADMIN_PASSWORD);
  const before = fixture.admins[0].password_hash;
  fixture.setFailUpdate(true);
  try {
    const res = await post(
      "/api/admin/change-password",
      { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
      { cookie: adminCookie() },
    );
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "change password failed");
  } finally {
    fixture.setFailUpdate(false);
  }
  assert.equal(fixture.admins[0].password_hash, before);
});

// ============================================================================
// Login flow end-to-end — spec §6 test 10
// ============================================================================

test("alur end-to-end: login lama → change → login lama gagal → login baru sukses", async () => {
  setAdminPassword(ADMIN_PASSWORD);

  const loginOld = await login(ADMIN_PASSWORD);
  assert.equal(loginOld.status, 200);

  const change = await post(
    "/api/admin/change-password",
    { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    { cookie: adminCookie() },
  );
  assert.equal(change.status, 200);

  const loginOldAgain = await login(ADMIN_PASSWORD);
  assert.equal(loginOldAgain.status, 401);
  assert.equal((await loginOldAgain.json()).error, "invalid credentials");

  const loginNew = await login(NEW_PASSWORD);
  assert.equal(loginNew.status, 200);
  const body = await loginNew.json();
  assert.equal(body.ok, true);
  assert.equal(body.username, ADMIN_USERNAME);
});
