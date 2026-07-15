// test-bulk-parser.mjs
// ============================================================================
// Unit tests for public/js/bulk-parser.js — pure parser for the Bulk Add
// feature. Covers all 18 test vectors from bulk-add-format-v2-spec.md §8.
//
// Run with: `pnpm test` (auto-discovers all tests under tests/)
// or: `node --test tests/test-bulk-parser.mjs` (single file)
//
// Uses `createRequire` to load the UMD-style parser — it works as both a
// browser script (window.bulkParser) AND a CommonJS module (module.exports).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBulkText,
  parseBlock,
  escapeHtml,
  previewHtmlForCell,
  isLeadIn,
  findExplicitOptionsIndex,
  looksLikeQuestion,
  MAX_PREMISES,
  MAX_LINES_PER_BLOCK,
  PREMISE_RE,
  OPTION_RE,
} from "../public/js/bulk-parser.js";

const TYPE = "TWK Pilar Negara";

// Helper: rebuild the expected `<ol>…<p>` content string for assertions.
function expectedContent(premises, question) {
  const liHtml = premises.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  return `<ol>${liHtml}</ol><p>${escapeHtml(question)}</p>`;
}

// ============================================================================
// §8.1 Happy path — new format with 6 premises
// ============================================================================
test("§8.1 happy path: 6-premise new format, 2 blocks", () => {
  const input = [
    "1) Premise one",
    "2) Premise two",
    "3) Premise three",
    "4) Premise four",
    "5) Premise five",
    "6) Premise six",
    "The actual question text",
    "A. 1, 2, dan 4",
    "B. 2, 3, dan 5",
    "C. 2, 4, dan 6",
    "D. 1, 2, dan 5",
    "E. 3, 5, dan 6",
    "D",
    "This is the explanation",
    "It spans multiple lines",
    "---",
    "1) P1",
    "2) P2",
    "Q2?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl2",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 2);

  // Block 1
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].errors, []);
  assert.deepEqual(r[0].premises, [
    "Premise one",
    "Premise two",
    "Premise three",
    "Premise four",
    "Premise five",
    "Premise six",
  ]);
  assert.equal(r[0].question, "The actual question text");
  assert.equal(
    r[0].content,
    expectedContent(r[0].premises, "The actual question text"),
  );
  assert.deepEqual(r[0].options, {
    A: "1, 2, dan 4",
    B: "2, 3, dan 5",
    C: "2, 4, dan 6",
    D: "1, 2, dan 5",
    E: "3, 5, dan 6",
  });
  assert.equal(r[0].correct_answer, "D");
  assert.equal(
    r[0].explanation,
    "This is the explanation\nIt spans multiple lines",
  );
  assert.equal(r[0].question_type, TYPE);

  // Block 2
  assert.equal(r[1].status, "valid");
  assert.deepEqual(r[1].premises, ["P1", "P2"]);
  assert.equal(r[1].question, "Q2?");
  assert.deepEqual(r[1].options, { A: "a", B: "b", C: "c", D: "d", E: "e" });
  assert.equal(r[1].correct_answer, "A");
  assert.equal(r[1].explanation, "Expl2");
});

// ============================================================================
// §8.2 Happy path — old format (no premises)
// ============================================================================
test("§8.2 happy path: old format, no premises", () => {
  const input = [
    "What is 2+2?",
    "A. 3",
    "B. 4",
    "C. 5",
    "D. 6",
    "E. 7",
    "B",
    "Because 2+2=4.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.equal(r[0].content, "What is 2+2?"); // plain text, no HTML
  assert.deepEqual(r[0].premises, []); // empty for old format
  assert.equal(r[0].question, "What is 2+2?");
  assert.deepEqual(r[0].options, { A: "3", B: "4", C: "5", D: "6", E: "7" });
  assert.equal(r[0].correct_answer, "B");
  assert.equal(r[0].explanation, "Because 2+2=4.");
});

// ============================================================================
// §8.3 Mixed format in one paste (auto-detect per block)
// ============================================================================
test("§8.3 mixed format: old + new + old in one paste", () => {
  const input = [
    "Old format Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Old expl",
    "---",
    "1) NewP1",
    "2) NewP2",
    "NewQ?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "B",
    "New expl",
    "---",
    "Another old Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "C",
    "Yet another expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 3);

  assert.equal(r[0].status, "valid");
  assert.equal(r[0].content, "Old format Q?");
  assert.deepEqual(r[0].premises, []);

  assert.equal(r[1].status, "valid");
  assert.deepEqual(r[1].premises, ["NewP1", "NewP2"]);
  assert.equal(r[1].question, "NewQ?");
  assert.equal(r[1].content, expectedContent(["NewP1", "NewP2"], "NewQ?"));

  assert.equal(r[2].status, "valid");
  assert.equal(r[2].content, "Another old Q?");
  assert.deepEqual(r[2].premises, []);
});

// ============================================================================
// §8.4 Premise sequence break (skip number)
// ============================================================================
test("§8.4 premise sequence break: 1, 3 (skip 2)", () => {
  const input = [
    "1) P1",
    "3) P3",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "invalid");
  assert.deepEqual(r[0].errors, [
    "premise nomor 3 di posisi 2 (harusnya 2)",
  ]);
});

// ============================================================================
// §8.5 Premise starts at wrong number (2 first, no 1)
// ============================================================================
test("§8.5 premise starts at wrong number: 2 first", () => {
  const input = [
    "2) P2",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "invalid");
  assert.deepEqual(r[0].errors, [
    "premise nomor 2 di posisi 1 (harusnya 1)",
  ]);
});

// ============================================================================
// §8.6 Question line starts with premise-like pattern
// ============================================================================
test("§8.6 question line starts with 1) (caught by sequential check)", () => {
  const input = [
    "1) P1",
    "1) Apa itu Pancasila?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "invalid");
  // Caught by sequential check (duplicate `1)` at position 2).
  assert.deepEqual(r[0].errors, [
    "premise nomor 1 di posisi 2 (harusnya 2)",
  ]);
});

// ============================================================================
// §8.7 Premise with `1.` (dot) variant
// ============================================================================
test("§8.7 premise with dot variant: 1. 2.", () => {
  const input = [
    "1. P1",
    "2. P2",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].premises, ["P1", "P2"]);
});

// ============================================================================
// §8.8 Premise with `(1)` (paren) variant
// ============================================================================
test("§8.8 premise with paren variant: (1) (2)", () => {
  const input = [
    "(1) P1",
    "(2) P2",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].premises, ["P1", "P2"]);
});

// ============================================================================
// §8.9 20-premise boundary (valid at 20, invalid at 21)
// ============================================================================
test("§8.9a 20 premises: valid (boundary inclusive)", () => {
  const lines = [];
  for (let i = 1; i <= 20; i++) lines.push(`${i}) P${i}`);
  lines.push("Q?", "A. a", "B. b", "C. c", "D. d", "E. e", "A", "Expl");
  const r = parseBulkText(lines.join("\n"), TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.equal(r[0].premises.length, 20);
});

test("§8.9b 21 premises: invalid (max 20)", () => {
  const lines = [];
  for (let i = 1; i <= 21; i++) lines.push(`${i}) P${i}`);
  lines.push("Q?", "A. a", "B. b", "C. c", "D. d", "E. e", "A", "Expl");
  const r = parseBulkText(lines.join("\n"), TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "invalid");
  assert.deepEqual(r[0].errors, ["terlalu banyak premise (max 20)"]);
});

// ============================================================================
// §8.10 Option with no A. prefix
// ============================================================================
test("§8.10 options without A./B. prefix: stored as-is", () => {
  const input = [
    "1) P1",
    "Q?",
    "1, 2, dan 4",
    "2, 3, dan 5",
    "2, 4, dan 6",
    "1, 2, dan 5",
    "3, 5, dan 6",
    "D",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].options, {
    A: "1, 2, dan 4",
    B: "2, 3, dan 5",
    C: "2, 4, dan 6",
    D: "1, 2, dan 5",
    E: "3, 5, dan 6",
  });
});

// ============================================================================
// §8.11 CRLF line endings
// ============================================================================
test("§8.11 CRLF line endings: parse identically to LF", () => {
  const lines = [
    "1) P1",
    "2) P2",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ];
  const lfInput = lines.join("\n");
  const crlfInput = lines.join("\r\n");

  const r1 = parseBulkText(lfInput, TYPE);
  const r2 = parseBulkText(crlfInput, TYPE);
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.equal(r1[0].status, "valid");
  assert.equal(r2[0].status, "valid");
  assert.equal(r1[0].content, r2[0].content);
  assert.deepEqual(r1[0].options, r2[0].options);
});

// ============================================================================
// §8.12 Trailing `---`
// ============================================================================
test("§8.12 trailing ---: empty trailing chunk dropped", () => {
  const input = [
    "1) P1",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
    "---",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
});

// ============================================================================
// §8.13 Empty blocks (multiple `---` in a row)
// ============================================================================
test("§8.13 multiple --- in a row: empty block dropped", () => {
  const input = [
    "1) P1",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
    "---",
    "---",
    "1) P2",
    "Q2?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl2",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 2);
  assert.equal(r[0].status, "valid");
  assert.equal(r[1].status, "valid");
  assert.equal(r[0].premises[0], "P1");
  assert.equal(r[1].premises[0], "P2");
});

// ============================================================================
// §8.14 Mixed tabs/spaces in leading whitespace
// ============================================================================
test("§8.14 mixed leading whitespace (tabs+spaces): parsed correctly", () => {
  const input = "   1) P1\n\t\t2) P2\nQ?\nA. a\nB. b\nC. c\nD. d\nE. e\nA\nExpl";

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].premises, ["P1", "P2"]);
});

// ============================================================================
// §8.15 Lowercase key
// ============================================================================
test("§8.15 lowercase key 'd': uppercased to 'D' on store", () => {
  const input = [
    "1) P1",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "d", // lowercase
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.equal(r[0].correct_answer, "D");
});

// ============================================================================
// §8.16 Pembahasan with internal blank lines (known limitation)
// ============================================================================
test("§8.16 pembahasan with internal blank line: blank line dropped", () => {
  const input = [
    "1) P1",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "First line of explanation.",
    "", // blank line in middle (will be dropped by filter)
    "Third line (blank line in between).",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  // Blank line silently dropped — documented limitation in spec §8.16
  assert.equal(
    r[0].explanation,
    "First line of explanation.\nThird line (blank line in between).",
  );
});

// ============================================================================
// §8.17 MathJax in premise text (\\( \\) preserved literally)
// ============================================================================
test("§8.17 MathJax delimiters in premise: \\( \\) preserved literally", () => {
  const input = [
    "1) Premise with \\(x^2\\) math",
    "2) Another premise",
    "Q?",
    "A. \\(a\\)",
    "B. \\(b\\)",
    "C. \\(c\\)",
    "D. \\(d\\)",
    "E. \\(e\\)",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  // \\( and \\) are NOT HTML-escaped (escapeHtml leaves parentheses alone)
  assert.equal(r[0].premises[0], "Premise with \\(x^2\\) math");
  assert.equal(
    r[0].content,
    "<ol><li>Premise with \\(x^2\\) math</li><li>Another premise</li></ol><p>Q?</p>",
  );
  assert.equal(r[0].options.A, "\\(a\\)");
});

// ============================================================================
// previewHtmlForCell: 1-line preview rendering helper
// ============================================================================
// Used by kelola-soal.js (table preview) and paket-detail.js (bank
// list + pack list). Replaces <ol>...</ol> with a "📋 N Premise"
// inline chip and <img> with a "📷 Ada Gambar" chip, then strips
// <p> / <br> tags so the result fits on a single line under
// `white-space: nowrap` + `text-overflow: ellipsis`.

// (a) plain text — returned as-is
test("previewHtmlForCell (a) plain text: returned unchanged (no markers)", () => {
  const result = previewHtmlForCell("What is 2+2?");
  assert.equal(result, "What is 2+2?");
  assert.ok(!result.includes("<"));
  assert.ok(!result.includes("span"));
});

// (b) new format with N premises — <ol>...</ol> replaced by "📋 N Premise"
test("previewHtmlForCell (b) new format with 6 premises: <ol> replaced by '📋 6 Premise' chip", () => {
  const html =
    "<ol>" +
    "<li>P1</li>" +
    "<li>P2</li>" +
    "<li>P3</li>" +
    "<li>P4</li>" +
    "<li>P5</li>" +
    "<li>P6</li>" +
    "</ol>" +
    "<p>Question text</p>";
  const result = previewHtmlForCell(html);
  // <ol> is gone, replaced by exactly one premise-marker chip with N=6
  assert.ok(!result.includes("<ol>"), "<ol> should be removed");
  assert.ok(!result.includes("<li>"), "<li> should be removed");
  assert.ok(!result.includes("<p>"), "<p>/</p> should be removed");
  assert.ok(
    result.includes('<span class="premise-marker">📋 6 Premise</span>'),
    `expected premise chip in: ${result}`,
  );
  // Question text preserved (after <p> strip)
  assert.ok(result.includes("Question text"));
});

// (b2) single premise — N=1 edge case
test("previewHtmlForCell (b2) single premise: chip says '1 Premise'", () => {
  const html = "<ol><li>Only one</li></ol><p>Q?</p>";
  const result = previewHtmlForCell(html);
  assert.ok(result.includes("📋 1 Premise"));
  assert.ok(result.includes("Q?"));
});

// (c) content with <img> — replaced by "📷 Ada Gambar" chip
test("previewHtmlForCell (c) content with <img>: replaced by '📷 Ada Gambar' chip", () => {
  const html = '<p>Look at this image:</p><img src="x.png" alt="x">';
  const result = previewHtmlForCell(html);
  assert.ok(!result.includes("<img"), "<img> should be removed");
  assert.ok(
    result.includes('<span class="img-marker">📷 Ada Gambar</span>'),
    `expected img chip in: ${result}`,
  );
  assert.ok(result.includes("Look at this image:"));
});

// (d) content with both <ol> and <img> — BOTH chips appear
test("previewHtmlForCell (d) content with both <ol> and <img>: BOTH chips appear, <ol> and <img> removed", () => {
  const html =
    "<ol>" +
    "<li>P1</li>" +
    "<li>P2</li>" +
    "</ol>" +
    "<p>Question</p>" +
    '<img src="x.png">';
  const result = previewHtmlForCell(html);
  // Both chips present
  assert.ok(result.includes("📋 2 Premise"), `expected premise chip in: ${result}`);
  assert.ok(result.includes("📷 Ada Gambar"), `expected img chip in: ${result}`);
  // No block tags left
  assert.ok(!result.includes("<ol>"));
  assert.ok(!result.includes("<li>"));
  assert.ok(!result.includes("<p>"));
  assert.ok(!result.includes("<img"));
  // Question text preserved
  assert.ok(result.includes("Question"));
});

// (e) empty string — returned as empty string
test("previewHtmlForCell (e) empty string: returned as empty string", () => {
  assert.equal(previewHtmlForCell(""), "");
  assert.equal(previewHtmlForCell(null), "");
  assert.equal(previewHtmlForCell(undefined), "");
});

// Bonus: content with lead-in (from §8.19) — lead-in is a <p>...<p> wrapper
// that should also be stripped, leaving just the chip + question.
test("previewHtmlForCell (bonus) new format with lead-in: lead-in <p> stripped, chip + question remain", () => {
  const html =
    "<p>Perhatikan pernyataan-pernyataan berikut ini!</p>" +
    "<ol>" +
    "<li>P1</li>" +
    "<li>P2</li>" +
    "</ol>" +
    "<p>Question?</p>";
  const result = previewHtmlForCell(html);
  assert.ok(!result.includes("<p>"), "<p> from lead-in should be stripped");
  assert.ok(result.includes("📋 2 Premise"));
  assert.ok(result.includes("Perhatikan pernyataan-pernyataan berikut ini!"));
  assert.ok(result.includes("Question?"));
});

// ============================================================================
// §8.19 Lead-in line: "Perhatikan pernyataan-pernyataan berikut ini!"
// ============================================================================
// Common Indonesian CAT pattern where a sentence introducing the
// premises appears BEFORE the numbered list. Without lead-in
// detection, the parser would mis-classify this block as old format
// (the lead-in would become the "question", premises would become
// options, and the key validation would fail on the first premise
// line). With the fix, the lead-in is stored as a leading <p> in
// the content HTML.
test("§8.19 lead-in: 'Perhatikan pernyataan...' before premises (user's reported case)", () => {
  const input = [
    "Perhatikan pernyataan-pernyataan berikut ini!",
    "1) Warga memanfaatkan teknologi digital untuk memperkenalkan budaya Indonesia secara positif.",
    "2) Masyarakat memeriksa kebenaran informasi digital sebelum membagikannya.",
    "3) Aparatur negara menggunakan teknologi untuk meningkatkan kualitas layanan publik.",
    "4) Warga lebih memilih konten global edukatif yang sesuai dengan kebutuhan.",
    "5) Tokoh masyarakat mengajak warga menggunakan teknologi secara bijak.",
    "6) Masyarakat mengikuti tren teknologi global sebagai bentuk keterbukaan terhadap inovasi.",
    "Manfaat utama dari penerapan nasionalisme dalam pemanfaatan teknologi ditunjukkan oleh perilaku …",
    "1, 2, dan 4",
    "2, 3, dan 5",
    "2, 4, dan 6",
    "1, 2, dan 5",
    "3, 5, dan 6",
    "D",
    "Penerapan nasionalisme dalam pemanfaatan teknologi tercermin dari perilaku memperkenalkan budaya bangsa secara positif melalui teknologi digital (1), memeriksa kebenaran informasi sebelum menyebarkannya sebagai wujud tanggung jawab digital (2), serta ajakan tokoh masyarakat untuk menggunakan teknologi secara bijak (5). Ketiganya menunjukkan penguatan identitas dan kesadaran nasional dalam ranah digital. Pernyataan 3, 4, dan 6 lebih menekankan aspek pelayanan publik, preferensi konten, atau keterbukaan global yang tidak secara langsung mencerminkan nasionalisme.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].errors, []);
  // 6 premises collected, lead-in skipped
  assert.equal(r[0].premises.length, 6);
  assert.equal(r[0].premises[0], "Warga memanfaatkan teknologi digital untuk memperkenalkan budaya Indonesia secara positif.");
  // Question is the line AFTER the last premise
  assert.equal(
    r[0].question,
    "Manfaat utama dari penerapan nasionalisme dalam pemanfaatan teknologi ditunjukkan oleh perilaku …",
  );
  // Options without A./B. prefix (user's input didn't include them)
  assert.deepEqual(r[0].options, {
    A: "1, 2, dan 4",
    B: "2, 3, dan 5",
    C: "2, 4, dan 6",
    D: "1, 2, dan 5",
    E: "3, 5, dan 6",
  });
  assert.equal(r[0].correct_answer, "D");
  // Content HTML: lead-in as leading <p> + <ol> + <p>question</p>
  assert.equal(
    r[0].content,
    "<p>Perhatikan pernyataan-pernyataan berikut ini!</p>" +
      "<ol>" +
      "<li>Warga memanfaatkan teknologi digital untuk memperkenalkan budaya Indonesia secara positif.</li>" +
      "<li>Masyarakat memeriksa kebenaran informasi digital sebelum membagikannya.</li>" +
      "<li>Aparatur negara menggunakan teknologi untuk meningkatkan kualitas layanan publik.</li>" +
      "<li>Warga lebih memilih konten global edukatif yang sesuai dengan kebutuhan.</li>" +
      "<li>Tokoh masyarakat mengajak warga menggunakan teknologi secara bijak.</li>" +
      "<li>Masyarakat mengikuti tren teknologi global sebagai bentuk keterbukaan terhadap inovasi.</li>" +
      "</ol>" +
      "<p>Manfaat utama dari penerapan nasionalisme dalam pemanfaatan teknologi ditunjukkan oleh perilaku …</p>",
  );
});

// ============================================================================
// §8.20 Lead-in heuristic: various sentence-ending punctuation
// ============================================================================
test("§8.20a isLeadIn: line ending with '!' is a lead-in", () => {
  assert.equal(isLeadIn("Perhatikan!"), true);
});
test("§8.20b isLeadIn: line ending with '.' is a lead-in", () => {
  assert.equal(isLeadIn("Baca baik-baik."), true);
});
test("§8.20c isLeadIn: line ending with '?' is a lead-in", () => {
  assert.equal(isLeadIn("Manakah yang benar?"), true);
});
test("§8.20d isLeadIn: premise line is NOT a lead-in", () => {
  assert.equal(isLeadIn("1) Premise satu"), false);
});
test("§8.20e isLeadIn: option line is NOT a lead-in", () => {
  assert.equal(isLeadIn("A. Opsi A"), false);
  assert.equal(isLeadIn("a. opsi a"), false);
});
test("§8.20f isLeadIn: empty / non-string is NOT a lead-in", () => {
  assert.equal(isLeadIn(""), false);
  assert.equal(isLeadIn(null), false);
  assert.equal(isLeadIn(undefined), false);
});
test("§8.20g isLeadIn: line without sentence-ending punctuation is NOT a lead-in", () => {
  // E.g. a question line that happens to come first (old format).
  assert.equal(isLeadIn("What is 2+2"), false);
});

// ============================================================================
// §8.21 Lead-in negative case: lead-in heuristic must require a premise
// on the NEXT line, otherwise the block should be treated as old format.
// ============================================================================
test("§8.21 lead-in NOT triggered: line 1 is a sentence but line 2 is NOT a premise", () => {
  // Old-format-shaped block: a sentence on line 1, then A-E, key, expl.
  // The leading sentence ends with '!' so isLeadIn(line 1) is true,
  // but line 2 ('A. 3') is an option, not a premise — so the block
  // should be parsed as old format with the sentence as the question.
  const input = [
    "What is 2+2?",
    "A. 3",
    "B. 4",
    "C. 5",
    "D. 6",
    "E. 7",
    "B",
    "Because 2+2=4.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  // Treated as old format (not new), so premises is empty and content
  // is the plain text question.
  assert.deepEqual(r[0].premises, []);
  assert.equal(r[0].question, "What is 2+2?");
  assert.equal(r[0].content, "What is 2+2?");
});

// ============================================================================
// §8.18 Old format plain text continues to be stored as plain text
// ============================================================================
test("§8.18 old format content: stored as plain text, no HTML wrapping", () => {
  const input = [
    "What is the capital of France?",
    "A. London",
    "B. Paris",
    "C. Berlin",
    "D. Madrid",
    "E. Rome",
    "B",
    "Paris is the capital of France.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].content, "What is the capital of France?");
  // No <ol>, no <p>, no HTML
  assert.ok(!r[0].content.includes("<"));
});

// ============================================================================
// Bonus: empty input
// ============================================================================
test("bonus: empty input returns empty array", () => {
  assert.deepEqual(parseBulkText("", TYPE), []);
  assert.deepEqual(parseBulkText("   \n  \n  ", TYPE), []);
  assert.deepEqual(parseBulkText(null, TYPE), []);
  assert.deepEqual(parseBulkText(undefined, TYPE), []);
});

// ============================================================================
// Bonus: XSS escape — premise/question with < > & " '
// ============================================================================
test("bonus: XSS escape — HTML special chars escaped in content", () => {
  const input = [
    "1) <script>alert(1)</script>",
    "2) Tom & Jerry's \"quote\"",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  // < > & " ' all escaped
  assert.equal(
    r[0].premises[0],
    "<script>alert(1)</script>", // raw text in `premises`
  );
  assert.equal(
    r[0].content,
    "<ol><li>&lt;script&gt;alert(1)&lt;/script&gt;</li>" +
      "<li>Tom &amp; Jerry&#039;s &quot;quote&quot;</li></ol><p>Q?</p>",
  );
});

// ============================================================================
// Bonus: error messages are Indonesian (sanity check on spec)
// ============================================================================
test("bonus: error messages are in Indonesian", () => {
  const input = [
    "What?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "Z", // invalid key
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r[0].status, "invalid");
  // Indonesian for "key invalid"
  assert.ok(r[0].errors[0].includes("tidak valid"));
  assert.ok(r[0].errors[0].includes("harus"));
});

// ============================================================================
// Bonus: missing option line produces specific error
// ============================================================================
test("bonus: missing option line produces specific error", () => {
  const input = [
    "1) P1",
    "Q?",
    "A. a",
    "B. b",
    "C. c", // missing D
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r[0].status, "invalid");
  // The line "D. d" is treated as key "D" (since the loop runs out of
  // options at index 4). This is a parser error, not "missing D".
  // Verify the parser at least flags this as invalid.
  assert.ok(r[0].errors.length > 0);
});

// ============================================================================
// Bonus: question_type is propagated to all blocks
// ============================================================================
test("bonus: question_type propagated to all blocks in paste", () => {
  const input = [
    "1) P1",
    "Q1?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl1",
    "---",
    "Q2?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl2",
  ].join("\n");

  const r = parseBulkText(input, "TIU Verbal");
  assert.equal(r.length, 2);
  assert.equal(r[0].question_type, "TIU Verbal");
  assert.equal(r[1].question_type, "TIU Verbal");
});

// ============================================================================
// Bonus: premise with empty text (e.g. "1) ")
// ============================================================================
test("bonus: premise with empty text after number (e.g. '1) '): invalid", () => {
  const input = [
    "1) ", // empty premise
    "2) P2",
    "Q?",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "E. e",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r[0].status, "invalid");
  assert.deepEqual(r[0].errors, ["premise 1 kosong"]);
});

// ============================================================================
// Bonus: case-insensitive option prefix stripping
// ============================================================================
test("bonus: lowercase option prefix 'a.' stripped too", () => {
  const input = [
    "1) P1",
    "Q?",
    "a. optA",
    "b. optB",
    "c. optC",
    "d. optD",
    "e. optE",
    "A",
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].options, {
    A: "optA",
    B: "optB",
    C: "optC",
    D: "optD",
    E: "optE",
  });
});

// ============================================================================
// §8.22 Bare-premise new format (TIU silogisme — user's reported case)
// ============================================================================
// Indonesian TIU silogisme pattern: 2+ plain-text premise sentences with
// NO numeric markers, followed by the actual question text (often
// "Kesimpulan dari kedua premis tersebut adalah ..."), then A-E options,
// then key, then explanation. The parser must auto-detect this from the
// explicit A-E options block (working backwards to locate the question
// line and the premises).
test("§8.22 happy path: bare-premise new format (TIU SKD 2025 silogisme)", () => {
  const input = [
    "Tidak ada warga desa A yang memiliki sepeda warna kuning",
    "Sepeda berwarna merah terparkir di depan kantor kecamatan X",
    "Kesimpulan dari kedua premis tersebut adalah ... (TIU SKD 2025)",
    "A. Sepeda berwarna merah yang terparkir di depan kantor kecamatan X berasal dari Desa A",
    "B. Semua sepeda yang terparkir di depan kantor kecamatan X berasal dari Desa A",
    "C. Sepeda berwarna merah yang terparkir di depan kantor kecamatan X mungkin berasal dari Desa A",
    "D. Sepeda berwarna kuning terparkir di depan kantor kecamatan X",
    "E. Tidak ada sepeda dari Desa A yang terparkir di depan kantor kecamatan X",
    "C",
    "Premis pertama menyatakan tidak ada warga Desa A yang memiliki sepeda kuning, sehingga warga Desa A memiliki sepeda berwarna lain. Premis kedua menyatakan bahwa sepeda berwarna merah terparkir di depan kantor kecamatan X (tanpa memberikan informasi asal pemiliknya), sehingga tidak bisa dipastikan dari mana sepeda tersebut berasal. Kesimpulan yang paling tepat dan tidak bertentangan dengan kedua premis adalah bahwa sepeda merah yang terparkir di depan kantor kecamatan X mungkin berasal dari Desa A, sehingga jawabannya adalah C.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].errors, []);

  // 2 bare premises captured
  assert.deepEqual(r[0].premises, [
    "Tidak ada warga desa A yang memiliki sepeda warna kuning",
    "Sepeda berwarna merah terparkir di depan kantor kecamatan X",
  ]);

  // Question is the line immediately before option A (the "Kesimpulan..."
  // prompt)
  assert.equal(
    r[0].question,
    "Kesimpulan dari kedua premis tersebut adalah ... (TIU SKD 2025)",
  );

  // Options A-E stripped of prefix
  assert.deepEqual(r[0].options, {
    A: "Sepeda berwarna merah yang terparkir di depan kantor kecamatan X berasal dari Desa A",
    B: "Semua sepeda yang terparkir di depan kantor kecamatan X berasal dari Desa A",
    C: "Sepeda berwarna merah yang terparkir di depan kantor kecamatan X mungkin berasal dari Desa A",
    D: "Sepeda berwarna kuning terparkir di depan kantor kecamatan X",
    E: "Tidak ada sepeda dari Desa A yang terparkir di depan kantor kecamatan X",
  });
  assert.equal(r[0].correct_answer, "C");

  // Explanation preserved (long Indonesian paragraph)
  assert.ok(r[0].explanation.includes("Premis pertama"));
  assert.ok(r[0].explanation.includes("jawabannya adalah C"));

  // Content HTML: same `<ol>…<p>` shape as numbered new format
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(
    r[0].content.includes(
      "<li>Tidak ada warga desa A yang memiliki sepeda warna kuning</li>",
    ),
  );
  assert.ok(
    r[0].content.includes(
      "<li>Sepeda berwarna merah terparkir di depan kantor kecamatan X</li>",
    ),
  );
  assert.ok(r[0].content.includes("</ol>"));
  assert.ok(
    r[0].content.endsWith(
      "<p>Kesimpulan dari kedua premis tersebut adalah ... (TIU SKD 2025)</p>",
    ),
  );
});

// ============================================================================
// §8.23 Regression guard: optIdx < 3 falls through to old format (gate works)
// ============================================================================
// Uses a CLEAN optIdx=1 input (A. at line 1) that old format parses
// successfully. This exercises the bare-premise gate (1 < 3 →
// parseBarePremiseNewFormatBlock is NOT called) and lets us assert
// directly on `r[0].premises === []` without fragile error-message
// string matching.
//
// An optIdx=2 boundary case would also be valid for this guard, but
// optIdx=2 input is structurally ambiguous — old format can't parse
// it cleanly either (key "E. Opsi E" doesn't match VALID_KEYS), so
// any assertion would have to handle both successful and
// short-circuited old-format outcomes (which is what the previous
// version of this test did). optIdx=1 is cleaner and consistent with
// the §8.2 / §8.10 / §8.18 / §8.21 old-format tests.
test("§8.23 fallback: optIdx < 3 falls through to old format", () => {
  const input = [
    "Silakan pilih opsi yang benar.",
    "A. Opsi A",
    "B. Opsi B",
    "C. Opsi C",
    "D. Opsi D",
    "E. Opsi E",
    "A",
    "Pembahasan singkat.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  // optIdx = 1 → gate `optIdx >= 3` fails → parseBarePremiseNewFormatBlock
  // NOT called → parseOldFormatBlock runs and validates cleanly.
  assert.equal(r[0].status, "valid");
  // CRITICAL: r[0].premises must be [] (proving bare-premise wasn't
  // triggered, since BAR would have populated premises from lines
  // 0..optIdx-1 = lines 0..0).
  assert.deepEqual(r[0].premises, []);
});

// ============================================================================
// §8.24 Regression guard: missing A-E prefixes must NOT trigger bare-premise
// detection (this is the old-format territory from §8.10 + §8.18).
// ============================================================================
test("§8.24 fallback: missing explicit A-E prefixes falls through to old format", () => {
  const input = [
    "1) P1", // triggers the EXISTING numbered new-format path (parseNewFormatBlock)
    "Q with ?",
    "bare option (no A./B. prefix)",
    "another bare option",
    "yet another",
    "still bare",
    "last bare option",
    "D", // key works for old format (key is on line 7 here, since no premises)
    "Expl",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  // Lines 0 is "1) P1" → triggers parseNewFormatBlock (existing
  // numbered new-format path). Bare-premise detection is irrelevant.
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].premises, ["P1"]);
});

// ============================================================================
// §8.25 findExplicitOptionsIndex unit tests for A-E block detection
// ============================================================================
test("§8.25a findExplicitOptionsIndex: returns 0 when A-E block starts at line 0", () => {
  const lines = [
    "A. one",
    "B. two",
    "C. three",
    "D. four",
    "E. five",
    "F", // key (out of range but we have 5+1+? lines)
    "Expl",
  ];
  assert.equal(findExplicitOptionsIndex(lines), 0);
});

test("§8.25b findExplicitOptionsIndex: returns correct offset when block is mid-stream", () => {
  const lines = [
    "P1",
    "P2",
    "Q?",
    "A. one", // index 3
    "B. two",
    "C. three",
    "D. four",
    "E. five",
    "A",
    "Expl",
  ];
  assert.equal(findExplicitOptionsIndex(lines), 3);
});

test("§8.25c findExplicitOptionsIndex: returns -1 when no A-E block exists", () => {
  const lines = [
    "P1",
    "P2",
    "Q?",
    "bare", // NOT A.
    "bare",
    "bare",
    "bare",
    "bare",
    "D",
    "Expl",
  ];
  assert.equal(findExplicitOptionsIndex(lines), -1);
});

test("§8.25d findExplicitOptionsIndex: returns -1 when too few lines remain after A", () => {
  // Need 5 options + key + ≥1 explanation = 7 lines after A. With only
  // 6 lines after A (5 options + key, no explanation), the loop bound
  // `i <= lines.length - 7` evaluates to `i <= -1` → no iterations → -1.
  const lines = ["A. x", "B. x", "C. x", "D. x", "E. x", "A"];
  assert.equal(findExplicitOptionsIndex(lines), -1);
});

test("§8.25e findExplicitOptionsIndex: case-insensitive prefix matching", () => {
  const lines = [
    "P1",
    "P2",
    "Q?",
    "a. one", // lowercase A
    "b. two",
    "c. three",
    "d. four",
    "e. five",
    "A",
    "Expl",
  ];
  assert.equal(findExplicitOptionsIndex(lines), 3);
});

// ============================================================================
// §8.26 Happy path: N bare premises with no question line is VALID
// ============================================================================
// With the §8.28+ sentence-splitting + question-detection extension,
// the "premises + no question" pattern is now accepted as valid with
// an EMPTY question (the conclusion is left implicit — common for
// Indonesian TIU silogisme items where the test-taker must derive
// it from the premises). This replaces the previous round's stricter
// guard reject. The previous test name "§8.26 invalid: 3 bare
// premises with no question line is rejected" was retired.
test("§8.26 happy path: 3 bare premises with no question line is valid (implicit question)", () => {
  const input = [
    "Semua warga negara wajib membayar pajak.",
    "Pajak digunakan untuk membiayai pembangunan fasilitas umum.",
    "Beberapa fasilitas umum sudah berdiri sejak lama.",
    "A. Opsi A",
    "B. Opsi B",
    "C. Opsi C",
    "D. Opsi D",
    "E. Opsi E",
    "A",
    "Penjelasan untuk tiga premis tanpa baris pertanyaan eksplisit.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  // 3 premises captured, NO question line.
  assert.equal(r[0].premises.length, 3);
  assert.deepEqual(r[0].premises, [
    "Semua warga negara wajib membayar pajak.",
    "Pajak digunakan untuk membiayai pembangunan fasilitas umum.",
    "Beberapa fasilitas umum sudah berdiri sejak lama.",
  ]);
  assert.equal(r[0].question, ""); // implicit
  // Options A-E preserved.
  assert.deepEqual(r[0].options, {
    A: "Opsi A",
    B: "Opsi B",
    C: "Opsi C",
    D: "Opsi D",
    E: "Opsi E",
  });
  assert.equal(r[0].correct_answer, "A");
  // Content HTML: <ol>…</ol> ONLY (no trailing <p></p> for empty
  // question — clean output, avoids an empty paragraph in the
  // downstream exam/review renderers).
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(r[0].content.endsWith("</ol>"));
  assert.ok(
    !r[0].content.includes("<p>"),
    `content must NOT contain <p> when question is empty; got: ${r[0].content}`,
  );
});

// ============================================================================
// §8.27 looksLikeQuestion unit tests
// ============================================================================
test("§8.27a looksLikeQuestion: line ending with '?' is a question", () => {
  assert.equal(looksLikeQuestion("Apakah benar?"), true);
});
test("§8.27b looksLikeQuestion: line ending with '!' is a question", () => {
  assert.equal(looksLikeQuestion("Perhatikan!"), true);
});
test("§8.27c looksLikeQuestion: line ending with '…' is a question", () => {
  assert.equal(looksLikeQuestion("Pilih yang paling tepat…"), true);
});
test("§8.27d looksLikeQuestion: 'Kesimpulan' cue is a question", () => {
  assert.equal(
    looksLikeQuestion(
      "Kesimpulan dari kedua premis tersebut adalah ... (TIU SKD 2025)",
    ),
    true,
  );
});
test("§8.27e looksLikeQuestion: 'Manakah' cue is a question", () => {
  assert.equal(
    looksLikeQuestion("Manakah opsi yang paling logis"),
    true,
  );
});
test("§8.27f looksLikeQuestion: 'Berdasarkan pernyataan' cue is a question", () => {
  assert.equal(
    looksLikeQuestion("Berdasarkan pernyataan di atas, maka ..."),
    true,
  );
});
test("§8.27g looksLikeQuestion: 'yang paling tepat' cue is a question", () => {
  assert.equal(looksLikeQuestion("Pernyataan yang paling tepat adalah"), true);
});
test("§8.27h looksLikeQuestion: plain premise is NOT a question", () => {
  assert.equal(
    looksLikeQuestion(
      "Tidak ada warga desa A yang memiliki sepeda warna kuning",
    ),
    false,
  );
});
test("§8.27i looksLikeQuestion: empty / non-string is NOT a question", () => {
  assert.equal(looksLikeQuestion(""), false);
  assert.equal(looksLikeQuestion(null), false);
  assert.equal(looksLikeQuestion(undefined), false);
});
test("§8.27j looksLikeQuestion: 'Pernyataan yang benar adalah' (no 'paling') matches", () => {
  // Cue is now `yang\s+(?:paling\s+)?(?:tepat|benar|logis)` so the
  // "paling" between "yang" and the adjective is OPTIONAL.
  assert.equal(looksLikeQuestion("Pernyataan yang benar adalah"), true);
  assert.equal(looksLikeQuestion("Opsi yang tepat adalah"), true);
  assert.equal(looksLikeQuestion("Pernyataan yang logis adalah"), true);
});
test("§8.27k looksLikeQuestion: 'Di mana ...' (TWO words) matches the cue", () => {
  // Cue is now `dimana` OR `di\s+mana`.
  assert.equal(looksLikeQuestion("Di mana letak kantor kecamatan X?"), true);
  assert.equal(looksLikeQuestion("Dimana rumah sakit terdekat?"), true);
});
test("§8.27l looksLikeQuestion: 'Paling tepat adalah ...' (cued without 'yang') matches", () => {
  // Cue `paling(?:-|\s)+(?:tepat|benar|logis)` catches this heading-only variant.
  assert.equal(
    looksLikeQuestion("Paling tepat adalah opsi A atau B?"),
    true,
  );
});
test("§8.27m looksLikeQuestion: 'YANG PALING TEPAT' (caps) matches (regex is /i)", () => {
  assert.equal(
    looksLikeQuestion("PERNYATAAN YANG PALING TEPAT ADALAH"),
    true,
  );
});

// ============================================================================
// §8.28 Happy path: multi-premise on one line + explicit question (TIU 2024)
// ============================================================================
// Common Indonesian TIU silogisme pattern where 2 premise sentences
// are joined on a single line with ". " (instead of proper \n
// separators) followed by an explicit "Manakah kesimpulan..." question
// line. The parser must:
//   1. Split line 0 on ". " (after "herbivora." before "Menurut")
//   2. Re-locate optIdx on the expanded lines (2 → 3 after split)
//   3. Recognize "Manakah kesimpulan..." as a question line
//   4. Treat the 2 split sentences as premises
test("§8.28 happy path: multi-premise on one line + explicit question (sentence split + Manakah ... cue)", () => {
  const input = [
    "Semua hewan yang berada di Kebun Binatang A merupakan hewan herbivora. Menurut para peneliti dari Universitas Haluoleo, hewan herbivora adalah hewan dengan rasa takut yang tinggi.",
    "Manakah kesimpulan yang paling tepat berdasarkan premis di atas... (TIU CPNS 2024)",
    "A. Hewan yang berada di Kebun Binatang A memiliki rasa takut yang tinggi.",
    "B. Beberapa hewan herbivora memiliki rasa takut yang tinggi.",
    "C. Semua hewan herbivora berada di Kebun Binatang A.",
    "D. Semua hewan dengan rasa takut yang tinggi berada di Kebun Binatang A.",
    "E. Hewan yang berada di Kebun Binatang A merupakan hewan langka.",
    "A",
    "Premis pertama menyatakan bahwa semua hewan di Kebun Binatang A merupakan hewan herbivora. Premis kedua menyatakan bahwa semua hewan herbivora memiliki rasa takut yang tinggi. Maka kesimpulan yang tepat adalah semua hewan yang berada di Kebun Binatang A memiliki rasa takut yang tinggi.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].errors, []);

  // 2 split premises captured from line 0
  assert.deepEqual(r[0].premises, [
    "Semua hewan yang berada di Kebun Binatang A merupakan hewan herbivora.",
    "Menurut para peneliti dari Universitas Haluoleo, hewan herbivora adalah hewan dengan rasa takut yang tinggi.",
  ]);

  // Question = the "Manakah kesimpulan..." line
  assert.equal(
    r[0].question,
    "Manakah kesimpulan yang paling tepat berdasarkan premis di atas... (TIU CPNS 2024)",
  );
  assert.deepEqual(r[0].options, {
    A: "Hewan yang berada di Kebun Binatang A memiliki rasa takut yang tinggi.",
    B: "Beberapa hewan herbivora memiliki rasa takut yang tinggi.",
    C: "Semua hewan herbivora berada di Kebun Binatang A.",
    D: "Semua hewan dengan rasa takut yang tinggi berada di Kebun Binatang A.",
    E: "Hewan yang berada di Kebun Binatang A merupakan hewan langka.",
  });
  assert.equal(r[0].correct_answer, "A");

  // Content HTML: standard <ol>...<p> shape with both premises + question
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(r[0].content.includes("<p>"));
  assert.ok(
    r[0].content.includes(
      "<li>Semua hewan yang berada di Kebun Binatang A merupakan hewan herbivora.</li>",
    ),
  );
  assert.ok(
    r[0].content.includes(
      "<li>Menurut para peneliti dari Universitas Haluoleo, hewan herbivora adalah hewan dengan rasa takut yang tinggi.</li>",
    ),
  );
  assert.ok(
    r[0].content.endsWith(
      "<p>Manakah kesimpulan yang paling tepat berdasarkan premis di atas... (TIU CPNS 2024)</p>",
    ),
  );
});

// ============================================================================
// §8.29 Happy path: 2 bare premise lines + NO question (premises-only)
// ============================================================================
// Indonesian TIU silogisme pattern where the user types 2 separate
// bare premise lines followed directly by A-E options, NO question
// line in between. The conclusion is left implicit — the parser
// accepts this with an empty question string.
test("§8.29 happy path: 2 bare premise lines + no question line (implicit-question mode)", () => {
  const input = [
    "Semua petani di Desa Sukamaju suka bekerja keras.",
    "Sebagian petani di Desa Sukamaju adalah pedagang.",
    "A. Semua petani di Desa Sukamaju adalah pedagang dan suka bekerja keras",
    "B. Sebagian petani di Desa Sukamaju merupakan pedagang dan suka bekerja keras",
    "C. Ada pedagang di Desa Sukamaju yang tidak suka bekerja keras",
    "D. Sebagian petani di Desa Sukamaju adalah pedagang yang tidak suka bekerja keras",
    "E. Semua petani yang suka bekerja keras berasal dari Desa Sukamaju",
    "B",
    "Premis 1: Semua petani di Desa Sukamaju suka bekerja keras. Premis 2: Sebagian petani di Desa Sukamaju adalah pedagang. Kesimpulan yang tepat adalah sebagian petani di Desa Sukamaju merupakan pedagang dan suka bekerja keras.",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");
  assert.deepEqual(r[0].errors, []);

  // 2 separate-line premises + EMPTY question
  assert.deepEqual(r[0].premises, [
    "Semua petani di Desa Sukamaju suka bekerja keras.",
    "Sebagian petani di Desa Sukamaju adalah pedagang.",
  ]);
  assert.equal(r[0].question, ""); // implicit
  assert.deepEqual(r[0].options, {
    A: "Semua petani di Desa Sukamaju adalah pedagang dan suka bekerja keras",
    B: "Sebagian petani di Desa Sukamaju merupakan pedagang dan suka bekerja keras",
    C: "Ada pedagang di Desa Sukamaju yang tidak suka bekerja keras",
    D: "Sebagian petani di Desa Sukamaju adalah pedagang yang tidak suka bekerja keras",
    E: "Semua petani yang suka bekerja keras berasal dari Desa Sukamaju",
  });
  assert.equal(r[0].correct_answer, "B");

  // Content HTML: <ol>…</ol> ONLY (no <p> since question empty)
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(r[0].content.endsWith("</ol>"));
  assert.ok(!r[0].content.includes("<p>"));
});

// ============================================================================
// §8.30 Happy path: premise + premise+question on same line
// ============================================================================
// Pattern where line 0 is a single-sentence premise and line 1
// combines a 2nd premise ("Naruto tidak rajin belajar.") with a
// question prompt ("Kesimpulannya adalah") joined by ". ". The
// parser must split line 1, recognize that both the 2nd premise and
// the question-prompt are present, and treat the latter as the
// question (matched by the "kesimpulan" cue).
test("§8.30 happy path: premise + premise+question joined on line 1 (sentence split + kesimpulan cue)", () => {
  const input = [
    "Jika Naruto rajin belajar maka dia akan memperoleh Indeks Prestasi yang baik.",
    "Naruto tidak rajin belajar. Kesimpulannya adalah",
    "A. Naruto memperoleh Indeks Prestasi yang baik",
    "B. Naruto memperoleh Indeks Prestasi yang baik walau-pun tidak rajin belajar",
    "C. Naruto adalah anak yang pintar",
    "D. Naruto tidak mendapat Indeks Prestasi yang baik",
    "E. Tidak dapat disimpulkan.",
    "E",
    "Premis 1: p -> q (Jika Naruto rajin belajar maka dia akan memperoleh Indeks Prestasi yang baik). Premis 2: ~p (Naruto tidak rajin belajar). Dalam logika formal, bentuk ~p dari p -> q tidak menghasilkan kesimpulan yang valid (Denying the Antecedent), sehingga tidak dapat disimpulkan (TDDS).",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");

  // 2 premises (line 0 + the 2nd split-off part of line 1)
  assert.deepEqual(r[0].premises, [
    "Jika Naruto rajin belajar maka dia akan memperoleh Indeks Prestasi yang baik.",
    "Naruto tidak rajin belajar.",
  ]);
  // Question = the "Kesimpulannya adalah" portion of line 1
  assert.equal(r[0].question, "Kesimpulannya adalah");
  assert.deepEqual(r[0].options, {
    A: "Naruto memperoleh Indeks Prestasi yang baik",
    B: "Naruto memperoleh Indeks Prestasi yang baik walau-pun tidak rajin belajar",
    C: "Naruto adalah anak yang pintar",
    D: "Naruto tidak mendapat Indeks Prestasi yang baik",
    E: "Tidak dapat disimpulkan.",
  });
  assert.equal(r[0].correct_answer, "E");

  // Content HTML: standard <ol>...<p> shape
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(r[0].content.includes("<p>"));
  assert.ok(
    r[0].content.endsWith("<p>Kesimpulannya adalah</p>"),
    `content should end with the question-line <p>; got: ${r[0].content}`,
  );
});

// ============================================================================
// §8.31 Happy path: 3 sentences on 1 line + no question (implicit)
// ============================================================================
// Pattern where line 0 contains 3 premise sentences all joined by
// ". ", followed directly by A-E options with NO question line at
// all. The parser must:
//   1. Split line 0 into 3 sentences on ". " (after each sentence)
//   2. Locate optIdx on the expanded lines (1 → 3 after split)
//   3. Recognize there is no explicit question (last line
//      "Goku..." doesn't match any cue)
//   4. Treat all 3 split sentences as premises with empty question
test("§8.31 happy path: 3 sentences on one line + no question line (implicit, multi-sentence split)", () => {
  const input = [
    "Jika tubuh sehat, maka jiwa akan sehat pula. Jika jiwa sehat, maka proses hidup akan dijalani dengan sehat. Goku memiliki tubuh yang tidak sehat.",
    "A. Proses hidup Goku dijalani dengan tidak sehat.",
    "B. Proses hidup Goku dijalani dengan sehat.",
    "C. Goku memiliki jiwa yang tidak sehat.",
    "D. Goku memiliki jiwa yang sehat.",
    "E. Tidak dapat disimpulkan.",
    "E",
    "Premis 1: Jika tubuh sehat, maka jiwa akan sehat pula (p -> q). Premis 2: Jika jiwa sehat, maka proses hidup akan dijalani dengan sehat (q -> r). Gabungan P1 & P2: p -> r. Premis 3 menyatakan Goku memiliki tubuh yang tidak sehat (~p). Bentuk ~p dari p -> r tidak menghasilkan kesimpulan yang valid, sehingga tidak dapat disimpulkan (TDDS).",
  ].join("\n");

  const r = parseBulkText(input, TYPE);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "valid");

  // 3 split premises + empty question
  assert.deepEqual(r[0].premises, [
    "Jika tubuh sehat, maka jiwa akan sehat pula.",
    "Jika jiwa sehat, maka proses hidup akan dijalani dengan sehat.",
    "Goku memiliki tubuh yang tidak sehat.",
  ]);
  assert.equal(r[0].question, ""); // implicit
  assert.deepEqual(r[0].options, {
    A: "Proses hidup Goku dijalani dengan tidak sehat.",
    B: "Proses hidup Goku dijalani dengan sehat.",
    C: "Goku memiliki jiwa yang tidak sehat.",
    D: "Goku memiliki jiwa yang sehat.",
    E: "Tidak dapat disimpulkan.",
  });
  assert.equal(r[0].correct_answer, "E");

  // Content HTML: <ol>…</ol> only (no <p>) since question is empty
  assert.ok(r[0].content.startsWith("<ol>"));
  assert.ok(r[0].content.endsWith("</ol>"));
  assert.ok(!r[0].content.includes("<p>"));
  // All 3 premises appear as <li> entries
  assert.ok(
    r[0].content.includes(
      "<li>Jika tubuh sehat, maka jiwa akan sehat pula.</li>",
    ),
  );
  assert.ok(
    r[0].content.includes(
      "<li>Goku memiliki tubuh yang tidak sehat.</li>",
    ),
  );
});
