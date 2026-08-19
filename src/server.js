// src/server.js
// Spec: specs/admin-auth-spec.md (rev 0.1). All admin auth code is
// grouped under "ADMIN AUTH" headers below for easy audit.
import "dotenv/config";
// Observability (specs/golden-signals-otel-spec.md): WAJIB di-import sebelum
// express/pino dimuat — otel.js mendaftarkan instrumentations yang mem-patch
// node:http, express, undici, dan pino. ESM mengevaluasi import dalam urutan
// source (depth-first), jadi blok ini harus tetap PALING ATAS.
import "./otel.js";
import "./logger.js";
import express from "express";
import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import supabase from "./db.js";
import { put } from "@vercel/blob";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { logger, errorField } from "./logger.js";
import {
  recordHttpRequest,
  withSpan,
  currentTraceContext,
  activeServerSpan,
  shutdownTelemetry,
} from "./otel.js";
import { isTrackedRequest } from "./tracked-request.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Trust Vercel proxy (1 hop). Free hardening; matters for any future
// rate limiting (req.ip would otherwise be the LB IP, not the client).
app.set("trust proxy", 1);

// Middleware
app.use(express.json({ limit: "10mb" }));

// ============================================
// OBSERVABILITY (specs/golden-signals-otel-spec.md §4.2/§4.4)
// ============================================
// Hanya request bisnis yang di-track: /api/* dan halaman *.html. /health
// (probe Docker HEALTHCHECK + monitoring eksternal) dan static assets
// (public/) di-exclude dari metrik + access log (keputusan interview R2 #7).
// Predikat diimpor dari modul bersama src/tracked-request.js — single source
// of truth yang juga dipakai hook trace di otel.js → paritas metrik/trace/
// access-log dijamin by construction.

// Golden-signals: histogram http.server.request.duration (traffic/latency/
// errors) + access log terstruktur, dicatat saat response selesai ('finish').
// trace_id/span_id diambil di AWAL middleware (bukan di 'finish'): saat
// request masuk span HTTP server masih aktif, jadi context deterministik —
// di event 'finish' span bisa sudah berakhir sehingga instrumentation-pino
// tidak lagi inject otomatis ke log.
app.use((req, res, next) => {
  if (!isTrackedRequest(req)) return next();
  const start = process.hrtime.bigint();
  const traceContext = currentTraceContext();
  // Referensi span server (fallback spec §7 — lihat otel.js activeServerSpan).
  const serverSpan = activeServerSpan();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const statusCode = res.statusCode;
    // Route ternormalisasi (pattern Express, bukan path mentah ber-id) —
    // mencegah kartinalitas tinggi (R2 #6).
    const route = req.route?.path ?? "<unmatched>";
    // Fallback ExpressInstrumentation-vs-Express-5 (spec §7): tulis route
    // ternormalisasi ke span server + rename dari "GET" jadi
    // "GET /api/exam/:id/results" (span masih terbuka di 'finish' — ditutup
    // di 'close').
    if (serverSpan) {
      serverSpan.setAttribute("http.route", route);
      if (route !== "<unmatched>") {
        serverSpan.updateName(`${req.method} ${route}`);
      }
    }
    recordHttpRequest({
      method: req.method,
      route,
      statusClass: `${Math.floor(statusCode / 100)}xx`,
      durationSeconds,
    });
    logger.info(
      {
        ...traceContext,
        event: "http.request",
        operation_status: statusCode < 400 ? "success" : "failed",
        duration_ms: Math.round(durationSeconds * 1000),
        http: { method: req.method, route, status_code: statusCode },
      },
      "HTTP request",
    );
  });
  next();
});

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

// Participant cookie (2026-08-11): diset saat /api/exam/submit sukses,
// terikat ke result_id hasil ujian tersebut. Dipakai GET /api/exam/:id/results
// untuk memastikan peserta PUBLIC hanya bisa melihat hasilnya sendiri.
const PARTICIPANT_COOKIE_NAME = "toskd_participant_sess";
const PARTICIPANT_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SLIDING_REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // refresh if < 12h remaining
const BCRYPT_COST = 10;
const MAX_USERNAME_LEN = 64;
const MAX_PASSWORD_LEN = 1000;

const BOOTSTRAP_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME;
const BOOTSTRAP_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;

const PUBLIC_DIR = join(__dirname, "..", "public");

// --- Health check helpers ---
// Short git commit hash (7 chars) untuk response /health.
// Prioritas: env Vercel (VERCEL_GIT_COMMIT_SHA) → env Docker build-arg
// (GIT_COMMIT_SHA, lihat Dockerfile ARG GIT_SHA) → git CLI (local dev) →
// "unknown". Di-cache setelah resolusi pertama (module-level lazy).
let _cachedCommitSha = null;
function getShortCommitSha() {
  if (_cachedCommitSha) return _cachedCommitSha;
  const envSha =
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA;
  if (envSha && envSha.trim()) {
    const s = envSha.trim();
    _cachedCommitSha = s.length > 7 ? s.slice(0, 7) : s;
    return _cachedCommitSha;
  }
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      timeout: 3000,
    });
    const s = out.trim();
    _cachedCommitSha = s.length > 7 ? s.slice(0, 7) : s;
    return _cachedCommitSha;
  } catch {
    // git tidak tersedia (serverless / image tanpa .git) — fallback.
    _cachedCommitSha = "unknown";
    return _cachedCommitSha;
  }
}

const APP_VERSION = getShortCommitSha();

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

// ============================================
// PACK VISIBILITY (specs/pack-visibility-spec.md §4.2)
// ============================================
// Single source of truth untuk gate penayangan paket soal
// (public/admin/archived). Admin = punya session cookie valid
// (toskd_admin_sess) — SAMA definisinya dengan requireAdmin, tapi di sini
// kita cuma butuh boolean (tidak redirect/401) karena endpoint ini publik
// dan harus LULUS untuk non-admin selama pack-nya 'public'.
function isAdminRequest(req) {
  return !!readSession(req);
}

// Visibility gate (READ endpoints): 'public' → semua orang;
// 'admin'/'archived' → admin only (admin butuh lihat archived utk CMS
// paket-soal.html / un-arsip). Legacy row tanpa kolom visibility (null,
// sebelum migration-007) → treat sebagai 'public' (backward compat, pola
// fallback sama seperti subtests).
function isPackVisibleTo(pack, req) {
  const v = pack?.visibility ?? "public";
  if (v === "public") return true;
  return isAdminRequest(req);
}

// Bisa DIKERJAKAN? (POST /api/exam/start + /submit) — LEBIH STRICT dari
// isPackVisibleTo (pack-visibility-spec.md matriks §12.1):
//   - 'archived' → TIDAK untuk siapa pun, TERMASUK admin (admin boleh
//     membaca archived di CMS, tapi TIDAK boleh mengerjakannya).
//   - 'admin'    → hanya admin.
//   - 'public'   → semua orang.
function canWorkPack(pack, req) {
  const v = pack?.visibility ?? "public";
  if (v === "archived") return false;
  if (v === "admin") return isAdminRequest(req);
  return true;
}

// Should the session cookie carry the `Secure` flag? MUST NOT be tied to
// NODE_ENV alone: the Docker image sets NODE_ENV=production, and when a
// container is served over plain http://localhost:PORT (self-host), a
// `Secure` cookie is never sent back by browsers — login "succeeds"
// server-side but every protected page bounces to /login.html. Base it on
// the actual connection instead: req.secure honors `trust proxy`
// (X-Forwarded-Proto), so Vercel over HTTPS still gets Secure while plain
// HTTP self-host does not. COOKIE_SECURE env var forces the decision.
function shouldUseSecureCookie(req) {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return req?.secure === true;
}

// Set a fresh session cookie. Guard against writing after headers flushed
// (Express 5 may stream earlier than Express 4).
function setSessionCookie(req, res, payload) {
  if (res.headersSent) return;
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_MS / 1000}${shouldUseSecureCookie(req) ? "; Secure" : ""}`,
  );
}

// --- Participant session helpers (2026-08-11) ---
// Read + verify the participant cookie (JWT HS256, same secret). Returns
// decoded payload or null. NOTE: cookie name berbeda dari admin cookie,
// jadi token peserta TIDAK pernah bisa dibaca sebagai sesi admin —
// requireAdmin hanya membaca toskd_admin_sess.
function readParticipantSession(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${PARTICIPANT_COOKIE_NAME}=([^;]+)`),
  );
  if (!match) return null;
  try {
    return jwt.verify(match[1], JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return null; // invalid or expired
  }
}

// Set the participant cookie bound to a single exam result id. Same
// cookie attributes as the admin session (HttpOnly, SameSite=Strict).
function setParticipantCookie(req, res, payload) {
  if (res.headersSent) return;
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
  res.setHeader(
    "Set-Cookie",
    `${PARTICIPANT_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PARTICIPANT_COOKIE_MAX_AGE_MS / 1000}${shouldUseSecureCookie(req) ? "; Secure" : ""}`,
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
    // Keputusan memakai predikat tracking (src/tracked-request.js — single
    // source of truth, dipakai juga oleh middleware observability metrik/trace/
    // access-log): hanya request BISNIS yang di-track yang mendapat perlakuan
    // auth. Path lowercase diteruskan ke predikat (R19 fix) — /Bank-soal.html
    // tetap terdeteksi sbg halaman HTML, konsisten dgn aturan tracking.
    // R19 fix + Review fix: do NOT use req.accepts("html") — default fetch
    // sends Accept: */* which would falsely match and redirect API calls.
    // Plain .html path check is sufficient (browsers navigate to .html).
    // ⚠️ Coupling: cabang redirect ini terikat aturan tracking (by design).
    // JANGAN ubah jadi isTrackedRequest(req) — req.path asli (mis. /BANK-SOAL.HTML)
    // case-sensitive → R19 regresi (401 bukan 302). Menghapus *.html dari
    // isTrackedPath juga akan memutus redirect login halaman CMS (401).
    if (isTrackedRequest({ path }) && path.endsWith(".html")) {
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
    setSessionCookie(req, res, {
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
    logger.info(
      { event: "admin.bootstrap", operation_status: "skipped", reason: "dev-mode" },
      "Bootstrap skipped (dev mode). Set NODE_ENV=production to test.",
    );
    return;
  }
  if (bootstrapDoneThisProcess) return;

  try {
    const { count, error: countError } = await supabase
      .from("admins")
      .select("*", { count: "exact", head: true });

    if (countError) throw countError;

    if (count > 0) {
      logger.warn(
        { event: "admin.bootstrap", operation_status: "skipped", reason: "admins-table-not-empty" },
        "BOOTSTRAP_ADMIN_* env vars set but admins table not empty. " +
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
        logger.info(
          { event: "admin.bootstrap", operation_status: "success", detail: "race-resolved-by-unique" },
          "Bootstrap race resolved by UNIQUE constraint.",
        );
        bootstrapDoneThisProcess = true;
        return;
      }
      throw insertError;
    }

    bootstrapDoneThisProcess = true;
    logger.info(
      {
        event: "admin.bootstrap",
        operation_status: "success",
        username: BOOTSTRAP_USERNAME,
      },
      "Bootstrap admin created. DELETE BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD env vars NOW.",
    );
  } catch (err) {
    // Rich error context: Node fetch errors stash the real network reason in
    // `err.cause` (err.message is just "fetch failed"); Supabase PostgREST
    // errors are plain objects with `message`/`code`/`details`. Print both.
    // errorField mempertahankan shape { type, code, message, stack, cause }
    // (spec §12.2 + cause utk Node fetch errors); details PostgREST tetap
    // dipertahankan terpisah.
    logger.error(
      {
        event: "admin.bootstrap",
        operation_status: "failed",
        error: errorField(err),
        details: err?.details ?? null,
      },
      "Admin bootstrap failed",
    );
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

    // Constant-time delay to prevent username enumeration. bcrypt compare
    // dibungkus span manual admin.login.verify (spec §4.6) — attribute hanya
    // username, TANPA password.
    if (error || !admin) {
      await withSpan("admin.login.verify", { username: normalizedUsername }, () =>
        bcrypt.compare(
          password,
          "$2a$10$dummy.hash.to.prevent.timing.attacks............",
        ),
      );
      logger.warn(
        { event: "auth.login", operation_status: "failed", reason: "no-such-user", username: normalizedUsername },
        "Failed login (no such user)",
      );
      return res.status(401).json({ error: "invalid credentials" });
    }

    const valid = await withSpan("admin.login.verify", { username: normalizedUsername }, () =>
      bcrypt.compare(password, admin.password_hash),
    );
    if (!valid) {
      logger.warn(
        { event: "auth.login", operation_status: "failed", reason: "bad-password", username: normalizedUsername },
        "Failed login (bad password)",
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
        logger.warn(
          { event: "auth.login", operation_status: "partial", detail: "last_login_at-update-failed", error: errorField(err) },
          "last_login_at update failed",
        );
      }
    })();

    logger.info(
      { event: "auth.login", operation_status: "success", username: normalizedUsername, admin_id: admin.id },
      "Successful login",
    );
    setSessionCookie(req, res, { adminId: admin.id, username: admin.username });
    res.json({ ok: true, username: admin.username });
  } catch (err) {
    logger.error({ event: "auth.login", operation_status: "failed", error: errorField(err) }, "Login failed");
    res.status(500).json({ error: "login failed" });
  }
});

// POST /api/admin/logout
app.post("/api/admin/logout", (req, res) => {
  if (!res.headersSent) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${shouldUseSecureCookie(req) ? "; Secure" : ""}`,
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
});// ============================================
// END ADMIN AUTH
// ============================================

// ============================================
// TKP SCORING (specs/tkp-scoring-spec.md §6 / §10)
// ============================================
// Server-authoritative scoring for TKP items uses per-option bobot
// from `option_scores` (admin-set per-question via single-question
// modal or via `Bobot:` line in bulk-parser, see §9.2). Non-TKP items
// keep the original binary scoring (correct=5, incorrect=0).

// Single source of truth for "is this question a TKP one?". Mirrors
// the client-side `isTkpType()` helper in kelola-soal.js. Keeps the
// server's branch logic identical to the client's.
function isTkp(question) {
  return (
    typeof question?.question_type === "string" &&
    question.question_type.toUpperCase().startsWith("TKP")
  );
}

// Per-soal score (mirror §6.1). Returns a numeric contribution that
// `computePackScore` sums across all questions in a pack.
//   - TWK/TIU (binary): upperAns === q.correct_answer ? 5 : 0
//   - TKP (weighted): option_scores[upperAns] ?? 0
//   - TKP without answer: 0
//   - Legacy migration safety (§11.2): TKP rows with NULL or empty
//     option_scores are scored as binary (correct=5, incorrect=0) so
//     existing results remain valid until admin fills bobot per-question.
//     Without this fallback, legacy TKP rows would silently regress to
//     0 every time their containing pack is re-submitted.
//
// Defensive normalizations (these mirror the V1-V4 server validation that
// runs on POST/PUT — they handle malformed-but-already-persisted rows):
//   - `ans` uppercased ONCE at the top so the equality branches AND the
//     TKP lookup share the same invariant (option_scores keys are
//     uppercase, correct_answer is uppercase; we never rely on the
//     caller's case).
//   - `q.option_scores` checked for null AND empty-shape (defence for any
//     legacy rows where shape validation was bypassed).
function scoreForQuestion(q, ans) {
  const upperAns =
    typeof ans === "string" ? ans.toUpperCase().trim() : ans;
  if (!isTkp(q)) {
    return upperAns && upperAns === q.correct_answer ? 5 : 0;
  }
  if (
    q.option_scores == null ||
    typeof q.option_scores !== "object" ||
    Object.keys(q.option_scores).length === 0
  ) {
    return upperAns && upperAns === q.correct_answer ? 5 : 0;
  }
  if (!upperAns) return 0;
  // ?? (not ||) to match spec §6.1 verbatim; lets a malformed legacy
  // row's NaN propagate instead of silently masking it (operator sees
  // the bug, not a misleading 0).
  return Number(q.option_scores[upperAns] ?? 0);
}

// V1-V4 server-side validation (mirror §10). Returns null on success,
// or { error } suitable for a 400 response shape.
//   - strict=true  → V1 enforce: TKP rows MUST have option_scores
//                    (used by single-question POST/PUT where admin
//                    explicitly committed a value).
//   - strict=false → V1 relaxed for bulk-import: TKP rows with null
//                    option_scores are allowed through; admin fills
//                    bobot later via the single-question modal.
function validateOptionScores(questionType, optionScores, { strict = true } = {}) {
  if (!isTkp({ question_type: questionType })) {
    return null; // V5 relaxed: non-TKP option_scores is inert
  }
  if (optionScores === null || optionScores === undefined) {
    return strict ? { error: "tkp scores required" } : null;
  }
  if (
    typeof optionScores !== "object" ||
    Array.isArray(optionScores)
  ) {
    return { error: "tkp scores shape" };
  }
  for (const k of ["A", "B", "C", "D", "E"]) {
    if (!(k in optionScores)) {
      return { error: "tkp scores shape" };
    }
  }
  const values = ["A", "B", "C", "D", "E"].map((k) => optionScores[k]);
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) {
    return { error: "tkp scores range" };
  }
  if (new Set(values).size !== 5) {
    return { error: "tkp scores must be exactly {1..5}" };
  }
  return null;
}

// --- API Endpoints (existing, unprotected for now)---

// Get all questions
app.get("/api/questions", async (req, res) => {
  try {
    const { data, error } = await supabase.from("questions").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    logger.error({ event: "question.list", operation_status: "failed", error: errorField(error) }, "Failed to fetch questions");
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
      // TKP option_scores must satisfy the §10 invariant. strict=true applies
      // V1-strict to bulk-import endpoint too: every TKP block MUST carry
      // `option_scores`. The bulk-parser (`public/js/bulk-parser.js`
      // `enrichTkpBobot`) rejects TKP-without-Bobot at parse-time with
      // error "bobot TKP wajib diisi"; this server check is defense-in-depth
      // for direct API calls that bypass the parser. See tkp-scoring-spec.md
      // §9.1 + §10 (V1-strict unified across single + bulk endpoints).
      const err = validateOptionScores(q.question_type, q.option_scores ?? null, {
        strict: true,
      });
      if (err) {
        return res.status(400).json({
          error: err.error,
          index: questions.indexOf(q),
        });
      }
    }

    const rows = questions.map(
      ({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        option_scores,
      }) => ({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        option_scores: option_scores ?? null,
        image_url: null,
        explanation_image_url: null,
      })
    );

    // Supabase's `.insert(rows).select()` sends a single PostgREST
    // request; PostgREST wraps the rows in one Postgres transaction so
    // any single insert failure rolls back the entire batch. Insert
    // dibungkus span manual question.bulk_add (spec §4.6).
    const { data, error } = await withSpan(
      "question.bulk_add",
      { count: rows.length },
      () => supabase.from("questions").insert(rows).select(),
    );

    if (error) throw error;

    res
      .status(201)
      .json({
        inserted: data.length,
        ids: data.map((d) => d.id),
      });
  } catch (error) {
    logger.error({ event: "question.bulk_add", operation_status: "failed", error: errorField(error) }, "Failed to bulk add questions");
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
    logger.error({ event: "question.bulk_usage", operation_status: "failed", error: errorField(error) }, "Failed to check usage");
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
    const summary = {
      event: "question.bulk_delete",
      total: ids.length,
      deleted: deleted.length,
      failed: failed.length,
    };
    if (failed.length > 0) {
      logger.warn({ ...summary, operation_status: "partial" }, "Bulk delete summary (some failed)");
    } else {
      logger.info({ ...summary, operation_status: "success" }, "Bulk delete summary");
    }

    res.json({ deleted, failed });
  } catch (error) {
    logger.error({ event: "question.bulk_delete", operation_status: "failed", error: errorField(error) }, "Failed to bulk delete questions");
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
      option_scores,
    } = req.body;
    let image_url = null;
    let explanation_image_url = null;

    // TKP rows MUST have option_scores at single-modal submit time
    // (strict V1) — mirroring the modal's client-side validation so a
    // misbehaving client can't smuggle an un-bobot'd TKP soal past.
    // Non-TKP rows accept option_scores null (V5 inert).
    const validationError = validateOptionScores(
      question_type,
      option_scores ?? null,
      { strict: true },
    );
    if (validationError) {
      return res.status(400).json({ error: validationError.error });
    }

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
        option_scores: option_scores ?? null,
        image_url,
        explanation_image_url,
      })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    logger.error({ event: "question.create", operation_status: "failed", error: errorField(error) }, "Failed to add question");
    res.status(500).json({ error: "Failed to add question" });
  }
});

// Get all question packs
app.get("/api/packs", async (req, res) => {
  try {
    // Newest packets first. id-desc breaks ties so two packets with the
    // same created_at get a stable order instead of an undefined
    // PostgREST tiebreaker. (UUID lex order is arbitrary for fresh rows;
    // the tiebreaker is for stability, not chronological meaning.)
    const [packsRes, countsRes] = await Promise.all([
      supabase
        .from("question_packs")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("exam_results")
        .select("pack_id")
        .limit(100000),
    ]);
    if (packsRes.error) throw packsRes.error;
    if (countsRes.error) throw countsRes.error;

    // Aggregate: count exam_results per pack_id
    const countsByPack = {};
    for (const row of countsRes.data) {
      countsByPack[row.pack_id] = (countsByPack[row.pack_id] || 0) + 1;
    }

    // Visibility gate (pack-visibility-spec.md §4.2): non-admin hanya dapat
    // pack 'public'; admin mendapat SEMUA termasuk 'archived' (dibutuhkan
    // CMS paket-soal.html untuk un-arsip). select-pack.js menyaring
    // 'archived' client-side (archived tidak boleh muncul di select-pack
    // untuk siapa pun — server tetap enforce 403 di /api/exam/start).
    const data = packsRes.data
      .filter((pack) => isPackVisibleTo(pack, req))
      .map((pack) => ({
        ...pack,
        completion_count: countsByPack[pack.id] || 0,
      }));
    res.json(data);
  } catch (error) {
    logger.error({ event: "pack.list", operation_status: "failed", error: errorField(error) }, "Failed to fetch packs");
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
    // Visibility gate (pack-visibility-spec.md §4.2): non-admin tidak boleh
    // membaca detail pack 'admin'/'archived' (403). Admin (CMS) bypass.
    if (!isPackVisibleTo(data, req)) {
      logger.warn(
        { event: "pack.access_denied", operation_status: "denied", pack_id: req.params.id },
        "Pack access denied (403)",
      );
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(data);
  } catch (error) {
    logger.error({ event: "pack.get", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to fetch pack");
    res.status(500).json({ error: "Failed to fetch pack" });
  }
});

// Pack input normalizer (POST + PUT share this). Returns { row, error }.
// - POST: allowPartial=false — semua field wajib ada.
// - PUT : allowPartial=true — field undefined di-drop untuk partial update.
// Validates subtests (1-3 of TWK/TIU/TKP) and subtest_thresholds shape per
// Indonesian SKD default map. Tidak ada lagi konsep pack_type — cukup
// panjang array subtests yang menentukan apakah paket itu 1-subtes
// (khusus) atau 2-3-subtes (combo).
const DEFAULT_SUBTEST_THRESHOLDS = { TWK: 65, TIU: 80, TKP: 166 };
// Visibility values (pack-visibility-spec.md §4.1) — sama dengan CHECK
// constraint di migration-007; server-side validation defense-in-depth.
const PACK_VISIBILITY_VALUES = new Set(["public", "admin", "archived"]);
function normalizePackInput(body, { allowPartial = false } = {}) {
  const {
    name,
    duration_minutes,
    passing_grade,
    subtests,
    subtest_thresholds,
    visibility,
  } = body || {};
  if (!allowPartial && (typeof name !== "string" || !name.trim())) {
    return { error: "name required" };
  }
  const dur = Number(duration_minutes);
  if (
    !allowPartial &&
    (!Number.isFinite(dur) || dur < 1)
  ) {
    return { error: "duration_minutes must be a positive integer" };
  }
  const pg = Number(passing_grade);
  if (!allowPartial && (!Number.isFinite(pg) || pg < 0)) {
    return { error: "passing_grade must be >= 0" };
  }
  // subtests default to all 3 if omitted (backward compat for legacy POST).
  // Batas: 1-3 (admin boleh pilih 1, 2, atau 3 subtes via checkbox di
  // modal). Tidak ada lagi validasi Single=1 / Combo=2-3. Dedupe
  // SELALU (preserve first-occurrence order) sehingga admin yang
  // mengirim ['TWK','TWK','TIU'] tetap konsisten — kita simpan
  // ['TWK','TIU'] tanpa 400.
  let normalizedSubtests = ["TWK", "TIU", "TKP"];
  if (Array.isArray(subtests)) {
    const validTokens = new Set(["TWK", "TIU", "TKP"]);
    const filtered = subtests.filter((s) => validTokens.has(s));
    if (filtered.length === 0) {
      return { error: "subtests must contain at least one of TWK/TIU/TKP" };
    }
    normalizedSubtests = Array.from(new Set(filtered));
  } else if (subtests !== undefined && !allowPartial) {
    return { error: "subtests must be an array" };
  }
  // subtest_thresholds shape: build map for selected subtests only.
  let normalizedThresholds = {};
  if (
    subtest_thresholds &&
    typeof subtest_thresholds === "object" &&
    !Array.isArray(subtest_thresholds)
  ) {
    for (const k of normalizedSubtests) {
      const v = Number(subtest_thresholds[k]);
      normalizedThresholds[k] =
        Number.isFinite(v) && v >= 0
          ? v
          : DEFAULT_SUBTEST_THRESHOLDS[k] || 0;
    }
  } else {
    for (const k of normalizedSubtests) {
      normalizedThresholds[k] = DEFAULT_SUBTEST_THRESHOLDS[k] || 0;
    }
  }
  // visibility (pack-visibility-spec.md §4.3): POST default 'public'
  // (requirement: paket baru default Publik); PUT hanya forward jika
  // benar-benar dikirim (partial update — jangan timpa nilai existing
  // dengan 'public' saat field dihilangkan). Nilai tak dikenal → 400.
  let normalizedVisibility;
  if (visibility !== undefined) {
    if (
      typeof visibility !== "string" ||
      !PACK_VISIBILITY_VALUES.has(visibility)
    ) {
      return { error: "visibility must be one of public/admin/archived" };
    }
    normalizedVisibility = visibility;
  } else if (!allowPartial) {
    normalizedVisibility = "public";
  }

  const row = {
    name: typeof name === "string" ? name.trim() : undefined,
    duration_minutes: Number.isFinite(dur) ? dur : undefined,
    passing_grade: Number.isFinite(pg) ? pg : undefined,
    subtests: normalizedSubtests,
    subtest_thresholds: normalizedThresholds,
    visibility: normalizedVisibility,
  };
  if (allowPartial) {
    // PUT: only forward fields that were actually provided.
    for (const k of Object.keys(row)) {
      if (row[k] === undefined) delete row[k];
    }
  }
  return { row };
}

// Create a new question pack
app.post("/api/packs", async (req, res) => {
  try {
    const { row, error } = normalizePackInput(req.body);
    if (error) return res.status(400).json({ error });
    const { data, error: dbError } = await supabase
      .from("question_packs")
      .insert(row)
      .select();
    if (dbError) throw dbError;
    res.status(201).json(data);
  } catch (error) {
    logger.error({ event: "pack.create", operation_status: "failed", error: errorField(error) }, "Failed to create pack");
    res.status(500).json({ error: "Failed to create pack" });
  }
});

// validateQuestionMatchesPack — server-side defense-in-depth for the
// subtes filter (subtes-picker-spec.md §2.3). The client-side
// filter in paket-detail.js `renderBankList` covers the happy path;
// this catches direct API calls (curl, future endpoints) that would
// otherwise let an admin bypass the UI and add a TKP soal to a
// Single-TWK pack.
//
// Returns { ok: true } on match; { ok: false, reason } on mismatch.
// Throws on DB error so the caller can map to 500.
async function validateQuestionMatchesPack(packId, questionId) {
  const [pRes, qRes] = await Promise.all([
    supabase
      .from("question_packs")
      .select("subtests")
      .eq("id", packId)
      .single(),
    supabase
      .from("questions")
      .select("question_type")
      .eq("id", questionId)
      .single(),
  ]);
  if (pRes.error) throw pRes.error;
  if (qRes.error) throw qRes.error;
  const allowed =
    Array.isArray(pRes.data?.subtests) && pRes.data.subtests.length
      ? pRes.data.subtests
      : ["TWK", "TIU", "TKP"]; // legacy packs fall back to all-3
  const qt = String(qRes.data?.question_type || "").trim().toUpperCase();
  const ok = allowed.some((s) => qt.startsWith(s));
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: `question_type "${qt}" does not match pack.subtests=[${allowed.join(",")}]`,
      };
}

// Add questions to a pack
app.post("/api/packs/:id/questions", async (req, res) => {
  try {
    const { question_id } = req.body;
    // Server-side subtest match (defense-in-depth vs client-side filter
    // in paket-detail.js renderBankList). Catches curl + future endpoints.
    const valid = await validateQuestionMatchesPack(
      req.params.id,
      question_id,
    );
    if (!valid.ok) {
      return res.status(400).json({ error: valid.reason });
    }
    // question_number SELALU ditentukan server: max(existing) + 1
    // (semantik append). Alasan (bug-fix 2026-08-12): klien lama mengirim
    // angka yang sama untuk seluruh batch (loop tidak pernah increment),
    // membuat banyak baris ber-question_number duplikat → urutan tampilan
    // jadi acak/tidak stabil di paket-detail/exam/review. Max+1 di sini
    // menjamin nomor unik sesuai urutan kedatangan request (= urutan
    // centang checkbox), sekaligus aman setelah penghapusan menyisakan
    // gap (mis. nomor 1,2,4,5 → soal baru dapat 6, tidak bentrok).
    // question_number dari klien DIABAIKAN; renumbering eksplisit
    // ditangani oleh PUT /api/packs/:id/questions.
    //
    // Race window antar tab admin (2026-08-12): max+1 bersifat
    // read-then-insert yang tidak atomik — dua POST konkuren bisa membaca
    // max yang sama lalu insert nomor yang sama. Ditutup dengan
    // UNIQUE(pack_id, question_number) di schema (migration-004) + retry
    // di sini: insert yang kalah race menerima error 23505 (unique
    // violation), lalu kita baca ulang max (fresh) dan insert ulang dengan
    // nomor berikutnya (bounded). Error selain 23505 fail-fast.
    const MAX_NUMBER_ATTEMPTS = 3;
    let inserted = null;
    let insertError = null;
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      const { data: maxRows, error: maxErr } = await supabase
        .from("pack_questions")
        .select("question_number")
        .eq("pack_id", req.params.id)
        .order("question_number", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;
      const nextNumber = (maxRows?.[0]?.question_number ?? 0) + 1;
      const insertRes = await supabase
        .from("pack_questions")
        .insert({
          pack_id: req.params.id,
          question_id,
          question_number: nextNumber,
        })
        .select();
      if (!insertRes.error) {
        inserted = insertRes.data;
        insertError = null;
        break;
      }
      insertError = insertRes.error;
      if (insertRes.error.code !== "23505") break;
    }
    if (insertError) throw insertError;
    res.status(201).json(inserted);
  } catch (error) {
    logger.error({ event: "pack.question_add", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to add question to pack");
    res.status(500).json({ error: "Failed to add question to pack" });
  }
});

// Get questions for a specific pack
app.get("/api/packs/:id/questions", async (req, res) => {
  try {
    // Visibility gate (pack-visibility-spec.md §4.2): endpoint ini adalah
    // satu-satunya jalur isi soal — non-admin TIDAK boleh membaca soal pack
    // 'admin'/'archived' (403). Admin (paket-detail, counts) bypass.
    // Diterima (R1.2 strict everywhere): participant yang pack-nya berubah
    // status setelah submit tidak bisa lagi buka review sendiri.
    const { data: pack, error: packErr } = await supabase
      .from("question_packs")
      .select("visibility")
      .eq("id", req.params.id)
      .single();
    if (packErr) throw packErr;
    if (!isPackVisibleTo(pack, req)) {
      logger.warn(
        { event: "pack.questions_denied", operation_status: "denied", pack_id: req.params.id },
        "Pack questions access denied (403)",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    // Deterministic tiebreak (bug-fix 2026-08-12): question_number bisa
    // duplikat untuk data lama (sebelum POST memakai max+1 server-side),
    // dan PostgREST tidak menjamin urutan antar baris bernomor sama —
    // urutan tampilan jadi berubah-ubah setiap add/delete/reload. Tambahan
    // order id ASC membuat baris bernomor sama tampil stabil (urutan
    // insertion), tanpa mengubah urutan nomor unik yang sudah benar.
    const { data, error } = await supabase
      .from("pack_questions")
      .select("*, questions(*)")
      .eq("pack_id", req.params.id)
      .order("question_number", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    res.json(data.map((item) => item.questions));
  } catch (error) {
    logger.error({ event: "pack.questions_get", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to fetch pack questions");
    res.status(500).json({ error: "Failed to fetch pack questions" });
  }
});

// --- Participant name validation (2026-08-19) ---
// Rules (interview 2026-08-19): hanya alfabet (A-Z/a-z) + spasi; TIDAK boleh
// diawali spasi; wajib non-empty setelah trim; maks 100 karakter. Dipakai
// server-side di exam/start + exam/submit (defense-in-depth — client sudah
// validasi inline di modal select-pack). Data lama yang tidak valid → 400.
const PARTICIPANT_NAME_MAX_LEN = 100;
function validateParticipantName(raw) {
  if (typeof raw !== "string") return { error: "nama peserta wajib diisi" };
  const name = raw.trim();
  if (!name) return { error: "nama peserta wajib diisi" };
  if (raw !== raw.trimStart()) {
    return { error: "nama peserta tidak boleh diawali spasi" };
  }
  if (name.length > PARTICIPANT_NAME_MAX_LEN) {
    return {
      error: `nama peserta terlalu panjang (maks ${PARTICIPANT_NAME_MAX_LEN} karakter)`,
    };
  }
  if (!/^[A-Za-z][A-Za-z ]*$/.test(name)) {
    return {
      error: "nama peserta hanya boleh berisi huruf alfabet dan spasi",
    };
  }
  return { name };
}

// Start exam
app.post("/api/exam/start", async (req, res) => {
  try {
    const { pack_id, participant_name } = req.body;
    // Nama peserta wajib valid (alfabet + spasi, tanpa spasi di awal) —
    // enforcement server-side, mirror validasi inline modal select-pack.
    const nameCheck = validateParticipantName(participant_name);
    if (nameCheck.error) {
      return res.status(400).json({ error: nameCheck.error });
    }
    const name = nameCheck.name;
    // Visibility gate (pack-visibility-spec.md §4.2) — titik enforce utama
    // "tak bisa dikerjakan": canWorkPack LEBIH strict dari isPackVisibleTo:
    //   - pack 'archived'  → 403 untuk SEMUA (termasuk admin)
    //   - pack 'admin'     → 403 untuk non-admin
    //   - pack 'public'    → lanjut
    const { data: pack, error: packErr } = await supabase
      .from("question_packs")
      .select("visibility")
      .eq("id", pack_id)
      .single();
    if (packErr || !pack) {
      logger.warn(
        { event: "exam.start.denied", operation_status: "denied", pack_id, reason: "pack-not-found" },
        "Exam start denied (pack not found)",
      );
      return res.status(404).json({ error: "Pack not found" });
    }
    if (!canWorkPack(pack, req)) {
      logger.warn(
        { event: "exam.start.denied", operation_status: "denied", pack_id, visibility: pack.visibility },
        "Exam start denied (403)",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    // Span manual exam.start.create (spec §4.6) — attribute hanya pack_id.
    const spanAttrs = {};
    if (pack_id !== undefined) spanAttrs.pack_id = pack_id;
    const { data, error } = await withSpan("exam.start.create", spanAttrs, () =>
      supabase
        .from("exam_results")
        .insert({
          pack_id,
          participant_name: name,
          score: 0,
          status: "In Progress",
          answers: {},
        })
        .select(),
    );
    if (error) throw error;
    logger.info(
      { event: "exam.start", operation_status: "success", pack_id, result_id: data[0]?.id },
      "Exam started",
    );
    res.status(201).json(data[0]);
  } catch (error) {
    logger.error({ event: "exam.start", operation_status: "failed", error: errorField(error) }, "Failed to start exam");
    res.status(500).json({ error: "Failed to start exam" });
  }
});

// Submit exam answers
app.post("/api/exam/submit", async (req, res) => {
  try {
    const { pack_id, participant_name, answers } = req.body;
    // Nama peserta wajib valid — enforcement sama dengan exam/start
    // (2026-08-19): menolak nama legacy/aneh di submit juga.
    const nameCheck = validateParticipantName(participant_name);
    if (nameCheck.error) {
      return res.status(400).json({ error: nameCheck.error });
    }
    const name = nameCheck.name;

    // Visibility gate (pack-visibility-spec.md §4.2) — defense-in-depth,
    // strict everywhere (R1.2): canWorkPack → archived 403 utk SEMUA
    // (termasuk admin); admin-only → 403 utk non-admin. SEBELUM
    // duplicate-check supaya peserta yang tidak berhak tidak bisa memaksa
    // submit via API langsung.
    const { data: packGate, error: packGateErr } = await supabase
      .from("question_packs")
      .select("visibility")
      .eq("id", pack_id)
      .single();
    if (packGateErr || !packGate) {
      logger.warn(
        { event: "exam.submit.denied", operation_status: "denied", pack_id, reason: "pack-not-found" },
        "Exam submit denied (pack not found)",
      );
      return res.status(404).json({ error: "Pack not found" });
    }
    if (!canWorkPack(packGate, req)) {
      logger.warn(
        { event: "exam.submit.denied", operation_status: "denied", pack_id, visibility: packGate.visibility },
        "Exam submit denied (403)",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    // Duplicate-submission guard (§defense-in-depth): satu peserta hanya
    // boleh submit satu kali per paket. Cek exact match participant_name +
    // pack_id sebelum melakukan scoring (mahal). Mengembalikan 409 Conflict
    // sehingga client bisa menampilkan pesan yang sesuai.
    const { data: existing, error: dupCheckErr } = await supabase
      .from("exam_results")
      .select("id")
      .eq("pack_id", pack_id)
      .eq("participant_name", name)
      .limit(1);
    if (dupCheckErr) throw dupCheckErr;
    if (existing && existing.length > 0) {
      logger.warn(
        { event: "exam.submit", operation_status: "duplicate", pack_id, result_id: existing[0].id },
        "Duplicate exam submission (409)",
      );
      // Fix 2026-08-19: bersihkan row In Progress dari percobaan yang
      // barusan ditolak (jangan sentuh hasil lama). Client mengirim
      // result_id yang didapat dari POST /api/exam/start; filter
      // pack_id + participant_name + status='In Progress' memastikan
      // row hasil LAMA yang sudah selesai tidak pernah tersentuh
      // walau client mengirim id yang salah.
      const rid = Number(req.body?.result_id);
      if (Number.isInteger(rid) && rid > 0) {
        const { error: delErr } = await supabase
          .from("exam_results")
          .delete()
          .eq("id", rid)
          .eq("pack_id", pack_id)
          .eq("participant_name", name)
          .eq("status", "In Progress");
        if (delErr) {
          logger.warn(
            {
              event: "exam.submit",
              operation_status: "partial",
              detail: "in-progress-cleanup-failed",
              error: errorField(delErr),
              result_id: rid,
            },
            "Gagal membersihkan row In Progress saat 409",
          );
        } else {
          logger.info(
            { event: "exam.submit", operation_status: "cleaned", result_id: rid, pack_id },
            "Row In Progress percobaan ditolak dihapus",
          );
        }
      }
      // Refresh participant cookie ke hasil yang sudah ada (2026-08-11):
      // kalau cookie asli sudah kadaluarsa, redirect ke review miliknya
      // sendiri setelah retry tetap diizinkan (bukan 403).
      setParticipantCookie(req, res, {
        kind: "participant",
        result_id: existing[0].id,
        participant_name: name,
      });
      return res.status(409).json({
        error: "Anda sudah menyelesaikan ujian ini sebelumnya.",
        existing_id: existing[0].id,
      });
    }

    const { data: packData, error: packError } = await supabase
      .from("question_packs")
      .select("passing_grade, subtests, subtest_thresholds")
      .eq("id", pack_id)
      .single();
    if (packError) throw packError;

    const { data: packQuestions, error: questionsError } = await supabase
      .from("pack_questions")
      .select("questions(*)")
      .eq("pack_id", pack_id);
    if (questionsError) throw questionsError;

    // Score per-question (binary for TWK/TIU; weighted for TKP via
    // option_scores, per tkp-scoring-spec.md §6.1). scoreForQuestion
    // is the single source of truth — see helper definition above the
    // API endpoints.
    const questions = packQuestions.map((item) => item.questions);
    // Span manual exam.submit.scoring (spec §4.6) — attribute hanya pack_id,
    // TANPA jawaban/request body.
    const score = withSpan(
      "exam.submit.scoring",
      { pack_id },
      () =>
        questions.reduce(
          (sum, q) => sum + scoreForQuestion(q, answers[q.id]),
          0,
        ),
    );

    // Per-subtest passing grade (per user request 2026-07-18 round 2):
    //   status = "Lulus PG" iff every active subtest.earned >= subtest.thresholds[sub].
    //   For 1-subtest packs (Single) this collapses to one comparison;
    //   for 2-3 subtests (Combo) every subtest must pass independently.
    //   Indonesian SKD per-subtest standard thresholds: TWK=65, TIU=80, TKP=166.
    //   Legacy fallback: if pack.subtest_thresholds is missing/empty (pre-
    //   migration-003 packs that predate subtests[]), fall back to the
    //   global passing_grade integer check for backward compatibility.
    const DEFAULT_SUBTEST_THRESHOLDS = { TWK: 65, TIU: 80, TKP: 166 };
    const activeSubtests =
      Array.isArray(packData.subtests) && packData.subtests.length
        ? packData.subtests
        : ["TWK", "TIU", "TKP"];
    const subtestEarned = { TWK: 0, TIU: 0, TKP: 0 };
    for (const q of questions) {
      const t = String(q.question_type || "").trim().toUpperCase();
      let bucket = null;
      if (t.startsWith("TWK")) bucket = "TWK";
      else if (t.startsWith("TKP")) bucket = "TKP";
      else if (t.startsWith("TIU")) bucket = "TIU";
      if (!bucket) continue;
      subtestEarned[bucket] += scoreForQuestion(q, answers[q.id]);
    }
    const thresholdsObj =
      packData.subtest_thresholds &&
      typeof packData.subtest_thresholds === "object" &&
      !Array.isArray(packData.subtest_thresholds)
        ? packData.subtest_thresholds
        : null;
    let status;
    if (thresholdsObj && Object.keys(thresholdsObj).length > 0) {
      const lulus = activeSubtests.every((sub) => {
        const earned = subtestEarned[sub] || 0;
        const threshold = Number(
          thresholdsObj[sub] ?? DEFAULT_SUBTEST_THRESHOLDS[sub],
        );
        return (
          Number.isFinite(threshold) && Number.isFinite(earned) && earned >= threshold
        );
      });
      status = lulus ? "Lulus PG" : "Tidak Lulus PG";
    } else {
      // Legacy single-threshold fallback (packs created before migration-003).
      const pg = Number(packData.passing_grade);
      status =
        Number.isFinite(pg) && score >= pg ? "Lulus PG" : "Tidak Lulus PG";
    }

    const { data, error } = await supabase
      .from("exam_results")
      .insert({ pack_id, participant_name: name, score, status, answers })
      .select();
    if (error) throw error;
    logger.info(
      {
        event: "exam.submit",
        operation_status: "success",
        pack_id,
        result_id: data[0]?.id,
        score,
      },
      "Exam submitted",
    );
    // Set participant cookie (2026-08-11): pemilik hasil ini. Dengan ini
    // peserta yang baru selesai ujian bisa membuka /review.html?id=...
    // miliknya sendiri, sementara hasil orang lain hanya untuk admin.
    // Cookie terikat ke result_id spesifik (least privilege) + HttpOnly.
    setParticipantCookie(req, res, {
      kind: "participant",
      result_id: data[0].id,
      participant_name: name,
    });
    res.status(201).json(data[0]);
  } catch (error) {
    logger.error({ event: "exam.submit", operation_status: "failed", error: errorField(error) }, "Failed to submit exam");
    res.status(500).json({ error: "Failed to submit exam" });
  }
});

// Get exam results — access-controlled (2026-08-11):
//   • Admin session (toskd_admin_sess) → boleh melihat hasil siapa pun
//     (termasuk link participant dari scoreboard.html).
//   • Participant cookie (toskd_participant_sess, diset saat submit) yang
//     result_id-nya cocok → peserta hanya bisa melihat hasilnya sendiri.
//   • Selain itu → 403 Forbidden. Melindungi /review.html?id=XXX dari
//     akses publik via scoreboard atau URL yang disalin.
app.get("/api/exam/:id/results", async (req, res) => {
  const admin = readSession(req);
  const participant = readParticipantSession(req);
  const requestedId = Number(req.params.id);
  const isOwner =
    !!participant &&
    participant.kind === "participant" &&
    Number(participant.result_id) === requestedId;
  if (!admin && !isOwner) {
    logger.warn(
      { event: "exam.results", operation_status: "denied", exam_id: req.params.id },
      "Exam results access denied (403)",
    );
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const { data, error } = await supabase
      .from("exam_results")
      .select("*, question_packs(*)")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    logger.error({ event: "exam.results", operation_status: "failed", error: errorField(error), exam_id: req.params.id }, "Failed to fetch exam results");
    res.status(500).json({ error: "Failed to fetch exam results" });
  }
});

// Get scoreboard
app.get("/api/scoreboard", async (req, res) => {
  try {
    const { pack_id } = req.query;
    // Visibility gate (pack-visibility-spec.md §4.2, R3.2): non-admin tidak
    // boleh lihat scoreboard paket 'admin'/'archived' meski via URL langsung
    // (403). Admin → semua.
    if (pack_id) {
      const { data: pack, error: packErr } = await supabase
        .from("question_packs")
        .select("visibility")
        .eq("id", pack_id)
        .single();
      if (packErr || !pack) {
        logger.warn(
          { event: "scoreboard.denied", operation_status: "denied", pack_id, reason: "pack-not-found" },
          "Scoreboard denied (pack not found)",
        );
        return res.status(404).json({ error: "Pack not found" });
      }
      if (!isPackVisibleTo(pack, req)) {
        logger.warn(
          { event: "scoreboard.denied", operation_status: "denied", pack_id, visibility: pack.visibility },
          "Scoreboard denied (403)",
        );
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const { data, error } = await supabase
      .from("exam_results")
      .select("participant_name, score, status")
      .eq("pack_id", pack_id)
      .order("score", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    logger.error({ event: "scoreboard.get", operation_status: "failed", error: errorField(error) }, "Failed to fetch scoreboard");
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
      option_scores,
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

    // TKP rows MUST have option_scores on edit too (strict V1).
    const validationError = validateOptionScores(
      question_type,
      option_scores ?? null,
      { strict: true },
    );
    if (validationError) {
      return res.status(400).json({ error: validationError.error });
    }

    const { data, error } = await supabase
      .from("questions")
      .update({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        option_scores: option_scores ?? null,
        image_url,
        explanation_image_url,
      })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    logger.error({ event: "question.update", operation_status: "failed", error: errorField(error), question_id: req.params.id }, "Failed to update question");
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
    logger.error({ event: "question.usage", operation_status: "failed", error: errorField(error), question_id: req.params.id }, "Failed to check usage");
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
    logger.error({ event: "image.upload", operation_status: "failed", error: errorField(error) }, "Failed to upload image");
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// ============================================
// IMAGE REHOST PROXY (public/js/image-uploader.js)
// ============================================
// POST /api/fetch-image — server-side download proxy for the markdown-image
// rehost pipeline. The client tries a direct `fetch(url, { referrerPolicy:
// "no-referrer" })` first (passes most Referer-based hotlink checks); when
// that is blocked (no CORS headers, strict anti-hotlink rules), the client
// falls back here. Node's fetch sends NO Referer header and is not subject
// to CORS, so this reliably retrieves images that browsers cannot.
//
// Returns `{ image: "data:<mime>;base64,..." }` — the client stages the
// bytes in IndexedDB and uploads them via /api/upload-image (keeps the
// local-storage-first flow the user specified).
//
// Security:
//   - requireAdmin (only authenticated CMS sessions can use the proxy).
//   - http(s) scheme only.
//   - SSRF guard: the hostname must resolve to a PUBLIC IP (loopback,
//     private, link-local and CGNAT ranges rejected) so the proxy can't be
//     abused to probe internal networks.
//   - Response must be an image Content-Type, non-empty, ≤ 8MB.
const FETCH_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const FETCH_IMAGE_TIMEOUT_MS = 15000;

// Private/reserved IPv4 + IPv6 ranges the proxy must never target.
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    // ::1 loopback, fc/fd unique-local, fe8-feB link-local, fec multicast.
    return (
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      /^fe[89ab]/.test(v) ||
      /^fec/.test(v)
    );
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number.isNaN(Number(p)))) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function isPublicHostname(hostname) {
  try {
    const { address } = await lookup(hostname);
    return !isPrivateIp(address);
  } catch {
    return false; // unresolvable → block
  }
}

app.post("/api/fetch-image", requireAdmin, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "url must be an http(s) URL" });
    }

    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return res.status(400).json({ error: "url is malformed" });
    }
    if (!(await isPublicHostname(hostname))) {
      return res.status(400).json({ error: "url host is not public" });
    }

    // NOTE: known TOCTOU — we validate the IP via lookup() above but then
    // fetch by hostname, so a DNS-rebinding race is theoretically possible.
    // Accepted trade-off: this endpoint is requireAdmin-guarded (only
    // authenticated CMS sessions), so the blast radius is the admin's own
    // browser.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_IMAGE_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TOSKD/1.0)" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: `upstream HTTP ${upstream.status}` });
    }
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    // Some CDNs serve images as application/octet-stream — accept those when
    // the URL path itself ends in a known image extension.
    const pathHasImageExt = /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(
      new URL(url).pathname,
    );
    const looksLikeImage =
      contentType.startsWith("image/") ||
      (contentType.includes("octet-stream") && pathHasImageExt);
    if (!looksLikeImage) {
      return res.status(400).json({ error: "upstream is not an image" });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0 || buf.length > FETCH_IMAGE_MAX_BYTES) {
      return res.status(400).json({ error: "image is empty or too large" });
    }
    const mime = contentType.split(";")[0].trim();
    res.json({
      image: `data:${mime};base64,${buf.toString("base64")}`,
    });
  } catch (error) {
    // AbortController timeout surfaces as AbortError.
    logger.error({ event: "image.fetch_proxy", operation_status: "failed", error: errorField(error) }, "Failed to fetch image via proxy");
    res.status(502).json({ error: "failed to fetch image" });
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
    logger.error({ event: "question.delete", operation_status: "failed", error: errorField(error), question_id: req.params.id }, "Failed to delete question");
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// Update a pack
app.put("/api/packs/:id", async (req, res) => {
  try {
    const { row, error } = normalizePackInput(req.body, {
      allowPartial: true,
    });
    if (error) return res.status(400).json({ error });
    const { data, error: dbError } = await supabase
      .from("question_packs")
      .update(row)
      .eq("id", req.params.id)
      .select();
    if (dbError) throw dbError;
    res.json(data[0]);
  } catch (error) {
    logger.error({ event: "pack.update", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to update pack");
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
    logger.error({ event: "pack.delete", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to delete pack");
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
    logger.error(
      { event: "pack.question_remove", operation_status: "failed", error: errorField(error), pack_id: req.params.packId, question_id: req.params.questionId },
      "Failed to remove question from pack",
    );
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
    logger.error({ event: "pack.question_reorder", operation_status: "failed", error: errorField(error), pack_id: req.params.id }, "Failed to update order");
    res.status(500).json({ error: "Failed to update order" });
  }
});

// Get scoreboard - enhanced with optional pack_id filter and created_at.
// Includes `id` so scoreboard.html can deep-link each row to
// /review.html?id=<id> (the review page reads ?id and fetches via
// /api/exam/:id/results).
app.get("/api/scoreboard-all", async (req, res) => {
  try {
    const { pack_id } = req.query;
    // Visibility gate (pack-visibility-spec.md §4.2, R3.2):
    //   - pack_id diberikan → non-admin dilarang utk pack 'admin'/'archived' (403).
    //   - tanpa pack_id      → non-admin hanya melihat hasil pack 'public'
    //     (filter di bawah setelah query) — admin melihat semua.
    if (pack_id) {
      const { data: pack, error: packErr } = await supabase
        .from("question_packs")
        .select("visibility")
        .eq("id", pack_id)
        .single();
      if (packErr || !pack) {
        logger.warn(
          { event: "scoreboard.denied", operation_status: "denied", pack_id, reason: "pack-not-found" },
          "Scoreboard denied (pack not found)",
        );
        return res.status(404).json({ error: "Pack not found" });
      }
      if (!isPackVisibleTo(pack, req)) {
        logger.warn(
          { event: "scoreboard.denied", operation_status: "denied", pack_id, visibility: pack.visibility },
          "Scoreboard denied (403)",
        );
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    let query = supabase
      .from("exam_results")
      .select(
        "id, participant_name, score, status, created_at, pack_id, question_packs(name)",
      )
      .order("score", { ascending: false })
      .order("created_at", { ascending: false });
    if (pack_id) query = query.eq("pack_id", pack_id);
    const { data, error } = await query;
    if (error) throw error;

    // Non-admin tanpa pack_id: sembunyikan hasil pack non-public (strict
    // everywhere — pack name + participant names tidak boleh bocor).
    if (!pack_id && !isAdminRequest(req)) {
      const { data: packs, error: packsErr } = await supabase
        .from("question_packs")
        .select("id, visibility");
      if (packsErr) throw packsErr;
      const visibleIds = new Set(
        (packs || [])
          .filter((p) => (p.visibility ?? "public") === "public")
          .map((p) => p.id),
      );
      res.json(data.filter((r) => visibleIds.has(r.pack_id)));
      return;
    }
    res.json(data);
  } catch (error) {
    logger.error({ event: "scoreboard.all", operation_status: "failed", error: errorField(error) }, "Failed to fetch scoreboard");
    res.status(500).json({ error: "Failed to fetch scoreboard" });
  }
});

// Reset scoreboard (admin only) — DELETE all exam_results rows.
// Menghapus seluruh hasil ujian: scoreboard.html jadi kosong, dan counter
// live "Dikerjakan N×" di paket-soal.html / select-pack.html (completion_count,
// dihitung dari exam_results di GET /api/packs) kembali ke 0.
app.delete("/api/scoreboard", requireAdmin, async (req, res) => {
  try {
    // PostgREST/Supabase menolak DELETE tanpa WHERE (error 21000), jadi
    // pakai filter .neq() yang cocok dengan SEMUA baris (id identity selalu > 0).
    const { data, error } = await supabase
      .from("exam_results")
      .delete()
      .neq("id", -1)
      .select("id");
    if (error) throw error;
    logger.info(
      { event: "scoreboard.reset", operation_status: "success", deleted: data?.length || 0 },
      "Scoreboard reset",
    );
    res.json({ success: true, deleted: data?.length || 0 });
  } catch (error) {
    logger.error({ event: "scoreboard.reset", operation_status: "failed", error: errorField(error) }, "Failed to reset scoreboard");
    res.status(500).json({ error: "Gagal mereset scoreboard" });
  }
});

// Delete single scoreboard row (admin only, 2026-08-19) — hapus SATU hasil
// ujian (mis. junk "In Progress" / duplikat nama). Kebalikan dari reset-all:
// menghapus hanya baris yang dipilih, completion_count ikut menurun otomatis.
app.delete("/api/scoreboard/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }
    const { data, error } = await supabase
      .from("exam_results")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "result not found" });
    }
    logger.info(
      { event: "scoreboard.delete", operation_status: "success", id },
      "Scoreboard row deleted",
    );
    res.json({ deleted: 1 });
  } catch (error) {
    logger.error({ event: "scoreboard.delete", operation_status: "failed", error: errorField(error) }, "Failed to delete scoreboard row");
    res.status(500).json({ error: "Gagal menghapus hasil ujian" });
  }
});

// Bulk delete scoreboard rows (admin only, 2026-08-19) — hapus beberapa hasil
// terpilih sekaligus (mirror pola bulk-delete soal: POST + body { ids }).
// Satu query PostgREST `in` (tanpa per-id allSettled — baris exam_results
// tidak punya dependensi FK, jadi partial-failure reporting tidak diperlukan).
app.post("/api/scoreboard/bulk-delete", requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: "max 1000 ids per request" });
    }
    const numericIds = ids
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (numericIds.length === 0) {
      return res.status(400).json({ error: "ids must be positive integers" });
    }
    const { data, error } = await supabase
      .from("exam_results")
      .delete()
      .in("id", numericIds)
      .select("id");
    if (error) throw error;
    logger.info(
      {
        event: "scoreboard.bulk_delete",
        operation_status: "success",
        deleted: data?.length ?? 0,
        requested: numericIds.length,
      },
      "Scoreboard bulk delete",
    );
    res.json({ deleted: data?.length ?? 0, requested: numericIds.length });
  } catch (error) {
    logger.error({ event: "scoreboard.bulk_delete", operation_status: "failed", error: errorField(error) }, "Failed to bulk delete scoreboard rows");
    res.status(500).json({ error: "Gagal menghapus hasil ujian" });
  }
});

// --- Health check (BEFORE static) ---
// GET /health — readiness probe. 200 { status: "ready", version } jika
// aplikasi berjalan + database reachable; 503 { status: "unavailable",
// version } jika DB check gagal. Dipakai Docker HEALTHCHECK (lihat
// Dockerfile) dan Caddy/monitoring eksternal.
// Timeout untuk DB smoke-test di /health — supabase-js fetch tidak punya
// default timeout; tanpa ini endpoint bisa hang selamanya untuk probe
// eksternal (Caddy/monitoring) saat network stall. Docker HEALTHCHECK punya
// --timeout sendiri, tapi probe lain butuh jaminan balasan cepat.
const HEALTH_DB_TIMEOUT_MS = 5000;

app.get("/health", async (req, res) => {
  try {
    // Smoke-test DB connectivity dengan query terkecil (limit 1, tanpa
    // data yang dibutuhkan). supabase-js tidak mengekspos raw SQL
    // (`select version()`), jadi cukup buktikan Supabase/PostgREST
    // reachable — error apa pun di sini berarti DB belum siap.
    const dbCheck = supabase.from("questions").select("id").limit(1);
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`DB check timed out after ${HEALTH_DB_TIMEOUT_MS}ms`)),
        HEALTH_DB_TIMEOUT_MS,
      ),
    );
    const { error } = await Promise.race([dbCheck, timeout]);
    if (error) throw error;
    res.json({ status: "ready", version: APP_VERSION });
  } catch (err) {
    logger.error({ event: "health.check", operation_status: "failed", error: errorField(err) }, "Health DB check failed");
    res.status(503).json({
      status: "unavailable",
      version: APP_VERSION,
      error: err?.message || "database unreachable",
    });
  }
});

// --- Static files (AFTER API routes & protected HTML routes) ---
app.use(express.static(PUBLIC_DIR));

// Run bootstrap check (async, non-blocking — does not delay startup).
// On Vercel serverless, this fires once per cold start. Idempotent.
maybeBootstrapAdmin().catch((err) =>
  logger.error({ event: "admin.bootstrap", operation_status: "failed", error: errorField(err) }, "Bootstrap uncaught error"),
);

// Local dev: listen on PORT. On Vercel this block is skipped because
// Vercel imports the module as a serverless function (app.listen would
// just hang). Enable with `pnpm start` for local curl testing.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    logger.info({ event: "server.listen", port: PORT, operation_status: "success" }, "Server listening");
  });

  // Graceful shutdown. IMPORTANT: without explicit handlers, Node running
  // as container PID 1 silently ignores SIGINT (Ctrl+C on `docker run -it`)
  // and SIGTERM (`docker stop`) — the kernel skips the default terminating
  // disposition for PID 1, so the container only dies via docker's 10s
  // SIGKILL fallback (or `docker stop --signal KILL`). Registering the
  // handlers makes Ctrl+C and `docker stop` stop the container instantly.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return; // second signal during grace period: ignore
    shuttingDown = true;
    logger.info({ event: "server.shutdown", signal, operation_status: "started" }, "Graceful shutdown initiated");
    // Stop accepting new connections immediately. closeIdleConnections drops
    // idle keep-alive sockets so close() doesn't wait for browser conns.
    const httpClosed = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections?.();
    // Safety net: if connections stay open / flush hangs, force exit so the
    // container never hangs past docker's stop timeout.
    const forceExit = setTimeout(() => {
      logger.error({ event: "server.shutdown", operation_status: "timeout", signal }, "Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 5000);
    forceExit.unref?.();
    // Flush pending telemetry (forceFlush) SEBELUM exit — process.exit(0)
    // di bawah hanya dijalankan setelah flush selesai, supaya in-flight
    // traces/metrics tidak terpotong di restart (spec §4.1).
    try {
      await shutdownTelemetry();
      logger.info({ event: "telemetry.shutdown", operation_status: "success" }, "Telemetry flushed");
    } catch (err) {
      logger.error({ event: "telemetry.shutdown", operation_status: "failed", error: errorField(err) }, "Telemetry flush failed");
    }
    // Tunggu koneksi HTTP drain (bounded oleh forceExit 5s di atas).
    await httpClosed;
    logger.info({ event: "server.shutdown", operation_status: "success" }, "HTTP server closed, exiting");
    process.exit(0);
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Export for Vercel serverless
export default app;
