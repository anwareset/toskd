-- ============================================
-- 006-grant-api-roles
-- GRANT privileges API roles (anon/authenticated/service_role) — align lokal
-- dengan hosted (2026-08-12)
-- ============================================
-- LATAR BELAKANG (insiden 2026-08-12):
-- Error 42501 "permission denied for table exam_results" saat app dipointing
-- ke Supabase LOCAL. Stack lokal memberi default privileges TERBATAS untuk
-- tabel yang dibuat via migrations: anon/authenticated/service_role hanya dapat
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (Dxtm) — TIDAK SELECT/INSERT/UPDATE/
-- DELETE (arwd). Hosted prod sebaliknya: default privileges penuh + GRANT
-- eksplisit per tabel (lihat dump prod: GRANT ALL ... TO anon/authenticated/
-- service_role). Tidak pernah terdeteksi karena app selama ini berjalan
-- melawan prod, bukan lokal.
--
-- Isi (idempotent, BEGIN/COMMIT):
--   1. GRANT ALL (CRUD + sisanya) pada SEMUA tabel public yang ADA
--      → anon, authenticated, service_role (mirror prod).
--   2. GRANT ALL pada SEMUA sequence public (identity id butuh USAGE/SELECT).
--   3. ALTER DEFAULT PRIVILEGES FOR ROLE postgres → tabel/sequence FUTURE
--      (buatan migration berikutnya) langsung dapat grant penuh — mencegah
--      error yang sama terulang di env mana pun.
--
-- RLS (migration-005) tetap aktif: grant ke anon/authenticated bersifat inert
-- karena RLS menolak akses mereka; service_role bypass RLS dan kini berfungsi.
-- ============================================

BEGIN;

-- Tabel yang SUDAH ada
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Sequence yang SUDAH ada (identity id)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Default privileges: tabel/sequence yang akan DATANG (dibuat role postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

COMMIT;
