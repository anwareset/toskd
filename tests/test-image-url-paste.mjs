// tests/test-image-url-paste.mjs
// Round-9 / Round-9b / Round-9c: lock-in tests for IMAGE_URL_REGEX
// (raw URL) and IMAGE_MD_REGEX (markdown syntax) contracts used by
// bindPasteImageHandler() in public/js/kelola-soal.js.
//
// Drift risk: regex literals are duplicated here (not exported from the
// source). If public/js/kelola-soal.js changes either regex, update this
// test file. Acceptable for a single-source-pattern contract.

import test from "node:test";
import assert from "node:assert/strict";

// Regexes mirrored from public/js/kelola-soal.js (keep in sync).
// NOTE (post-Round-9d): IMAGE_URL_REGEX is no longer used in source (raw URL whole-text
// auto-embed was dropped per user request). The 11 IMAGE_URL_REGEX tests below are
// KEPT as documented contract for the URL-extension subpattern shared with
// IMAGE_MD_REGEX's URL group. If you remove the regex from source entirely,
// delete the IMAGE_URL_REGEX tests too.
const IMAGE_URL_REGEX = /^https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i;
const IMAGE_MD_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^)]*)?)\)/g;

// ============================================================================
// Round-9 / Round-9b: raw URL tests
// ============================================================================

test("IMAGE_URL_REGEX accepts a representative Indonesian CAT image URL", () => {
  assert.equal(IMAGE_URL_REGEX.test("https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png"), true);
});

test("IMAGE_URL_REGEX accepts common image extensions", () => {
  for (const url of [
    "https://example.com/a.png",
    "https://example.com/a.jpg",
    "https://example.com/a.jpeg",
    "https://example.com/a.gif",
    "https://example.com/a.webp",
    "https://example.com/a.svg",
    "https://example.com/a.bmp",
  ]) {
    assert.equal(IMAGE_URL_REGEX.test(url), true, `expected ACCEPT ${url}`);
  }
});

test("IMAGE_URL_REGEX accepts http (not just https)", () => {
  assert.equal(IMAGE_URL_REGEX.test("http://example.com/a.png"), true);
});

test("IMAGE_URL_REGEX accepts URL with query string after extension", () => {
  assert.equal(IMAGE_URL_REGEX.test("https://example.com/img.png?v=123&w=200"), true);
});

test("IMAGE_URL_REGEX accepts URL with port", () => {
  assert.equal(IMAGE_URL_REGEX.test("https://example.com:8443/img.png"), true);
});

test("IMAGE_URL_REGEX accepts URL with path containing dots (case-insensitive .PNG)", () => {
  assert.equal(IMAGE_URL_REGEX.test("https://example.com/path/with.dots/file.PNG"), true);
});

test("IMAGE_URL_REGEX REJECTS non-image extensions", () => {
  for (const url of [
    "https://example.com/file.pdf",
    "https://example.com/file.txt",
    "https://example.com/file.html",
    "https://example.com/file.css",
    "https://example.com/file.js",
    "https://example.com/file.mp4",
    "https://example.com/file.zip",
  ]) {
    assert.equal(IMAGE_URL_REGEX.test(url), false, `expected REJECT ${url}`);
  }
});

test("IMAGE_URL_REGEX REJECTS non-http schemes", () => {
  for (const input of [
    "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=", // raw text paste only; clipboard HTML <img> path is handled by Quill's default matchers separately
    "ftp://example.com/a.png",             // wrong scheme
    "file:///etc/passwd",
    "mailto:foo@example.com",
  ]) {
    assert.equal(IMAGE_URL_REGEX.test(input), false, `expected REJECT ${input}`);
  }
});

test("IMAGE_URL_REGEX REJECTS URLs with whitespace (multi-line / mid-sentence paste)", () => {
  for (const input of [
    "lihat https://example.com/a.png ya",       // mid-sentence
    "https://example.com/a.png\nhttps://other.com/b.jpg", // multi-line
    " https://example.com/a.png ",               // regex anchored ^...$ so external whitespace breaks the match; handler's .trim() runs first but regex is the formal contract
  ]) {
    assert.equal(IMAGE_URL_REGEX.test(input), false, `expected REJECT ${input}`);
  }
});

test("IMAGE_URL_REGEX REJECTS relative paths", () => {
  for (const input of [
    "/images/a.png",
    "../a.png",
    "a.png",
    "./a.png",
  ]) {
    assert.equal(IMAGE_URL_REGEX.test(input), false, `expected REJECT ${input}`);
  }
});

test("IMAGE_URL_REGEX REJECTS empty string and non-string", () => {
  assert.equal(IMAGE_URL_REGEX.test(""), false);
  assert.equal(IMAGE_URL_REGEX.test(null), false);
  assert.equal(IMAGE_URL_REGEX.test(undefined), false);
});

// ============================================================================
// Round-9c: markdown syntax tests
// ============================================================================

function mdMatches(text) {
  IMAGE_MD_REGEX.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = IMAGE_MD_REGEX.exec(text)) !== null) {
    matches.push({ alt: m[1], url: m[2], full: m[0] });
  }
  return matches;
}

test("IMAGE_MD_REGEX matches canonical Indonesian CAT URL in markdown syntax", () => {
  const text = "![img](https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png)";
  const matches = mdMatches(text);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, "https://soal121.tryoutsiswa.com/Images/SoalFile/954D8898B0974ABA973F2492420BBDED.png");
  assert.equal(matches[0].alt, "img");
});

test("IMAGE_MD_REGEX accepts all 7 image extensions", () => {
  for (const url of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.bmp"]) {
    const text = `![alt](https://example.com/${url})`;
    const matches = mdMatches(text);
    assert.equal(matches.length, 1, `expected MATCH for ${url}`);
    assert.equal(matches[0].url, `https://example.com/${url}`);
  }
});

test("IMAGE_MD_REGEX accepts alt text with spaces and special chars", () => {
  const matches = mdMatches("![Diagram alur 1: proses](https://example.com/x.png)");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].alt, "Diagram alur 1: proses");
});

test("IMAGE_MD_REGEX accepts query string in URL", () => {
  const matches = mdMatches("![x](https://example.com/img.png?v=2&w=300)");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, "https://example.com/img.png?v=2&w=300");
});

test("IMAGE_MD_REGEX accepts URL with port", () => {
  const matches = mdMatches("![x](https://example.com:8443/img.png)");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, "https://example.com:8443/img.png");
});

test("IMAGE_MD_REGEX finds multiple matches in one text", () => {
  const text = "Look ![a](https://x.com/1.png) then ![b](https://y.com/2.jpg) end";
  const matches = mdMatches(text);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].url, "https://x.com/1.png");
  assert.equal(matches[1].url, "https://y.com/2.jpg");
});

test("IMAGE_MD_REGEX REJECTS non-image extensions", () => {
  for (const ext of ["pdf", "txt", "html", "css", "js", "mp4", "zip"]) {
    const matches = mdMatches(`![alt](https://example.com/x.${ext})`);
    assert.equal(matches.length, 0, `expected REJECT for .${ext}`);
  }
});

test("IMAGE_MD_REGEX REJECTS malformed syntax (missing brackets)", () => {
  for (const text of [
    "![no close paren https://example.com/x.png",
    "!alt](https://example.com/x.png)",
    "![alt] https://example.com/x.png",
    "![alt](no http)",                  // no http scheme
    // Post-Round-9d polish: input `"![alt](https://example.com/x.png) extra )"` was REMOVED.
    // The markdown regex correctly consumes the leading `![alt](url)` portion (up to first
    // `)`) producing 1 match, but this test asserted 0. Trailing text-after-close-paren is
    // parsed by the markdown walker as inter-match text-Delta-op, intentionally.
  ]) {
    assert.equal(mdMatches(text).length, 0, `expected REJECT: ${JSON.stringify(text)}`);
  }
});

test("IMAGE_MD_REGEX works inside longer paragraph text (typical paste case)", () => {
  const text =
    "Berikut gambar diagram prosesnya:\n\n" +
    "![Diagram alur](https://example.com/diagram.png)\n\n" +
    "Penjelasan lebih detail menyusul.";
  const matches = mdMatches(text);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, "https://example.com/diagram.png");
  assert.equal(matches[0].alt, "Diagram alur");
});
