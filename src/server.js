// src/server.js
// Spec: specs/admin-auth-spec.md (rev 0.1). All admin auth code is
// grouped under "ADMIN AUTH" headers below for easy audit.
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import supabase from "./db.js";
import { put } from "@vercel/blob";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Trust Vercel proxy (1 hop). Free hardening; matters for any future
// rate limiting (req.ip would otherwise be the LB IP, not the client).
app.set("trust proxy", 1);

// Middleware
app.use(express.json({ limit: "10mb" }));

// ============================================
// ADMIN AUTH (specs/admin-auth-spec.md §6)
// ============================================

// STRICT-FAIL: throw on startup if JWT_SECRET missing or too short.
// Avoids silent production bugs from random-per-cold-start fallback.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    "[admin-auth] FATAL: JWT_SECRET env var must be set to a strong random string (>= 32 chars). " +
    "Generate via: openssl rand -hex 32",
  );
}

const COOKIE_NAME = "toskd_admin_sess";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SLIDING_REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // refresh if < 12h remaining
const BCRYPT_COST = 10;
const MAX_USERNAME_LEN = 64;
const MAX_PASSWORD_LEN = 1000;

const BOOTSTRAP_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME;
const BOOTSTRAP_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;

const PUBLIC_DIR = join(__dirname, "..", "public");

// --- Session helpers ---

// Read + verify session cookie. Returns decoded JWT payload or null.
function readSession(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`),
  );
  if (!match) return null;
  try {
    // Pin algorithm to HS256 to prevent alg:none attacks.
    return jwt.verify(match[1], JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return null; // invalid or expired
  }
}

// Set a fresh session cookie. Guard against writing after headers flushed
// (Express 5 may stream earlier than Express 4).
function setSessionCookie(res, payload) {
  if (res.headersSent) return;
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}

// --- requireAdmin middleware ---
// SPEC DECISION: accept stale 24h sessions (C2). If admin is TRUNCATE'd
// from DB, existing JWTs remain valid until exp. No per-request DB check
// — keeps JWT stateless. Trade-off: known limitation L2.
function requireAdmin(req, res, next) {
  // Lowercase path (R19 fix): /Bank-soal.html bypasses lowercase list otherwise.
  // Use local var because req.path is a getter-only in Express 5 — mutating
  // it throws TypeError in ES module strict mode.
  const path = req.path.toLowerCase();

  const session = readSession(req);
  if (!session) {
    // CORS preflight (OPTIONS) — respond 204; never block.
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    // Content negotiation: HTML page → redirect to login, API → 401 JSON.
    // R19 fix + Review fix: do NOT use req.accepts("html") — default fetch
    // sends Accept: */* which would falsely match and redirect API calls.
    // Plain .html path check is sufficient (browsers navigate to .html).
    if (path.endsWith(".html")) {
      const next_ = encodeURIComponent(req.originalUrl);
      return res.redirect(302, `/login.html?next=${next_}`);
    }
    return res.status(401).json({ error: "admin login required" });
  }

  req.admin = session; // { adminId, username, iat, exp }

  // Sliding refresh: if remaining life < 12h, re-issue cookie.
  // SPEC DECISION (C6): every request — keeps impl simple, browser dedupes.
  const now = Math.floor(Date.now() / 1000);
  const remaining = (session.exp || 0) - now;
  if (remaining > 0 && remaining < SLIDING_REFRESH_THRESHOLD_MS / 1000) {
    setSessionCookie(res, {
      adminId: session.adminId,
      username: session.username,
    });
  }

  next();
}

// --- Bootstrap: seed first admin from env vars on cold-start ---
// Short-circuits if already done in this process. Idempotent: subsequent
// cold-starts log a warning if env vars still set + table non-empty.
let bootstrapDoneThisProcess = false;

async function maybeBootstrapAdmin() {
  if (!BOOTSTRAP_USERNAME || !BOOTSTRAP_PASSWORD) return;
  // Dev guard: skip bootstrap outside production. Avoids log spam on every
  // cold start when SUPABASE_URL is mocked or admins table is absent locally.
  // To test bootstrap locally, run with `NODE_ENV=production node src/server.js`.
  // We log a one-liner (not console.error) so it's visible in dev but doesn't
  // look alarming. Lets the next person hitting a bootstrap issue immediately
  // see "skipped (dev mode)" and know how to enable it.
  if (process.env.NODE_ENV?.toLowerCase() !== "production") {
    console.log("[admin-auth] Bootstrap skipped (dev mode). Set NODE_ENV=production to test.");
    return;
  }
  if (bootstrapDoneThisProcess) return;

  try {
    const { count, error: countError } = await supabase
      .from("admins")
      .select("*", { count: "exact", head: true });

    if (countError) throw countError;

    if (count > 0) {
      console.warn(
        "[admin-auth] BOOTSTRAP_ADMIN_* env vars set but admins table not empty. " +
        "DELETE the env vars from Vercel dashboard NOW to avoid plaintext password leak.",
      );
      bootstrapDoneThisProcess = true;
      return;
    }

    if (BOOTSTRAP_PASSWORD.length > MAX_PASSWORD_LEN) {
      throw new Error(
        `[admin-auth] BOOTSTRAP_ADMIN_PASSWORD longer than ${MAX_PASSWORD_LEN} chars; aborting.`,
      );
    }

    const password_hash = await bcrypt.hash(BOOTSTRAP_PASSWORD, BCRYPT_COST);
    const { error: insertError } = await supabase
      .from("admins")
      .insert({ username: BOOTSTRAP_USERNAME, password_hash });

    if (insertError) {
      // UNIQUE violation = race condition (another instance beat us). Safe to ignore.
      if (insertError.code === "23505") {
        console.log("[admin-auth] Bootstrap race resolved by UNIQUE constraint.");
        bootstrapDoneThisProcess = true;
        return;
      }
      throw insertError;
    }

    bootstrapDoneThisProcess = true;
    console.log(
      `[admin-auth] Bootstrap admin "${BOOTSTRAP_USERNAME}" created. ` +
      `DELETE BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD env vars NOW.`,
    );
  } catch (err) {
    // Rich error context: Node fetch errors stash the real network reason in
    // `err.cause` (err.message is just "fetch failed"); Supabase PostgREST
    // errors are plain objects with `message`/`code`/`details`. Print both.
    console.error("[admin-auth] Bootstrap failed:", {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      cause: err?.cause?.message || err?.cause,
      stack: err?.stack,
    });
  }
}

// --- Admin auth endpoints ---

// POST /api/admin/login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "username + password required" });
    }
    if (username.length === 0 || password.length === 0) {
      return res.status(400).json({ error: "username + password required" });
    }
    // Input length cap (DoS mitigation — bcrypt on 1MB input burns CPU).
    if (
      username.length > MAX_USERNAME_LEN ||
      password.length > MAX_PASSWORD_LEN
    ) {
      return res.status(400).json({
        error: `username or password too long (max ${MAX_USERNAME_LEN} / ${MAX_PASSWORD_LEN})`,
      });
    }

    // Normalize username to lowercase for case-insensitive lookup.
    const normalizedUsername = username.toLowerCase();

    const { data: admin, error } = await supabase
      .from("admins")
      .select("id, username, password_hash")
      .eq("username", normalizedUsername)
      .single();

    // Constant-time delay to prevent username enumeration.
    if (error || !admin) {
      await bcrypt.compare(
        password,
        "$2a$10$dummy.hash.to.prevent.timing.attacks............",
      );
      console.warn(
        `[admin-auth] failed login for username="${normalizedUsername}" (no such user)`,
      );
      return res.status(401).json({ error: "invalid credentials" });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      console.warn(
        `[admin-auth] failed login for username="${normalizedUsername}" (bad password)`,
      );
      return res.status(401).json({ error: "invalid credentials" });
    }

    // Update last_login_at (best-effort, does not block login).
    void (async () => {
      try {
        await supabase
          .from("admins")
          .update({ last_login_at: new Date().toISOString() })
          .eq("id", admin.id);
      } catch (err) {
        console.warn("[admin-auth] last_login_at update failed:", err);
      }
    })();

    console.log(
      `[admin-auth] successful login for username="${normalizedUsername}" (id=${admin.id})`,
    );
    setSessionCookie(res, { adminId: admin.id, username: admin.username });
    res.json({ ok: true, username: admin.username });
  } catch (err) {
    console.error("[admin-auth] login error:", err);
    res.status(500).json({ error: "login failed" });
  }
});

// POST /api/admin/logout
app.post("/api/admin/logout", (req, res) => {
  if (!res.headersSent) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
  }
  res.json({ ok: true });
});

// GET /api/admin/me
app.get("/api/admin/me", (req, res) => {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "not authenticated" });
  }
  res.json({ username: session.username });
});

// --- Protected CMS HTML routes (BEFORE static) ---
// These MUST be declared before `app.use(express.static(...))` to prevent
// the static handler from bypassing the requireAdmin middleware.
const PROTECTED_HTML_ROUTES = [
  "bank-soal.html",
  "kelola-soal.html",
  "paket-soal.html",
  "paket-detail.html",
];
PROTECTED_HTML_ROUTES.forEach((filename) => {
  app.get(`/${filename}`, requireAdmin, (req, res) => {
    res.sendFile(join(PUBLIC_DIR, filename));
  });
});

// ============================================
// END ADMIN AUTH
// ============================================

// --- API Endpoints (existing, unprotected for now) ---

// Get all questions
app.get("/api/questions", async (req, res) => {
  try {
    const { data, error } = await supabase.from("questions").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// Bulk insert questions (atomic single transaction via PostgREST).
// Spec: specs/bulk-add-questions-spec.md, Section 4.6.
// Accepts `{ questions: [{...}, {...}] }` and creates all rows in one
// round-trip. Returns `{ inserted: N, ids: [...] }` on success.
app.post("/api/questions/bulk", async (req, res) => {
  try {
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: "questions must be an array" });
    }
    if (questions.length === 0) {
      return res.status(400).json({ error: "questions array is empty" });
    }
    if (questions.length > 500) {
      return res
        .status(400)
        .json({ error: "max 500 questions per bulk request" });
    }

    // Defensive shape validation. Frontend already validates via parser,
    // but server-side guard prevents malformed payloads if someone calls
    // the endpoint directly.
    for (const q of questions) {
      if (
        !q ||
        !q.content ||
        !q.question_type ||
        !q.options ||
        !q.correct_answer ||
        !q.explanation
      ) {
        return res.status(400).json({ error: "invalid question shape" });
      }
    }

    const rows = questions.map(
      ({ content, question_type, options, correct_answer, explanation }) => ({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        image_url: null,
        explanation_image_url: null,
      })
    );

    // Supabase's `.insert(rows).select()` sends a single PostgREST
    // request; PostgREST wraps the rows in one Postgres transaction so
    // any single insert failure rolls back the entire batch.
    const { data, error } = await supabase
      .from("questions")
      .insert(rows)
      .select();

    if (error) throw error;

    res
      .status(201)
      .json({
        inserted: data.length,
        ids: data.map((d) => d.id),
      });
  } catch (error) {
    console.error("Error bulk adding questions:", error);
    res.status(500).json({ error: "Failed to bulk add questions" });
  }
});

// Bulk usage pre-check (per specs/bulk-delete-questions-spec.md Section 4.7 / 8).
// Accepts `{ ids: [1..1000] }` and returns Record<idStr, { used, packs }>
// in a SINGLE round-trip via PostgREST aggregate `IN` query — never loop
// per-id (would otherwise hang the UI for hundreds of soal). 400 for bad
// payload, 500 for unexpected DB error.
app.post("/api/questions/bulk-usage", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    if (ids.length > 1000) {
      return res
        .status(400)
        .json({ error: "max 1000 ids per request" });
    }

    // Single PostgREST query: WHERE question_id IN (...) JOIN question_packs.
    // Each row carries the embedded pack name. Aggregate per-id below.
    const { data, error } = await supabase
      .from("pack_questions")
      .select("question_id, question_packs(name)")
      .in("question_id", ids);
    if (error) throw error;

    // Initialize every requested id with default empty usage; then fill from
    // returned rows. String-keyed map for JSON safety with BigInt ids.
    const usageMap = {};
    for (const id of ids) {
      usageMap[String(id)] = { used: false, packs: [] };
    }
    for (const row of data) {
      const key = String(row.question_id);
      if (!usageMap[key]) continue; // defensive: id in result but not requested
      usageMap[key].used = true;
      const packName = row.question_packs?.name;
      if (packName && !usageMap[key].packs.includes(packName)) {
        usageMap[key].packs.push(packName);
      }
    }

    res.json(usageMap);
  } catch (error) {
    console.error("Error in bulk usage check:", error);
    res.status(500).json({ error: "Failed to check usage" });
  }
});

// Bulk delete questions (per specs/bulk-delete-questions-spec.md Section 4.10).
// Best-effort per-id semantics via Promise.allSettled — NOT single transaction
// (partial-failure reporting is explicit feature). Each iteration defensively
// pre-unlinks pack_questions then deletes the question row (FK ON DELETE
// CASCADE on pack_questions.question_id handles unlinking too — pre-unlink
// is belt-and-suspenders for schema-evolution safety). Returns
// `{ deleted: [ids], failed: [{id, reason}] }`.
app.post("/api/questions/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    if (ids.length > 1000) {
      return res
        .status(400)
        .json({ error: "max 1000 ids per request" });
    }

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        // Defensive pre-unlink pack_questions (FK cascade also handles this,
        // but explicit is safer if schema later removes the CASCADE clause).
        const { error: relError } = await supabase
          .from("pack_questions")
          .delete()
          .eq("question_id", id);
        if (relError) {
          throw new Error(`pack_questions unlink failed: ${relError.message}`);
        }

        const { error: qError } = await supabase
          .from("questions")
          .delete()
          .eq("id", id);
        if (qError) {
          throw new Error(`questions delete failed: ${qError.message}`);
        }
        return id;
      })
    );

    const deleted = [];
    const failed = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const id = ids[i];
      if (r.status === "fulfilled") {
        deleted.push(id);
      } else {
        failed.push({
          id,
          reason: r.reason?.message || "unknown error",
        });
      }
    }

    // Spec Section 7 R13: aggregate server-side summary log to avoid
    // per-id error spam when 1000 IDs fail at once.
    console.error("Bulk delete summary:", {
      total: ids.length,
      deleted: deleted.length,
      failed: failed.length,
    });

    res.json({ deleted, failed });
  } catch (error) {
    console.error("Bulk delete error:", error);
    res.status(500).json({ error: "Failed to bulk delete questions" });
  }
});

// Add a new question
app.post("/api/questions", async (req, res) => {
  try {
    const {
      content,
      question_type,
      options,
      correct_answer,
      explanation,
      image,
      explanation_image,
    } = req.body;
    let image_url = null;
    let explanation_image_url = null;

    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`questions/${Date.now()}.png`, buffer, {
        access: "public",
      });
      image_url = url;
    }

    if (explanation_image) {
      const base64Data = explanation_image.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`explanations/${Date.now()}.png`, buffer, {
        access: "public",
      });
      explanation_image_url = url;
    }

    const { data, error } = await supabase
      .from("questions")
      .insert({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        image_url,
        explanation_image_url,
      })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding question:", error);
    res.status(500).json({ error: "Failed to add question" });
  }
});

// Get all question packs
app.get("/api/packs", async (req, res) => {
  try {
    const { data, error } = await supabase.from("question_packs").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching packs:", error);
    res.status(500).json({ error: "Failed to fetch packs" });
  }
});

// Get single pack by ID
app.get("/api/packs/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("question_packs")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching pack:", error);
    res.status(500).json({ error: "Failed to fetch pack" });
  }
});

// Create a new question pack
app.post("/api/packs", async (req, res) => {
  try {
    const { name, duration_minutes, passing_grade } = req.body;
    const { data, error } = await supabase
      .from("question_packs")
      .insert({ name, duration_minutes, passing_grade: passing_grade || 85 })
      .select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating pack:", error);
    res.status(500).json({ error: "Failed to create pack" });
  }
});

// Add questions to a pack
app.post("/api/packs/:id/questions", async (req, res) => {
  try {
    const { question_id, question_number } = req.body;
    const { data, error } = await supabase
      .from("pack_questions")
      .insert({ pack_id: req.params.id, question_id, question_number })
      .select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding question to pack:", error);
    res.status(500).json({ error: "Failed to add question to pack" });
  }
});

// Get questions for a specific pack
app.get("/api/packs/:id/questions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pack_questions")
      .select("*, questions(*)")
      .eq("pack_id", req.params.id)
      .order("question_number", { ascending: true });
    if (error) throw error;
    res.json(data.map((item) => item.questions));
  } catch (error) {
    console.error("Error fetching pack questions:", error);
    res.status(500).json({ error: "Failed to fetch pack questions" });
  }
});

// Start exam
app.post("/api/exam/start", async (req, res) => {
  try {
    const { pack_id, participant_name } = req.body;
    const { data, error } = await supabase
      .from("exam_results")
      .insert({
        pack_id,
        participant_name,
        score: 0,
        status: "In Progress",
        answers: {},
      })
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Error starting exam:", error);
    res.status(500).json({ error: "Failed to start exam" });
  }
});

// Submit exam answers
app.post("/api/exam/submit", async (req, res) => {
  try {
    const { pack_id, participant_name, answers } = req.body;

    const { data: packData, error: packError } = await supabase
      .from("question_packs")
      .select("passing_grade")
      .eq("id", pack_id)
      .single();
    if (packError) throw packError;

    const { data: packQuestions, error: questionsError } = await supabase
      .from("pack_questions")
      .select("questions(*)")
      .eq("pack_id", pack_id);
    if (questionsError) throw questionsError;

    let correctAnswers = 0;
    const questions = packQuestions.map((item) => item.questions);
    questions.forEach((q) => {
      if (answers[q.id] === q.correct_answer) correctAnswers++;
    });

    const score = correctAnswers * 5;
    const status =
      score >= packData.passing_grade ? "Lulus PG" : "Tidak Lulus PG";

    const { data, error } = await supabase
      .from("exam_results")
      .insert({ pack_id, participant_name, score, status, answers })
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Error submitting exam:", error);
    res.status(500).json({ error: "Failed to submit exam" });
  }
});

// Get exam results
app.get("/api/exam/:id/results", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exam_results")
      .select("*, question_packs(*)")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching exam results:", error);
    res.status(500).json({ error: "Failed to fetch exam results" });
  }
});

// Get scoreboard
app.get("/api/scoreboard", async (req, res) => {
  try {
    const { pack_id } = req.query;
    const { data, error } = await supabase
      .from("exam_results")
      .select("participant_name, score, status")
      .eq("pack_id", pack_id)
      .order("score", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching scoreboard:", error);
    res.status(500).json({ error: "Failed to fetch scoreboard" });
  }
});

// Update a question
app.put("/api/questions/:id", async (req, res) => {
  try {
    const {
      content,
      question_type,
      options,
      correct_answer,
      explanation,
      image,
      image_url: existingUrl,
      explanation_image,
      explanation_image_url: existingExplanationUrl,
    } = req.body;
    let image_url = existingUrl || null;
    if (image && image.startsWith("data:")) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`questions/${Date.now()}.png`, buffer, {
        access: "public",
      });
      image_url = url;
    }
    let explanation_image_url = existingExplanationUrl || null;
    if (explanation_image && explanation_image.startsWith("data:")) {
      const base64Data = explanation_image.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`explanations/${Date.now()}.png`, buffer, {
        access: "public",
      });
      explanation_image_url = url;
    }
    const { data, error } = await supabase
      .from("questions")
      .update({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        image_url,
        explanation_image_url,
      })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error("Error updating question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// Check if question is used in packs
app.get("/api/questions/:id/usage", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pack_questions")
      .select("question_packs(name)")
      .eq("question_id", req.params.id);
    if (error) throw error;
    const packNames = data
      .map((item) => item.question_packs?.name)
      .filter(Boolean);
    res.json({ used: packNames.length > 0, packs: packNames });
  } catch (error) {
    console.error("Error checking question usage:", error);
    res.status(500).json({ error: "Failed to check usage" });
  }
});

// Upload image for rich text editor
app.post("/api/upload-image", async (req, res) => {
  try {
    const { image, folder } = req.body;
    if (!image) return res.status(400).json({ error: "No image provided" });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const dir = folder || "questions";
    const { url } = await put(`${dir}/${Date.now()}.png`, buffer, {
      access: "public",
    });
    res.json({ url });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// Delete a question
app.delete("/api/questions/:id", async (req, res) => {
  try {
    const { error: relError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("question_id", req.params.id);
    if (relError) throw relError;

    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// Update a pack
app.put("/api/packs/:id", async (req, res) => {
  try {
    const { name, duration_minutes, passing_grade } = req.body;
    const { data, error } = await supabase
      .from("question_packs")
      .update({ name, duration_minutes, passing_grade })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error("Error updating pack:", error);
    res.status(500).json({ error: "Failed to update pack" });
  }
});

// Delete a pack
app.delete("/api/packs/:id", async (req, res) => {
  try {
    // Delete related exam results first
    const { error: resError } = await supabase
      .from("exam_results")
      .delete()
      .eq("pack_id", req.params.id);
    if (resError) throw resError;

    // Delete pack questions relations
    const { error: pqError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", req.params.id);
    if (pqError) throw pqError;

    // Delete pack
    const { error } = await supabase
      .from("question_packs")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting pack:", error);
    res.status(500).json({ error: "Gagal menghapus paket soal" });
  }
});

// Remove a question from a pack
app.delete("/api/packs/:packId/questions/:questionId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", req.params.packId)
      .eq("question_id", req.params.questionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error removing question from pack:", error);
    res.status(500).json({ error: "Failed to remove question from pack" });
  }
});

// Update question order in a pack (bulk)
app.put("/api/packs/:id/questions", async (req, res) => {
  try {
    const { questions } = req.body; // [{question_id, question_number}]
    const packId = req.params.id;
    // Delete all existing and re-insert
    const { error: delError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", packId);
    if (delError) throw delError;
    if (questions.length > 0) {
      const rows = questions.map((q) => ({
        pack_id: packId,
        question_id: q.question_id,
        question_number: q.question_number,
      }));
      const { error: insError } = await supabase
        .from("pack_questions")
        .insert(rows);
      if (insError) throw insError;
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating pack questions order:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// Get scoreboard - enhanced with optional pack_id filter and created_at.
// Includes `id` so scoreboard.html can deep-link each row to
// /review.html?id=<id> (the review page reads ?id and fetches via
// /api/exam/:id/results).
app.get("/api/scoreboard-all", async (req, res) => {
  try {
    let query = supabase
      .from("exam_results")
      .select(
        "id, participant_name, score, status, created_at, pack_id, question_packs(name)",
      )
      .order("score", { ascending: false });
    const { pack_id } = req.query;
    if (pack_id) query = query.eq("pack_id", pack_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching scoreboard:", error);
    res.status(500).json({ error: "Failed to fetch scoreboard" });
  }
});

// --- Static files (AFTER API routes & protected HTML routes) ---
app.use(express.static(PUBLIC_DIR));

// Run bootstrap check (async, non-blocking — does not delay startup).
// On Vercel serverless, this fires once per cold start. Idempotent.
maybeBootstrapAdmin().catch((err) =>
  console.error("[admin-auth] bootstrap uncaught error:", err),
);

// Local dev: listen on PORT. On Vercel this block is skipped because
// Vercel imports the module as a serverless function (app.listen would
// just hang). Enable with `pnpm start` for local curl testing.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
export default app;
