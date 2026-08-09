// tests/test-markdown-render.mjs
// Round-17 (2026-08-09): lock-in tests for public/js/markdown-image.js —
// the shared single source of truth for inline markdown-image rendering
// (IMAGE_MD_REGEX + renderInlineMd HTML-input variant + renderInlinePreview
// raw-text variant + optional resolveUrl mapper). The helpers are pure
// (no window/document), so they are directly importable in Node.

import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_MD_REGEX,
  renderInlineMd,
  renderInlinePreview,
} from "../public/js/markdown-image.js";

const URL =
  "https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png";

// ============================================================================
// renderInlineMd — HTML-input variant (input is pre-escaped, no local esc)
// ============================================================================

test("renderInlineMd converts ![alt](url) to <img> with anti-hotlink hardening", () => {
  const html = renderInlineMd(`![\u201cDiagram\u201d](${URL})`);
  assert.match(html, /^<img /);
  assert.match(html, new RegExp(`src="${URL}"`));
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.match(html, /max-width:100%/);
});

test("renderInlineMd leaves non-string input untouched", () => {
  assert.equal(renderInlineMd(null), null);
  assert.equal(renderInlineMd(undefined), undefined);
  assert.equal(renderInlineMd(42), 42);
});

test("renderInlineMd leaves text without image markdown untouched", () => {
  const text = "<p>Halo <strong>dunia</strong></p>";
  assert.equal(renderInlineMd(text), text);
});

test("renderInlineMd does not double-escape entities already in pre-escaped input", () => {
  const html = renderInlineMd(`![A &amp; B](https://example.com/x.png)`);
  assert.match(html, /alt="A &amp; B"/);
  assert.doesNotMatch(html, /alt="A &amp;amp; B"/);
});

test("renderInlineMd is safe with $ backreferences in alt text (function replacer)", () => {
  const out = renderInlineMd("![img$2](https://example.com/x.png)");
  assert.match(out, /alt="img\$2"/); // literal $2, NOT capture-group 2 (the URL)
  assert.doesNotMatch(out, /alt="imghttps:\/\/example\.com\/x\.png"/);
});

test("renderInlineMd resolveUrl maps rehosted urls, keeps original when mapper returns null", () => {
  const map = (u) => (u === URL ? "https://blob.vercel-storage.com/x.png" : null);
  const html = renderInlineMd(
    `![x](${URL}) dan ![y](https://example.com/2.png)`,
    { resolveUrl: map },
  );
  assert.match(html, /src="https:\/\/blob\.vercel-storage\.com\/x\.png"/);
  assert.match(html, /src="https:\/\/example\.com\/2\.png"/);
});

// ============================================================================
// renderInlinePreview — raw-text variant (escapes non-match, bulk-md-image)
// ============================================================================

test("renderInlinePreview escapes non-image text and converts matches to bulk-md-image imgs", () => {
  const out = renderInlinePreview(`Lihat <b>gambar</b>:\n![Gambar A](${URL}) selesai.`);
  assert.match(out, /&lt;b&gt;gambar&lt;\/b&gt;/); // raw text escaped
  assert.match(
    out,
    new RegExp(
      `<img src="${URL}" alt="Gambar A" referrerpolicy="no-referrer" class="bulk-md-image">`,
    ),
  );
  assert.doesNotMatch(out, /<b>gambar<\/b>/);
});

test("renderInlinePreview is idempotent: empty → empty; no match → escaped original; null → empty", () => {
  assert.equal(renderInlinePreview(""), "");
  assert.equal(renderInlinePreview("teks biasa <script>"), "teks biasa &lt;script&gt;");
  assert.equal(renderInlinePreview(null), "");
});

test("renderInlinePreview resolveUrl mapper applies to image src", () => {
  const map = (u) => (u === URL ? "https://blob.example.com/a.png" : u);
  const out = renderInlinePreview(`![x](${URL})`, { resolveUrl: map });
  assert.match(out, /src="https:\/\/blob\.example\.com\/a\.png"/);
});

// ============================================================================
// IMAGE_MD_REGEX contract
// ============================================================================

test("IMAGE_MD_REGEX is the shared /g global instance", () => {
  assert.equal(IMAGE_MD_REGEX.flags.includes("g"), true);
  assert.equal(
    IMAGE_MD_REGEX.source,
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^)]*)?)\)/g.source,
  );
});
