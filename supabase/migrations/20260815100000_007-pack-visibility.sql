-- ============================================
-- 007-pack-visibility
-- Manajemen penayangan paket soal (public/admin/archived)
-- Spec: specs/pack-visibility-spec.md §4.1
-- ============================================
-- LATAR BELAKANG (2026-08-15):
-- CMS `public/paket-soal.html` butuh kontrol penayangan paket soal di
-- `public/select-pack.html`:
--   - 'public'   → tampil + bisa dikerjakan semua orang
--   - 'admin'    → tampil + hanya bisa dikerjakan admin (login via
--                  cookie toskd_admin_sess, dideteksi server-side)
--   - 'archived' → TIDAK tampil di select-pack + TIDAK bisa dikerjakan
--                  siapa pun (termasuk admin); CMS tetap melihatnya
--                  supaya bisa di-un-arsip.
--
-- Kolom baru `question_packs.visibility` TEXT:
--   - DEFAULT 'public' → SEMUA baris existing otomatis terisi 'public'
--     (requirement: existing packs default Publik) via fast metadata-only
--     ADD COLUMN (Postgres >= 11, DEFAULT non-volatile).
--   - CHECK constraint memastikan nilai hanya dari 3 token valid — mencegah
--     nilai tak dikenal masuk lewat API langsung (defense-in-depth; server
--     juga memvalidasi di normalizePackInput).
--
-- RLS/GRANT TIDAK berubah: app memakai service_role (bypass RLS);
-- migration-006 sudah grant table-level ALL + ALTER DEFAULT PRIVILEGES,
-- jadi kolom baru di tabel existing otomatis ter-cover.
--
-- Idempotent penuh (re-run aman): ADD COLUMN IF NOT EXISTS + DO-block utk
-- CHECK constraint (ADD CONSTRAINT tidak punya IF NOT EXISTS). BEGIN/COMMIT
-- eksplisit — saat manual via SQL Editor, gagal di tengah = rollback penuh.
--
-- POST-MIGRATION VERIFICATION:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'question_packs'
--     AND column_name = 'visibility';
--   Expected: visibility | text | NO | 'public'::text
--
--   Lalu cek existing rows sudah ter-fill (harusnya 0 baris non-public):
--     SELECT COUNT(*) FROM question_packs WHERE visibility <> 'public';
-- ============================================

BEGIN;

ALTER TABLE question_packs
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_packs_visibility_check'
      AND conrelid = 'question_packs'::regclass
  ) THEN
    ALTER TABLE question_packs
      ADD CONSTRAINT question_packs_visibility_check
      CHECK (visibility IN ('public', 'admin', 'archived'));
  END IF;
END $$;

COMMIT;
