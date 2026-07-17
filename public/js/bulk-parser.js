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

// TKP-only optional marker line for admin-defined per-option bobot.
// Format: `Bobot: A=#,B=#,C=#,D=#,E=#` dengan # masing-masing 1..5. Bobot
// tidak harus urut siklik; admin boleh menulis permutasi {1,2,3,4,5} apa
// pun (mis. A=2,B=1,C=5,D=3,E=4). Separator toleran: `,`, `;`, atau
// whitespace. Case-insensitive untuk label "Bobot" dan huruf A-E.
// Tracker: tkp-scoring-spec.md §9.2.
const BOBOT_LINE_RE = /^[Bb]obot\s*:\s*[Aa]\s*=\s*([1-5])\s*[,;\s]+\s*[Bb]\s*=\s*([1-5])\s*[,;\s]+\s*[Cc]\s*=\s*([1-5])\s*[,;\s]+\s*[Dd]\s*=\s*([1-5])\s*[,;\s]+\s*[Ee]\s*=\s*([1-5])\s*$/;
const MAX_PREMISES = 20;
const MAX_LINES_PER_BLOCK = 200;

// Indonesian question-position cues used to validate a candidate question
// line in the bare-premise new format. If the line before option A doesn't
// end with ? / ! / … and doesn't contain any of these cues, we reject the
// block — otherwise we'd silently mis-categorize one of the premises as
// the question prompt.
//
// Notes:
//   - `yang\s+(?:paling\s+)?(?:tepat|benar|logis)` accepts BOTH "Pernyataan
//     yang paling benar adalah" AND "Pernyataan yang benar adalah".
//   - `di\s+mana` (2 words) AND `dimana` (1 word) both match the
//     Indonesian locative question word.
//   - `paling(?:-|\s)+(?:tepat|benar|logis)` also catches the heading-only
//     variant "Paling tepat adalah ..." without a "yang" prefix.
// Indonesian question-position cues. The `(?:nya)?` suffix on `kesimpulan`
// lets the cue match the formal-possessive form "Kesimpulannya adalah …"
// (used heavily in TIU SKD/CAT questions), where the literal word
// "kesimpulan" is followed by "nya" and a word boundary \b is therefore
// absent immediately after the cue. Pre-existing \b anchors at the end
// still guard "kesimpulan dengan" etc. when no suffix is present.
// `dimana`/`kapan` are similarly relaxed below to handle the common
// "diamanakah"/"kapankah" interrogation forms.
const QUESTION_CUE_RE =
  /\b(kesimpulan(?:nya)?|manakah|apakah|bagaimana|berdasarkan(?:\s+pernyataan)?|yang\s+(?:paling\s+)?(?:tepat|benar|logis)|paling(?:-|\s)+(?:tepat|benar|logis)|di\s+mana|dimana(?:kah)?|kapan(?:kah)?|mengapa(?:kah)?)\b/i;

// Heuristic: line looks like a question prompt iff it ends with `?`, `!`,
// or `…` OR its trimmed form matches a known Indonesian question-position
// cue (case-insensitive).
//
// STATUS (Round 4+): no longer called from the production parser — the
// verbatim-display policy removed scenario (E) which depended on it. Kept
// as a PUBLIC EXPORT because (a) tests/test-bulk-parser.mjs §8.27a-m
// still pin its behavior, and (b) custom store-frontends that want to
// reuse the Indonesian-question-cue detection logic may want a stable
// import surface rather than re-implementing QUESTION_CUE_RE. Do NOT
// use this helper inside new parser logic — if you find yourself
// wanting to call `looksLikeQuestion` from `parseBarePremiseNewFormatBlock`,
// you probably want the `isQuestionLineEnd` RE-based check above
// instead (no question-cue detection, just terminal punctuation).
function looksLikeQuestion(line) {
  if (typeof line !== "string" || line.length === 0) return false;
  const trimmed = line.trim();
  if (
    trimmed.endsWith("?") ||
    trimmed.endsWith("!") ||
    trimmed.endsWith("…")
  ) {
    return true;
  }
  return QUESTION_CUE_RE.test(trimmed);
}

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
//
// Per user directive (Round 4 — verbatim display): NEVER auto-add
// browser numbering (`1./2./3.`) on top of the user's text. Tips:
//   - User-typed markers like `1)` / `2)` / `3)` are PRESERVED verbatim
//     in `<li>` (parseNewFormatBlock stops stripping them).
//   - Each premise line stays as ONE `<li>` (no internal sentence
//     splits), so multi-sentence premise lines render as a single
//     paragraph rather than N numbered fragments.
//   - Inline `list-style-type: none` suppresses the browser's default
//     `1./2./3.` prefix. Defense-in-depth: outer renderers (exam.html,
//     review.html, paket-detail.js) also rely on a global `.q-content ol`
//     CSS rule, but inline style wins over stylesheet rules so new soal
//     render correctly even before global CSS is in place.
//
// Question rendering:
//   - Single-line: emits one `<p>`.
//   - Multi-line: splits on `\n` and emits one `<p>` per non-blank
//     line (catalog case #B input — user pastes 1) 2) 3) premises
//     + 2 continuation prose lines + A-E; we keep all of it visible).
//   - Empty: emits just the `<ol>` (TIU silogisme with implicit
//     question, OR bare-premise mode with NO explicit question line
//     like catalog case #A / #C).
function buildNewFormatContent(premises, question) {
  const liHtml = premises.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  const olStyle =
    'list-style-type: none; margin: 0; padding-left: 0;';
  const olHtml = `<ol style="${olStyle}">${liHtml}</ol>`;
  if (!question) return olHtml;
  // Multi-line question: each non-blank line becomes its own <p> so
  // they're visually distinct paragraph rows rather than collapsed into
  // a single text block. Splitting preserves the user's verbatim text
  // (no auto-paragraph breaks; lines come in as the user typed them).
  const paragraphs = question
    .split(/\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // Edge case: if `question` is non-empty but every line is blank
  // (e.g., user pasted trailing whitespace as the "question"), the
  // filter above yields zero paragraphs and `pHtml` is empty. We still
  // emit just `<ol>` in that case — the user's verbatim split has no
  // content to render. This is correct behavior; documented here so a
  // future maintainer doesn't think the trailing `<p>` block vanished.
  const pHtml = paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  return olHtml + pHtml;
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
//
// Round-6: drop the `📋 N Premise` chip from table-cell previews +
// raise the cell-content cap from 45 → 70 chars. Per user follow-up
// (Round 6), the chip hid the actual question text — admin wanted
// the cell to show the inline premise + question text verbatim with
// a single-cell, single-line, max-70-char snippet. The Round-6
// implementation strips wrapper tags (`<ol>`, `<li>`, `<p>`) but
// injects a space boundary so adjacent `<li>` text doesn't run
// together into a single word. Bobot: TKP marker lines are stripped
// (admin-only metadata, never visible to exam taker). Real `\n` from
// Round-4 verbatim multi-line question text is folded by the post-
// strip whitespace collapse. Final 70-char cap with `…` guarantees
// the cell renders as ONE line regardless of source length.
//
// Image chip (`📷 Ada Gambar`) is RETAINED because (a) it's still
// useful admin signal ("this question has a gambar"), and (b) the
// user only asked to drop the OL chip specifically, not all chips.
const MAX_PREVIEW_CELL_CHARS = 70;

function previewHtmlForCell(html) {
  if (!html) return "";
  let result = html;

  // Strip Bobot: TKP marker lines. These are admin-only metadata
  // (block-level, not inline inside `<p>`), so regex-on-raw-line
  // works. Defensive layer — the parser already strips these
  // from `explanation` and other fields, but a future parser
  // change shouldn't leak a Bobot: line into the cell preview.
  result = result.replace(/^\s*Bobot:[^\n]*$/gmi, "");

  // Replace <img> with chip (Round-5 retained). Attribute-tolerant
  // opener matches future `<img loading="lazy">` etc.
  if (/<img\b/i.test(result)) {
    result =
      '<span class="img-marker">📷 Ada Gambar</span> ' +
      result.replace(/<img\b[^>]*>/gi, "");
  }

  // Strip wrapper tags, injecting a single space at each tag
  // boundary so adjacent `<li>` / `<p>` text doesn't run together
  // into a single word. Whitespace collapse below absorbs any
  // double-spacing this creates.
  //
  // NB: this DROPS the previous `📋 N Premise` chip substitution
  // (Round 6). Admin wanted the cell content to show verbatim, so
  // we keep the premise lines themselves instead of replacing the
  // <ol> with a metadata chip. The `\b[^>]*` ensures attribute
  // tolerance for Round-4's inline `<ol style="...">` and any
  // future attributes.
  result = result.replace(/<\/?ol\b[^>]*>/gi, " ");
  result = result.replace(/<\/?li\b[^>]*>/gi, " ");
  result = result.replace(/<\/?p\b[^>]*>/gi, " ");
  result = result.replace(/<br\s*\/?>/gi, " ");

  // Collapse all whitespace runs (real `\n` chars from Round-4
  // verbatim question text + multi-space tags + extra space from
  // injected boundaries from the previous step) into a single
  // space so the cell renders as ONE line.
  result = result.replace(/\s+/g, " ").trim();

  // Final guard: cap cell content at MAX_PREVIEW_CELL_CHARS chars
  // so wide premise listings don't wrap the cell onto a 2nd row.
  // Append the Unicode ellipsis `…` (1 char, not "..." which is 3)
  // when truncated so admins can see the cell was clipped.
  if (result.length > MAX_PREVIEW_CELL_CHARS) {
    result = result.slice(0, MAX_PREVIEW_CELL_CHARS) + "…";
  }

  return result;
}

// -------- Per-format parsers ---------------------------------------------

// Walks forward looking for the start of an explicit A./B./C./D./E. option
// block — five consecutive lines whose prefixes match A., B., C., D., E.
// (case-insensitive) in that order. Returns the index of the "A. ..." line,
// or -1 if no such block exists.
//
// Used by the auto-detect loop in parseBlock to recognize the "bare-premise
// new format" (Indonesian TIU silogisme style), where premises have no
// numeric markers but the explicit A-E options give us a fixed anchor to
// work backwards from: the line BEFORE A is the question, lines BEFORE
// the question are the premises.
//
// We require at least 7 lines remaining after the start of A (5 options +
// key + at least 1 explanation line). This filters out accidental matches
// in fragments that don't have a full new-format structure.
function findExplicitOptionsIndex(lines) {
  // 5 options + key + min 1 line explanation
  const MIN_LINES_AFTER = 7;
  for (let i = 0; i <= lines.length - MIN_LINES_AFTER; i++) {
    if (
      /^A[\.\)]\s/i.test(lines[i]) &&
      /^B[\.\)]\s/i.test(lines[i + 1]) &&
      /^C[\.\)]\s/i.test(lines[i + 2]) &&
      /^D[\.\)]\s/i.test(lines[i + 3]) &&
      /^E[\.\)]\s/i.test(lines[i + 4])
    ) {
      return i;
    }
  }
  return -1;
}

// Parse a "bare-premise new format" block on PRE-EXPANDED lines.
// The caller (parseBlock) has already applied
// `expandToSentencesBefore` to the original lines and re-located
// `optIdx` to `newOptIdx` on the post-expansion array. This
// function operates directly on the expanded array; no further
// splitting is performed here.
//
// Two Indonesian CAT patterns supported:
//   (a) Explicit question (TWK reading-passage OR TIU silogisme
//       with prompt): 1+ bare premise line(s) + a
//       "Manakah kesimpulan..." question line. Single-line reading
//       passages are valid for TWK comprehension items — even one
//       context line is legitimate when paired with an explicit
//       question that is self-contained.
//   (b) Implicit question (TIU silogisme without prompt): 2+ bare
//       premise sentences (possibly joined on one line via ". ")
//       followed directly by A-E options, with the conclusion left
//       implicit. Mode (b) keeps the ≥2 threshold because
//       syllogistic inference needs at least two statements to draw
//       a conclusion; mode (a) relaxes to ≥1 since the explicit
//       question carries the cognitive load. The question is stored
//       as empty string and the content HTML omits the trailing
//       <p> tag.
//
// Indonesian CAT pattern (TIU silogisme — explicit question):
//   Premise 1
//   Premise 2
//   Question text
//   A. ...
//   B. ...
//   C. ...
//   D. ...
//   E. ...
//   <key>
//   <explanation>
//
// Stored as the same `<ol>…<p>` HTML as the numbered new format
// (or `<ol>…</ol>` if question is implicit), so the downstream
// preview + exam/review renderers work without changes.
// Terminal punctuation or rhythm that signals "this whole line is the
// question paragraph" (NOT a premise). Matches EITHER:
//   - a single trailing `?` / `!` / `…` (Unicode ellipsis U+2026)
//   - an ASCII three-dot ellipsis `...`
// IMPORTANT: a SINGLE trailing `.` does NOT match — otherwise every
// Indonesian full-stop sentence would be mis-classified as a question
// line, which is exactly the bug the user reported against §8.29 (two
// premise lines ending in `.` were being collapsed: last premise was
// treated as the question verbatim, dropping the first premise). Use
// alternation with `\.{3}` (NOT a `[?!….]` character class) so single `.`
// falls outside the match.
const QUESTION_LINE_END_RE = /(?:[?!…]|\.{3})\s*$/;

function isQuestionLineEnd(line) {
  if (typeof line !== "string") return false;
  return QUESTION_LINE_END_RE.test(line.trim());
}

function parseBarePremiseNewFormatBlock(lines, idx, questionType, optIdx) {
  const errors = [];

  // Round-4 VERBATIM semantics (user directive: "tampilkan apa adanya,
  // hilangkan penomoran premis"). Two scenarios remain:
  //
  //   (D) SOURCE LINE ENDS WITH ?/!/…/...": admin wrote the candidate
  //       line (lines[optIdx-1]) as a COMPLETE question paragraph. Use
  //       it VERBATIM as the question. Premises come from
  //       lines[0..optIdx-2] — each as one verbatim line, NO internal
  //       sentence split. Examples: §8.22/§8.28/§8.33 and catalog
  //       #6/#11d/#12.
  //
  //   (F) NO EXPLICIT QUESTION: all lines[0..optIdx-1] are premises,
  //       each kept verbatim (no `. A-Z` auto-split). Question is
  //       empty. Examples: §8.26/§8.29/§8.31, catalog #A and #C.
  //
  // Note: the previous scenario (E) "split Premise line by sentence
  // when last chunk looks like a question" is REMOVED. It collapsed
  // the user's `Premise·. Kesimpulannya adalah` format in unwanted
  // ways (e.g., §8.30 silently treated `Kesimpulannya adalah` as the
  // question after auto-splitting). With the new verbatim policy,
  // every line is preserved as a single premise; if the user wants a
  // question, they put a single line that ends with ?/!/…/... above
  // the A-E block (handled by scenario D).
  //
  // Single `.` does NOT trigger scenario D — see `isQuestionLineEnd`
  // which uses alternation `(?:[?!…]|\.{3})` to avoid matching
  // regular Indonesian full-stops.
  const candidateSrcLine = lines[optIdx - 1];
  // Trigger scenario (D) verbatim-question mode if EITHER the line ends with
  // terminal question punctuation (`?` / `!` / `…` / `...`) OR it carries an
  // Indonesian question-position cue from QUESTION_CUE_RE (e.g. "Kesimpulan
  // dari kedua premis tersebut adalah ... (TIU SKD 2025)" — §8.22). The
  // trim() before QUESTION_CUE_RE.test is required since the regex uses `\b`
  // word-boundary anchors that don't see through leading/trailing whitespace.
  // Tracker: §8.22 bug — without this OR, lines ending in `)` instead of
  // terminal punctuation were incorrectly captured as premises, leaving
  // `question = ""` and `premises.length = 3`.
  const srcLineEndsWithQ =
    isQuestionLineEnd(candidateSrcLine) ||
    QUESTION_CUE_RE.test(candidateSrcLine.trim());

  let premisesSrc;
  let question;
  let hasExplicitQuestion;
  if (srcLineEndsWithQ) {
    // (D) Source line is the question paragraph — verbatim. Premises
    // are lines[0..optIdx-2], each kept as one element.
    question = candidateSrcLine;
    premisesSrc = lines.slice(0, optIdx - 1);
    hasExplicitQuestion = true;
  } else {
    // (F) Implicit-question mode. ALL lines before option A are
    // premises (verbatim, no internal split).
    question = "";
    premisesSrc = lines.slice(0, optIdx);
    hasExplicitQuestion = false;
  }

  // Each premise line stays as a single element. No flatMap /
  // splitSentences — verbatim preservation per the user's directive.
  const premises = premisesSrc
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Per tkp-scoring-spec.md §9.1: implicit-question mode (TIU
  // silogisme) requires ≥2 premises; explicit-question mode (TWK
  // reading-passage or TIU with prompt) accepts ≥1 premise line
  // because the explicit question is self-contained.
  if (hasExplicitQuestion) {
    if (premises.length < 1) {
      errors.push("format bare-premise baru tapi tidak ada premise");
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  } else {
    if (premises.length < 2) {
      errors.push("format bare-premise baru tapi premise kurang dari 2 (min 2 untuk mode tanpa pertanyaan eksplisit)");
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }
  if (premises.length > MAX_PREMISES) {
    errors.push(`terlalu banyak premise (max ${MAX_PREMISES})`);
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  for (let p = 0; p < premises.length; p++) {
    if (premises[p].length === 0) {
      errors.push(`premise ${p + 1} kosong`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }

  // Options A–E. The A-prefix was already verified by
  // findExplicitOptionsIndex on the original lines; B/C/D/E are
  // also verified.
  const options = {
    A: stripOptionPrefix(lines[optIdx]),
    B: stripOptionPrefix(lines[optIdx + 1]),
    C: stripOptionPrefix(lines[optIdx + 2]),
    D: stripOptionPrefix(lines[optIdx + 3]),
    E: stripOptionPrefix(lines[optIdx + 4]),
  };
  for (const k of ["A", "B", "C", "D", "E"]) {
    if (!options[k]) {
      errors.push(`opsi ${k} kosong`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }

  // Key. Skip any Bobot: TKP marker lines that sit at the key position.
  // The FIRST Bobot line we skip is captured into `lastBobotWeights` so
  // 4b can derive `correct_answer` from it when (1) the type is TKP
  // AND (2) there is no explicit single-letter Kunci line below. This
  // matches the spec at tkp-scoring-spec.md §9.2 ("admin intent: the
  // option marked 5 is the best answer") — admins who already wrote a
  // Bobot line do not need to repeat the letter as a separate Kunci.
  //
  // SEMANTICS: only the FIRST match is honored for derivation. Extra
  // Bobot lines (admin accidentally pasted twice) are stripped but the
  // weights are NOT summed or averaged — the first one is canonical.
  // This mirrors enrichTkpBobot's "first match honored" rule so both
  // paths produce identical correct_answer values when run on the same
  // input.
  let keyIdx = optIdx + 5;
  let lastBobotWeights = null;
  while (
    keyIdx < lines.length
    && BOBOT_LINE_RE.test(lines[keyIdx].trimStart())
  ) {
    if (!lastBobotWeights) {
      const m = lines[keyIdx].trimStart().match(BOBOT_LINE_RE);
      if (m) {
        lastBobotWeights = {
          A: Number(m[1]),
          B: Number(m[2]),
          C: Number(m[3]),
          D: Number(m[4]),
          E: Number(m[5]),
        };
      }
    }
    keyIdx++;
  }
  // Resolve the key: explicit single-letter wins; otherwise derive
  // from bobot for TKP; otherwise the block is invalid.
  const isTkpBarePremise = typeof questionType === "string" && questionType.toUpperCase().startsWith("TKP");
  let keyRaw;
  let keyIdxFinal;
  if (keyIdx < lines.length) {
    const candidateRaw = lines[keyIdx].toUpperCase().trim();
    if (VALID_KEYS.includes(candidateRaw)) {
      keyRaw = candidateRaw;
      keyIdxFinal = keyIdx + 1;
    } else if (isTkpBarePremise && lastBobotWeights) {
      keyRaw = pickMaxWeightLetter(lastBobotWeights);
      keyIdxFinal = keyIdx; // explanation starts HERE (the bogus-kunci line IS explanation)
    } else {
      errors.push(`kunci tidak valid: "${lines[keyIdx]}" (harus A/B/C/D/E)`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  } else {
    if (isTkpBarePremise && lastBobotWeights) {
      keyRaw = pickMaxWeightLetter(lastBobotWeights);
      keyIdxFinal = keyIdx;
    } else {
      errors.push("kunci jawaban hilang");
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }

  // Explanation. When the key was DERIVED from bobot, the next non-Bobot
  // line is already accounted for in `keyIdxFinal` (no separate skip).
  // When the key was EXPLICIT, skip any trailing Bobot: lines (admin may
  // have ALSO pasted a Bobot AFTER the Kunci line — see parser docs).
  let explainStart = keyIdxFinal;
  while (
    explainStart < lines.length
    && BOBOT_LINE_RE.test(lines[explainStart].trimStart())
  ) {
    explainStart++;
  }
  if (explainStart >= lines.length) {
    errors.push("pembahasan kosong");
    return { idx, status: "invalid", errors, question_type: questionType };
  }
  const explanation = lines.slice(explainStart).join("\n").trim();
  if (explanation.length === 0) {
    errors.push("pembahasan kosong");
    return { idx, status: "invalid", errors, question_type: questionType };
  }

  return {
    idx,
    status: "valid",
    errors: [],
    content: buildNewFormatContent(premises, question),
    premises,
    question,
    options,
    correct_answer: keyRaw,
    explanation,
    question_type: questionType,
  };
}

// Pick the letter A-E whose weight is the largest in `bobotWeights`.
// Used by parseBarePremiseNewFormatBlock + parseNewFormatBlock when
// (a) the question type starts with "TKP" and
// (b) admin provided a `Bobot:` line but no separate single-letter Kunci line.
// Ties go to the FIRST letter with that weight (deterministic; spec §10 says
// admin must use a permutation {1..5} so ties shouldn't occur in practice,
// but we resolve them the same way enrichTkpBobot does for consistency).
function pickMaxWeightLetter(bobotWeights) {
  let maxL = "A";
  let maxW = bobotWeights.A;
  for (const L of ["A", "B", "C", "D", "E"]) {
    if (bobotWeights[L] > maxW) {
      maxW = bobotWeights[L];
      maxL = L;
    }
  }
  return maxL;
}

function parseNewFormatBlock(lines, idx, questionType, leadInLine = null) {
  const errors = [];
  const premises = [];
  let i = 0;

  // 1) Collect premises 1..N. Must be sequential starting from 1.
  //    Loop breaks on first non-premise line; `i` then points to the
  //    candidate question block (which may now span MULTIPLE lines —
  //    see step 2 below).
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
    // Per verbatim-display policy: KEEP the user-typed marker
    // (`1)`, `1.`, `(1)`) as part of the premise TEXT instead of
    // stripping it via `m[1]`. This lets the user's literal
    // `1) Premis pertama` round-trip through to the renderer so
    // the candidate sees exactly what the admin typed — without the
    // browser re-adding `1.` over the user's `1)` (the `style="…"`
    // on `<ol>` in buildNewFormatContent suppresses that).
    const text = lines[i].trim();
    // Empty-premise check: the user-typed marker alone (`1) ` or `1.`)
    // is treated as EMPTY content even though the line is non-blank.
    // We check `m[1].trim().length === 0` because `m[1]` captures the
    // text AFTER the marker; if that's empty the premise is invalid.
    // This preserves the original validation behavior (bonus test:
    // "premise with empty text after number (e.g. '1) '): invalid")
    // while still passing through the user's marker into the stored
    // `premises[]` when content IS present.
    if (text.length === 0 || m[1].trim().length === 0) {
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

  // 2) Question block(s). After the numbered premises, the user may
  //    paste ONE OR MORE lines of prose (e.g., continuation of a reading
  //    passage, additional “Untuk setiap pernyataan” flavor
  //    stanzas, etc.) before the A-E options. We don't know how
  //    many lines there are, so we locate the A-E anchor via
  //    `findExplicitOptionsIndex` and treat everything between the
  //    last premise and option A as a multi-line question.
  //
  //    FALLBACK: when no explicit A./B./C./D./E. prefix block is found
  //    (some admins paste raw question + raw option lines without
  //    re-typing the letters), we fall back to the LEGACY single-line
  //    question + 5-line options contract. This preserves compatibility
  //    with §8.10 (no A. prefix) and similar real-world inputs.
  //
  //    Previously the parser unconditionally took only ONE line as the
  //    question; now it accepts multiple (catalog case #B and the
  //    user's report) when explicit prefixes anchor the A-E block.
  const optIdxForNew = findExplicitOptionsIndex(lines);
  let question;
  if (optIdxForNew >= i) {
    // Multi-line question (verbatim preservation across N prose lines).
    question = lines.slice(i, optIdxForNew).join("\n").trim();
    i = optIdxForNew; // fast-forward past the question block
  } else {
    // LEGACY single-line question + 5-line options contract. Used when
    // admin types option lines WITHOUT explicit A./B./C./D./E. prefixes
    // (see §8.10 — covers Indonesian CAT templates where admins paste
    // option bodies without the letter rows).
    question = lines[i];
    i = i + 1;
  }
  if (i >= lines.length) {
    errors.push("tidak ada opsi setelah pertanyaan");
    return { idx, status: "invalid", errors, question_type: questionType };
  }
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

  // 4a) Skip any Bobot: TKP marker lines that may appear immediately
  //     after the options (so admins can paste `Bobot: …` BEFORE the
  //     Kunci line without choking the key-position parser). The FIRST
  //     Bobot line we skip is captured into `lastBobotWeights` so 4b
  //     can derive `correct_answer` from it when type=TKP AND no
  //     explicit single-letter Kunci follows. See tkp-scoring-spec.md
  //     §9.2 for the placement rules + §10 for the spec invariant.
  //
  //     FIRST-match semantics mirror enrichTkpBobot, so parser-level
  //     and enrichment-level derivations agree when run on the same
  //     block (no multi-Bobot mismatch producing different correct_answer).
  let lastBobotWeights = null;
  while (i < lines.length && BOBOT_LINE_RE.test(lines[i].trimStart())) {
    if (!lastBobotWeights) {
      const m = lines[i].trimStart().match(BOBOT_LINE_RE);
      if (m) {
        lastBobotWeights = {
          A: Number(m[1]),
          B: Number(m[2]),
          C: Number(m[3]),
          D: Number(m[4]),
          E: Number(m[5]),
        };
      }
    }
    i++;
  }

  // 4b) Key resolution. Three cases, in priority order:
  //     (i)  Explicit single-letter key at i → use it (admin wrote Kunci).
  //     (ii) No explicit key BUT type=TKP AND we have lastBobotWeights
  //          → derive key from letter with max weight (admin intent:
  //          "option marked 5 is the best answer"). i stays put — the
  //          non-Kunci line at i IS the explanation already.
  //     (iii) Otherwise → invalid block.
  const isTkpNewFormat = typeof questionType === "string" && questionType.toUpperCase().startsWith("TKP");
  let keyRaw;
  let keyResolutionMode; // "explicit" | "derived"
  if (i < lines.length) {
    const candidate = lines[i].toUpperCase().trim();
    if (VALID_KEYS.includes(candidate)) {
      keyRaw = candidate;
      keyResolutionMode = "explicit";
      i++;
    } else if (isTkpNewFormat && lastBobotWeights) {
      keyRaw = pickMaxWeightLetter(lastBobotWeights);
      keyResolutionMode = "derived";
      // i stays put — next line is the explanation.
    } else {
      errors.push(`kunci tidak valid: "${lines[i]}" (harus A/B/C/D/E)`);
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  } else {
    if (isTkpNewFormat && lastBobotWeights) {
      keyRaw = pickMaxWeightLetter(lastBobotWeights);
      keyResolutionMode = "derived";
    } else {
      errors.push("kunci jawaban hilang");
      return { idx, status: "invalid", errors, question_type: questionType };
    }
  }

  // 4c) Skip trailing Bobot: lines ONLY when the key was EXPLICIT (admin
  //     may have ALSO pasted a Bobot AFTER the Kunci line). When the
  //     key was DERIVED, the lines following the Bobot marker are the
  //     explanation already, so we DO NOT skip — moving i would lose
  //     the first explanation line.
  if (keyResolutionMode === "explicit") {
    while (i < lines.length && BOBOT_LINE_RE.test(lines[i].trimStart())) i++;
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
  // Skip past any Bobot: TKP marker line that may appear at the key
  // position (so admin can paste `Bobot: …` BEFORE the Kunci without
  // tripping the key validator). Tracks tkp-scoring-spec.md §9.2.
  let keyLineIdx = 6;
  let lastBobotWeights = null;
  while (
    keyLineIdx < lines.length
    && BOBOT_LINE_RE.test(lines[keyLineIdx].trimStart())
  ) {
    if (!lastBobotWeights) {
      const m = lines[keyLineIdx].trimStart().match(BOBOT_LINE_RE);
      if (m) {
        lastBobotWeights = {
          A: Number(m[1]), B: Number(m[2]), C: Number(m[3]),
          D: Number(m[4]), E: Number(m[5]),
        };
      }
    }
    keyLineIdx++;
  }
  const isTkpOldFormat = typeof questionType === "string" && questionType.toUpperCase().startsWith("TKP");
  let keyRaw;
  if (keyLineIdx < lines.length) {
    const candidate = (lines[keyLineIdx] || "").toUpperCase().trim();
    if (VALID_KEYS.includes(candidate)) {
      keyRaw = candidate;
      keyLineIdx = keyLineIdx + 1;
    } else if (isTkpOldFormat && lastBobotWeights) {
      keyRaw = pickMaxWeightLetter(lastBobotWeights);
    } else {
      keyRaw = ""; // existing error path below will pick this up
    }
  } else if (isTkpOldFormat && lastBobotWeights) {
    keyRaw = pickMaxWeightLetter(lastBobotWeights);
  }
  if (!keyRaw) {
    // Legacy path: no TKP derive fallback available. Surface error.
    keyRaw = (lines[keyLineIdx] || "").toUpperCase().trim();
  }
  // No `+ 1` here on purpose: in EXPLICIT-key branch we advanced
  // keyLineIdx past the key (slice = lines after key); in DERIVE branch
  // keyLineIdx stays at the bogus-kunci line so it gets included as
  // part of the user's prose explanation (matches Round-7 convention
  // in parseBarePremiseNewFormatBlock where keyIdxFinal = keyIdx).
  const explanation = lines
    .slice(keyLineIdx)
    .filter((l) => !BOBOT_LINE_RE.test(l.trimStart()))
    .join("\n")
    .trim();

  if (!content) errors.push("pertanyaan kosong");
  if (!options.A) errors.push("opsi A kosong");
  if (!options.B) errors.push("opsi B kosong");
  if (!options.C) errors.push("opsi C kosong");
  if (!options.D) errors.push("opsi D kosong");
  if (!options.E) errors.push("opsi E kosong");
  if (!VALID_KEYS.includes(keyRaw)) {
    errors.push(
      `kunci tidak valid: "${lines[keyLineIdx] || ""}" (harus A/B/C/D/E)`,
    );
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

// TKP-weighted-scoring helper (tkp-scoring-spec.md §9.2).
//
// If the parsed block's question_type starts with `TKP` and the raw block
// text contains a `Bobot: A=#,B=#,C=#,D=#,E=#` line, attach
// `option_scores` to the result (with the parsed 1..5 values per letter),
// derive `correct_answer` as the letter with the maximum weight (admin
// intent: the option marked `5` is the best answer), and strip the Bobot:
// line from the explanation so it doesn't leak into pembahasan.
//
// Bobot: optional. If absent for TKP, `option_scores` stays undefined
// and admins fill weights via the single-question modal later. For non-TKP
// blocks this helper is a no-op. Robust against multiple Bobot: lines
// (only the first match is honoured; later ones are stripped but ignored).
function enrichTkpBobot(result, rawBlock, questionType) {
  if (!result || result.status !== "valid") return result;
  if (
    typeof questionType !== "string" ||
    !questionType.toUpperCase().startsWith("TKP")
  ) return result;
  if (typeof rawBlock !== "string") return result;

  const lines = rawBlock
    .split(/\r?\n/)
    .map((l) => l.trimStart())
    .filter((l) => l.length > 0);

  let bobotMatch = null;
  for (const line of lines) {
    const m = line.match(BOBOT_LINE_RE);
    if (m) {
      bobotMatch = m;
      break;
    }
  }
  // TKP MUST carry a `Bobot:` line in bulk-add (spec tkp-scoring-spec.md §9.1
  // + §10 V1-strict applied to bulk endpoint too). Returning an invalid
  // block propagates through `parseBlock` → `parseBulkText` → the bulk-add
  // UI's `.bulk-error-list`, so the admin sees inline feedback instead of a
  // silent null-option_scores row that would later score as binary.
  if (!bobotMatch) {
    return {
      idx: result.idx,
      status: "invalid",
      errors: [
        "bobot TKP wajib diisi (tambahkan baris 'Bobot: A=#,B=#,C=#,D=#,E=#')",
      ],
      question_type: questionType,
    };
  }

  const optionScores = {
    A: Number(bobotMatch[1]),
    B: Number(bobotMatch[2]),
    C: Number(bobotMatch[3]),
    D: Number(bobotMatch[4]),
    E: Number(bobotMatch[5]),
  };

  // Derive correct_answer as the letter carrying the highest weight.
  // Admin intent: the option marked `5` is the best answer.
  let maxLetter = "A";
  let maxW = optionScores.A;
  for (const L of ["A", "B", "C", "D", "E"]) {
    if (optionScores[L] > maxW) {
      maxW = optionScores[L];
      maxLetter = L;
    }
  }

  // Strip the Bobot: line from the explanation text (defence-in-depth:
  // the inner parsers already skip Bobot: lines, this catches anything
  // that bled in via `lines.slice(...)`).
  const cleanedExpl = (result.explanation || "")
    .split(/\r?\n/)
    .filter((l) => !BOBOT_LINE_RE.test(l.trimStart()))
    .join("\n")
    .trim();

  return {
    ...result,
    option_scores: optionScores,
    correct_answer: maxLetter,
    explanation: cleanedExpl,
  };
}

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

  // TKP administrators can attach `Bobot: A=#,B=#,C=#,D=#,E=#` to a block
  // to specify per-option weights as a permutation of {1,2,3,4,5} (not
  // required to be in cyclic order from the Kunci letter). `enrichTkpBobot`
  // attaches `option_scores`, derives `correct_answer` as the letter
  // holding the maximum weight, and strips the marker line from
  // `explanation`. No-op when no Bobot: line OR the block is not TKP.
  // Tracker: tkp-scoring-spec.md §9.2.
  let result;
  if (isNewFormat) {
    // If there's a lead-in, skip it when passing to parseNewFormatBlock
    // (which expects line 0 to be the first premise). The lead-in is
    // stored separately and prepended to the content HTML below.
    const premiseLines = leadInLine ? lines.slice(1) : lines;
    result = parseNewFormatBlock(premiseLines, idx, questionType, leadInLine);
  } else {
    // Bare-premise new format detection (Indonesian TIU silogisme style).
    // Premises have NO numeric marker; question line (optional) follows as
    // plain text; then explicit A-E options. Two distinct user patterns
    // fold into `explicitOptIdx >= 2`:
    //
    //   (D) SOURCE LINE ENDS WITH ?/!/…/..." → verbatim-question mode:
    //       line[optIdx - 1] becomes the question, prior lines are
    //       premises (each kept verbatim, NO internal sentence-split).
    //   (F) NO PROPMPTED QUESTION → implicit-question mode: ALL lines
    //       before option A are premises, question stays empty.
    //
    // Edge case: 1-line-before-A input falls through to old-format
    // (`explicitOptIdx == 1` skipped, parseOldFormatBlock handles it
    // as a plain-text question). See §8.23 + §8.31 regression guards.
    //
    // Safety rail: findExplicitOptionsIndex returns -1 if any A-E
    // prefix is missing → bare-premise path NOT taken → old format.
    // parseBarePremiseNewFormatBlock runs internal validation; if
    // status !== "valid" we fall through to old format for rescue.
    const explicitOptIdx = findExplicitOptionsIndex(lines);
    if (explicitOptIdx >= 2) {
      const validated = parseBarePremiseNewFormatBlock(
        lines,
        idx,
        questionType,
        explicitOptIdx,
      );
      if (validated.status === "valid") result = validated;
    }
    if (!result) result = parseOldFormatBlock(lines, idx, questionType);
  }

  return enrichTkpBobot(result, rawBlock, questionType);
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
  findExplicitOptionsIndex,
  looksLikeQuestion,
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
