// tests/test-migrate-images.mjs
// Lock-in tests for the pure helpers in scripts/migrate-images.mjs — the
// one-off bulk migration that rehosts existing questions' external images
// to Vercel Blob (collectQuestionImages / collectUniqueUrls /
// buildUpdatedQuestion). The I/O glue (supabase, @vercel/blob, fetch) is
// only imported lazily inside main(), so these helpers are importable
// without any env vars.

import test from "node:test";
import assert from "node:assert/strict";
import {
  collectQuestionImages,
  collectUniqueUrls,
  buildUpdatedQuestion,
} from "../scripts/migrate-images.mjs";

const ORIG_URL = "https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png";
const ORIG2_URL = "https://example.com/diagram.png";
const BLOB_URL = "https://abc123.public.blob.vercel-storage.com/migration/1712345678901.png";

function makeQuestion(overrides = {}) {
  return {
    id: 1,
    content: `<p>Lihat gambar: ![Diagram](${ORIG_URL})</p>`,
    options: { A: `<p><img src="${ORIG2_URL}"></p>`, B: "teks biasa", C: "c", D: "d", E: "e" },
    explanation: `<p>Pembahasan dengan <img src="${ORIG_URL}"></p>`,
    image_url: null,
    explanation_image_url: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// collectQuestionImages
// ---------------------------------------------------------------------------

test("collectQuestionImages collects content, explanation, options and direct URL columns", () => {
  const q = makeQuestion({ image_url: ORIG_URL, explanation_image_url: ORIG2_URL });
  const { textFields, directUrls } = collectQuestionImages(q);
  assert.equal(textFields.length, 7); // content + explanation + 5 options
  assert.ok(textFields.includes(q.content));
  assert.ok(textFields.includes(q.options.A));
  assert.ok(textFields.includes(q.explanation));
  assert.deepEqual(directUrls, [ORIG_URL, ORIG2_URL]);
});

test("collectQuestionImages tolerates missing/null fields", () => {
  const { textFields, directUrls } = collectQuestionImages({
    id: 9,
    content: "teks saja",
    options: null,
    explanation: null,
  });
  assert.deepEqual(textFields, ["teks saja"]);
  assert.deepEqual(directUrls, []);
});

// ---------------------------------------------------------------------------
// collectUniqueUrls
// ---------------------------------------------------------------------------

test("collectUniqueUrls finds markdown + <img> + direct-column URLs, de-duplicated", () => {
  const q1 = makeQuestion({ image_url: ORIG_URL }); // ORIG appears in content, explanation AND image_url
  const q2 = {
    id: 2,
    content: `<p>![Gambar](${ORIG2_URL}) lagi</p>`,
    options: { A: "", B: "", C: "", D: "", E: "" },
    explanation: `<p>x</p>`,
    image_url: null,
    explanation_image_url: BLOB_URL, // already rehosted → excluded
  };
  const urls = collectUniqueUrls([q1, q2]);
  assert.deepEqual(urls, [ORIG_URL, ORIG2_URL]);
});

test("collectUniqueUrls excludes Blob-hosted URLs and handles empty input", () => {
  assert.deepEqual(collectUniqueUrls([]), []);
  const urls = collectUniqueUrls([
    makeQuestion({
      content: `![ok](${BLOB_URL})`,
      options: { A: "", B: "", C: "", D: "", E: "" },
      explanation: `<p>tanpa gambar</p>`,
    }),
  ]);
  assert.deepEqual(urls, []);
});

// ---------------------------------------------------------------------------
// buildUpdatedQuestion
// ---------------------------------------------------------------------------

test("buildUpdatedQuestion replaces markdown, <img src> and direct URL columns", () => {
  const q = makeQuestion({ image_url: ORIG_URL, explanation_image_url: ORIG2_URL });
  const urlMap = { [ORIG_URL]: BLOB_URL, [ORIG2_URL]: BLOB_URL };
  const { changed, row } = buildUpdatedQuestion(q, urlMap);

  assert.equal(changed, true);
  // content: markdown form
  assert.ok(row.content.includes(`![Diagram](${BLOB_URL})`));
  assert.ok(!row.content.includes(ORIG_URL));
  // options.A: <img src> form
  assert.ok(row.options.A.includes(`<img src="${BLOB_URL}">`));
  assert.ok(!row.options.A.includes(ORIG2_URL));
  // options.B: unchanged value preserved (the whole JSONB object is
  // written back — identical values for untouched keys are harmless)
  assert.equal(row.options.B, "teks biasa");
  // explanation: <img src> form of ORIG_URL
  assert.ok(row.explanation.includes(`<img src="${BLOB_URL}">`));
  // legacy columns
  assert.equal(row.image_url, BLOB_URL);
  assert.equal(row.explanation_image_url, BLOB_URL);
});

test("buildUpdatedQuestion returns changed=false when nothing references the map", () => {
  const q = makeQuestion({ content: "teks tanpa gambar" });
  const { changed, row } = buildUpdatedQuestion(q, { "https://other.com/x.png": BLOB_URL });
  assert.equal(changed, false);
  assert.deepEqual(row, {});
});

test("buildUpdatedQuestion leaves unmapped URLs untouched", () => {
  const q = makeQuestion(); // ORIG_URL in content/explanation, ORIG2_URL in options.A
  const { changed, row } = buildUpdatedQuestion(q, { [ORIG_URL]: BLOB_URL });
  assert.equal(changed, true);
  assert.ok(row.content.includes(`![Diagram](${BLOB_URL})`));
  // ORIG2_URL not in the map → options.A unchanged → options NOT part of
  // the update row (row.options is only set when an option actually changed)
  assert.equal(row.options, undefined);
  assert.ok(q.options.A.includes(ORIG2_URL)); // original untouched
});

test("buildUpdatedQuestion handles malformed rows defensively", () => {
  const { changed, row } = buildUpdatedQuestion(
    { id: 3, content: null, options: "bukan objek", explanation: null },
    { [ORIG_URL]: BLOB_URL },
  );
  assert.equal(changed, false);
  assert.deepEqual(row, {});
});
