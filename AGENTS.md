# AGENTS.md — AI Agent Instructions for `toskd`

> Filename `AGENTS.md` (UPPERCASE) dibaca otomatis oleh AI coding agents
> (Claude Code, Cursor, Codex, Roo Code, Aider) dari working directory.
> File ini **di-track di git** — berlaku untuk semua clone, tidak seperti
> `specs/` yang gitignored (working-tree-only).

---

## 1. Repo at a glance

**Project**: `toskd` — CAT (Computer Assisted Test) platform untuk simulasi ujian SKD (Seleksi Kompetensi Dasar) Indonesia. Ujian real-time, pembahasan soal, scoreboard, dan CMS bank soal.

**Tech stack**:

| Layer | Stack |
|---|---|
| Backend | Node.js v22+ (WAJIB — supabase-js 2.110 butuh native WebSocket) + Express 5 |
| Frontend | Vanilla HTML + CSS + JS (no framework, no build step) |
| Database | Supabase (PostgreSQL) — `schema.sql` snapshot, migration via `supabase/migrations/` |
| Storage | Vercel Blob (gambar soal) |
| Rich text / Math | Quill.js 1.3.7 CDN + MathJax 3 CDN |
| Theme | CSS design tokens di `public/css/tokens.css` (source of truth warna — jangan hardcode hex) |
| Logger / Observability | Pino (structured JSON + redact) + OpenTelemetry (aktif hanya jika `OTEL_SERVICE_NAME` + `OTEL_EXPORTER_OTLP_ENDPOINT` terisi) |
| Hosting | Vercel Serverless + Docker (self-host, `node:22-alpine`) |
| Package manager | **pnpm** (bukan npm, bukan yarn) |
| Env loader | `dotenv` — auto-load `.env` via `import "dotenv/config"` di `src/server.js` |

**Layout / Struktur File Utama**:

```
toskd/
├── public/
│   ├── index.html                # Halaman utama (Mulai Ujian, Bank Soal, Scoreboard)
│   ├── select-pack.html          # Halaman pemilihan paket ujian
│   ├── exam.html                 # Halaman ujian (real-time timer & grid lembar jawaban + TKP weighted scoring)
│   ├── review.html               # Halaman hasil & pembahasan soal lengkap (TKP weighted rendering + per-subtest breakdown)
│   ├── bank-soal.html             # Menu CMS (Kelola Paket Soal, Kelola Soal) - protected
│   ├── paket-soal.html            # Kelola paket soal (CRUD + subtes chip picker 1-3 + per-subtest thresholds) - protected
│   ├── kelola-soal.html           # Kelola bank soal (CRUD + Quill.js editor + TKP Bobot field + bulk-add modal) - protected
│   ├── paket-detail.html          # Kelola relasi & urutan soal (Drag & Drop + subtest-filtered bank list) - protected
│   ├── user.html                 # Ganti kata sandi admin (self-service: verifikasi password lama, min 8 karakter) - protected
│   ├── login.html                # Halaman login admin (CMS protection)
│   ├── scoreboard.html           # Papan peringkat peserta (Paging & filter + tombol Reset admin-only)
│   ├── assets/
│   │   └── toskd-emoticon.svg    # Logo SVG (browser tab favicon + global header brand mark)
│   ├── css/
│   │   ├── tokens.css            # Design tokens (CSS variables untuk color, spacing, dll)
│   │   └── styles.css            # CSS Global & Responsive Variables (termasuk .chip picker, .field-helper, bobot/TKP styles)
│   └── js/
│       ├── theme.js              # Theme manager + dynamic global header injector (auto-inject di semua page, kecuali exam/review)
│       ├── main.js               # Halaman index (landing - navigasi utama: Mulai Ujian, Bank Soal, Scoreboard)
│       ├── select-pack.js        # Halaman Pilih Paket - listing paket + validasi 1–110 soal + modal nama peserta
│       ├── exam.js               # Halaman ujian - timer persist (wall-clock + sid + multi-tab sync) + answer grid (hijau/merah) + TKP weighted scoring (option_scores per soal)
│       ├── review.js             # Halaman pembahasan - skor + status Lulus/Tidak + per-soal pembahasan (benar/salah/partial) + TKP weight gradient cards + per-subtest breakdown (filtered by pack.subtests) + <p> wrapper stripping + overlay "Akses Ditolak" (403 access control, auto-redirect 5 detik)
│       ├── scoreboard.js         # Halaman scoreboard - pagination + sortable headers + search filter (sticky-left No column, admin: checkbox col + .score-name-col) + admin-only: tombol Reset All (tersembunyi saat seleksi), hapus per-row/bulk (checkbox + select-all + pill + modal konfirmasi) + link peserta ke review (isAdmin via /api/admin/me)
│       ├── login.js              # Login admin form handler (POST /api/admin/login, redirect ke ?next=, auto-fill username dari cookie session)
│       ├── user.js               # Halaman User - ganti kata sandi admin: validasi klien (min 8 + konfirmasi cocok) + POST /api/admin/change-password + mapping error EN→ID + showNotification + 401 → redirect login
│       ├── kelola-soal.js        # Kelola bank soal: CRUD + Quill.js editor (full toolbar) + image upload ke Vercel Blob + TKP Bobot dropdown (1-5, dedupe otomatis) + bulk-add modal dengan TKP format help
│       ├── paket-soal.js         # Kelola paket soal: CRUD + subtes chip picker 1-3 + per-subtest threshold inputs + live running total + sortable/pagination table + Subtes column (chip-styled)
│       ├── paket-detail.js       # Relasi soal ↔ paket: drag-and-drop reorder + tentative selection + subtest-filtered bank list (only questions matching pack.subtests shown) + partial-failure add-to-pack + urutan add sesuai urutan centang checkbox (question_number naik per iterasi)
│       ├── bulk-parser.js        # ESM parser untuk bulk-add soal format v2 (premise list + lead-in + options A–E + key + TKP `Bobot:` line parsing) + previewHtmlForCell helper
│       ├── image-uploader.js     # Pipeline rehost gambar anti-hotlink: scan ![alt](url)/<img src> → download (no-referrer + fallback /api/fetch-image) → IndexedDB staging → upload Vercel Blob → cleanup (window.ImageUploader)
│       └── markdown-image.js     # Modul BERSAMA render markdown-img: IMAGE_MD_REGEX + renderInlineMd/renderInlinePreview (single source of truth, dipakai exam.js/review.js/kelola-soal.js; muat sbg <script type="module"> sebelum classic scripts)
├── src/
│   ├── server.js                 # API Express.js (Vercel Serverless Function) - 32 endpoint: TKP weighted scoring (scoreForQuestion + validateOptionScores) + normalizePackInput + validateQuestionMatchesPack + POST /api/fetch-image (proxy download anti-hotlink: requireAdmin + SSRF guard) + DELETE /api/scoreboard (reset, requireAdmin) + DELETE /api/scoreboard/:id + POST /api/scoreboard/bulk-delete (hapus hasil per-row/bulk, requireAdmin) + validateParticipantName (alfabet+spasi, 400 di exam/start+submit) + cleanup row In Progress saat 409 (result_id opsional, guard status) + access control review: cookie peserta toskd_participant_sess + gate GET /api/exam/:id/results (admin ATAU pemilik, selain → 403) + POST /api/admin/change-password (self-service ganti password: verifikasi current → tolak new==current → bcrypt hash → UPDATE admins; span admin.password_change.verify/.update) + urutan soal paket: POST /api/packs/:id/questions assign question_number = max(existing)+1 server-side (ignore client number, gap-safe) + GET /api/packs/:id/questions tiebreak .order('id') deterministik + observability: middleware golden-signals (histogram http.server.request.duration + access log, hanya /api/* + *.html) + migrasi console.* → Pino + span manual (exam.start.create / exam.submit.scoring / admin.login.verify / question.bulk_add) + shutdownTelemetry() di graceful shutdown
│   ├── otel.js                   # OpenTelemetry bootstrap (WAJIB di-import pertama): guard OTEL_SERVICE_NAME+OTEL_EXPORTER_OTLP_ENDPOINT, NodeSDK + instrumentations (http/express/undici/pino/runtime-node), sampler AlwaysOn route ujian + TraceIdRatioBased 10%, histogram golden-signals, withSpan/currentTraceContext/shutdownTelemetry
│   ├── logger.js                 # Pino singleton (service=toskd, pino-redact password/token/cookie/authorization/body/answers, pino-pretty hanya dev) + errorField helper
│   ├── db.js                     # Supabase client connection
│   └── tracked-request.js        # Predikat tracking bersama isTrackedPath/isTrackedUrl/isTrackedRequest (single source of truth observability)
├── scripts/
│   └── migrate-images.mjs        # CLI migrasi massal gambar soal → Vercel Blob (pnpm migrate:images; dry-run default, --apply untuk eksekusi)
├── tests/                        # Unit tests (Node built-in test runner; run via `pnpm test`) — 18 files, 206 test
│   ├── test-bulk-parser.mjs                       # Unit tests untuk public/js/bulk-parser.js (parser + previewHtmlForCell)
│   ├── test-bulk-parser-catalog.mjs               # Catalog regression suite untuk bulk-input patterns (parser integration)
│   ├── test-image-url-paste.mjs                   # IMAGE_URL_REGEX paste contract; IMAGE_MD_REGEX di-import dari markdown-image.js (modul bersama)
│   ├── test-health.mjs                            # GET /health readiness probe (mock PostgREST: 200 ready / 503 unavailable / version fallback)
│   ├── test-bulk-parser-bobot.mjs                 # Unit tests untuk TKP Bobot validation (option_scores invariants: himpunan {1..5})
│   ├── test-tkp-scoring.mjs                       # Integration tests untuk TKP weighted scoring (scoreForQuestion + computePackScore)
│   ├── test-image-uploader.mjs                    # Pure helpers scan/replace (image-uploader.js: scanImageUrls/applyUrlReplacements/isRehostedUrl)
│   ├── test-migrate-images.mjs                    # URL collection + transformasi field (scripts/migrate-images.mjs)
│   ├── test-markdown-render.mjs                   # renderInlineMd/renderInlinePreview/IMAGE_MD_REGEX (markdown-image.js)
│   ├── test-pack-question-order.mjs               # Urutan soal paket: POST max+1 server-side + client number diabaikan + tiebreak GET deterministik (mock PostgREST stateful)
│   ├── test-logger-redact.mjs                     # Lock-in src/logger.js: pino-redact menyensor password/token/cookie/authorization/body/answers + service=toskd + errorField shape
│   ├── test-otel-exporter-env.mjs                 # Lock-in Pendekatan A: validateExporterEnv mendeteksi nilai OTEL_*_EXPORTER tak dikenal (anti-senyap; prometheus metrics ditolak)
│   ├── test-otel-smoke.mjs                        # Lock-in end-to-end OTLP: mock receiver → histogram golden-signals (2xx+4xx) ter-ekspor, route ternormalisasi di traces, /health tidak masuk metrik; access log ber-trace_id (trace correlation)
│   ├── test-tracked-request.mjs                   # Predikat tracking bersama isTrackedPath/isTrackedUrl/isTrackedRequest (src/tracked-request.js) + paritas 3 fungsi
│   ├── test-admin-auth-redirect.mjs               # Lock-in auth redirect: HTML → 302 login, API → 401 JSON, OPTIONS tidak diblokir, alur login→cookie→200
│   ├── test-pack-visibility.mjs                   # Gate visibility paket: list/detail/questions/exam start-submit/scoreboard + validasi create-update + legacy fallback (mock PostgREST stateful)
│   ├── test-scoreboard-delete.mjs                 # Delete scoreboard per-row/bulk + validasi nama peserta (400) + cleanup row In Progress saat 409 (mock PostgREST stateful)
│   └── test-admin-password-change.mjs             # Ganti kata sandi admin: 401/OPTIONS/validasi 400/min-8/new==current/404/500 + hash bcrypt ter-update + sesi tetap valid + edge multi-tab (mock PostgREST stateful mutatif)
├── schema.sql                    # Skema database Supabase (termasuk tabel admins + option_scores + subtests + subtest_thresholds)
├── supabase/                     # Supabase CLI: config.toml + migrations/ (8 file: 000-007) + seed.sql (di-track sejak 2026-08-15)
├── pnpm-workspace.yaml           # Config pnpm: packages ["."] (kompat pnpm 12) + allowBuilds protobufjs (pnpm 10+)
├── Dockerfile                    # Multi-stage Docker build (node:22-alpine, non-root, tini init, HEALTHCHECK)
├── docker-compose.yaml           # Self-host: service toskd di network eksternal net1 (Caddy reverse-proxy), env dari .env.container
├── .dockerignore                 # Exclude unnecessary or sensitive files
├── .github/workflows/            # CI/CD: ci.yml test-only (push main + pull_request), docker-build.yml tag release GHCR (tag `N.N.N` → build & push, job merge bikin manifest `N.N.N` + `sha-<long>` + `latest`), arcane-deploy.yml deployment (+ verifikasi /health)
├── vercel.json                   # Konfigurasi routing Vercel
├── specs/                        # ⚠️ GITIGNORED — konvensi detail + spec docs (working-tree-only, tidak di-clone)
└── package.json
```

---

## 2. Perintah yang dipakai

```bash
pnpm install      # Install deps (WAJIB pnpm — jangan npm/yarn)
pnpm test         # Test gate: `node --test tests/*.mjs` — WAJIB hijau sebelum commit
pnpm start        # = node src/server.js (auto-load .env via dotenv)
vercel dev        # Local dev (recommended, matches production runtime)
node --check <file.js>   # Syntax check setiap edit JS
```

> ❌ **Tidak ada `pnpm run build`** — Vercel build sendiri via `@vercel/node`; static frontend di-serve direct.

---

## 3. Hard rules (MUST / MUST NOT)

### MUST

1. **Pakai `pnpm`.** Bukan npm, bukan yarn. `pnpm-lock.yaml` adalah lockfile source of truth. Package baru → `pnpm add <pkg>`.
2. **Test gate hijau sebelum commit.** `pnpm test` wajib lolos (saat ini **206/206 pass**). Regresi = jangan commit.
3. **Verify setiap edit JS** dengan `node --check <file.js>` sebelum commit. Untuk HTML/CSS refactor, cek konsistensi ID/class (grep).
4. **Interview-first untuk feature ≥1 file atau behavior change.** 3-round `ask_user` interview SEBELUM implementasi untuk keputusan penting. (Detail konvensi: `specs/AGENTS.md`, lihat §7.)
5. **Schema migrations diuji di DUA bentuk** — (A) fresh `supabase db reset --local`, (B) replika bentuk prod. Migration wajib idempotent + RLS/GRANT seaman prod.
6. **Jangan commit credential/secret** — semua env di `.env` (gitignored). `.env.example` (placeholder) aman di-track.
7. **Spawn sub-agent peninjau kode (code-reviewer sub-agent) sebelum commit** untuk perubahan non-trivial — multi-file, behavior change, atau structure change. Skip hanya untuk trivial fix ≤3 lines. Fallback platform tanpa sub-agents: lakukan self-review setara (`node --check` + grep konsistensi + `pnpm test`).

### MUST NOT

1. **Jangan `git add` / `git commit` / `git push` tanpa explicit user ask.** Default = working-tree only. Silent, no proactive confirmation. Lulus dari sub-agent peninjau/verifikasi TIDAK mengotomatiskan commit — tetap butuh perintah eksplisit dari user.
2. **Jangan force-push, `--amend`, `rebase`, atau `reset --hard`.** Destructive — tidak ada use case valid di repo ini.
3. **Jangan commit file `specs/`** — gitignored by design (MUST-NOT #10 di `specs/AGENTS.md`). `git add -f specs/<file>` = violation.
4. **Jangan hardcode hex color** di luar `public/css/tokens.css`. Selalu `var(--token)`.
5. **Jangan ubah `schema.sql`** tanpa spec + interview — berdampak langsung ke production data (no rollback path).
6. **Jangan tambahkan trailer `Co-authored-by` / atribusi AI** di pesan commit — commit message murni milik author manusia.

---

## 4. Git workflow

### Command policy (3-tier)

| Kategori | Contoh | Aturan |
|---|---|---|
| **Read-only** | `git status`, `git diff`, `git log`, `git show`, `git blame`, `git rev-parse`, `git branch -l`, `git tag -l` | Silent OK |
| **Worktree mutation** (reversible) | `git stash`/`stash pop`, `git checkout <file>`, `git clean -n`, `git restore <file>` | Silent OK |
| **Write** | `git add` (semua bentuk), `git commit`, `git push` | **WAJIB explicit user ask** |

### Konvensi

- **Feature branch + PR** untuk fitur: `feat/<slug>` dari `main` → PR → merge → cleanup branch. Push langsung ke `main` hanya untuk hotfix/trivial.
- **Commit message multi-line**: subject ≤72 char + body deskriptif (perubahan per file, AC-verified). TANPA trailer AI (MUST-NOT #6).
- **Single commit = single logical change.** Jangan bundle perubahan tak terkait.
- **Local-only default**: user bilang "commit" tanpa "push" → commit local saja.

---

## 5. Environment variables (ringkas)

| Variable | Keterangan |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_KEY` | **service_role key** (bukan anon — wajib bypass RLS utk `password_hash`) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob Read/Write token |
| `JWT_SECRET` | ≥32 char (`openssl rand -hex 32`). **Di lokal cukup env ini + Supabase vars** — kredensial admin digenerate otomatis (lihat baris Bootstrap). |
| `COOKIE_SECURE` | Opsional: paksa `Secure` flag cookie login |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | Bootstrap admin — **dua mode**: **(a) Auto-generate (default, dev)** — biarkan keduanya kosong; saat `admins` kosong & `NODE_ENV` ≠ `production`, server membuat `admin` + password acak 20 char lalu menampilkannya **sekali** via banner `GENERATED ADMIN CREDENTIALS` di stdout (bukan Pino). **(b) Eksplisit** — set keduanya; dibuat dari env di SEMUA `NODE_ENV`; setelah login pertama, DELETE env tersebut (log warning tiap cold-start). Parsial (hanya satu diset) → error log `partial-env`, bootstrap skip. `NODE_ENV=production` + kosong → skip total. |
| `LOG_LEVEL` | Level Pino (default `info`) |
| `OTEL_SERVICE_NAME` + `OTEL_EXPORTER_OTLP_ENDPOINT` | Keduanya wajib terisi agar telemetry aktif |
| `APP_VERSION` | Build-time (Docker `APP_VERSION`) dari canonical stable SemVer git tag — dipakai `/health` `version` |
| `GIT_COMMIT_SHA` | Build-time (Docker `GIT_SHA`) — dipakai `/health` `sha` |

### Catatan alur release untuk AI Agents

Bagian ini adalah catatan internal untuk AI coding agents di masa depan. Jangan menganggapnya sebagai konfigurasi runtime atau dokumentasi pengguna.

- Deployment production Docker hanya dipicu oleh canonical stable SemVer tag tanpa prefix `v`, tepat berbentuk `N.N.N`, misalnya `0.1.0`. CI berjalan di push main + pull_request (bukan push ke branch non-main); branch tidak membangun atau mendeploy image production.
- Sebelum membuat tag release, **ubah dan commit `package.json.version` terlebih dahulu** agar sama dengan versi target. Workflow Docker menolak tag jika versinya tidak cocok dengan `package.json`; image release menggunakan tag versi dan immutable commit SHA; tag `latest` juga dibuat di job merge menunjuk rilis terbaru (convenience pull/dev) tetapi `latest` bukan target deployment.
- Setelah commit perubahan versi masuk ke `main`, buat tag pada commit tersebut lalu push tag. Contoh untuk rilis `0.1.1`:
  ```bash
  # 1. Ubah package.json menjadi: "version": "0.1.1"
  # 2. Commit dan merge perubahan ke main
  git switch main
  git pull --ff-only origin main
  git tag 0.1.1
  git push origin 0.1.1
  ```
- Jangan membuat atau memindahkan tag sebelum `package.json.version` diperbarui dan commit versi sudah menjadi dasar tag. Jika tag sudah terlanjur menunjuk commit yang salah, jangan memaksa/memindahkannya; buat perbaikan melalui commit baru dan gunakan versi tag berikutnya sesuai kebijakan immutable release.
- `/health` mengembalikan `version` sebagai semantic version dan `sha` sebagai short commit SHA. Consumer yang membutuhkan commit SHA harus membaca `health.sha`, bukan `health.version`.
- GitHub Release dibuat manual melalui GitHub **Releases → Draft a new release → Choose a tag**. GitHub Release menggunakan nama `vN.N.N` (misalnya `v0.1.1`), sedangkan tag deployment yang dipilih tetap `N.N.N` (misalnya `0.1.1`) setelah build Docker dan deployment Arcane untuk tag/commit tersebut sukses.
- Tidak diperlukan workflow GitHub Release khusus. Jangan menambahkan kembali workflow otomatis/manual khusus untuk kebutuhan ini tanpa spec baru.
- Jika mengubah workflow release/deployment, pertahankan korelasi tag dan commit SHA serta verifikasi `/health` (`status`, `version`, dan `sha`).

Detail setup pengguna tetap berada di `README.md` §Deployment. Catatan penting: perubahan versi di `package.json` harus dibuat melalui commit/PR sebelum tag release dibuat.


Detail setup + sumber tiap var: `README.md` §Deployment + `.env.example`.

---

## 6. Referensi

| Resource | Path | Kapan dirujuk |
|---|---|---|
| Project intro & deployment | `README.md` | Setup awal, env vars, deployment, self-host |
| Konvensi detail (spec workflow, CSS token, API endpoints §10) | `specs/AGENTS.md` | ⚠️ Lokal saja (gitignored). Detail lengkap konvensi repo |
| Spec docs (historical + aktif) | `specs/*-spec.md` | Implementation: peer ke spec utk AC/UAT/status |
| Database schema | `schema.sql` + `supabase/migrations/` | Struktur tabel, migration history |
| CI/CD | `.github/workflows/` | ci.yml (test-only) + docker-build.yml (tag release `N.N.N` + GHCR) + arcane-deploy.yml (deploy + verifikasi `/health`) |

> **Catatan sinkronisasi**: file ini **self-contained untuk clone baru** (aturan inti + arsitektur: API endpoints §9, token system §8, troubleshooting §10). `specs/` gitignored dan tidak ikut clone — jika folder itu tidak ada di working tree, abaikan referensi ke sana; file ini cukup.

---

## 7. Spec-driven workflow (ringkas)

Untuk feature ≥1 file atau behavior change:

1. **Interview 3-round** via `ask_user` (apa → gimana → detail delivery). Jangan tebak keputusan penting.
2. **Tulis spec** `specs/<slug>-spec.md` (13-section, gitignored, working-tree-only) — atau catat keputusan di commit message jika sederhana.
3. **Implement + verify** (`node --check`, `pnpm test`; perubahan non-trivial → review sub-agent per MUST #7).
4. **Commit + push HANYA atas explicit user ask.**

**Sub-agents (SHOULD, jika platform mendukung)**: gunakan ROLE generik, bukan nama model spesifik — (a) **sub-agent pemikir (thinker)** untuk bug-fix non-trivial / pendekatan tidak pasti, beri `filePaths` relevan sebagai konteks; (b) **sub-agent peninjau kode + sub-agent verifikasi (verifier)** dijalankan **paralel** — keduanya independen, hemat waktu. Conventions ini berlaku universal agar kompatibel dengan bermacam AI Agents (Claude Code, Cursor, Codex, Roo, dll.) di masa mendatang.

Single-file tweaks (minor CSS, 1-line fix) tidak butuh spec — cukup commit message langsung.

---

## 8. CSS token system

**Source of truth**: `public/css/tokens.css` — di-load SEBELUM `styles.css` di setiap HTML page. Semua warna wajib via `var(--token)`. **46 tokens**, didefinisikan paralel di `:root` (light) dan `[data-theme="dark"]`:

| Group | Tokens |
|---|---|
| Accent | `--primary`, `--primary-hover`, `--primary-light`, `--accent`, `--accent-strong`, `--ring` |
| Status | `--success`, `--success-light`, `--success-hover`, `--danger`, `--danger-light`, `--danger-hover`, `--warning` |
| TKP bobot | `--orange-300`, `--yellow-300`, `--orange-200`, `--orange-600`, `--amber-100`, `--amber-500` |
| Neutrals | `--bg`, `--surface`, `--surface-2`, `--surface-header`, `--surface-hover`, `--text`, `--text-muted`, `--text-faint`, `--border`, `--border-strong` |
| Typography | `--font-sans`, `--font-mono` |
| Radius | `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` |
| Shadows | `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl` |
| Motion | `--ease-out`, `--ease-spring` |
| Utility | `--on-primary`, `--toast-bg`, `--toast-text` |

**Rules**:

1. **NEVER hardcode hex** di luar `tokens.css`. Pengecualian terdokumentasi: track/thumb theme-toggle, hover/kontras dark mode (explicit hex), `.btn-cta`/`.btn-cta-ghost` landing hero.
2. **Token baru wajib di dua tempat** — append di `:root` DAN `[data-theme="dark"]` paralel (light/dark parity).
3. **Dark mode**: `[data-theme="dark"]` override dengan explicit hex utk hover; state classes (`.answered`, `.active`) harus specificity ≥ hover rule.
4. **WCAG contrast**: tiap token baru wajib dites kontras sebelum ditambahkan.

---

## 9. API Endpoints

Semua endpoint didefinisikan di `src/server.js` (Express 5, di-deploy sebagai Vercel Serverless Function). **Total: 32 endpoint + 5 protected HTML routes.**

### Questions (8)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/questions` | Daftar semua soal |
| POST | `/api/questions` | Tambah soal (+ optional image upload) |
| POST | `/api/questions/bulk` | Bulk add (max 500, atomic via single transaction) |
| POST | `/api/questions/bulk-usage` | Pre-check usage banyak soal (`{ ids }` → `{ used, packs }`) |
| POST | `/api/questions/bulk-delete` | Bulk delete best-effort per-id (`{ deleted, failed }`) |
| PUT | `/api/questions/:id` | Update soal (+ optional image upload) |
| DELETE | `/api/questions/:id` | Hapus soal (auto-unlink via FK CASCADE) |
| GET | `/api/questions/:id/usage` | Single-question usage check |

### Packs (9)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/packs` | Daftar paket — visibility-gated (non-admin hanya `public`) |
| GET | `/api/packs/:id` | Detail paket — 403 utk non-admin saat `admin`/`archived` |
| POST | `/api/packs` | Buat paket (default `visibility='public'`) |
| PUT | `/api/packs/:id` | Update nama/durasi/passing grade/visibility (PUT partial) |
| DELETE | `/api/packs/:id` | Hapus paket (cascade ke exam_results + pack_questions) |
| POST | `/api/packs/:id/questions` | Tambah soal — `question_number` = max+1 server-side (gap-safe) |
| GET | `/api/packs/:id/questions` | Daftar soal paket urut `question_number` (403 utk non-admin saat non-public) |
| PUT | `/api/packs/:id/questions` | Bulk reorder (delete-all-then-insert) |
| DELETE | `/api/packs/:packId/questions/:questionId` | Hapus 1 soal dari paket (tanpa hapus soal) |

### Exam (3)

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/exam/start` | Mulai ujian (create `exam_results` "In Progress"; visibility gate) |
| POST | `/api/exam/submit` | Submit + scoring (TWK/TIU biner 5/0, TKP weighted 1-5); duplicate-submit → 409; set cookie peserta |
| GET | `/api/exam/:id/results` | Hasil ujian — admin ATAU pemilik cookie peserta, selain → 403 |

### Scoreboard (5)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/scoreboard?pack_id=X` | Scoreboard per-paket (pack_id WAJIB) |
| GET | `/api/scoreboard-all?pack_id=X` | Scoreboard global + optional filter; anon hanya pack `public` |
| DELETE | `/api/scoreboard/:id` | Hapus 1 hasil ujian (admin-only; 400 id invalid, 404 not found, 200 `{ deleted: 1 }`) |
| POST | `/api/scoreboard/bulk-delete` | Hapus banyak hasil (admin-only, `{ ids }` max 1000, satu query `in` → `{ deleted, requested }`) |
| DELETE | `/api/scoreboard` | Reset scoreboard (admin-only, `neq("id",-1)` utk PostgREST) |

### Upload & Image proxy (2)

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/upload-image` | Upload base64 ke Vercel Blob (`{ image, folder? }` → `{ url }`) |
| POST | `/api/fetch-image` | Proxy download anti-hotlink (requireAdmin + SSRF guard, max 8MB) |

### Admin Auth (4)

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/admin/login` | Login (cookie `toskd_admin_sess`, HttpOnly, SameSite=Strict, 24h) |
| POST | `/api/admin/logout` | Logout (hapus cookie, idempotent) |
| GET | `/api/admin/me` | Cek session aktif (200 `{ username }` / 401) |
| POST | `/api/admin/change-password` | Ganti kata sandi admin (self-service, requireAdmin): verifikasi `current_password` → tolak new==current → bcrypt hash (cost 10) → UPDATE; 400/404/500, sesi JWT tidak disentuh |

### Health (1)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/health` | Readiness probe — 200 `{ status: "ready", version, sha }` / 503 `{ status: "unavailable", version, sha, error }` saat DB down |

### Protected HTML routes (5)

`/bank-soal.html`, `/kelola-soal.html`, `/paket-soal.html`, `/paket-detail.html`, `/user.html` — `requireAdmin`: HTML → 302 `/login.html?next=`, API → 401 JSON.

---

## 10. Troubleshooting — Node.js <22 (WebSocket crash)

**Gejala**: crash saat startup — `Error: Node.js detected but native WebSocket not found` (dari `@supabase/realtime-js` di `src/db.js`).

**Root cause**: `@supabase/supabase-js@2.110` memakai native WebSocket API yang hanya ada di **Node.js 22+**.

**Fix**:

1. **Docker**: pastikan base image = `node:22-alpine` (bukan `node:20-alpine`), lalu rebuild (`docker build --no-cache` jika cache lama).
2. **Local**: upgrade Node ≥22 (`nvm install 22 && nvm use 22`).
3. **JANGAN downgrade `@supabase/supabase-js`** — upgrade Node saja.

---

## Appendix: File metadata

| Field | Value |
|---|---|
| Path | `AGENTS.md` (root repo) |
| Tracked | **Ya** (di-commit ke git — berlaku semua clone) |
| Audience | AI coding agents |
| Dibuat | 2026-08-16 |
