// tests/test-scoreboard-delete.mjs
// Regression lock-in (2026-08-19) untuk tiga fitur:
//   1. Validasi nama peserta (alfabet + spasi, tanpa spasi di awal, maks 100):
//      POST /api/exam/start & /api/exam/submit → 400 utk nama invalid.
//   2. Cleanup row "In Progress" saat duplicate-submit 409: client mengirim
//      result_id (dari /api/exam/start) → server menghapus PERSIS row
//      percobaan tsb (filter status='In Progress') TANPA menyentuh hasil lama.
//   3. Hapus scoreboard per-row: DELETE /api/scoreboard/:id (single) +
//      POST /api/scoreboard/bulk-delete { ids } — keduanya requireAdmin.
//
// Strategy: sama seperti test-pack-visibility.mjs — local stateful mock
// PostgREST (plain node:http) via SUPABASE_URL, lalu REAL src/server.js
// di-import ONCE dan di-exercise via HTTP. Admin = cookie toskd_admin_sess
// ber-JWT valid (jsonwebtoken, secret sama dgn server).
//
// Run: node tests/test-scoreboard-delete.mjs (atau via `pnpm test`)

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
// Stateful mock PostgREST — mendukung query yang dipakai endpoint terkait:
//   GET    /rest/v1/question_packs  (visibility gate start/submit; single)
//   GET    /rest/v1/exam_results    (filters id/pack_id/participant_name/
//                                    status + order + limit + embed packs)
//   POST   /rest/v1/exam_results    (exam start/submit insert)
//   DELETE /rest/v1/exam_results    (cleanup 409, delete single/bulk)
//   GET    /rest/v1/pack_questions  (embed questions(*) — submit scoring)
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
  ];

  const examResults = [
    { id: 11, pack_id: 1, participant_name: "Peserta Publik", score: 80, status: "Lulus PG", answers: {}, created_at: "2026-08-15T04:00:00.000Z" },
    { id: 12, pack_id: 2, participant_name: "Peserta Admin", score: 90, status: "Lulus PG", answers: {}, created_at: "2026-08-15T05:00:00.000Z" },
    { id: 13, pack_id: 3, participant_name: "Peserta Arsip", score: 70, status: "Tidak Lulus PG", answers: {}, created_at: "2026-08-15T06:00:00.000Z" },
    // Hasil LAMA yang sudah selesai — dipakai test 409-cleanup: row ini
    // TIDAK boleh terhapus oleh cleanup percobaan yang ditolak.
    { id: 14, pack_id: 1, participant_name: "Budi Santoso", score: 75, status: "Lulus PG", answers: {}, created_at: "2026-08-15T07:00:00.000Z" },
  ];
  let nextResultId = 20;

  const questions = [
    {
      id: 101, question_type: "TWK", correct_answer: "A",
      options: { A: "opsi A" }, explanation: "penjelasan", option_scores: null,
    },
  ];
  const packQuestions = [
    { id: 1, pack_id: 1, question_id: 101, question_number: 1 },
  ];

  function eqFilter(params, name) {
    const v = params.get(name);
    if (!v || !v.startsWith("eq.")) return null;
    const raw = decodeURIComponent(v.slice(3));
    const num = Number(raw);
    return Number.isFinite(num) && raw.trim() !== "" ? num : raw;
  }

  function inFilter(params, name) {
    const v = params.get(name);
    if (!v || !v.startsWith("in.")) return null;
    // Format PostgREST: in.(11,13) — setelah "in.", buka kurung pembungkus.
    let inner = v.slice(3);
    if (inner.startsWith("(") && inner.endsWith(")")) {
      inner = inner.slice(1, -1);
    }
    return inner.split(",").map((s) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    });
  }

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

    // --- GET /rest/v1/question_packs (visibility gate; single via Accept) ---
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

    // --- GET /rest/v1/exam_results ---
    if (req.method === "GET" && url.pathname === "/rest/v1/exam_results") {
      const id = eqFilter(params, "id");
      const packId = eqFilter(params, "pack_id");
      const pName = eqFilter(params, "participant_name");
      const status = eqFilter(params, "status");
      const select = params.get("select") || "*";
      let rows = examResults.filter(
        (r) =>
          (id == null || r.id === id) &&
          (packId == null || r.pack_id === packId) &&
          (pName == null || r.participant_name === pName) &&
          (status == null || r.status === status),
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

    // --- POST /rest/v1/exam_results (exam start/submit insert) ---
    if (req.method === "POST" && url.pathname === "/rest/v1/exam_results") {
      const row = await readBody();
      const full = { id: nextResultId++, ...row, pack_id: Number(row.pack_id) };
      examResults.push(full);
      return json(201, [full]);
    }

    // --- DELETE /rest/v1/exam_results (cleanup 409 + delete single/bulk) ---
    if (req.method === "DELETE" && url.pathname === "/rest/v1/exam_results") {
      const id = eqFilter(params, "id");
      const packId = eqFilter(params, "pack_id");
      const pName = eqFilter(params, "participant_name");
      const status = eqFilter(params, "status");
      const inIds = inFilter(params, "id");
      const removed = [];
      for (let i = examResults.length - 1; i >= 0; i--) {
        const r = examResults[i];
        let match = true;
        if (id != null && r.id !== id) match = false;
        if (packId != null && r.pack_id !== packId) match = false;
        if (pName != null && r.participant_name !== pName) match = false;
        if (status != null && r.status !== status) match = false;
        if (inIds && !inIds.includes(r.id)) match = false;
        if (match) removed.push(examResults.splice(i, 1)[0]);
      }
      removed.reverse();
      return json(200, removed);
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
    srv.listen(0, "127.0.0.1", () => resolve({ srv, examResults })),
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

function adminCookie() {
  const token = jwt.sign(
    { adminId: 1, username: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  return `toskd_admin_sess=${token}`;
}

async function api(path, { cookie } = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
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

async function del(path, { cookie } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

// Helper: ambil semua baris exam_results di mock via /api/scoreboard-all
// (admin) → cek apakah id ada/tidak ada di state.
async function rowIdsInMock() {
  const res = await api("/api/scoreboard-all", { cookie: adminCookie() });
  assert.equal(res.status, 200);
  const rows = await res.json();
  return rows.map((r) => r.id);
}

// ============================================================================
// 1. Validasi nama peserta — POST /api/exam/start
// ============================================================================

test("exam/start nama invalid → 400 (spasi awal, angka, hyphen, kosong, terlalu panjang)", async () => {
  const badNames = [
    " budi",                       // diawali spasi
    "pr4b0w0 5u814nt0",            // angka
    "Nur-Aini",                    // hyphen (ketat: alfabet + spasi saja)
    "M. Prabowo",                  // titik
    "   ",                         // whitespace-only
    "A".repeat(101),               // terlalu panjang (> 100)
  ];
  for (const name of badNames) {
    const res = await post("/api/exam/start", {
      pack_id: 1,
      participant_name: name,
    });
    assert.equal(res.status, 400, `nama "${name.slice(0, 20)}" harus 400`);
    const body = await res.json();
    assert.ok(typeof body.error === "string" && body.error.length > 0);
  }
});

test("exam/start nama valid → 201 dan nama disimpan sudah di-trim", async () => {
  const res = await post("/api/exam/start", {
    pack_id: 1,
    participant_name: "Andi Baru",
  });
  assert.equal(res.status, 201);
  // API /api/exam/start mengembalikan data[0] (objek), bukan array.
  const row = await res.json();
  assert.equal(row.participant_name, "Andi Baru");
  assert.equal(row.status, "In Progress");
  assert.ok(fixture.examResults.some((r) => r.id === row.id));
});

// ============================================================================
// 1b. Validasi nama — POST /api/exam/submit
// ============================================================================

test("exam/submit nama invalid → 400", async () => {
  const res = await post("/api/exam/submit", {
    pack_id: 1,
    participant_name: "Budi_123",
    answers: {},
  });
  assert.equal(res.status, 400);
});

// ============================================================================
// 2. Cleanup row In Progress saat 409 (jangan sentuh hasil lama)
// ============================================================================

test("submit duplikat → 409 + row In Progress percobaan dihapus, hasil lama utuh", async () => {
  // Mulai ujian baru dgn nama yang sudah punya hasil selesai (id 14).
  const start = await post("/api/exam/start", {
    pack_id: 1,
    participant_name: "Budi Santoso",
  });
  assert.equal(start.status, 201);
  const inProgressId = (await start.json()).id;
  assert.ok(fixture.examResults.some((r) => r.id === inProgressId && r.status === "In Progress"));

  // Submit percobaan ini dengan result_id → 409 + cleanup row tsb.
  const submit = await post("/api/exam/submit", {
    pack_id: 1,
    participant_name: "Budi Santoso",
    answers: { 101: "A" },
    result_id: inProgressId,
  });
  assert.equal(submit.status, 409, "duplicate submit harus 409");
  const body = await submit.json();
  assert.equal(body.existing_id, 14, "409 menunjuk hasil lama id 14");

  // Row In Progress percobaan dihapus; hasil lama 14 tetap ada.
  const ids = await rowIdsInMock();
  assert.ok(!ids.includes(inProgressId), "row In Progress percobaan harus hilang");
  assert.ok(ids.includes(14), "hasil lama id 14 tidak boleh terhapus");
});

test("409 dgn result_id menunjuk hasil selesai → hasil tsb TIDAK terhapus (filter status)", async () => {
  // result_id = 14 (status "Lulus PG") — bukan In Progress → cleanup harus no-op.
  const submit = await post("/api/exam/submit", {
    pack_id: 1,
    participant_name: "Budi Santoso",
    answers: { 101: "A" },
    result_id: 14,
  });
  assert.equal(submit.status, 409);
  const ids = await rowIdsInMock();
  assert.ok(ids.includes(14), "hasil selesai id 14 tidak boleh terhapus");
});

test("409 tanpa result_id → tetap 409 dan tidak ada yang dihapus", async () => {
  const submit = await post("/api/exam/submit", {
    pack_id: 1,
    participant_name: "Budi Santoso",
    answers: { 101: "A" },
  });
  assert.equal(submit.status, 409);
  const ids = await rowIdsInMock();
  assert.ok(ids.includes(14), "tanpa result_id tidak boleh ada row yang terhapus");
});

// ============================================================================
// 3a. DELETE /api/scoreboard/:id — single delete (admin only)
// ============================================================================

test("DELETE /api/scoreboard/:id anon → 401", async () => {
  const res = await del("/api/scoreboard/11");
  assert.equal(res.status, 401);
});

test("DELETE /api/scoreboard/:id id invalid → 400", async () => {
  const res = await del("/api/scoreboard/abc", { cookie: adminCookie() });
  assert.equal(res.status, 400);
});

test("DELETE /api/scoreboard/:id tidak ada → 404", async () => {
  const res = await del("/api/scoreboard/99999", { cookie: adminCookie() });
  assert.equal(res.status, 404);
});

test("DELETE /api/scoreboard/:id admin → 200 { deleted: 1 } dan row hilang", async () => {
  assert.ok(fixture.examResults.some((r) => r.id === 12));
  const res = await del("/api/scoreboard/12", { cookie: adminCookie() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { deleted: 1 });
  const ids = await rowIdsInMock();
  assert.ok(!ids.includes(12), "id 12 harus sudah hilang dari mock");
});

// ============================================================================
// 3b. POST /api/scoreboard/bulk-delete — multi delete (admin only)
// ============================================================================

test("bulk-delete anon → 401", async () => {
  const res = await post("/api/scoreboard/bulk-delete", { ids: [11] });
  assert.equal(res.status, 401);
});

test("bulk-delete ids kosong / bukan array → 400", async () => {
  const res = await post(
    "/api/scoreboard/bulk-delete",
    { ids: [] },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 400);
});

test("bulk-delete > 1000 ids → 400", async () => {
  const res = await post(
    "/api/scoreboard/bulk-delete",
    { ids: Array.from({ length: 1001 }, (_, i) => i + 1) },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 400);
});

test("bulk-delete admin → 200 { deleted } dan semua row hilang", async () => {
  assert.ok(fixture.examResults.some((r) => r.id === 11));
  assert.ok(fixture.examResults.some((r) => r.id === 13));
  const res = await post(
    "/api/scoreboard/bulk-delete",
    { ids: [11, 13] },
    { cookie: adminCookie() },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deleted, 2);
  assert.equal(body.requested, 2);
  const ids = await rowIdsInMock();
  assert.ok(!ids.includes(11) && !ids.includes(13), "id 11 & 13 harus hilang");
});
