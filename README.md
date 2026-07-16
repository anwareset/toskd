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
- Navigasi soal via grid lembar jawaban (hijau = dijawab, merah = belum)
- Score per soal = 5 poin (benar), 0 poin (salah/tidak dijawab)
- Passing grade absolut (bukan persentase)
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
│   ├── exam.html                 # Halaman ujian (real-time timer & grid lembar jawaban)
│   ├── review.html               # Halaman hasil & pembahasan soal lengkap
│   ├── bank-soal.html             # Menu CMS (Kelola Paket Soal, Kelola Soal) — protected
│   ├── paket-soal.html            # Kelola paket soal (CRUD) — protected
│   ├── kelola-soal.html           # Kelola bank soal (CRUD + Quill.js editor) — protected
│   ├── paket-detail.html          # Kelola relasi & urutan soal (Drag & Drop) — protected
│   ├── login.html                # Halaman login admin (CMS protection)
│   ├── scoreboard.html           # Papan peringkat peserta (Paging & filter)
│   ├── assets/
│   │   └── toskd-emoticon.svg    # Logo SVG (browser tab favicon + global header brand mark)
│   ├── css/
│   │   ├── tokens.css            # Design tokens (CSS variables untuk color, spacing, dll)
│   │   └── styles.css            # CSS Global & Responsive Variables
│   └── js/
│       ├── theme.js              # Theme manager + dynamic global header injector (auto-inject di semua page, kecuali exam/review)
│       ├── main.js               # Halaman index (landing — navigasi utama: Mulai Ujian, Bank Soal, Scoreboard)
│       ├── select-pack.js        # Halaman Pilih Paket — listing paket + validasi 1–35 soal + modal nama peserta
│       ├── exam.js               # Halaman ujian — timer persist (wall-clock + sid + multi-tab sync) + answer grid (hijau/merah)
│       ├── review.js             # Halaman pembahasan — skor + status Lulus/Tidak + per-soal pembahasan (benar/salah)
│       ├── scoreboard.js         # Halaman scoreboard — pagination + sortable headers + search filter (sticky-left No column)
│       ├── login.js              # Login admin form handler (POST /api/admin/login, redirect ke ?next=, auto-fill username dari cookie session)
│       ├── kelola-soal.js        # Kelola bank soal: CRUD + Quill.js editor (full toolbar) + image upload ke Vercel Blob + bulk-add modal
│       ├── paket-soal.js         # Kelola paket soal: CRUD + passing grade + duration + table render (sortable + pagination)
│       ├── paket-detail.js       # Relasi soal ↔ paket: drag-and-drop reorder + tentative selection + partial-failure add-to-pack
│       └── bulk-parser.js        # ESM parser untuk bulk-add soal format v2 (premise list + lead-in + options A–E + key) + previewHtmlForCell helper
├── src/
│   ├── server.js                 # API Express.js (Vercel Serverless Function)
│   ├── blob.js                   # Vercel Blob storage helper (signed-token upload/delete)
│   └── db.js                     # Supabase client connection
├── tests/                        # Unit tests (Node built-in test runner)
│   └── test-bulk-parser.mjs      # 42 unit tests untuk public/js/bulk-parser.js (jalankan: `pnpm test` — atau `node --test tests/test-bulk-parser.mjs` untuk single file)
├── schema.sql                    # Skema database Supabase (termasuk tabel admins)
├── vercel.json                   # Konfigurasi routing Vercel
└── package.json
```

---

## 🔧 Rule & Logika Ujian

1. **Scoring Ujian**:
   - Jawaban benar: **5 poin**
   - Jawaban salah / tidak dijawab: **0 poin**
   - Total skor absolut (bukan persentase)

2. **Passing Grade**:
   - Ditentukan per paket soal (contoh: 85 poin)
   - Status: "Lulus PG" atau "Tidak Lulus PG"

3. **Limitasi Paket Soal**:
   - Minimal 1 soal, maksimal 35 soal per paket

---

## 🚀 Deployment

### 1. Prerequisites

- Node.js v18 ke atas
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

**Catatan `BOOTSTRAP_ADMIN_*`**: env var ini dibaca sekali di cold-start. Jika tabel `admins` kosong, server akan otomatis hash password (bcrypt cost 10) dan insert admin pertama. **PENTING: DELETE kedua env var ini dari Vercel dashboard setelah admin pertama berhasil login** — server log warning setiap cold-start kalau masih ada (plaintext password leak risk).

### 4. Setup Database

Jalankan query SQL di `schema.sql` melalui **Supabase SQL Editor**:

1. Buka Supabase Dashboard → project Anda
2. Klik **SQL Editor** di sidebar
3. Copy-paste seluruh isi file `schema.sql`
4. Klik **Run** untuk membuat tabel

### 5. Jalankan Project

```bash
# Install dependensi
pnpm install

# Jalankan development server
vercel dev # untuk local development
# atau
vercel # untuk production deployment
```

Akses platform di [`http://localhost:3000`](http://localhost:3000).

---

## 📚 API Endpoints

Semua endpoint didefinisikan di `src/server.js` (Express.js, di-deploy sebagai Vercel Serverless Function). Backend menggunakan Supabase untuk database dan Vercel Blob untuk upload gambar. Total: **26 endpoint** + **4 protected HTML routes**, dikelompokkan berdasarkan resource.

### 📝 Questions (8 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/questions` | Daftar semua soal |
| POST | `/api/questions` | Tambah soal baru (dengan optional upload gambar inline ke Vercel Blob) |
| POST | `/api/questions/bulk` | Bulk tambah banyak soal (max 500 per request, atomic via PostgREST single transaction) |
| POST | `/api/questions/bulk-usage` | Pre-check pack usage untuk banyak soal sekaligus. **Body:** `{ ids: [1..1000] }`. **Returns:** `Record<idStr, { used, packs }>`. Single round-trip via PostgREST `IN` query — bukan loop per-id. |
| POST | `/api/questions/bulk-delete` | Bulk delete dengan **best-effort per-id semantics** (bukan atomic). **Body:** `{ ids: [1..1000] }`. **Returns:** `{ deleted: [ids], failed: [{ id, reason }] }` untuk partial-failure reporting. |
| PUT | `/api/questions/:id` | Update soal (dengan optional image upload) |
| DELETE | `/api/questions/:id` | Hapus soal (auto-unlink dari `pack_questions` via FK CASCADE) |
| GET | `/api/questions/:id/usage` | Single-question usage check. **Returns:** `{ used, packs: [name] }` |

### 📦 Packs (9 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/packs` | Daftar semua paket soal |
| GET | `/api/packs/:id` | Detail paket soal |
| POST | `/api/packs` | Buat paket soal baru |
| PUT | `/api/packs/:id` | Update nama / durasi / passing grade |
| DELETE | `/api/packs/:id` | Hapus paket (cascade ke `exam_results` + `pack_questions`) |
| POST | `/api/packs/:id/questions` | Tambah 1 soal ke paket (assign `question_number`) |
| GET | `/api/packs/:id/questions` | Daftar soal dalam paket, diurutkan berdasarkan `question_number` |
| PUT | `/api/packs/:id/questions` | Bulk reorder soal dalam paket (delete-all-then-insert). **Body:** `{ questions: [{ question_id, question_number }] }` |
| DELETE | `/api/packs/:packId/questions/:questionId` | Hapus 1 soal dari 1 paket (tanpa menghapus soal itu sendiri) |

### 🎯 Exam (3 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/exam/start` | Mulai ujian (create row `exam_results` dengan status `"In Progress"`) |
| POST | `/api/exam/submit` | Kirim jawaban, hitung skor otomatis (5 poin per benar, 0 untuk salah/tidak dijawab), set status `"Lulus PG"` / `"Tidak Lulus PG"` berdasarkan passing grade |
| GET | `/api/exam/:id/results` | Hasil ujian berdasarkan `exam_id` (include embedded `question_packs` data) |

### 🏆 Scoreboard (2 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/scoreboard?pack_id=X` | Scoreboard per-paket. **`pack_id` query param WAJIB.** **Returns:** `[{ participant_name, score, status }]` ordered by score DESC. |
| GET | `/api/scoreboard-all?pack_id=X` | Scoreboard global, dengan optional `pack_id` filter. **Returns:** `[{ participant_name, score, status, created_at, pack_id, question_packs(name) }]` ordered by score DESC. |

### 🖼️ Upload (1 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/upload-image` | Upload gambar (base64) ke Vercel Blob. **Body:** `{ image, folder? }` (default folder: `questions`). **Returns:** `{ url }`. |

### 🔐 Admin Auth (3 endpoint)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/admin/login` | Login admin. **Body:** `{ username, password }`. **Returns:** `{ ok: true, username }` + Set-Cookie `toskd_admin_sess` (HttpOnly, SameSite=Strict, 24h expiry). Username di-normalize lowercase. Constant-time bcrypt compare untuk mencegah timing attack enumeration. |
| POST | `/api/admin/logout` | Logout admin. Set-Cookie dengan `Max-Age=0` untuk hapus session cookie. Idempotent (selalu return `{ ok: true }`). |
| GET | `/api/admin/me` | Cek session aktif. **Returns:** `{ username }` jika authenticated, atau `401 { error: "not authenticated" }` jika tidak. Dipakai oleh `theme.js` untuk render tombol Logout di global header. |

### 🛡️ Protected HTML Routes (4 routes, di luar `/api/`)

Route CMS HTML yang di-protect oleh `requireAdmin` middleware. Definisi di `src/server.js` sebagai `PROTECTED_HTML_ROUTES`. Jika user belum authenticated dan akses route ini:

- **HTML page request** (`GET /bank-soal.html`): redirect `302` ke `/login.html?next=<encoded-original-url>`
- **API request** (`/api/...`): return `401 { error: "admin login required" }`

| Path | Description |
|------|-------------|
| `/bank-soal.html` | Menu CMS (Kelola Paket Soal, Kelola Soal) |
| `/kelola-soal.html` | Kelola bank soal (CRUD + Quill.js editor) |
| `/paket-soal.html` | Kelola paket soal (CRUD) |
| `/paket-detail.html` | Kelola relasi & urutan soal (Drag & Drop) |
