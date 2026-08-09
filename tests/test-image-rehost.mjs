// tests/test-image-rehost.mjs
// Lock-in tests for the pure scan/replace helpers in
// public/js/image-uploader.js — the markdown-image → Vercel Blob rehost
// pipeline (Round-16, 2026-08-09).
//
// The browser-only parts (IndexedDB, fetch, AbortSignal) are guarded behind
// `typeof window !== "undefined"` / `typeof indexedDB !== "undefined"`, so
// importing this module in Node exercises only the pure functions:
//   - scanImageUrls()        — finds external image URLs in BOTH markdown
//                              `![alt](url)` AND `<img src="url">` forms,
//                              de-duplicated, Blob URLs excluded.
//   - applyUrlReplacements() — rewrites those forms to Vercel Blob URLs.
//   - isRehostedUrl()        — Blob-host detection.

import test from "node:test";
import assert from "node:assert/strict";
import {
  scanImageUrls,
  applyUrlReplacements,
  isRehostedUrl,
} from "../public/js/image-uploader.js";

const BLOB_URL = "https://abc123.public.blob.vercel-storage.com/questions/1712345678901.png";
const ORIG_URL = "https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png";

// ---------------------------------------------------------------------------
// isRehostedUrl
// ---------------------------------------------------------------------------

test("isRehostedUrl returns true for Vercel Blob public URLs", () => {
  assert.equal(isRehostedUrl(BLOB_URL), true);
  assert.equal(
    isRehostedUrl("https://x-y-z.public.blob.vercel-storage.com/a/b.png"),
    true,
  );
});

test("isRehostedUrl returns false for non-Blob URLs", () => {
  for (const url of [
    ORIG_URL,
    "https://example.com/a.png",
    "http://example.com/a.png",
    "https://cdn.example.com/img.jpg?w=100",
  ]) {
    assert.equal(isRehostedUrl(url), false, `expected false for ${url}`);
  }
});

test("isRehostedUrl returns false for junk input", () => {
  assert.equal(isRehostedUrl(""), false);
  assert.equal(isRehostedUrl(null), false);
  assert.equal(isRehostedUrl(undefined), false);
  assert.equal(isRehostedUrl("not a url"), false);
});

// ---------------------------------------------------------------------------
// scanImageUrls
// ---------------------------------------------------------------------------

test("scanImageUrls finds markdown image URLs", () => {
  const text = `Lihat gambar: ![Contoh Gambar](${ORIG_URL})`;
  assert.deepEqual(scanImageUrls(text), [ORIG_URL]);
});

test("scanImageUrls finds <img src> URLs (Quill paste-embed form)", () => {
  const html = `<p>Diagram:</p><p><img src="${ORIG_URL}"></p>`;
  assert.deepEqual(scanImageUrls(html), [ORIG_URL]);
});

test("scanImageUrls finds both forms and de-duplicates", () => {
  const text = `![a](${ORIG_URL}) dan <img src="${ORIG_URL}"> dan ![b](https://x.com/2.jpg)`;
  assert.deepEqual(scanImageUrls(text), [
    ORIG_URL,
    "https://x.com/2.jpg",
  ]);
});

test("scanImageUrls excludes already-rehosted Blob URLs", () => {
  const text = `![ok](${BLOB_URL}) dan ![not](${ORIG_URL})`;
  assert.deepEqual(scanImageUrls(text), [ORIG_URL]);
});

test("scanImageUrls ignores non-image and non-http(s) URLs", () => {
  const text =
    "![pdf](https://example.com/doc.pdf) " +
    "data:image/png;base64,iVBORw0KGgo= " +
    "https://example.com/plain.png"; // bare URL, not markdown, no <img> tag
  assert.deepEqual(scanImageUrls(text), []);
});

test("scanImageUrls handles empty / non-string input", () => {
  assert.deepEqual(scanImageUrls(""), []);
  assert.deepEqual(scanImageUrls(null), []);
  assert.deepEqual(scanImageUrls(undefined), []);
  assert.deepEqual(scanImageUrls(123), []);
});

test("scanImageUrls preserves first-occurrence order", () => {
  const text = `![a](https://x.com/1.png) ![b](https://x.com/1.png) ![c](https://x.com/2.jpg)`;
  assert.deepEqual(scanImageUrls(text), [
    "https://x.com/1.png",
    "https://x.com/2.jpg",
  ]);
});

test("scanImageUrls accepts query strings after the extension", () => {
  const url = "https://example.com/img.png?v=2&w=300";
  assert.deepEqual(scanImageUrls(`![x](${url})`), [url]);
});

// ---------------------------------------------------------------------------
// applyUrlReplacements
// ---------------------------------------------------------------------------

test("applyUrlReplacements rewrites markdown form to Blob URL", () => {
  const text = `![Contoh Gambar](${ORIG_URL})`;
  const out = applyUrlReplacements(text, { [ORIG_URL]: BLOB_URL });
  assert.equal(out, `![Contoh Gambar](${BLOB_URL})`);
});

test("applyUrlReplacements rewrites <img src> form to Blob URL", () => {
  const html = `<p><img src="${ORIG_URL}" style="max-width:100%"></p>`;
  const out = applyUrlReplacements(html, { [ORIG_URL]: BLOB_URL });
  assert.equal(out, `<p><img src="${BLOB_URL}" style="max-width:100%"></p>`);
});

test("applyUrlReplacements rewrites multiple occurrences + both forms", () => {
  const text = `![a](${ORIG_URL}) <img src="${ORIG_URL}"> ![b](https://x.com/2.jpg)`;
  const out = applyUrlReplacements(text, {
    [ORIG_URL]: BLOB_URL,
    "https://x.com/2.jpg": "https://other.public.blob.vercel-storage.com/2.png",
  });
  assert.equal(
    out,
    `![a](${BLOB_URL}) <img src="${BLOB_URL}"> ![b](https://other.public.blob.vercel-storage.com/2.png)`,
  );
});

test("applyUrlReplacements leaves unmapped URLs untouched", () => {
  const text = `![a](${ORIG_URL}) ![b](https://x.com/2.jpg)`;
  const out = applyUrlReplacements(text, { [ORIG_URL]: BLOB_URL });
  assert.equal(out, `![a](${BLOB_URL}) ![b](https://x.com/2.jpg)`);
});

test("applyUrlReplacements is a no-op for empty text / empty map", () => {
  assert.equal(applyUrlReplacements("", { [ORIG_URL]: BLOB_URL }), "");
  assert.equal(applyUrlReplacements(ORIG_URL, {}), ORIG_URL);
  assert.equal(applyUrlReplacements(ORIG_URL, null), ORIG_URL);
});

test("applyUrlReplacements does not mangle $ or backslashes in alt text", () => {
  const alt = "harga $100 \\ path";
  const text = `![${alt}](${ORIG_URL})`;
  const out = applyUrlReplacements(text, { [ORIG_URL]: BLOB_URL });
  assert.equal(out, `![${alt}](${BLOB_URL})`);
});

test("round-trip: scan then replace yields only Blob URLs", () => {
  const text = `Lihat: ![x](${ORIG_URL}) dan <img src="${ORIG_URL}"> end`;
  const urls = scanImageUrls(text);
  const map = {};
  for (const u of urls) map[u] = `https://${u.length}.public.blob.vercel-storage.com/1.png`;
  const out = applyUrlReplacements(text, map);
  assert.equal(out, `Lihat: ![x](https://${ORIG_URL.length}.public.blob.vercel-storage.com/1.png) dan <img src="https://${ORIG_URL.length}.public.blob.vercel-storage.com/1.png"> end`);
  // Re-scanning the output must find nothing left to rehost.
  assert.deepEqual(scanImageUrls(out), []);
});
