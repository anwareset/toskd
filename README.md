# 🚀 CAT SKD - Platform

Platform CAT (Computer Assisted Test) untuk simulasi ujian SKD (Seleksi Kompetensi Dasar). Platform ini memiliki fitur ujian real-time, pembahasan soal, scoreboard, dan pengelola bank soal.

---

## 📌 Tech Stack

- **Hosting / Deploy**: Vercel
- **Database**: Supabase (PostgreSQL)
- **Storage**: Vercel Blob (untuk gambar soal)
- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS, VanillaJS
- **Rich Text Editor**: Quill.js 1.3.7 (WYSIWYG editor dengan toolbar untuk bold, italic, image upload, dll)
- **Math Rendering**: MathJax 3 CDN (support ekspresi matematika `$$\frac{a}{b}$$`)

---

## ✨ Fitur Utama

### 🎯 Ujian
- Timer real-time dengan auto-submit saat waktu habis
- Scoring: TWK/TIU biner (5 poin benar / 0 salah) + TKP weighted (bobot 1–5 per opsi / 0 jika tak dijawab)
- Passing grade per-subtes: lulus jika SEMUA subtes mencapai ambang (default TWK=65, TIU=80, TKP=166)
- Hasil ujian dengan pembahasan lengkap

### 📝 CMS Bank Soal
- Rich Text Editor (Quill.js) untuk input soal, opsi jawaban, dan pembahasan
- Toolbar: bold, italic, underline, strike, lists, links, image upload, formula
- Upload gambar langsung ke Vercel Blob dari editor
- Preview soal dengan MathJax rendering
- Bulk Add Soal
- Drag & drop urutan soal dalam paket

### 🏆 Scoreboard
- Tabel peringkat peserta
- Filter berdasarkan paket soal
- Sorting berdasarkan skor

---

## 📂 Struktur File Utama

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
│   ├── login.html                # Halaman login admin (CMS protection)
│   ├── scoreboard.html           # Papan peringkat peserta (Paging & filter)
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
│       ├── review.js             # Halaman pembahasan - skor + status Lulus/Tidak + per-soal pembahasan (benar/salah/partial) + TKP weight gradient cards + per-subtest breakdown (filtered by pack.subtests) + <p> wrapper stripping
│       ├── scoreboard.js         # Halaman scoreboard - pagination + sortable headers + search filter (sticky-left No column)
│       ├── login.js              # Login admin form handler (POST /api/admin/login, redirect ke ?next=, auto-fill username dari cookie session)
│       ├── kelola-soal.js        # Kelola bank soal: CRUD + Quill.js editor (full toolbar) + image upload ke Vercel Blob + TKP Bobot dropdown (1-5, dedupe otomatis) + bulk-add modal dengan TKP format help
│       ├── paket-soal.js         # Kelola paket soal: CRUD + subtes chip picker 1-3 + per-subtest threshold inputs + live running total + sortable/pagination table + Subtes column (chip-styled)
│       ├── paket-detail.js       # Relasi soal ↔ paket: drag-and-drop reorder + tentative selection + subtest-filtered bank list (only questions matching pack.subtests shown) + partial-failure add-to-pack
│       └── bulk-parser.js        # ESM parser untuk bulk-add soal format v2 (premise list + lead-in + options A–E + key + TKP `Bobot:` line parsing) + previewHtmlForCell helper
├── src/
│   ├── server.js                 # API Express.js (Vercel Serverless Function) - TKP weighted scoring (scoreForQuestion + validateOptionScores) + normalizePackInput + validateQuestionMatchesPack
│   └── db.js                     # Supabase client connection
├── tests/                        # Unit tests (Node built-in test runner; run via `pnpm test`)
│   ├── test-bulk-parser.mjs                       # Unit tests untuk public/js/bulk-parser.js (parser + previewHtmlForCell)
│   ├── test-bulk-patterns-catalog.mjs             # Catalog regression suite untuk bulk-input patterns (parser integration)
│   ├── test-tkp-bobot.mjs                         # Unit tests untuk TKP Bobot validation (option_scores invariants: himpunan {1..5})
│   └── test-tkp-scoring.mjs                       # Integration tests untuk TKP weighted scoring (scoreForQuestion + computePackScore)
├── schema.sql                    # Skema database Supabase (termasuk tabel admins + option_scores + subtests + subtest_thresholds)
├── Dockerfile                    # Multi-stage Docker build (node:22-alpine, non-root, tini init, HEALTHCHECK)
├── .dockerignore                 # Exclude node_modules, .env, specs/, tests/ dari image
├── vercel.json                   # Konfigurasi routing Vercel
└── package.json
```

---

## 🔧 Rule & Logika Ujian

1. **Scoring per Soal**:
   - **TWK / TIU (biner)**: 5 poin jika jawaban benar, 0 poin jika salah/tidak dijawab
   - **TKP (bobot)**: per-soal memiliki poin (1–5), 0 poin jika tidak dijawab.
   - **Total skor absolut**: bukan persentase

2. **Paket Soal**:
   - Paket soal terdiri dari 1–3 subtes (TWK, TIU, TKP).
   - Setiap subtes dalam paket memiliki nilai passing grade masing-masing (Contoh: TWK=65, TIU=80, TKP=166).

3. **Passing Grade**:
   - Peserta "Lulus PG" jika hasil semua subtes mencapai passing grade subtes.
   - Jika hasil salah satu subtes tidak mencapai passing grade subtes, maka peserta "Tidak Lulus PG". 

4. **Limitasi Paket Soal**:
   - Minimal 1 soal, maksimal 110 soal per paket.

---

## 🚀 Deployment

### 1. Prerequisites

- Node.js v22+
- PNPM
- Akun Vercel & Supabase

### 2. Setup Infrastruktur

#### Supabase (Database)

1. Buat project baru di Supabase Dashboard
2. Buka **Project Settings → API** untuk mengambil:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (JANGAN anon key) → `SUPABASE_KEY`. Wajib service_role supaya server bisa bypass RLS untuk read `password_hash` di tabel `admins`. Anon key + RLS policy "allow public read" = plaintext password leak.

#### Vercel Blob (Storage Image)

1. Buat **Blob Store** di Vercel Dashboard
2. Set access mode: **Public**
3. Copy **Blob Read/Write Token** → `BLOB_READ_WRITE_TOKEN`

### 3. Environment Variables

Buat file `.env` di root folder project:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...          # service_role key (Wajib, bukan anon)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxxxx
JWT_SECRET=<random-32+-chars>                                    # Generate: openssl rand -hex 32
BOOTSTRAP_ADMIN_USERNAME=admin                                  # Opsional: untuk bootstrap admin pertama
BOOTSTRAP_ADMIN_PASSWORD=<strong-password>                      # Opsional: akan di-hash bcrypt lalu di-insert
```

**Catatan `BOOTSTRAP_ADMIN_*`**: env var ini dibaca sekali di cold-start. Jika tabel `admins` kosong, server akan otomatis hash password (bcrypt cost 10) dan insert admin pertama. **PENTING: DELETE kedua env var ini dari Vercel dashboard setelah admin pertama berhasil login**. Server log warning setiap cold-start kalau masih ada (plaintext password leak risk).

### 4. Setup Database

Jalankan query SQL di `schema.sql` melalui **Supabase SQL Editor**:

1. Buka Supabase Dashboard → project Anda
2. Klik **SQL Editor** di sidebar
3. Copy-paste seluruh isi file `schema.sql`
4. Klik **Run** untuk membuat tabel

### 5. Jalankan Project

```bash
# Install dependencies
pnpm install

# Jalankan development server
vercel dev           # untuk local development (auto-load .env)
# atau
pnpm start           # node src/server.js langsung (load .env via dotenv)
# atau
vercel               # untuk production deployment
```

Akses platform di [`http://localhost:3000`](http://localhost:3000).

### 6. Container

Tersedia file `Dockerfile` multi-stage yang dioptimalkan untuk containerization:

```bash
# Build image
docker build -t toskd .

# Jalankan container dengan env vars dari .env
docker run -it -p 3000:3000 --env-file .env toskd

# Atau pass env satu per satu
docker run -it -p 3000:3000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_KEY=... \
  -e BLOB_READ_WRITE_TOKEN=... \
  -e JWT_SECRET=... \
  toskd
```
