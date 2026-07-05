# 🚀 CAT SKD - TIU Subtes Platform

Computer Assisted Test (CAT) untuk simulasi ujian Seleksi Kompetensi Dasar (SKD) - Tes Inteligensia Umum (TIU).
Platform ini memiliki fitur ujian real-time, pembahasan soal, scoreboard, dan Content Management System (CMS) untuk mengelola bank soal.

---

## 📌 Tech Stack
- **Hosting / Deploy**: Vercel
- **Database**: Supabase (PostgreSQL)
- **Storage**: Vercel Blob (untuk asset gambar soal Figural)
- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS (Responsive!), VanillaJS (Framework-less)
- **Math Rendering**: MathJax 3 CDN (support ekspresi matematika `$$\frac{a}{b}$$`)

---

## 📂 Struktur File Utama
```
toskd/
├── public/
│   ├── index.html                # Halaman utama
│   ├── select-pack.html          # Halaman pemilihan paket ujian
│   ├── exam.html                 # Halaman ujian (real-time timer & grid lembar jawaban)
│   ├── review.html               # Halaman hasil & pembahasan soal lengkap
│   ├── bank-soal.html             # Menu CMS
│   ├── paket-soal.html            # Kelola paket soal (CRUD)
│   ├── kelola-soal.html           # Kelola bank soal (CRUD + MathJax/Image preview)
│   ├── paket-detail.html          # Kelola relasi & urutan soal (Drag & Drop)
│   ├── scoreboard.html           # Papan peringkat peserta (Paging & filter)
│   ├── css/
│   │   └── styles.css            # CSS Global & Responsive Variables
│   └── js/
│       ├── theme.js              # Theme manager & dynamic header injector
│       └── [page].js             # Logic VanillaJS masing-masing halaman
├── src/
│   ├── server.js                 # API Express.js (Vercel Serverless Function)
│   └── db.js                      # Supabase client connection
├── vercel.json                   # Konfigurasi routing Vercel
└── package.json
```

---

## 🔧 Rule & Logika Ujian
1. **Scoring Ujian**:
   - Jawaban benar mendapat **5 poin**.
   - Jawaban salah / tidak dijawab mendapat **0 poin**.
   - Total nilai berupa **skor absolut** (bukan persentase).
2. **Passing Grade**:
   - Ditentukan secara absolut per paket soal (contoh: 85 poin).
   - Status kelulusan: "Lulus PG" atau "Tidak Lulus PG".
3. **Limitasi Soal**:
   - Jumlah soal per paket dibatasi **minimal 1 soal dan maksimal 35 soal**.
   - Validasi otomatis berjalan pada halaman pemilihan paket dan CMS.
4. **Theme Switcher**:
   - Mendukung Light Mode & Dark Mode dengan penyimpanan status di `localStorage`.

---

## 🚀 Instalasi & Menjalankan Lokal

### 1. Prerequirements
Pastikan sudah terpasang:
- Node.js (v18 ke atas)
- PNPM / NPM
- Akun Vercel & Supabase

### 2. Setup Infrastruktur

#### Supabase (Database)
1. Buat project baru di Supabase Dashboard
2. Buka **Project Settings → API** untuk mengambil:
   - **Project URL** untuk `SUPABASE_URL`
   - **anon public key** untuk `SUPABASE_KEY`

#### Vercel Blob (Storage Image)
1. Buat **Blob Store** di Vercel Dashboard
2. Set access mode: **Public**
3. Cari **Blob Read/Write Token** ambil untuk `BLOB_READ_WRITE_TOKEN`

#### Vercel Deploy
1. Pastikan **Environment Variables** sudah ada di Vercel Project:
   - `SUPABASE_URL` = [Supabase URL]
   - `SUPABASE_KEY` = [Supabase anon key]
   - `BLOB_READ_WRITE_TOKEN` = [Blob token]

### 3. Environment Variables (`.env`)
Buat file `.env` di root folder project dan isi:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxxxx
```

### 4. Jalankan Project
Jalankan perintah berikut untuk menginstall dependency dan run server lokal:
```bash
# Install dependensi
pnpm install

# Jalankan development server
vercel dev
```
Akses platform di `http://localhost:3000`.

---

## 🗃️ Skema Database Supabase

Untuk membuat seluruh tabel dan relasi yang diperlukan di dashboard Supabase (SQL Editor), jalankan query yang ada di file:
👉 [`schema.sql`](./schema.sql)
