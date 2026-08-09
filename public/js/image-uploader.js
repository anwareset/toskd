// public/js/image-uploader.js
// ============================================================================
// Markdown-image rehost pipeline (2026-08-09).
//
// User request: every time admin enters `![alt](https://URL.COM/X.png)` —
// in the single-question modal (Add/Edit Soal) OR the bulk paste editor —
// the image should be:
//   1. downloaded into LOCAL STORAGE (browser),
//   2. uploaded to Vercel Blob (via POST /api/upload-image),
//   3. removed from local storage once the Blob upload succeeded,
//   4. and the Vercel Blob URL is what ends up displayed in the
//      kelola-soal preview, exam.html and review.html.
//
// This is the anti-hotlink strategy: exam/review pages never load the
// original server's image directly (many Indonesian CAT hosts block
// hotlinking via Referer checks), they load a copy hosted on Vercel Blob.
//
// Why IndexedDB instead of `localStorage`? localStorage only stores small
// strings (~5MB total) — far too small for base64-encoded images. IndexedDB
// stores real Blobs, survives page reloads, and is exactly the "local
// storage" staging area the flow needs: if the upload fails or the tab is
// closed mid-flight, the staged Blob is retried on the next page load
// (resumePending()) instead of re-downloading the source.
//
// Load order: this file is loaded as `<script type="module">` BEFORE
// `kelola-soal.js` (module scripts are deferred and execute in document
// order), then attaches `window.ImageUploader`.
//
// Browser-only parts (IndexedDB, fetch, AbortSignal) are guarded so the
// pure scan/replace helpers can be imported by tests (Node has no
// window/indexedDB).
// ============================================================================

// IMAGE_MD_REGEX lives in public/js/markdown-image.js (Round-17 — single
// source of truth for the markdown ![]() image pattern; also used by
// kelola-soal.js / exam.js / review.js and mirrored in
// tests/test-image-url-paste.mjs). Captures: 1 = alt text, 2 = url ending
// in image-ext.
import { IMAGE_MD_REGEX } from "./markdown-image.js";

// `<img src="...">` tags inside Quill innerHTML (created when the admin
// PASTES markdown — bindPasteImageHandler converts it to an image embed).
// Double-quoted src only; matches what Quill emits.
const IMG_SRC_RE = /<img\b[^>]*\bsrc="([^"]+)"/gi;

// URL-level image-extension guard for img-src URLs (mirrors the markdown
// regex's URL group). Optional query string allowed.
const IMG_EXT_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?\S*)?$/i;

// Vercel Blob public URLs end with this hostname suffix — they are already
// rehosted and must never be re-downloaded/re-uploaded.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

// ---- Pure helpers (Node-testable) ---------------------------------------

export function isRehostedUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

// Scan a text/HTML string for external image URLs in BOTH forms:
//   - markdown `![alt](url)`
//   - `<img src="url">` (from Quill's paste handler)
// Returns a de-duplicated array of http(s) image URLs that are NOT yet
// hosted on Vercel Blob. Preserves first-occurrence order.
export function scanImageUrls(text) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  const seen = new Set();

  const mdRe = new RegExp(IMAGE_MD_REGEX.source, "g");
  let m;
  while ((m = mdRe.exec(text)) !== null) {
    const url = m[2];
    if (!seen.has(url) && !isRehostedUrl(url)) {
      seen.add(url);
      found.push(url);
    }
  }

  const imgRe = new RegExp(IMG_SRC_RE.source, "gi");
  let m2;
  while ((m2 = imgRe.exec(text)) !== null) {
    const url = (m2[1] || "").trim();
    if (url && IMG_EXT_RE.test(url) && !seen.has(url) && !isRehostedUrl(url)) {
      seen.add(url);
      found.push(url);
    }
  }

  return found;
}

// Apply a `{ originalUrl: blobUrl }` map to a text/HTML string, rewriting
// both markdown `![alt](url)` and `<img src="url">` occurrences whose URL
// has a replacement. Unmapped occurrences are left untouched. Function
// replacers (not string patterns) so `$`/backslashes in alt text or URLs
// are never interpreted as substitution tokens.
export function applyUrlReplacements(text, urlMap) {
  if (typeof text !== "string" || !text) return text;
  if (!urlMap || typeof urlMap !== "object") return text;
  const keys = Object.keys(urlMap);
  if (keys.length === 0) return text;

  let out = text.replace(new RegExp(IMAGE_MD_REGEX.source, "g"), (full, alt, url) => {
    const repl = urlMap[url];
    return repl ? `![${alt}](${repl})` : full;
  });

  out = out.replace(new RegExp(IMG_SRC_RE.source, "gi"), (full) => {
    const srcMatch = full.match(/src="([^"]+)"/i);
    if (!srcMatch) return full;
    const repl = urlMap[srcMatch[1]];
    return repl ? full.replace(`src="${srcMatch[1]}"`, `src="${repl}"`) : full;
  });

  return out;
}

// ---- Browser-only pipeline (guarded) ------------------------------------

const DB_NAME = "toskd-image-staging";
const STORE = "images";
// Max size we'll attempt to rehost (matches the 10mb express.json cap on
// /api/upload-image minus base64 overhead — a ~7MB binary becomes ~9.3MB
// of base64 text). Larger images keep their original URL.
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

let _dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "url" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbGet(url) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(url);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(url, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ url, blob, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(url) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = (meta.match(/^data:([^;]+)/) || [])[1] || "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Download the image. Client-first with `referrerPolicy: "no-referrer"`
// (the standard anti-hotlink trick — many hosts only block based on the
// Referer header). If the client fetch is blocked (CORS missing, etc.)
// fall back to POST /api/fetch-image, a server-side proxy with no Referer
// and no CORS restrictions.
async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      referrerPolicy: "no-referrer",
      mode: "cors",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`client fetch HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error("empty response body");
    return blob;
  } catch (clientErr) {
    const res = await fetch("/api/fetch-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`server fetch HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.image) throw new Error("no image in server response");
    return dataUrlToBlob(data.image);
  }
}

// Upload a Blob to Vercel Blob via the existing /api/upload-image endpoint.
async function uploadImage(blob) {
  const image = await blobToDataUrl(blob);
  const res = await fetch("/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ image, folder: "questions" }),
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.url) throw new Error("no url in upload response");
  return data.url;
}

// ---- In-session registry + async pipeline --------------------------------
// registry: url -> { status: 'pending'|'done'|'failed', blobUrl? }
// inFlight: url -> Promise (dedup concurrent rehosts of the same URL)

const registry = new Map();
const inFlight = new Map();
const listeners = new Set();

export function onRehosted(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitRehosted() {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch (err) {
      console.warn("[image-uploader] listener error:", err);
    }
  }
}

// Sync lookup: returns the Blob URL if `url` was already rehosted this
// session, otherwise null.
export function getBlobUrl(url) {
  const r = registry.get(url);
  return r && r.status === "done" ? r.blobUrl : null;
}

// Rehost one image URL. Returns the Vercel Blob URL on success, or null
// on failure (the caller keeps the original URL in that case).
export async function rehostImage(url) {
  if (!url || isRehostedUrl(url)) return null;

  const existing = registry.get(url);
  // A URL that already FAILED this session is NOT retried: the textarea
  // still holds the original URL, so emitting on failure would make the
  // onRehosted listener re-scan → rehost → fail → emit again — an infinite
  // retry loop hammering the network while the modal is open. Failed URLs
  // stay at the original (still displayed) URL; the user can re-trigger by
  // editing the text again (text-change re-runs the scan, and registry
  // entries are per-page-load so a reload also re-attempts them).
  if (existing && existing.status === "failed") return null;
  if (existing && existing.status === "done") return existing.blobUrl;
  if (inFlight.has(url)) return inFlight.get(url);

  const promise = (async () => {
    registry.set(url, { status: "pending" });
    try {
      // 1) Local storage: reuse a staged Blob from a previous session if
      //    present (avoids re-downloading after a tab close / failed upload).
      let blob = null;
      try {
        const rec = await idbGet(url);
        if (rec && rec.blob instanceof Blob && rec.blob.size > 0) blob = rec.blob;
      } catch {
        // storage unavailable — continue with download
      }

      // 2) Download (client no-referrer → server proxy fallback).
      if (!blob) {
        blob = await downloadImage(url);
      }
      // Size gate applies to BOTH freshly-downloaded and re-staged blobs
      // (a staged blob from a previous session could exceed the cap).
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("image too large");

      // 3) Stage into local storage (IndexedDB). Best-effort: a storage
      //    failure must not block the upload.
      try {
        await idbPut(url, blob);
      } catch {
        // ignore
      }

      // 4) Upload to Vercel Blob.
      const blobUrl = await uploadImage(blob);

      // 5) Upload succeeded → clear the local storage copy.
      try {
        await idbDelete(url);
      } catch {
        // ignore
      }

      registry.set(url, { status: "done", blobUrl });
      emitRehosted();
      return blobUrl;
    } catch (err) {
      // Keep the staged Blob in local storage so resumePending() can retry
      // the upload (no re-download needed) on a later page load.
      registry.set(url, { status: "failed" });
      console.error("[image-uploader] rehost failed:", url, "→", err?.message || err);
      // No emitRehosted() here on purpose — see the "failed" guard above.
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, promise);
  return promise;
}

// Scan `text` (markdown or HTML), rehost every external image URL found
// (awaiting in-flight uploads), and return the text with all successfully
// rehosted URLs replaced by their Vercel Blob URLs. Failed URLs stay as-is.
export async function processText(text) {
  if (typeof text !== "string" || !text) return text;
  const urls = scanImageUrls(text);
  if (urls.length === 0) return text;

  await Promise.all(urls.map((u) => rehostImage(u)));

  const urlMap = {};
  for (const u of urls) {
    const blobUrl = getBlobUrl(u);
    if (blobUrl) urlMap[u] = blobUrl;
  }
  if (Object.keys(urlMap).length === 0) return text;
  return applyUrlReplacements(text, urlMap);
}

// Retry any staged Blobs left in local storage from a previous session
// (tab closed mid-upload, upload failed, etc.) — upload them without
// re-downloading. Called once on window 'load'.
export async function resumePending() {
  if (typeof indexedDB === "undefined") return 0;
  let done = 0;
  try {
    const records = await idbAll();
    for (const rec of records) {
      if (!rec || !(rec.blob instanceof Blob) || rec.blob.size === 0) continue;
      if (rec.blob.size > MAX_IMAGE_BYTES) continue;
      if (registry.get(rec.url)?.status === "done") continue;
      try {
        const blobUrl = await uploadImage(rec.blob);
        await idbDelete(rec.url);
        registry.set(rec.url, { status: "done", blobUrl });
        done++;
      } catch (err) {
        console.warn("[image-uploader] resumePending failed:", rec.url, "→", err?.message || err);
      }
    }
    if (done > 0) emitRehosted();
  } catch (err) {
    console.warn("[image-uploader] resumePending:", err?.message || err);
  }
  return done;
}

// Attach to window + auto-resume on load (browser only — Node test imports
// skip this because `window` is undefined).
if (typeof window !== "undefined") {
  window.ImageUploader = {
    IMAGE_MD_REGEX,
    isRehostedUrl,
    scanImageUrls,
    applyUrlReplacements,
    onRehosted,
    getBlobUrl,
    rehostImage,
    processText,
    resumePending,
  };
  window.addEventListener("load", () => {
    resumePending().catch(() => {});
  });
}
