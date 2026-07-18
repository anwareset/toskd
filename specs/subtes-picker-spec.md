# Subtes Picker Spec

> <a id="status"></a>**Status**: ✅ Implemented (commit b397e30, 2026-07-18) — `public/paket-soal.html` chip picker + `src/server.js` validateQuestionMatchesPack + `schema-migration-003-add-subtests-and-thresholds.sql`.
> **Scope:** Admin bisa pilih 1-3 subtes per paket soal (TWK/TIU/TKP) via chip picker UI; passing grade dihitung otomatis dari per-subtest threshold.

## 1. Goal

Paket soal latihan SKD bisa berisi **kombinasi subtes** (TWK saja, TWK+TIU, atau TWK+TIU+TKP). Sebelumnya pakai `pack_type` enum ("Single"/"Combo") yang inflexible. Sekarang admin bebas pilih subtes mana saja yang masuk paket.

**Permintaan user**:
- Hapus `pack_type` lama
- Ganti dengan `subtests[]` array (1-3 elemen dari `{TWK, TIU, TKP}`)
- Tambah `subtest_thresholds` JSONB (per-subtest passing grade)
- Status kelulusan: **per-subtest logical-AND** — pack lulus PG iff setiap `subtest.earned >= subtest_thresholds[sub]` untuk setiap `sub` dalam `pack.subtests`. Pack 1-subtest = 1 comparison (Single). Pack 2-3 subtests = N independent comparisons (Combo); jika ada satu yang fail, status = "Tidak Lulus PG".
- Default thresholds Indonesia: TWK=65, TIU=80, TKP=166

## 2. Pendekatan yang dipilih

### 2.1 Schema

Kolom baru di `question_packs`:
```sql
subtests TEXT[] NOT NULL DEFAULT ARRAY['TWK','TIU','TKP']
subtest_thresholds JSONB NOT NULL DEFAULT '{"TWK":65,"TIU":80,"TKP":166}'::jsonb
```
- `subtests`: 1-3 elemen, unique, dari `{TWK, TIU, TKP}`
- `subtest_thresholds`: object dengan key per subtes, value integer >= 0
- Legacy pack (sebelum migration-003) dapat fallback ke default

### 2.2 UI (`public/paket-soal.html`)

- **Chip picker**: toggle chip TWK/TIU/TKP di modal create/edit paket
- **Auto-derived**: kalau pilih 1 subtes → 1 input threshold. Pilih 2 → 2 input. Pilih 3 → 3 input.
- **Running total**: "Passing Grade Total: <sum>" live update saat user typing
- **Hapus field `passing_grade` lama** di modal (auto-computed dari subtest_thresholds)
- **Kolom tabel "Subtes"**: tampilkan chips per paket di tabel paket-soal

### 2.3 Server-side filter (`src/server.js`)

```js
function validateQuestionMatchesPack(question, pack) {
  // Cek question.question_type (prefix TWK/TIU/TKP) ada di pack.subtests
  // Return boolean
}
```

- Dipakai di `POST /api/packs/:id/questions` dan `PUT /api/packs/:id/questions`
- Filter soal yang di-add ke paket harus sesuai subtes paket
- Defense-in-depth: UI chip picker sudah constrain, tapi server validate juga

### 2.4 Bank list filter (`public/paket-detail.html` + `public/js/paket-detail.js`)

- Bank soal (di paket-detail) hanya menampilkan soal dengan `question_type` sesuai `pack.subtests`
- Filter di-fetch dari server atau di-filter client-side
- Empty state: "Tidak ada soal TWK di paket ini. Tambah soal di Bank Soal dulu."

## 3. Files & touchpoints

| File | Perubahan |
|---|---|
| `public/paket-soal.html` + `public/js/paket-soal.js` | Chip picker + per-subtest threshold inputs + running total + kolom Subtes |
| `public/paket-detail.html` + `public/js/paket-detail.js` | Bank list filter by `pack.subtests` |
| `public/js/review.js` | `packSubtests` dynamic rendering + `computeBreakdowns()` filter |
| `src/server.js` | `validateQuestionMatchesPack()` helper + filter di POST/PUT pack questions |
| `schema.sql` | Tambah kolom di CREATE TABLE question_packs + ALTER TABLE ADD COLUMN IF NOT EXISTS |
| `schema-migration-003-add-subtests-and-thresholds.sql` | ALTER TABLE untuk existing install |
| `public/css/styles.css` | `.chip` + `.chip__label` + `.subtes-chips` styling |

## 4. Test scenarios

| # | Skenario | Expected |
|---|---|---|
| T1 | Create paket baru, pilih hanya TWK | `subtests=["TWK"]`, 1 input threshold |
| T2 | Create paket baru, pilih TWK+TIU | `subtests=["TWK","TIU"]`, 2 input thresholds |
| T3 | Create paket baru, pilih TWK+TIU+TKP | `subtests=["TWK","TIU","TKP"]`, 3 input thresholds |
| T4 | Uncheck subtes lalu submit | Modal validation error |
| T5 | Edit paket existing (legacy tanpa subtests) | Default fallback `["TWK","TIU","TKP"]` |
| T6 | Add soal TKP ke paket yang subtests=["TWK"] | 400 error "soal tidak sesuai subtes paket" |
| T7 | Lulus PG = per-subtest lulus (logical-AND) | TWK.earned>=65 DAN TIU.earned>=80 DAN TKP.earned>=166 (per-subtest, bukan global sum) |
| T8 | Running total live update saat user typing | Display ter-update real-time |

## Revision history

| Date | Change |
|---|---|
| 2026-07-18 | Spec documented locally (working tree only) — implemented in commit b397e30. |
