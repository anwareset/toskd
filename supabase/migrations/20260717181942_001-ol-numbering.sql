-- ============================================================================
-- Schema Migration 001 — Round-4 verbatim-display retrofit
-- ============================================================================
-- (Round 4 refactor: "hilangkan penomoran premis di tampilan/preview.
-- Tampilkan apa adanya dengan yang diinput di bulk add").
--
-- PURPOSE:
-- Existing questions in the `questions.content` column are stored as
-- `<ol><li>Premise 1</li>...</ol><p>question text</p>` — the bare
-- `<ol>` without any inline style. Browsers default to `1./2./3.`
-- numbering on `<ol>`, which contradicts the Round-4 verbatim-display
-- policy (no auto-numbering, user-typed markers preserved).
--
-- The parser now writes new rows with `<ol style="list-style-type:
-- none; margin: 0; padding-left: 0;">` (see /c/Users/anwar/Documents/
-- toskd/public/js/bulk-parser.js :: buildNewFormatContent). This
-- migration retrofits OLD rows with the same inline style so they
-- render consistently in exam.html / review.html / paket-detail.html /
-- kelola-soal.html without `1./2./3.` browser prefixes.
--
-- This migration is also defended by a global CSS rule added in
-- /c/Users/anwar/Documents/toskd/public/css/styles.css (`.q-content
-- ol, .bulk-preview-ol, ol:not([class])`) so the inline style is
-- belt-and-suspenders: even rows WITHOUT the inline style still render
-- correctly. The migration is therefore cosmetic + defensive — it does
-- NOT change semantics, only rendering consistency.
--
-- SAFETY:
--   - WHERE clause filters to rows that have a `<ol>` tag in their
--     content (most soal do; skip rows that don't to make the update
--     idempotent and fast).
--   - REPLACE is scoped to the FIRST `<ol>` occurrence per row. The
--     parser only ever emits ONE `<ol>` per `content` so this covers
--     all rows without needing a recursive CTE.
--   - For rows where the FIRST `<ol>` already has the inline style
--     (parser output from after this fix shipped), the LIKE-based
--     WHERE skips them, so the UPDATE is idempotent (no double-wrap,
--     no row churn).
-- ============================================================================

UPDATE questions
SET content = REPLACE(
    content,
    '<ol>',
    '<ol style="list-style-type: none; margin: 0; padding-left: 0;">'
)
WHERE content LIKE '%<ol>%'
  AND content NOT LIKE '%<ol style="list-style-type: none;%';

