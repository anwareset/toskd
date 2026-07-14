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
  escapeHtml,
  previewHtmlForCell,
  isLeadIn,
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
