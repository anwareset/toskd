# Exam Answer Grid Polish — Spec

> <a id="status"></a>**Status**: ✅ Implemented (working tree only, 2026-07-16)

> Document ini adalah spec hasil interview dengan user (3 ronde, 12 pertanyaan) untuk redesign kotak nomor soal di **lembar jawaban** (`<div class="answer-grid">`) pada halaman **exam.html** dan konsistensinya dengan **review.html**.

---

## 1. Tujuan & Latar Belakang

### 1.1 Tujuan
Meningkatkan polish visual kotak nomor soal di sidebar ujian sehingga:
1. **Lebih mudah di-scan** — user tahu posisinya dan progress menjawab dengan cepat
2. **Diferensiasi state jelas** — putih untuk belum, biru untuk sudah dijawab
3. **Konsisten dengan halaman review** — shape, size, dan typography identik

### 1.2 Latar Belakang (Bug Saat Ini)
Inspeksi kode menunjukkan:

- **`public/js/exam.js`** (baris ~58): button di-render dengan class mentah
  ```js
  `<button class="${answers[q.id] ? "answered" : "unanswered"}" data-i="${i}">`
  ```
  → **tidak ada prefix `.answer-cell`** sehingga rules di CSS tidak match.
- **`public/css/styles.css`** (~1108-1157): rules `.answer-cell.answered`, `.answer-cell.unanswered`, dll. ditulis dengan prefix `.answer-cell`.
- **Akibatnya**: button di exam grid saat ini di-render dengan styling **default browser** (bukan styling polished). User melihat button standar OS, bukan card-grid design yang intended.
- `.answer-cell.answered` saat ini berwarna **hijau** (`--color-grade-pass-bg`), bukan biru yang user minta.
- Review grid (`review.html` + `review.js`) sudah pakai `.answer-cell` dengan palette `correct/incorrect/not-answered` (hijau/merah/abu-abu) sehingga tidak ada bug styling di sana.

### 1.3 Scope
- ✅ In scope: styling `.answer-cell` untuk 4 states (`unanswered`, `answered`, `active`, hover/focus-visible)
- ✅ In scope: perbaikan bug class di `exam.js` agar styling applied
- ✅ In scope: konsistensi shape dengan `.answer-cell` di review.html
- ❌ Out of scope: ubah layout halaman exam (sidebar width, padding, dst)
- ❌ Out of scope: perubahan logic save jawaban atau backend API
- ❌ Out of scope: redesign halaman review secara keseluruhan (hanya shape parity)

---

## 2. Design Decisions (Hasil Interview)

### Round 1 — Visual Identity
| # | Aspek | Keputusan | Rationale |
|---|-------|-----------|-----------|
| 1 | Warna "answered" | **Soft primary tint** | Latar `var(--color-primary-light)` (8% opacity) + teks dark `var(--color-primary)` |
| 2 | Active indicator (current question) | **Soft scale-up + shadow** | `transform: scale(1.08)` + `box-shadow` subtle. Tidak menambah warna baru, kompak dengan answered (blue) |
| 3 | Border unanswered | **Tanpa border** | Hanya terpisah oleh gap. Cell putih murni dengan radius 8px |
| 4 | Border radius | **8px (medium)** | Modern tapi tidak terlalu kasual |

### Round 2 — Polish & Motion
| # | Aspek | Keputusan | Rationale |
|---|-------|-----------|-----------|
| 5 | Motion duration | **Instant (0ms)** | Tidak ada transisi warna. State berubah langsung saat answer dipilih |
| 6 | Number typography | **Medium (500)** | Lebih tegas dari regular 400, terbaca jelas di 52px |
| 7 | Cell size | **52-56px square** | Lebih mudah di-tap di mobile; total ~280px sidebar width masih muat di 320px |
| 8 | Hover | **Hanya cursor pointer** | Tidak ada perubahan warna/shape saat hover |

### Round 3 — Consistency & Edge Cases
| # | Aspek | Keputusan | Rationale |
|---|-------|-----------|-----------|
| 9 | Apply ke review.js? | **Ya, identik secara shape** | Review pakai shape sama tapi palette green/red/gray (correct/incorrect/not-answered) |
| 10 | Counter summary header | **Tidak** | Header tetap '<h3>📋 Lembar Jawaban</h3>' saja, tanpa 'X/Y selesai' |
| 11 | ARIA live announcement | **Tidak ada** | Tidak mengumumkan perubahan jawaban ke SR (menghindari noise) |
| 12 | Responsive columns | **5 kolom di semua device** | Konsisten desktop & mobile. Cell tetap readable sampai ~360px viewport |

---

## 3. Visual Specification

### 3.1 Token References
Token sudah ada di `styles.css`, tidak perlu token baru:
```
--color-primary:           #0056D2 (light) / #4D8DFF (dark)
--color-primary-hover:     #004BB5 (light)
--color-primary-light:     rgba(0, 86, 210, 0.08) (light) / rgba(77, 141, 255, 0.12) (dark)
--color-surface-1:         #FFFFFF (light) / #1E293B (dark)
--color-surface-2:         ... (review not-answered)
--color-grade-pass:        green (review correct only)
--color-grade-fail:        red (review incorrect only)
--color-ink:               ... (text tokens)
--space-2:                 8px (gap antar cell)
--radius-md:               8px (saat ini mungkin didefine — fallback 8px)
```

### 3.2 Cell Anatomy

```
┌─────────────────────┐
│         12          │  ← font-size: 14px, font-weight: 500, tabular-nums
│     (medium)        │  ← text-align: center
└─────────────────────┘
   width: 52-56px
   height: 52-56px (aspect-ratio: 1/1)
   border-radius: 8px
   padding: 0 (no padding, content area fully occupied by number)
```

### 3.3 State Matrix

| State | Background | Text Color | Border | Transform | Shadow |
|-------|-----------|-----------|--------|-----------|--------|
| `unanswered` (default) | `--color-surface-1` | `--color-ink` | none | none | none |
| `hover` (desktop only) | `--color-surface-1` (sama) | `--color-ink` (sama) | none | none | none *(cursor: pointer only)* |
| `focus-visible` (keyboard) | `--color-surface-1` | `--color-ink` | none | none | `0 0 0 3px var(--color-primary-transparent)` *(ring untuk a11y keyboard nav)* |
| `answered` | `--color-primary-light` | `--color-primary` | none | none | none |
| `active` (current question, stackable dengan answered) | inherited dari base (surface OR primary-light) | inherited | none | `scale(1.08)` | `0 4px 12px rgba(0,0,0,0.08)` (light) / `0 4px 12px rgba(0,0,0,0.32)` (dark) |

> **Catatan**: state `.active` ditumpangkan (`composes`) di atas answered/unanswered sehingga:
> - Cell aktif + answered → blue tint + scaled up dengan shadow
> - Cell aktif + unanswered → putih + scaled up dengan shadow
> 
> Ini memenuhi design "soft scale-up + shadow" tanpa menambah warna baru.

### 3.4 Review Page Variant (konsistensi shape)

| State | Background | Text | Catatan |
|-------|-----------|------|---------|
| `.answer-cell.correct` | `--color-grade-pass-bg` | `--color-grade-pass` | Tetap hijau |
| `.answer-cell.incorrect` | `--color-grade-fail-bg` | `--color-grade-fail` | Tetap merah |
| `.answer-cell.not-answered` | `--color-surface-2` | `--color-ink-muted` | Tetap abu-abu |

Shape, size, radius, typography, layout grid identik dengan exam grid. Hanya palette berbeda.
`.active` (current question di review) tetap pakai scale + shadow yang sama.

---

## 4. Implementation Plan

### 4.1 File Changes

#### `public/js/exam.js` (line 58 area)
- **Ubah** template builder agar setiap button dapat class `.answer-cell`:
  ```js
  // SEBELUM:
  `<button class="${answers[q.id] ? "answered" : "unanswered"}" data-i="${i}">${i + 1}</button>`

  // SESUDAH:
  `<button class="answer-cell ${answers[q.id] ? "answer-cell--answered" : "answer-cell--unanswered"}" data-i="${i}">${i + 1}</button>`
  ```
- **Ubah** `updateGrid()` function (line 65-71) untuk selalu set class `.answer-cell` + modifier, agar `.active` tidak menggantikan base class:
  ```js
  function updateGrid() {
    gridEl.querySelectorAll("button").forEach((b, i) => {
      // Reset base class, pakai BEM-style modifier
      const isAnswered = !!answers[questions[i].id];
      b.className = `answer-cell ${isAnswered ? "answer-cell--answered" : "answer-cell--unanswered"}`;
      if (i === currentIndex) b.classList.add("answer-cell--active");
    });
  }
  ```
- Tidak ada perubahan di click handler (sudah ada di onclick delegation di `buildGrid`).

#### `public/css/styles.css` (~line 1108-1175 area)

**Hapus atau rewrite** rules `.answer-cell.answered`/`.unanswered` saat ini (yang warnanya hijau dan pakai raw class names tanpa prefix logic). Ganti dengan BEM-style classes + tambah:
- `.answer-cell` — base (52-56px square, 8px radius, medium weight, dll.)
- `.answer-cell--unanswered` — base + white
- `.answer-cell--answered` — base + primary-light bg + primary text
- `.answer-cell--active` — composable scale + shadow (tumpangan)
- `.answer-cell:focus-visible` — outline ring keyboard-only
- `.answer-cell.correct` / `.incorrect` / `.not-answered` — review.js states (existing, mungkin perlu touch-up warna)

Catatan BEM: pilihan `--answered`/`--unanswered`/`--active` double-dash modifier dokumentatif. Implementation bisa juga pakai `data-state="answered"` attr, tapi BEM lebih konsisten dengan pattern di design system.

**Dark mode block `[data-theme="dark"]`**: tambahkan override untuk active shadow karena shadow untuk light mode menggunakan `rgba(0,0,0,0.08)` yang kurang terlihat di dark.

#### `public/js/review.js`
- Tidak ada perubahan logic. Cukup verifikasi bahwa class names di builder sama dengan exam (`answer-cell`, `answer-cell--correct`, `answer-cell--incorrect`, `answer-cell--not-answered`).
- **Rename** state classes di review.js dari `.correct`/`.incorrect`/`.not-answered` → `answer-cell--correct` / `answer-cell--incorrect` / `answer-cell--not-answered` agar BEM-consistent. CSS tetap punya variant-nya tanpa perlu ada selector terpisah untuk base `(tanpa modifier)`.

#### `public/exam.html`
- Tidak ada perubahan struktural. Class `<div class="answer-grid">` dan `<aside class="answer-panel">` sudah sesuai.

#### `public/review.html`
- Tidak ada perubahan struktural.

### 4.2 Step-by-step Roll-out
1. Update `.answer-cell` rules di styles.css (base + 3 modifiers + focus-visible + active).
2. Update `exam.js` agar button dapat `.answer-cell` base + modifier class.
3. Update `review.js` agar class names match (BEM style).
4. Verify dark mode override untuk active shadow.
5. Visual regression test di browser untuk light + dark mode (lihat §6).

---

## 5. Acceptance Criteria

### 5.1 Visual Verification Checklist
- [ ] Cell unanswered — latar putih (light) / surface-1 (dark), teks medium grey, tanpa border
- [ ] Cell answered — latar primary-light 8%, teks primary, tanpa border
- [ ] Cell active — `transform: scale(1.08)` + subtle shadow, **stackable** dengan answered (jadi blue + scaled up)
- [ ] Cell hover — TIDAK ada perubahan visual (cuma cursor pointer)
- [ ] Cell focus-visible (keyboard tab) — ring primary-transparent 3px offset
- [ ] Border-radius 8px di kedua state
- [ ] Ukuran 52-56px square
- [ ] Font Medium 500 dengan tabular-nums (opsional, lihat §3.2)
- [ ] Tidak ada transisi warna saat answer diubah (instant)

### 5.2 Consistency Verification
- [ ] `exam.js` dan `review.js` button builder pakai class `.answer-cell` sebagai base
- [ ] Ukuran, radius, font-weight identik di exam & review
- [ ] Review grid tetap pakai palette green/red/grey (tidak berubah ke blue answered)

### 5.3 Functional Verification
- [ ] Click button masih navigasi ke soal (onclick handler di `buildGrid` tidak berubah)
- [ ] State answered/unanswered masih sync dengan localStorage `exam_<id>_answers`
- [ ] Active class masih pindah saat user pindah soal via prev/next button
- [ ] Tidak ada regresi di MathJax rendering (tidak terkait tapi pastikan tidak ada efek samping)
- [ ] Tidak ada regresi di timer warning threshold logic

### 5.4 Accessibility Checklist
- [ ] `<button>` element tetap dipakai (sudah semantic)
- [ ] Focus-visible outline terlihat untuk keyboard navigation
- [ ] `aria-label="Lembar jawaban — klik untuk pindah ke soal"` di aside tetap berlaku
- [ ] Tidak ada live announcement baru (existing behavior preserved)
- [ ] Contrast ratio text ≥ 4.5:1 di light & dark mode (primary pada primary-light masih readable)
- [ ] Touch target minimal 44×44 px (kami pakai 52-56px ✓)

---

## 6. Verification Approach

### 6.1 Static Validation
- `bash`/`rg` checks:
  - Class `.answer-cell` + 4 modifiers didefine di styles.css
  - `exam.js` button builder pakai class `.answer-cell`
  - `review.js` builder pakai class names yang cocok
  - Syntax check seluruh `public/js/*.js` via `node --check`
  - Tidak ada ID HTML yang di-reference JS tapi tidak ada di HTML

### 6.2 Visual Tests (manual atau browser-use)
1. **Light mode, kosong**: Buka `/exam.html?packId=<id>&name=test`. Klik belum jawab. Verify cells unanswered berwarna putih, no border.
2. **Light mode, menjawab**: Jawab soal 1 → cell 1 jadi biru softtint. Verify tidak ada transition glitch (instant).
3. **Active state**: Soal 2 (via next button) → cell 2 terlihat scaled up + shadow sedikit.
4. **Combined**: Jawab soal 2, lalu click cell 2 di grid → cell tetap biru + scaled.
5. **Dark mode**: Toggle ke dark mode via theme toggle. Verify primary-light dark variant digunakan.
6. **Review**: Submit ujian, lihat review.html. Grid pakai green/red palette yang sama persis ukurannya.
7. **Resize**: Browser ke 360px width. Verify grid masih readable (5 kolom × 56px + gap 8px = 308px, masih muat).

### 6.3 Code Review
- Spawn `code-reviewer-minimax-m3` setelah implementasi selesai untuk review critical feedback.

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| BEM class naming conflict dengan existing `.answer-cell.answered` rule (yang saat ini hijau) | Medium | Rewrite semua rules `.answer-cell.*` jadi versi BEM `--answered`/etc. Hapus raw class rules lama. |
| Active indicator (scale) bisa overflow grid container | Low | Pastikan grid container tidak punya `overflow: hidden`. Tambahkan margin/visual padding sekitar cell aktif jika perlu |
| `--color-primary-light` saat ini didefine sebagai `rgba(0, 86, 210, 0.08)` di light + `rgba(77, 141, 255, 0.12)` di dark. Kontras teks primary (dark blue) pada tint 8% mungkin rendah | Low | Test contrast manual di light mode. Jika < 4.5:1, naikkan opacity tint atau pakai border tipis primary |
| ARIA existing `aria-live="polite"` di `#exam-progress` (soal X dari Y) masih ada — apakah perlu berubah? | Low | TIDAK. Ini sudah mengumumkan perpindahan soal (current/total), cukup relevan. Spec hanya menjaga **tidak menambah** live announcement baru saat answer change |
| Review.js state classes `.correct`/`.incorrect`/`.not-answered` saat ini di-render langsung. Migrasi ke `answer-cell--correct` dll. mungkin break styling | Medium | Verify CSS rules mencakup kedua pattern (legacy + BEM) atau migrasi penuh konsisten |

---

## 8. Open Questions (untuk klarifikasi lebih lanjut saat implementasi)

> Semua pertanyaan di bawah ini **non-blocking** — bisa dijawab saat code review atau setelah implementasi initial.

1. **Font tabular-nums**: apakah perlu diaktifikan? CSS `font-variant-numeric: tabular-nums` membuat angka rata (tidak ada ragged width). Untuk cell square dengan angka multi-digit (10–110) lebar font bervariasi — tanpa tabular-nums, grid cell akan terlihat jitter saat participant berpindah dari soal #9 ke #10. Rekomendasi: aktifkan untuk konsistensi dengan timer dan mencegah pergeseran layout saat perpindahan nomor soal.
2. **Active scale size**: 1.08 sudah ditentukan dalam interview. Apakah cukup atau perlu dinaikkan ke 1.1 untuk lebih jelas?
3. **Active shadow elevation**: apakah `0 4px 12px rgba(0,0,0,0.08)` cukup, atau perlu lebih dramatis (mis. `0 6px 16px rgba(0,86,210,0.12)` dengan primary tint untuk extra "glow")?
4. **Apakah perlu transisi transform saja, tanpa transisi warna?** Mis. 150ms transition pada transform/opacity tapi 0ms pada background-color. Bisa membuat movement active feel "lighter" tanpa compromise instant feedback.
5. **Apakah soal yang "dilihat tapi belum dijawab" perlu berbeda dari "belum pernah dilihat"?** Saat ini keduanya = unanswered. Spec saat ini tidak membahas hal ini, jadi tetap sama.
6. **Apakah perlu keyboard shortcut (1-9 untuk jump ke 9 soal pertama)?** Out of scope saat ini, tapi ditambah sebagai enhancement opportunity.

---

## 9. Acceptance Sign-off

Setelah implementasi:
1. ✅ Visual verification checklist (§5.1) passed
2. ✅ Consistency verification (§5.2) passed
3. ✅ Functional verification (§5.3) passed — no regression
4. ✅ Accessibility checklist (§5.4) passed
5. ✅ Code review oleh `code-reviewer-minimax-m3` → status PASS

Spec ini siap menjadi basis implementasi. Setelah ditandatangani, dibuat implementation plan terpisah (atau langsung code changes).

## Revision history

| Date       | Change |
|------------|--------|
| 2026-07-16 | Spec documented locally (working tree only); no single commit attributable untuk exam answer grid (impl predates tracked commits atau tersebar di multiple exam refinement commits). |
| 2026-07-16 | Sync Status header format ke SPECS.md §5 convention + create Revision history section per § 8. |
