// public/js/markdown-image.js
// ============================================================================
// Single source of truth for inline markdown image `![alt](url)` → <img>
// rendering. Previously the regex + render helper were duplicated (with
// slight drift) in public/js/kelola-soal.js, public/js/exam.js and
// public/js/review.js — Round-17 (2026-08-09) consolidates them here.
//
// Also consumed by:
//   - public/js/image-uploader.js  (imports IMAGE_MD_REGEX for the rehost
//     pipeline's scan/replace helpers)
//   - tests/test-image-url-paste.mjs (mirrors the literal — keep in sync)
//
// Two variants:
//   - renderInlineMd(html)      — input is ALREADY pre-escaped HTML (Quill
//                                 innerHTML / DB rows). alt/url are inserted
//                                 RAW (no esc) — escaping here would
//                                 double-escape entities like `&amp;`.
//   - renderInlinePreview(text) — input is RAW user text; every non-match
//                                 part is HTML-escaped; images get the
//                                 `bulk-md-image` class.
//
// Both accept `{ resolveUrl }`: an optional sync url → replacement-url
// mapper (kelola-soal.js passes one that points at rehosted Vercel Blob
// URLs via window.ImageUploader.getBlobUrl). The original url is kept when
// the mapper returns null/undefined.
//
// Pure module — no `window`/`document` access, importable in Node tests.
// ============================================================================

// Captures: 1 = alt text, 2 = url ending in image-ext. Mirrored in
// tests/test-image-url-paste.mjs (IMAGE_MD_REGEX) — keep in sync.
const IMAGE_MD_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^)]*)?)\)/g;

export { IMAGE_MD_REGEX };

// HTML-input variant (documented above). Function replacer so `$`/
// backslashes in alt/url are never treated as substitution tokens.
export function renderInlineMd(html, { resolveUrl } = {}) {
  if (typeof html !== "string") return html;
  const re = new RegExp(IMAGE_MD_REGEX.source, "g");
  return html.replace(re, (match, alt, url) => {
    const src = typeof resolveUrl === "function" ? resolveUrl(url) || url : url;
    // referrerpolicy="no-referrer" is display-side anti-hotlink hardening:
    // images still pointing at the original server (e.g. an upload that
    // failed) are requested without a Referer header.
    return `<img src="${src}" alt="${alt}" referrerpolicy="no-referrer" style="max-width:100%;border-radius:8px;margin-top:8px">`;
  });
}

// Raw-text variant (documented above): escapes all non-image text, replaces
// matches with inline <img class="bulk-md-image">.
export function renderInlinePreview(text, { resolveUrl } = {}) {
  if (typeof text !== "string" || !text) return "";
  const parts = [];
  const re = new RegExp(IMAGE_MD_REGEX.source, "g");
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(esc(text.substring(lastIndex, match.index)));
    }
    const url = typeof resolveUrl === "function" ? resolveUrl(match[2]) || match[2] : match[2];
    parts.push(
      `<img src="${esc(url)}" alt="${esc(match[1])}" referrerpolicy="no-referrer" class="bulk-md-image">`,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(esc(text.substring(lastIndex)));
  }
  return parts.join("");
}

// DOM-free HTML-escape (Node-testable). Escapes the 5 entities the app's
// DOM-based esc() helpers cover; output is functionally identical for the
// attribute/text contexts renderInlinePreview produces.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Attach to window for the classic (non-module) consumers — exam.js /
// review.js / kelola-soal.js read the helpers via `window.MarkdownImage`.
// ES-module consumers (image-uploader.js, Node tests) use the exports
// directly; both get the exact same functions, so behavior can't drift.
// Load markdown-image.js as a module script BEFORE those classic scripts
// in the page so the window API exists when they execute.
if (typeof window !== "undefined") {
  window.MarkdownImage = {
    IMAGE_MD_REGEX,
    renderInlineMd,
    renderInlinePreview,
  };
}
