// scripts/migrate-images.mjs
// ============================================================================
// One-off migration: rehost every external image referenced by EXISTING
// questions to Vercel Blob (anti-hotlink strategy — see
// public/js/image-uploader.js for the runtime pipeline that new questions
// already use).
//
// Questions created BEFORE the rehost feature shipped still reference the
// original image servers inside content / options / explanation (and the
// legacy image_url / explanation_image_url columns). This script migrates
// those rows in bulk:
//
//   1. Read all questions from Supabase (paginated).
//   2. Collect every unique external image URL — markdown `![alt](url)` AND
//      `<img src="url">` forms (via scanImageUrls), plus the two legacy
//      URL columns.
//   3. Download each SERVER-SIDE (Node fetch sends no Referer and has no
//      CORS restrictions — same robustness as the POST /api/fetch-image
//      proxy in src/server.js) and upload to Vercel Blob via @vercel/blob.
//   4. Replace the original URLs in the question fields and write the rows
//      back to Supabase.
//
// IDEMPOTENT: URLs already on *.public.blob.vercel-storage.com are skipped,
// so re-running only processes the remaining (previously failed) images.
//
// SAFETY: default mode is DRY-RUN (report only — no downloads/uploads, no
// DB writes). Pass --apply to actually migrate.
//
// Usage:
//   node scripts/migrate-images.mjs                 # report only
//   node scripts/migrate-images.mjs --apply         # migrate for real
//
// Options:
//   --limit=100        process only the first N questions (newest first)
//   --concurrency=5    parallel image downloads/uploads (default 5)
//   --failures=f.json  write failed image URLs to a JSON file
//
// Required env (see .env.example):
//   SUPABASE_URL, SUPABASE_KEY, BLOB_READ_WRITE_TOKEN
//
// NOTE: unlike the public /api/fetch-image endpoint (which has an SSRF
// guard), this script runs locally as an admin/dev tool — scheme + size +
// content-type checks only.
// ============================================================================

import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  scanImageUrls,
  applyUrlReplacements,
  isRehostedUrl,
} from "../public/js/image-uploader.js";

// ---------------------------------------------------------------------------
// Pure helpers (Node-testable — no env, no network)
// ---------------------------------------------------------------------------

const OPTION_KEYS = ["A", "B", "C", "D", "E"];
const TEXT_FIELD_KEYS = ["content", "explanation"];
const DIRECT_URL_KEYS = ["image_url", "explanation_image_url"];

// Split a question row into (a) free-text fields that may contain inline
// markdown/<img> image references, and (b) plain URL columns.
export function collectQuestionImages(q) {
  const textFields = [];
  for (const k of TEXT_FIELD_KEYS) {
    if (typeof q?.[k] === "string" && q[k]) textFields.push(q[k]);
  }
  const opts = q?.options;
  if (opts && typeof opts === "object" && !Array.isArray(opts)) {
    for (const k of OPTION_KEYS) {
      if (typeof opts[k] === "string" && opts[k]) textFields.push(opts[k]);
    }
  }
  const directUrls = [];
  for (const k of DIRECT_URL_KEYS) {
    if (typeof q?.[k] === "string" && q[k]) directUrls.push(q[k]);
  }
  return { textFields, directUrls };
}

// Unique external image URLs across all questions (first-occurrence order).
// Blob-hosted URLs are excluded (nothing to migrate).
export function collectUniqueUrls(questions) {
  const seen = new Set();
  const urls = [];
  for (const q of questions) {
    const { textFields, directUrls } = collectQuestionImages(q);
    for (const field of textFields) {
      for (const u of scanImageUrls(field)) {
        if (!seen.has(u)) {
          seen.add(u);
          urls.push(u);
        }
      }
    }
    for (const u of directUrls) {
      if (!isRehostedUrl(u) && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
  }
  return urls;
}

// Build the DB-update row for one question after rehosting. `urlMap` is
// `{ originalUrl: blobUrl }`. Returns `{ changed, row }` — row only carries
// the fields that actually changed.
export function buildUpdatedQuestion(q, urlMap) {
  const applyText = (s) =>
    typeof s === "string" ? applyUrlReplacements(s, urlMap) : s;
  const row = {};
  let changed = false;

  for (const k of TEXT_FIELD_KEYS) {
    const v = applyText(q[k]);
    if (v !== q[k]) {
      row[k] = v;
      changed = true;
    }
  }

  if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) {
    const newOptions = { ...q.options };
    let optionsChanged = false;
    for (const k of OPTION_KEYS) {
      if (typeof newOptions[k] === "string") {
        const v = applyText(newOptions[k]);
        if (v !== newOptions[k]) {
          newOptions[k] = v;
          optionsChanged = true;
        }
      }
    }
    if (optionsChanged) {
      row.options = newOptions;
      changed = true;
    }
  }

  for (const k of DIRECT_URL_KEYS) {
    if (typeof q[k] === "string" && q[k] && urlMap[q[k]]) {
      row[k] = urlMap[q[k]];
      changed = true;
    }
  }

  return { changed, row };
}

// ---------------------------------------------------------------------------
// I/O glue (only executed when run directly)
// ---------------------------------------------------------------------------

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((err) => {
    console.error("[migrate-images] FATAL:", err?.message || err);
    process.exit(1);
  });
}

async function main() {
  const { default: supabase } = await import("../src/db.js");

  const APPLY = process.argv.includes("--apply");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 0) : 0;
  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg
    ? Math.max(1, parseInt(concurrencyArg.split("=")[1], 10) || 5)
    : 5;
  const failuresArg = process.argv.find((a) => a.startsWith("--failures="));
  const failuresPath = failuresArg ? failuresArg.split("=")[1] : null;

  console.log(`[migrate-images] mode=${APPLY ? "APPLY" : "DRY-RUN"} (--apply untuk migrasi)`);

  // ---- Phase 0: load questions (paginated, newest first) ----
  const { count, error: countError } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(`count gagal: ${countError.message}`);

  const total = limit ? Math.min(limit, count) : count;
  const questions = [];
  const PAGE_SIZE = 1000;
  for (let start = 0; start < total; start += PAGE_SIZE) {
    const end = Math.min(start + PAGE_SIZE, total) - 1;
    const { data, error } = await supabase
      .from("questions")
      .select("id, content, options, explanation, image_url, explanation_image_url")
      .order("id", { ascending: false })
      .range(start, end);
    if (error) throw new Error(`select gagal: ${error.message}`);
    questions.push(...data);
    console.log(`[migrate-images] memuat soal ${Math.min(start + PAGE_SIZE, total)}/${total}...`);
  }
  console.log(`[migrate-images] ${questions.length} soal dimuat.`);

  // ---- Phase 1: unique external image URLs + affected-question scope ----
  const urls = collectUniqueUrls(questions);
  const urlSet = new Set(urls);
  let affectedQuestions = 0;
  for (const q of questions) {
    const { textFields, directUrls } = collectQuestionImages(q);
    const hasUrl = textFields.some((f) =>
      scanImageUrls(f).some((u) => urlSet.has(u)),
    ) || directUrls.some((u) => urlSet.has(u));
    if (hasUrl) affectedQuestions++;
  }
  console.log(
    `[migrate-images] ${urls.length} URL gambar eksternal unik ditemukan di ${affectedQuestions} soal.`,
  );

  if (urls.length === 0) {
    console.log("[migrate-images] Tidak ada gambar untuk dimigrasi. Selesai.");
    return;
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] Tidak ada unduhan/unggahan/perubahan DB yang dilakukan.");
    console.log(`Perkiraan: ${affectedQuestions} soal akan ter-update.`);
    console.log("Contoh URL yang akan dimigrasi:");
    for (const u of urls.slice(0, 10)) console.log(`  - ${u}`);
    if (urls.length > 10) console.log(`  … dan ${urls.length - 10} URL lainnya.`);
    console.log("\nJalankan dengan --apply untuk benar-benar memigrasi.");
    return;
  }

  // ---- Phase 2: download + upload each unique URL (pooled) ----
  console.log(
    `[migrate-images] Mengunggah ${urls.length} gambar untuk ~${affectedQuestions} soal (concurrency=${concurrency})...`,
  );
  const results = await mapPool(
    urls,
    async (url, i) => {
      try {
        return await uploadImage(url, i);
      } catch (err) {
        console.error(`[migrate-images] GAGAL ${url}: ${err.message}`);
        return { url, blobUrl: null };
      }
    },
    concurrency,
  );

  const urlMap = {};
  const failed = [];
  for (const r of results) {
    if (r.blobUrl) urlMap[r.url] = r.blobUrl;
    else failed.push(r.url);
  }
  console.log(
    `[migrate-images] ${Object.keys(urlMap).length} gambar diunggah, ${failed.length} gagal.`,
  );

  if (failuresPath && failed.length > 0) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(failuresPath, JSON.stringify(failed, null, 2));
    console.log(`[migrate-images] URL gagal ditulis ke ${failuresPath}`);
  }

  // ---- Phase 3: build updated rows + write to DB (pooled) ----
  const updates = [];
  for (const q of questions) {
    const { changed, row } = buildUpdatedQuestion(q, urlMap);
    if (changed) updates.push({ id: q.id, row });
  }
  console.log(`[migrate-images] ${updates.length} soal akan diupdate.`);

  let updated = 0;
  let updateFailed = 0;
  await mapPool(
    updates,
    async ({ id, row }) => {
      try {
        const { error } = await supabase
          .from("questions")
          .update(row)
          .eq("id", id);
        if (error) throw error;
        updated++;
      } catch (err) {
        // Covers both supabase-returned errors AND thrown network errors
        // (so a transient blip doesn't abort the whole run via Promise.all).
        updateFailed++;
        console.error(`[migrate-images] update soal #${id} gagal: ${err?.message || err}`);
      }
    },
    Math.min(10, Math.max(1, updates.length)),
  );

  console.log(
    `[migrate-images] Selesai: ${updated} soal ter-update, ${updateFailed} update gagal, ${failed.length} gambar gagal diunggah.`,
  );
  if (failed.length > 0) {
    console.log("[migrate-images] Jalankan ulang (idempotent) untuk mencoba gambar yang gagal.");
  }
}

// Simple bounded worker pool: run `worker(item, index)` for every item with
// at most `concurrency` in flight. Returns results in input order.
async function mapPool(items, worker, concurrency) {
  let next = 0;
  const results = new Array(items.length);
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

// ---- Download / upload primitives ----

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const IMAGE_PATH_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    // image/* accepted; also tolerate CDNs serving images as
    // application/octet-stream when the path ends in an image extension.
    const isImage =
      contentType.startsWith("image/") ||
      (contentType.includes("octet-stream") &&
        IMAGE_PATH_EXT_RE.test(new URL(url).pathname));
    if (!isImage) throw new Error(`bukan gambar (content-type "${contentType || "none"}")`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("body kosong");
    if (buf.length > MAX_BYTES)
      throw new Error(`terlalu besar (${(buf.length / (1024 * 1024)).toFixed(1)} MB)`);
    return {
      buf,
      contentType: (contentType.split(";")[0] || "image/png").trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extFromUrl(url) {
  const m = new URL(url).pathname.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i);
  if (!m) return "png";
  const e = m[1].toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}

async function uploadImage(url, index) {
  // isRehostedUrl() URLs never reach here — collectUniqueUrls filters them
  // out — kept as a defensive guard for direct callers.
  if (isRehostedUrl(url)) return { url, blobUrl: url };
  const { buf, contentType } = await downloadImage(url);
  const { put } = await import("@vercel/blob");
  const path = `migration/${Date.now()}-${index}.${extFromUrl(url)}`;
  const { url: blobUrl } = await put(path, buf, { access: "public", contentType });
  return { url, blobUrl };
}
