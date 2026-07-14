// public/js/bulk-parser.js
// ============================================================================
// Pure parser for the "Bulk Add Soal" feature in kelola-soal.html.
//
// Spec: bulk-add-format-v2-spec.md
//
// Supports TWO input formats, auto-detected per-block by inspecting line 1:
//   1. NEW format: 1+ numbered premises (1) ... 2) ... 3) ...) before the
//      question line. Stored as HTML `<ol><li>…</li></ol><p>question</p>`
//      in `content` for downstream rendering (kelola-soal.js preview,
//      exam.html, review.html, paket-detail.js).
//   2. OLD format: question directly on line 1, then 5 options + key +
//      pembahasan. Backwards compat with v1 parser. Stored as plain text
//      in `content`.
//
// This file is PURE — no `document`/`window`/DOM access. It can be loaded
// in browser (as ESM via `<script type="module">`, attaches to
// `globalThis.bulkParser` as a side effect) or in Node (via `import`).
//
// Block separator: a line containing only `---` (with optional surrounding
// whitespace). Multiple consecutive `---` and trailing `---` are tolerated.
// ============================================================================

// -------- Constants -------------------------------------------------------

// Matches `1) text`, `1. text`, `(1) text` with optional leading
// whitespace. Captures the text AFTER the number+separator+space.
// Does NOT match `1)Premise` (no space).
const PREMISE_RE = /^\s*\(?\d+[\)\.]\s+(.*)/;

// Captures just the number from a premise line. Must be applied AFTER
// PREMISE_RE matches. Used to enforce sequential numbering (1, 2, 3, …).
const PREMISE_NUM_RE = /^\s*\(?(\d+)[\)\.]/;

// Matches `A. text`, `A) text`, `a. text` (case-insensitive). Used to
// STRIP the prefix from option lines — options without prefix are also
// accepted (OPTION_RE just returns the whole line in that case).
const OPTION_RE = /^[A-Ea-e][\.\)]\s+(.*)/;

// Heuristic: a lead-in is a non-premise, non-option line that ends
// with sentence-ending punctuation. It's a common Indonesian CAT
// pattern (e.g. "Perhatikan pernyataan-pernyataan berikut ini!") that
// appears BEFORE the numbered premises. Without this detection the
// parser would mis-classify the block as old format — the lead-in
// would become the question, the actual premises would become
// options, and the key validation would fail on the first premise
// line ("1) ...") which is not a valid A-E key.
const LEADIN_ENDING_RE = /[.!?]$/;
function isLeadIn(line) {
  if (typeof line !== "string" || line.length === 0) return false;
  if (PREMISE_RE.test(line)) return false;
  if (OPTION_RE.test(line)) return false;
  return LEADIN_ENDING_RE.test(line.trim());
}

const VALID_KEYS = ["A", "B", "C", "D", "E"];
const MAX_PREMISES = 20;
const MAX_LINES_PER_BLOCK = 200;

// -------- Helpers ---------------------------------------------------------

// HTML-escape a string for safe inclusion in `<li>` / `<p>` content.
// The existing single-question create flow uses Quill's `root.innerHTML`
// (already escapes), but the bulk parser builds HTML from raw text input
// and must escape explicitly to prevent XSS.
function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Strip `A. ` / `A) ` / `a. ` / etc. prefix from an option line if
// present, then trim. If no prefix, returns the line trimmed.
function stripOptionPrefix(line) {
  const m = line.match(OPTION_RE);
  return (m ? m[1] : line).trim();
}

// Build the stored `content` HTML for a new-format block.
// Format: `<ol><li>Premise 1</li>…</ol><p>question</p>` (no newlines).
// Single-line string is intentional — keeps the DB row compact and
// matches the single-question Quill pattern (one inline string).
function buildNewFormatContent(premises, question) {
  const liHtml = premises.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  return `<ol>${liHtml}</ol><p>${escapeHtml(question)}</p>`;
}

// Strip every <ol> and <img> in a Quill-rendered HTML string and
// replace them with compact inline markers so the preview cell
// stays 1-line. Also strip <p> and <br> tags so text flows inline.
//
// Background: with the v2 bulk-add format, question content is
// stored as `<ol><li>…</li></ol><p>…</p>`. The <ol> is a block
// element and breaks the parent's 1-line constraint (white-space:
// nowrap + text-overflow: ellipsis), so new-format questions
// display as N+1 lines while old-format (plain text) questions
// display as 1 line. Replacing the <ol> with an inline marker
// (e.g. "📋 6 Premise") restores the consistent 1-line look.
//
// Done in JS rather than CSS because the parent uses 1-line
// truncation, which would clip any CSS-::after-based chip past
// line 1. Prepending the chip parks it on line 1, well inside
// the budget regardless of where the original <ol> sat in the
// source. Marker styling lives in `styles.css` under
// `.premise-marker` and `.img-marker`.
//
// Used by:
//   - public/js/kelola-soal.js (table preview in kelola-soal.html)
//   - public/js/paket-detail.js (bank list + pack list previews
//     in paket-detail.html)
function previewHtmlForCell(html) {
  if (!html) return "";
  let result = html;

  // Replace <ol>...</ol> with a "📋 N Premise" marker. Count the
  // <li> children for the N. The <ol> is a block element that
  // breaks the parent's 1-line constraint; replacing it with an
  // inline <span> marker preserves the constraint.
  if (/<ol\b/i.test(result)) {
    const olMatch = result.match(/<ol>([\s\S]*?)<\/ol>/i);
    if (olMatch) {
      const liCount = (olMatch[1].match(/<li>/gi) || []).length;
      const marker = `<span class="premise-marker">📋 ${liCount} Premise</span> `;
      result = result.replace(/<ol>[\s\S]*?<\/ol>/i, marker);
    }
  }

  // Replace <img> with "📷 Ada Gambar" marker (preserves the
  // original v1 imgToMarker behavior).
  if (/<img\b/i.test(result)) {
    result =
      '<span class="img-marker">📷 Ada Gambar</span> ' +
      result.replace(/<img\b[^>]*>/gi, "");
  }

  // Strip <p> and </p> tags so text flows inline. The CSS
  // override (`#questions-table td:nth-child(3) p { display:
  // inline }`) does this for the table cell, but stripping in
  // JS is more robust and also fixes the bank list in
  // paket-detail.js where no CSS override exists.
  result = result.replace(/<\/?p>/gi, "");
  // Replace <br> with a space so the text doesn't get
  // concatenated when the line break is removed.
  result = result.replace(/<br\s*\/?>/gi, " ");

  return result;
}

// -------- Per-format parsers ---------------------------------------------

function parseNewFormatBlock(lines, idx, questionType, leadInLine = null) {
  const errors = [];
  const premises = [];
  let i = 0;

  // 1) Collect premises 1..N. Must be sequential starting from 1.
  //    Loop breaks on first non-premise line; `i` then points to the
  //    candidate question line.
  for (i = 0; i < lines.length; i++) {
    const m = lines[i].match(PREMISE_RE);
    if (!m) break;
    const numStr = lines[i].match(PREMISE_NUM_RE)[1];
    const actualNum = parseInt(numStr, 10);
    const expectedNum = i + 1;
    if (actualNum !== expectedNum) {
      errors.push(
        `premise nomor ${actualNum} di posisi ${i + 1} (harusnya ${expectedNum})`,
      );
      return { idx, status: "invalid", errors, question_type: questionType };
    }
    const text = m[1].trim();
    if (text.length === 0) {
      errors.push(`premise ${actualNum} kosong`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
    premises.push(text);
    if (premises.length > MAX_PREMISES) {
      errors.push(`terlalu banyak premise (max ${MAX_PREMISES})`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }

  // Defensive — unreachable in normal flow because auto-detect guarantees
  // line 1 matches PREMISE_RE before we enter this function. Kept for
  // safety in case parseBlock is called directly.
  if (premises.length === 0) {
    errors.push("format baru tapi tidak ada premise");
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  // 2) Question line. The line that broke the loop is the question.
  //    If we ran off the end of the array, the block is missing the
  //    question. Note: the spec also says the question must NOT start
  //    with a premise-like pattern, but that case is unreachable here
  //    (any such line would have been collected as a premise, failing
  //    the sequential check first — see test vector §8.6).
  if (i >= lines.length) {
    errors.push("tidak ada baris pertanyaan setelah premise");
    return { idx, status: "invalid", errors, question_type: questionType };
  }
  const question = lines[i++];
  if (question.length === 0) {
    errors.push("pertanyaan kosong");
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  // 3) Options A–E. Strip prefix if present, then trim.
  const options = {};
  for (let k = 0; k < 5; k++) {
    if (i >= lines.length) {
      errors.push(`opsi ${"ABCDE"[k]} hilang`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
    const optText = stripOptionPrefix(lines[i++]);
    if (optText.length === 0) {
      errors.push(`opsi ${"ABCDE"[k]} kosong`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
    options["ABCDE"[k]] = optText;
  }

  // 4) Key. Single letter A–E, case-insensitive (uppercased on store).
  if (i >= lines.length) {
    errors.push("kunci jawaban hilang");
    return { idx, status: "invalid", errors, question_type: questionType };
  }
  const keyRaw = lines[i++].toUpperCase().trim();
  if (!VALID_KEYS.includes(keyRaw)) {
    errors.push(`kunci tidak valid: "${lines[i - 1]}" (harus A/B/C/D/E)`);
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  // 5) Pembahasan. Lines i..end joined with \n. Empty-line-as-content
  //    is silently dropped by the filter in parseBlock; this is a known
  //    limitation documented in the spec.
  if (i >= lines.length) {
    errors.push("pembahasan kosong");
    return { idx, status: "invalid", errors, question_type: questionType };
  }
  const explanation = lines.slice(i).join("\n").trim();
  if (explanation.length === 0) {
    errors.push("pembahasan kosong");
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  // 6) Build content HTML. If there's a lead-in, prepend it as a
  //    <p> before the <ol> so it renders as a natural sentence
  //    introducing the premises in the exam/review pages. This
  //    preserves the user's intent of having an instruction line
  //    ("Perhatikan pernyataan-pernyataan berikut ini!") above the
  //    numbered statements.
  const contentCore = buildNewFormatContent(premises, question);
  const content = leadInLine
    ? `<p>${escapeHtml(leadInLine)}</p>${contentCore}`
    : contentCore;

  return {
    idx,
    status: "valid",
    errors: [],
    content,
    // Convenience fields for the renderer (not stored in DB, but used
    // by renderBulkPreview to display a structured preview):
    premises,
    question,
    options,
    correct_answer: keyRaw,
    explanation,
    question_type: questionType,
  };
}

function parseOldFormatBlock(lines, idx, questionType) {
  const errors = [];

  if (lines.length < 8) {
    return {
      idx,
      status: "invalid",
      errors: [`hanya ${lines.length} baris (perlu minimal 8)`],
      question_type: questionType,
    };
  }
  if (lines.length > MAX_LINES_PER_BLOCK) {
    return {
      idx,
      status: "invalid",
      errors: [`terlalu banyak baris (max ${MAX_LINES_PER_BLOCK})`],
      question_type: questionType,
    };
  }

  // content is plain text (no HTML wrapping) — preserved for
  // backwards-compat with all existing v1 questions in DB.
  const content = lines[0];
  const options = {
    A: stripOptionPrefix(lines[1]),
    B: stripOptionPrefix(lines[2]),
    C: stripOptionPrefix(lines[3]),
    D: stripOptionPrefix(lines[4]),
    E: stripOptionPrefix(lines[5]),
  };
  const keyRaw = (lines[6] || "").toUpperCase().trim();
  const explanation = lines.slice(7).join("\n").trim();

  if (!content) errors.push("pertanyaan kosong");
  if (!options.A) errors.push("opsi A kosong");
  if (!options.B) errors.push("opsi B kosong");
  if (!options.C) errors.push("opsi C kosong");
  if (!options.D) errors.push("opsi D kosong");
  if (!options.E) errors.push("opsi E kosong");
  if (!VALID_KEYS.includes(keyRaw)) {
    errors.push(`kunci tidak valid: "${lines[6] || ""}" (harus A/B/C/D/E)`);
  }
  if (!explanation) errors.push("pembahasan kosong");

  if (errors.length > 0) {
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  return {
    idx,
    status: "valid",
    errors: [],
    content,
    premises: [],
    question: content, // alias for renderer uniformity
    options,
    correct_answer: keyRaw,
    explanation,
    question_type: questionType,
  };
}

// -------- Public entry points --------------------------------------------

// Parse a single raw block (between two `---` separators, or the whole
// input if there are no separators). Returns null for an empty block.
function parseBlock(rawBlock, idx, questionType) {
  // We use `.trimStart()` instead of `.trim()` so that lines like `1) `
  // (premise with trailing space, empty content) keep their trailing
  // whitespace. PREMISE_RE requires `\s+` after the `)`/`.` to match;
  // trimming the line would strip that space and turn `1) ` into `1)`,
  // which then fails to match and is incorrectly treated as the start
  // of an old-format block. Leading whitespace is still trimmed so
  // users can paste with any indentation. Lines that are ONLY whitespace
  // (e.g. `   `, `\t\t`) become empty after trimStart and are filtered
  // out below.
  const lines = rawBlock
    .split(/\r?\n/)
    .map((l) => l.trimStart())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  if (lines.length > MAX_LINES_PER_BLOCK) {
    return {
      idx,
      status: "invalid",
      errors: [`terlalu banyak baris (max ${MAX_LINES_PER_BLOCK})`],
      question_type: questionType,
    };
  }

  // Auto-detect format (3-way):
  //   1. If line 0 matches the premise pattern → new format
  //   2. Else if line 0 looks like a "lead-in" (sentence-ending
  //      punctuation) AND line 1 matches the premise pattern → new
  //      format with line 0 as the lead-in (stored as a leading <p>
  //      in the content HTML)
  //   3. Otherwise → old format (backwards compat with v1)
  let isNewFormat = PREMISE_RE.test(lines[0]);
  let leadInLine = null;
  if (!isNewFormat && lines.length >= 2) {
    if (isLeadIn(lines[0]) && PREMISE_RE.test(lines[1])) {
      isNewFormat = true;
      leadInLine = lines[0];
    }
  }

  if (isNewFormat) {
    // If there's a lead-in, skip it when passing to parseNewFormatBlock
    // (which expects line 0 to be the first premise). The lead-in is
    // stored separately and prepended to the content HTML below.
    const premiseLines = leadInLine ? lines.slice(1) : lines;
    return parseNewFormatBlock(premiseLines, idx, questionType, leadInLine);
  }
  return parseOldFormatBlock(lines, idx, questionType);
}

// Parse the entire pasted plain text into an array of blocks.
//   rawText:       the plain text from the Quill paste editor
//   questionType:  the currently-selected Tipe Soal (applied to all
//                  blocks); the parser does not look at this for
//                  validation, just stores it on the result.
// Returns: array of block records (possibly empty). Block records
//   always have `idx`, `status`, `errors`, `question_type`. Valid
//   blocks additionally have `content`, `premises`, `question`,
//   `options`, `correct_answer`, `explanation`.
function parseBulkText(rawText, questionType) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  // Split on one or more consecutive `---` separator lines. The `(?:...)+`
  // quantifier collapses multiple `---` in a row (e.g. `Block1\n---\n---\nBlock2`)
  // into a single split point, so neither separator leaks into the next
  // block. Each group matches a single `---` line (with optional surrounding
  // spaces/tabs and a trailing newline). The leading `\r?\n` is required so
  // a leading `---` is NOT consumed.
  const blocks = rawText.split(/\r?\n(?:[ \t]*---[ \t]*\r?\n?)+/);
  const out = [];
  blocks.forEach((blk, idx) => {
    const trimmed = blk.trim();
    if (!trimmed) return; // drop empty blocks (consecutive `---`, trailing `---`)
    const parsed = parseBlock(trimmed, idx, questionType);
    if (parsed) out.push(parsed);
  });
  return out;
}

// -------- Exports --------------------------------------------------------

export {
  parseBulkText,
  parseBlock,
  escapeHtml,
  previewHtmlForCell,
  isLeadIn,
  PREMISE_RE,
  OPTION_RE,
  MAX_PREMISES,
  MAX_LINES_PER_BLOCK,
};

// -------- Browser side effect --------------------------------------------
// In the browser, `kelola-soal.js` is a classic (non-module) script and
// cannot `import` from this file. Attach the parser to `globalThis` so
// `kelola-soal.js` can read it via `window.bulkParser.parseBulkText(...)`.
// In Node ESM, this is a harmless no-op (tests use `import` instead).
if (typeof globalThis !== "undefined") {
  globalThis.bulkParser = {
    parseBulkText,
    parseBlock,
    escapeHtml,
    previewHtmlForCell,
    isLeadIn,
  };
}
