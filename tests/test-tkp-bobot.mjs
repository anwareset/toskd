// tests/test-tkp-bobot.mjs
// Smoke test for bulk-parser.js Bobot: handling. Also acts as a regression
// guard for tkp-scoring-spec.md §9.1 (strict-rejection: TKP blocks without
// `Bobot:` line MUST be invalid).
//
// Run: node tests/test-tkp-bobot.mjs
import { parseBlock } from '../public/js/bulk-parser.js';
import assert from 'node:assert/strict';

function log(name, r) {
  console.log(name, JSON.stringify({
    status: r?.status,
    correct_answer: r?.correct_answer,
    option_scores: r?.option_scores ?? null,
    explanationSnippet: r?.explanation?.slice(0, 60) ?? null,
    errors: r?.errors ?? null,
  }));
}

// case1 — TKP with Bobot: line (custom non-cyclic weights) — should be VALID
// and have option_scores populated + correct_answer auto-derived from max weight.
log('case1-tkp-bobot-only', parseBlock(
  `1) Premise 1\n2) Premise 2\nPertanyaan?\nA. optA\nB. optB\nC. optC\nD. optD\nE. optE\nBobot: A=2, B=1, C=5, D=3, E=4\n<pembahasan>`,
  0,
  'TKP Pelayanan Publik',
));

// case2 — TKP WITHOUT Bobot: line — MUST be invalid (regression guard for §9.1).
// The parser must reject with error "bobot TKP wajib diisi".
{
  const r = parseBlock(
    `1) Premise 1\n2) Premise 2\nPertanyaan?\nA. optA\nB. optB\nC. optC\nD. optD\nE. optE\nD\n<pembahasan>`,
    0,
    'TKP Pelayanan Publik',
  );
  log('case2-tkp-no-bobot-EXPECT_INVALID', r);
  assert.equal(r?.status, 'invalid', `case2: expected status='invalid', got ${r?.status}`);
  assert.ok(
    (r?.errors ?? []).some((e) => e.includes('bobot TKP wajib diisi')),
    `case2: expected errors to include 'bobot TKP wajib diisi', got ${JSON.stringify(r?.errors)}`,
  );
  console.log('  [OK] case2 assertion passed: status=invalid + errors contains bobot TKP wajib diisi');
}

// case3 — TWK with stray Bobot: line — Bobot: must be ignored, soal is binary.
log('case3-twk-bobot-ignored', parseBlock(
  `1) Premise 1\n2) Premise 2\nPertanyaan?\nA. optA\nB. optB\nC. optC\nD. optD\nE. optE\nBobot: A=2, B=1, C=5, D=3, E=4\n<pembahasan>`,
  0,
  'TWK Pilar Negara',
));

// case4 — Bobot: line BEFORE Kunci line — both honored.
log('case4-bobot-before-kunci', parseBlock(
  `1) P1\n2) P2\nQ?\nA. a\nB. b\nC. c\nD. d\nE. e\nBobot: A=2, B=1, C=5, D=3, E=4\nC\n<pembahasan>`,
  0,
  'TKP Pelayanan Publik',
));

// case5 — Multiple Bobot: lines — first match wins, later ones stripped.
log('case5-multi-bobot', parseBlock(
  `1) P1\n2) P2\nQ?\nA. a\nB. b\nC. c\nD. d\nE. e\nC\nBobot: A=2, B=1, C=5, D=3, E=4\nBobot: A=5, B=4, C=3, D=2, E=1\n<pembahasan>`,
  0,
  'TKP Jejaring Kerja',
));

// case6 — Old-format TKP block with Bobot: line + Kunci.
log('case6-old-format-bobot', parseBlock(
  `Pertanyaan teks\nA. optA\nB. optB\nC. optC\nD. optD\nE. optE\nBobot: A=2, B=1, C=5, D=3, E=4\nD\n<pembahasan pembahasan panjang>`,
  0,
  'TKP Pelayanan Publik',
));

// ── Regression guards for strict-rejection contract (tkp-scoring-spec.md §9.1):
// Cases 7/8/9 exercise the OTHER 3 format paths (old-format, new-format+lead-in,
// bare-premise) to ensure `enrichTkpBobot` correctly rejects TKP-without-Bobot
// across all four format branches. Without these, a regression in the
// Bobot-line scan for any non-numbered format would slip past case2's gate.

// case7 — OLD-FORMAT TKP without Bobot: — MUST be invalid.
{
  const r = parseBlock(
    `Apa ibu kota negara Indonesia?\nA. Surabaya\nB. Bandung\nC. Jakarta\nD. Yogyakarta\nE. Medan\nC\nIbu kota Indonesia adalah Jakarta.`,
    0,
    'TKP Pelayanan Publik',
  );
  log('case7-old-format-tkp-no-bobot-EXPECT_INVALID', r);
  assert.equal(r?.status, 'invalid', `case7: expected status='invalid', got ${r?.status}`);
  assert.ok(
    (r?.errors ?? []).some((e) => e.includes('bobot TKP wajib diisi')),
    `case7: expected errors to include 'bobot TKP wajib diisi', got ${JSON.stringify(r?.errors)}`,
  );
  console.log('  [OK] case7 assertion passed: old-format TKP without Bobot: rejected');
}

// case8 — NEW-FORMAT + LEAD-IN TKP without Bobot: — MUST be invalid.
{
  const r = parseBlock(
    `Perhatikan pernyataan berikut!\n1) Premis satu.\n2) Premis dua.\n3) Premis tiga.\nPertanyaan di sini?\nA. a\nB. b\nC. c\nD. d\nE. e\nC\n<pembahasan>`,
    0,
    'TKP Pelayanan Publik',
  );
  log('case8-new-leadin-tkp-no-bobot-EXPECT_INVALID', r);
  assert.equal(r?.status, 'invalid', `case8: expected status='invalid', got ${r?.status}`);
  assert.ok(
    (r?.errors ?? []).some((e) => e.includes('bobot TKP wajib diisi')),
    `case8: expected errors to include 'bobot TKP wajib diisi', got ${JSON.stringify(r?.errors)}`,
  );
  console.log('  [OK] case8 assertion passed: new+lead-in TKP without Bobot: rejected');
}

// case9 — BARE-PREMISE TKP without Bobot: — MUST be invalid.
{
  const r = parseBlock(
    `Semua warga negara berhak atas pendidikan.\nPendidikan adalah tanggung jawab negara.\nKesimpulan yang tepat?\nA. Pendidikan bukan tanggung jawab negara\nB. Warga negara berhak mendapat pendidikan gratis\nC. Hanya sebagian warga negara yang mendapat pendidikan\nD. Pendidikan disediakan oleh swasta\nE. Negara tidak menyediakan pendidikan gratis\nB\n<pembahasan>`,
    0,
    'TKP Pelayanan Publik',
  );
  log('case9-bare-premise-tkp-no-bobot-EXPECT_INVALID', r);
  assert.equal(r?.status, 'invalid', `case9: expected status='invalid', got ${r?.status}`);
  assert.ok(
    (r?.errors ?? []).some((e) => e.includes('bobot TKP wajib diisi')),
    `case9: expected errors to include 'bobot TKP wajib diisi', got ${JSON.stringify(r?.errors)}`,
  );
  console.log('  [OK] case9 assertion passed: bare-premise TKP without Bobot: rejected');
}