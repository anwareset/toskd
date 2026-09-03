// tests/test-pack-visibility.mjs
// Regression lock-in for the pack VISIBILITY feature (2026-08-15):
//   - GET /api/packs           : non-admin → hanya pack 'public' (+ legacy
//                                fallback); admin → semua termasuk 'archived'.
//   - GET /api/packs/:id       : non-admin → 403 utk 'admin'/'archived'.
//   - GET /api/packs/:id/questions : non-admin → 403 utk 'admin'/'archived'
//                                (satu-satunya jalur isi soal).
//   - POST /api/exam/start     : 'archived' → 403 utk SEMUA (termasuk admin);
//                                'admin' → 403 utk non-admin.
//   - POST /api/exam/submit    : gate yang sama (defense-in-depth, SEBELUM
//                                duplicate-check).
//   - GET /api/scoreboard + /scoreboard-all : non-admin diblokir utk pack
//                                'admin'/'archived' (403); scoreboard-all
//                                tanpa pack_id menyembunyikan hasil pack
//                                non-public utk non-admin.
//   - POST/PUT /api/packs      : visibility divalidasi server
//                                (invalid → 400; POST default 'public';
//                                PUT partial tidak menimpa).
//
// Strategy: sama seperti test-pack-question-order.mjs / test-health.mjs —
// local stateful mock PostgREST (plain node:http) pointed at via
// SUPABASE_URL, lalu REAL src/server.js di-import ONCE dan di-exercise via
// HTTP. Admin disimulasikan via cookie toskd_admin_sess ber-JWT valid
// (jsonwebtoken dari deps project, secret yang sama dgn server).
//
// Run: node tests/test-pack-visibility.mjs (atau via `pnpm test`)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");

// ---------------------------------------------------------------------------
// Stateful mock PostgREST — mendukung query yang dipakai endpoint terkait
// visibility:
//   GET  /rest/v1/question_packs  (list / single via Accept object; select
//                                  diabaikan — full row memenuhi semua konsumen)
//   POST /rest/v1/question_packs  (insert → [row])
//   PATCH /rest/v1/question_packs (update by id → [row])
//   GET  /rest/v1/exam_results    (filters pack_id/participant_name + order
//                                  + limit + embed question_packs(name))
//   POST /rest/v1/exam_results    (insert → [row])
//   GET  /rest/v1/pack_questions  (embed questions(*) — utk submit scoring)
// ---------------------------------------------------------------------------
function startMockPostgrest() {
  const questionPacks = [
    {
      id: 1, name: "Paket Publik", duration_minutes: 60, passing_grade: 65,
      visibility: "public", subtests: ["TWK"], subtest_thresholds: { TWK: 65 },
      created_at: "2026-08-15T00:00:00.000Z",
    },
    {
      id: 2, name: "Paket Admin", duration_minutes: 60, passing_grade: 65,
      visibility: "admin", subtests: ["TWK"], subtest_thresholds: { TWK: 65 },
      created_at: "2026-08-15T01:00:00.000Z",
    },
    {
      id: 3, name: "Paket Arsip", duration_minutes: 60, passing_grade: 65,
      visibility: "archived", subtests: ["TWK"], subtest_thresholds: { TWK: 65 },
      created_at: "2026-08-15T02:00:00.000Z",
    },
    {
      // Legacy row TANPA kolom visibility (simulasi sebelum migration-007)
      // → harus di-fallback sebagai 'public' di server maupun client.
      id: 4, name: "Paket Legacy", duration_minutes: 60, passing_grade: 65,
      subtests: ["TWK"], subtest_thresholds: { TWK: 65 },
      created_at: "2026-08-15T03:00:00.000Z",
    },
  ];
  let nextPackId = 5;

  const examResults = [
    { id: 11, pack_id: 1, participant_name: "Peserta Publik", score: 80, status: "Lulus PG", answers: {}, created_at: "2026-08-15T04:00:00.000Z" },
    { id: 12, pack_id: 2, participant_name: "Peserta Admin", score: 90, status: "Lulus PG", answers: {}, created_at: "2026-08-15T05:00:00.000Z" },
    { id: 13, pack_id: 3, participant_name: "Peserta Arsip", score: 70, status: "Tidak Lulus PG", answers: {}, created_at: "2026-08-15T06:00:00.000Z" },
  ];
  let nextResultId = 20;

  // Fixture minimal utk submit scoring (public pack 1 → soal TWK 101).
  const questions = [
    {
      id: 101, question_type: "TWK", correct_answer: "A",
      options: { A: "opsi A" }, explanation: "penjelasan", option_scores: null,
    },
  ];
  const packQuestions = [
    { id: 1, pack_id: 1, question_id: 101, question_number: 1 },
  ];

  // Parse PostgREST equality filter: `pack_id=eq.1` → 1, `participant_name=eq.X` → "X".
  function eqFilter(params, name) {
    const v = params.get(name);
    if (!v || !v.startsWith("eq.")) return null;
    const raw = decodeURIComponent(v.slice(3));
    const num = Number(raw);
    return Number.isFinite(num) && raw.trim() !== "" ? num : raw;
  }

  // Apply `order=col.desc,col2.asc` (default asc).
  function applyOrder(rows, orderParam) {
    if (!orderParam) return rows;
    const keys = orderParam.split(",").map((part) => {
      const [col, dir] = part.split(".");
      return { col, asc: dir !== "desc" };
    });
    return rows.slice().sort((a, b) => {
      for (const { col, asc } of keys) {
        const av = a[col] ?? 0;
        const bv = b[col] ?? 0;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
      }
      return 0;
    });
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
        req.on("end", () => resolve(JSON.parse(body || "{}")));
      });

    // --- GET /rest/v1/question_packs (list / single) ---
    if (req.method === "GET" && url.pathname === "/rest/v1/question_packs") {
      const id = eqFilter(params, "id");
      let rows = questionPacks.filter((p) => id == null || p.id === id);
      rows = applyOrder(rows, params.get("order"));
      const wantObject = (req.headers.accept || "").includes(
        "application/vnd.pgrst.object",
      );
      if (wantObject) {
        if (rows.length === 0) return json(406, { message: "Not Found" });
        return json(200, rows[0]);
      }
      return json(200, rows);
    }

    // --- POST /rest/v1/question_packs (insert) ---
    if (req.method === "POST" && url.pathname === "/rest/v1/question_packs") {
      const row = await readBody();
      const full = { id: nextPackId++, ...row };
      questionPacks.push(full);
      return json(201, [full]);
    }

    // --- PATCH /rest/v1/question_packs?id=eq.N (update) ---
    if (req.method === "PATCH" && url.pathname === "/rest/v1/question_packs") {
      const id = eqFilter(params, "id");
      const patch = await readBody();
      const row = questionPacks.find((p) => p.id === id);
      if (!row) return json(404, { message: "Not Found" });
      Object.assign(row, patch);
      return json(200, [row]);
    }

    // --- GET /rest/v1/exam_results ---
    if (req.method === "GET" && url.pathname === "/rest/v1/exam_results") {
      const packId = eqFilter(params, "pack_id");
      const pName = eqFilter(params, "participant_name");
      const select = params.get("select") || "*";
      let rows = examResults.filter(
        (r) =>
          (packId == null || r.pack_id === packId) &&
          (pName == null || r.participant_name === pName),
      );
      rows = applyOrder(rows, params.get("order"));
      const limitParam = params.get("limit");
      if (limitParam !== null) {
        const limit = Number(limitParam);
        if (Number.isFinite(limit) && limit >= 0) rows = rows.slice(0, limit);
      }
      const embed = select.includes("question_packs(");
      const out = rows.map((r) => {
        const row = { ...r };
        if (embed) {
          const pack = questionPacks.find((p) => p.id === r.pack_id);
          row.question_packs = pack ? { name: pack.name } : null;
        }
        return row;
      });
      return json(200, out);
    }

    // --- POST /rest/v1/exam_results (exam start/submit) ---
    if (req.method === "POST" && url.pathname === "/rest/v1/exam_results") {
      const row = await readBody();
      const full = { id: nextResultId++, ...row, pack_id: Number(row.pack_id) };
      examResults.push(full);
      return json(201, [full]);
    }

    // --- GET /rest/v1/pack_questions (embed questions(*) — submit scoring) ---
    if (req.method === "GET" && url.pathname === "/rest/v1/pack_questions") {
      const packId = eqFilter(params, "pack_id");
      const select = params.get("select") || "*";
      let rows = packQuestions.filter(
        (r) => packId == null || r.pack_id === packId,
      );
      rows = applyOrder(rows, params.get("order"));
      const embed = select.includes("questions(");
      const out = rows.map((r) => {
        const row = { ...r };
        if (embed) {
          row.questions = questions.find((q) => q.id === r.question_id) || null;
        }
        return row;
      });
      return json(200, out);
    }

    json(404, { message: "not found: " + req.method + " " + url.pathname });
  });

  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ srv })),
  );
}

let fixture;
let app;
let server;
let baseUrl;

before(async () => {
  fixture = await startMockPostgrest();
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

// Cookie admin valid (JWT toskd_admin_sess — secret sama dgn server).
function adminCookie() {
  const token = jwt.sign(
    { adminId: 1, username: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  return `toskd_admin_sess=${token}`;
}

async function api(path, { cookie } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return res;
}

async function post(path, body, { cookie } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return res;
}

// ============================================================================
// GET /api/packs — list filtering
// ============================================================================

test("GET /api/packs anon → hanya pack public (+ legacy fallback)", async () => {
  const res = await api("/api/packs");
  assert.equal(res.status, 200);
  const packs = await res.json();
  assert.deepEqual(
    packs.map((p) => p.id).sort((a, b) => a - b),
    [1, 4],
    "anon hanya boleh melihat pack visibility=public (1) + legacy tanpa kolom (4)",
  );
});

test("GET /api/packs admin → semua pack termasuk archived", async () => {
  const res = await api("/api/packs", { cookie: adminCookie() });
  assert.equal(res.status, 200);
  const packs = await res.json();
  assert.deepEqual(
    packs.map((p) => p.id).sort((a, b) => a - b),
    [1, 2, 3, 4],
    "admin melihat SEMUA pack (public, admin, archived, legacy) utk CMS",
  );
});

// ============================================================================
// GET /api/packs/:id — single pack gate
// ============================================================================

test("GET /api/packs/:id anon → 403 utk admin & archived, 200 utk public/legacy", async () => {
  for (const id of [2, 3]) {
    const res = await api(`/api/packs/${id}`);
    assert.equal(res.status, 403, `pack ${id} harus 403 utk anon`);
  }
  for (const id of [1, 4]) {
    const res = await api(`/api/packs/${id}`);
    assert.equal(res.status, 200, `pack ${id} harus 200 utk anon`);
    const pack = await res.json();
    assert.equal(pack.id, id);
  }
});

test("GET /api/packs/:id admin → 200 untuk semua termasuk archived", async () => {
  for (const id of [1, 2, 3]) {
    const res = await api(`/api/packs/${id}`, { cookie: adminCookie() });
    assert.equal(res.status, 200, `pack ${id} harus 200 utk admin`);
  }
});

// ============================================================================
// GET /api/packs/:id/questions — isi soal gate
// ============================================================================

test("GET /api/packs/:id/questions anon → 403 utk admin & archived, 200 utk public", async () => {
  for (const id of [2, 3]) {
    const res = await api(`/api/packs/${id}/questions`);
    assert.equal(res.status, 403, `questions pack ${id} harus 403 utk anon`);
  }
  const res = await api("/api/packs/1/questions");
  assert.equal(res.status, 200);
});

// ============================================================================
// POST /api/exam/start — "tak bisa dikerjakan"
// ============================================================================

test("exam/start archived → 403 utk SEMUA (termasuk admin)", async () => {
  const body = { pack_id: 3, participant_name: "Siapa Saja" };
  const anon = await post("/api/exam/start", body);
  assert.equal(anon.status, 403, "anon harus 403 utk archived");
  const admin = await post("/api/exam/start", body, { cookie: adminCookie() });
  assert.equal(admin.status, 403, "ADMIN juga harus 403 utk archived (AC4/T4)");
});

test("exam/start admin-pack → 403 utk non-admin, 201 utk admin", async () => {
  const body = { pack_id: 2, participant_name: "Orang Biasa" };
  const anon = await post("/api/exam/start", body);
  assert.equal(anon.status, 403);
  const admin = await post("/api/exam/start", body, { cookie: adminCookie() });
  assert.equal(admin.status, 201, `admin start gagal: ${await admin.text()}`);
});

test("exam/start public-pack → 201 utk non-admin", async () => {
  const res = await post("/api/exam/start", {
    pack_id: 1,
    participant_name: "Orang Publik",
  });
  assert.equal(res.status, 201, `public start gagal: ${await res.text()}`);
});

test("exam/start pack tak dikenal → 404", async () => {
  const res = await post("/api/exam/start", {
    pack_id: 999,
    participant_name: "X",
  });
  assert.equal(res.status, 404);
});

// ============================================================================
// POST /api/exam/submit — defense-in-depth gate
// ============================================================================

test("exam/submit admin-pack anon → 403 (gate SEBELUM duplicate-check)", async () => {
  const res = await post("/api/exam/submit", {
    pack_id: 2,
    participant_name: "Orang Biasa",
    answers: {},
  });
  assert.equal(res.status, 403);
});

test("exam/submit archived-pack anon → 403", async () => {
  const res = await post("/api/exam/submit", {
    pack_id: 3,
    participant_name: "Orang Biasa",
    answers: {},
  });
  assert.equal(res.status, 403);
});

test("exam/submit public-pack anon → 201 (alur publik tetap jalan)", async () => {
  const res = await post("/api/exam/submit", {
    pack_id: 1,
    participant_name: "Orang Baru",
    answers: { 101: "A" },
  });
  assert.equal(res.status, 201, `public submit gagal: ${await res.text()}`);
});

// ============================================================================
// GET /api/scoreboard + /api/scoreboard-all
// ============================================================================

test("scoreboard pack_id admin/archived anon → 403; public → 200", async () => {
  for (const id of [2, 3]) {
    const res = await api(`/api/scoreboard?pack_id=${id}`);
    assert.equal(res.status, 403, `scoreboard pack ${id} harus 403 utk anon`);
  }
  const res = await api("/api/scoreboard?pack_id=1");
  assert.equal(res.status, 200);
});

test("scoreboard-all anon → hanya hasil pack public", async () => {
  // Catatan: test exam/start+submit sebelumnya sudah meng-insert beberapa
  // exam_results baru (pack 1 dan 2) ke mock — jadi assert struktural:
  // SEMUA baris yang terlihat anon harus berasal dari pack 1 (public),
  // dan baris pack admin (12) / archived (13) TIDAK boleh muncul.
  const res = await api("/api/scoreboard-all");
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length >= 1, "setidaknya hasil pack public tampil");
  assert.ok(
    rows.every((r) => r.pack_id === 1),
    "anon tidak boleh melihat hasil pack admin/archived: " + JSON.stringify(rows),
  );
});

test("scoreboard-all admin → semua hasil (public + admin + archived)", async () => {
  const res = await api("/api/scoreboard-all", { cookie: adminCookie() });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length >= 3, "admin melihat semua hasil yang ada");
  assert.ok(
    rows.every((r) => [1, 2, 3].includes(r.pack_id)),
    "semua hasil berasal dari pack yang dikenal",
  );
  assert.ok(
    rows.some((r) => r.id === 12) && rows.some((r) => r.id === 13),
    "hasil pack admin (12) & archived (13) terlihat utk admin",
  );
});

// ============================================================================
// POST/PUT /api/packs — validasi visibility server-side
// ============================================================================

test("POST /api/packs visibility invalid → 400", async () => {
  const res = await post("/api/packs", {
    name: "Pack Invalid",
    duration_minutes: 30,
    passing_grade: 65,
    visibility: "bogus",
  });
  assert.equal(res.status, 400);
});

test("POST /api/packs tanpa visibility → default 'public'", async () => {
  const res = await post("/api/packs", {
    name: "Pack Default",
    duration_minutes: 30,
    passing_grade: 65,
  });
  const text = await res.text();
  assert.equal(res.status, 201, `create gagal: ${text}`);
  const [pack] = JSON.parse(text);
  assert.equal(pack.visibility, "public");
});

test("POST /api/packs dgn visibility 'admin' → tersimpan", async () => {
  const res = await post("/api/packs", {
    name: "Pack Admin Baru",
    duration_minutes: 30,
    passing_grade: 65,
    visibility: "admin",
  });
  const text = await res.text();
  assert.equal(res.status, 201, `create gagal: ${text}`);
  const [pack] = JSON.parse(text);
  assert.equal(pack.visibility, "admin");
});

test("PUT /api/packs/:id tanpa visibility → nilai existing TIDAK tertimpa", async () => {
  // Pack 2 awalnya 'admin'. PUT partial (hanya ganti nama) tidak boleh
  // me-reset visibility ke 'public'.
  const res = await fetch(`${baseUrl}/api/packs/2`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Paket Admin Renamed" }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `put gagal: ${text}`);
  const pack = JSON.parse(text);
  assert.equal(pack.name, "Paket Admin Renamed");
  assert.equal(pack.visibility, "admin", "visibility existing harus dipertahankan");
});

test("PUT /api/packs/:id dgn visibility → di-update (un-arsip flow)", async () => {
  // Pack 3 awalnya 'archived' → admin un-arsip ke 'public' (AC5/T8).
  const res = await fetch(`${baseUrl}/api/packs/3`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility: "public" }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `put gagal: ${text}`);
  const pack = JSON.parse(text);
  assert.equal(pack.visibility, "public");
});
