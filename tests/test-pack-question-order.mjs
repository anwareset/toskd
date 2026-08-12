// tests/test-pack-question-order.mjs
// Regression lock-in for the pack-question ORDERING bug (2026-08-12):
//   - POST /api/packs/:id/questions assigns question_number = max(existing)+1
//     server-side, so a batch added from the bank list lands in arrival order
//     (= checkbox click order) with UNIQUE numbers — even after deletions
//     leave gaps (numbers 1,2,4,5 → next add gets 6, never a collision).
//   - Client-supplied question_number is IGNORED (explicit renumbering is the
//     PUT /api/packs/:id/questions endpoint's job), so a misbehaving client
//     can no longer create duplicate numbers.
//   - GET /api/packs/:id/questions orders by question_number then id ASC
//     (deterministic tiebreak), so even legacy duplicate rows display in a
//     stable order across add/delete/reload.
//
// Strategy: same as test-health.mjs — a local stateful mock PostgREST
// (plain node:http) pointed at via SUPABASE_URL, then the REAL src/server.js
// is imported ONCE and exercised over HTTP.
//
// Run: node tests/test-pack-question-order.mjs (or via `pnpm test`)

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, "..", "src", "server.js");

// ---------------------------------------------------------------------------
// Stateful mock PostgREST — supports exactly the queries the pack-question
// endpoints make:
//   GET    /rest/v1/pack_questions?select=...&pack_id=eq.N&order=...&limit=1
//   POST   /rest/v1/pack_questions            (body = row; returns [row])
//   DELETE /rest/v1/pack_questions?pack_id=eq.N&question_id=eq.M
//   GET    /rest/v1/question_packs?id=eq.N&select=subtests   (single object)
//   GET    /rest/v1/questions?id=eq.N&select=question_type   (single object)
// ---------------------------------------------------------------------------
function startMockPostgrest() {
  let nextPqId = 1;
  const packQuestions = []; // {id, pack_id, question_id, question_number}
  const questions = [
    { id: 101, question_type: "TWK" },
    { id: 102, question_type: "TIU" },
    { id: 103, question_type: "TKP" },
    { id: 104, question_type: "TWK" },
    { id: 105, question_type: "TIU" },
    { id: 106, question_type: "TWK" },
    { id: 107, question_type: "TKP" },
    { id: 108, question_type: "TIU" },
  ];
  const questionPacks = [{ id: 1, subtests: ["TWK", "TIU", "TKP"] }];

  // Test-only hooks exposed via the returned fixture:
  //   state.rejectNextInsert — reject the NEXT insert with 23505 to
  //   deterministically exercise the server's retry path (simulates a
  //   concurrent admin tab winning the race). Auto-resets after one use.
  const state = { rejectNextInsert: false };

  // Parse PostgREST equality filter: `pack_id=eq.1` → 1. Returns null when
  // absent (matches everything).
  function eqFilter(params, name) {
    const v = params.get(name);
    if (!v || !v.startsWith("eq.")) return null;
    return Number(v.slice(3));
  }

  // Apply `order=question_number.desc` / `order=question_number.asc,id.asc`.
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

  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://mock");
    const params = url.searchParams;
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // --- POST /rest/v1/pack_questions: insert row with auto-id ---
    if (req.method === "POST" && url.pathname === "/rest/v1/pack_questions") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const row = JSON.parse(body || "{}");
        // PostgREST/Postgres BIGINT column coerces the string "1" from a
        // URL param to the number 1 — mirror that coercion in the mock so
        // the numeric eq filters (r.pack_id === packId) match correctly.
        const packId = Number(row.pack_id);
        const qId = Number(row.question_id);

        // Test-only hook: simulate that a concurrent request "won" the race
        // — reject this insert with 23505 so the server's retry runs.
        if (state.rejectNextInsert) {
          state.rejectNextInsert = false;
          json(409, {
            code: "23505",
            details: "Key (pack_id, question_number) already exists.",
            message:
              'duplicate key value violates unique constraint "pack_questions_pack_id_question_number_key"',
          });
          return;
        }

        // Mirror real Postgres UNIQUE(pack_id, question_number): reject
        // duplicate numbers per pack with PostgREST's 409 + error code
        // 23505 (supabase-js surfaces it as error.code === "23505").
        const dup = packQuestions.some(
          (r) =>
            r.pack_id === packId &&
            r.question_number === Number(row.question_number),
        );
        if (dup) {
          json(409, {
            code: "23505",
            details: "Key (pack_id, question_number) already exists.",
            message:
              'duplicate key value violates unique constraint "pack_questions_pack_id_question_number_key"',
          });
          return;
        }

        const full = {
          id: nextPqId++,
          ...row,
          pack_id: packId,
          question_id: qId,
        };
        packQuestions.push(full);
        json(201, [full]);
      });
      return;
    }

    // --- DELETE /rest/v1/pack_questions?pack_id=eq.N&question_id=eq.M ---
    if (req.method === "DELETE" && url.pathname === "/rest/v1/pack_questions") {
      const packId = eqFilter(params, "pack_id");
      const qId = eqFilter(params, "question_id");
      let removed = 0;
      for (let i = packQuestions.length - 1; i >= 0; i--) {
        const r = packQuestions[i];
        if (
          (packId == null || r.pack_id === packId) &&
          (qId == null || r.question_id === qId)
        ) {
          packQuestions.splice(i, 1);
          removed++;
        }
      }
      json(200, removed > 0 ? [{ id: 1 }] : []);
      return;
    }

    // --- GET /rest/v1/pack_questions (filter + order + embed questions(*)) ---
    if (req.method === "GET" && url.pathname === "/rest/v1/pack_questions") {
      const packId = eqFilter(params, "pack_id");
      const select = params.get("select") || "*";
      let rows = packQuestions.filter(
        (r) => packId == null || r.pack_id === packId,
      );
      rows = applyOrder(rows, params.get("order"));
      // Only slice when `limit` is actually present: Number(null) === 0,
      // which would slice(0, 0) → empty for every non-limited query.
      const limitParam = params.get("limit");
      if (limitParam !== null) {
        const limit = Number(limitParam);
        if (Number.isFinite(limit) && limit >= 0) rows = rows.slice(0, limit);
      }
      const embed = select.includes("questions(");
      const out = rows.map((r) => {
        const row = { ...r };
        if (embed) {
          row.questions =
            questions.find((q) => q.id === r.question_id) || null;
        }
        return row;
      });
      json(200, out);
      return;
    }

    // --- GET /rest/v1/question_packs & questions (single-object lookups) ---
    // `.single()` in supabase-js sends Accept: application/vnd.pgrst.object+json
    // and expects a bare object back — honor it, fall back to array otherwise.
    const wantObject = (req.headers.accept || "").includes(
      "application/vnd.pgrst.object",
    );
    if (req.method === "GET" && url.pathname === "/rest/v1/question_packs") {
      const id = eqFilter(params, "id");
      const row = questionPacks.find((p) => id == null || p.id === id);
      if (!row) return json(wantObject ? 406 : 200, wantObject ? {} : []);
      const out = { id: row.id, subtests: row.subtests };
      return json(200, wantObject ? out : [out]);
    }
    if (req.method === "GET" && url.pathname === "/rest/v1/questions") {
      const id = eqFilter(params, "id");
      const row = questions.find((q) => id == null || q.id === id);
      if (!row) return json(wantObject ? 406 : 200, wantObject ? {} : []);
      const out = { id: row.id, question_type: row.question_type };
      return json(200, wantObject ? out : [out]);
    }

    json(404, { message: "not found: " + req.method + " " + url.pathname });
  });

  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ srv, state })),
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

// POST a question into pack 1 (optionally with a bogus client question_number).
async function addToPack(questionId, sentNumber) {
  const res = await fetch(`${baseUrl}/api/packs/1/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_id: questionId,
      ...(sentNumber !== undefined ? { question_number: sentNumber } : {}),
    }),
  });
  return res;
}

async function packQuestionsFromApi() {
  const res = await fetch(`${baseUrl}/api/packs/1/questions`);
  assert.equal(res.status, 200);
  return res.json();
}

test("sequential adds get unique question_number in arrival (checkbox) order", async () => {
  for (const qId of [101, 102, 103, 104]) {
    const res = await addToPack(qId);
    assert.equal(res.status, 201, `add q${qId} failed: ${await res.text()}`);
  }
  const qs = await packQuestionsFromApi();
  assert.deepEqual(
    qs.map((q) => q.id),
    [101, 102, 103, 104],
    "pack order must match add/click order",
  );
});

test("client-supplied duplicate question_number is ignored (server max+1 wins)", async () => {
  // Force number 1 for q105 → server must assign the next free number (5),
  // never reusing an existing one.
  const res = await addToPack(105, 1);
  assert.equal(res.status, 201);
  const qs = await packQuestionsFromApi();
  assert.deepEqual(qs.map((q) => q.id), [101, 102, 103, 104, 105]);
});

test("delete leaves gaps but next add uses max+1 (no collision, stable order)", async () => {
  // Delete q102 (number 2) → remaining numbers 1,3,4,5.
  const del = await fetch(`${baseUrl}/api/packs/1/questions/102`, {
    method: "DELETE",
  });
  assert.equal(del.status, 200);
  let qs = await packQuestionsFromApi();
  assert.deepEqual(
    qs.map((q) => q.id),
    [101, 103, 104, 105],
    "remaining order unchanged after delete",
  );

  // Re-add q102 (and force a wrong number 99) → must land at number 6
  // (max+1), appended after 105 without colliding with number 5.
  const add = await addToPack(102, 99);
  assert.equal(add.status, 201);
  qs = await packQuestionsFromApi();
  assert.deepEqual(qs.map((q) => q.id), [101, 103, 104, 105, 102]);
});

test("23505 race loss → server retries with fresh max+1 and succeeds", async () => {
  // Simulate another admin tab winning the race: the next insert attempt is
  // rejected with 23505 (UNIQUE(pack_id, question_number)). The server must
  // detect the unique violation, re-read max, and retry — never a 500.
  fixture.state.rejectNextInsert = true;
  const res = await addToPack(106);
  assert.equal(res.status, 201, `retry add failed: ${await res.text()}`);
  const qs = await packQuestionsFromApi();
  const ids = qs.map((q) => q.id);
  assert.ok(ids.includes(106), "question 106 must be present after retry");
  assert.equal(ids.length, 6, "six questions in pack after retry");
});

test("concurrent adds: UNIQUE constraint + retry → both succeed, none lost", async () => {
  // Two admin tabs hitting POST at the same time. Both read the same max,
  // both try the same number — the mock's UNIQUE check rejects one with
  // 23505, the server retries with a fresh max+1. Both must end 201 and
  // neither question may be lost.
  const [r1, r2] = await Promise.all([addToPack(107), addToPack(108)]);
  assert.equal(r1.status, 201, `concurrent add 1 failed: ${await r1.text()}`);
  assert.equal(r2.status, 201, `concurrent add 2 failed: ${await r2.text()}`);
  const qs = await packQuestionsFromApi();
  assert.deepEqual(
    qs.map((q) => q.id).sort((a, b) => a - b),
    [101, 102, 103, 104, 105, 106, 107, 108],
    "all 8 questions present — none lost to the race",
  );
});
