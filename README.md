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
- **Package Manager**: PNPM

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
│   ├── bank-soal.html             # Menu CMS (Kelola Paket Soal, Kelola Soal)
│   ├── paket-soal.html            # Kelola paket soal (CRUD)
│   ├── kelola-soal.html           # Kelola bank soal (CRUD + Quill.js editor)
│   ├── paket-detail.html          # Kelola relasi & urutan soal (Drag & Drop)
│   ├── scoreboard.html           # Papan peringkat peserta (Paging & filter)
│   ├── css/
│   │   └── styles.css            # CSS Global & Responsive Variables
│   └── js/
│       ├── theme.js              # Theme manager & dynamic header injector
│       ├── kelola-soal.js        # Quill.js editor + image upload integration
│       └── [page].js             # Logic VanillaJS masing-masing halaman
├── src/
│   ├── server.js                 # API Express.js (Vercel Serverless Function)
│   └── db.js                     # Supabase client connection
├── schema.sql                    # Skema database Supabase
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

3. **Limitasi Soal**:
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
   - **anon public key** → `SUPABASE_KEY`

#### Vercel Blob (Storage Image)

1. Buat **Blob Store** di Vercel Dashboard
2. Set access mode: **Public**
3. Copy **Blob Read/Write Token** → `BLOB_READ_WRITE_TOKEN`

### 3. Environment Variables

Buat file `.env` di root folder project:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxxxx
```

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

## 🗃️ Skema Database Supabase

Untuk membuat seluruh tabel dan relasi, jalankan query yang ada di file:
 [`schema.sql`](./schema.sql)

**Tabel utama**:
- `questions` - Bank soal (konten HTML dengan gambar inline)
- `question_packs` - Paket soal
- `pack_questions` - Relasi soal dalam paket
- `exam_results` - Hasil ujian peserta

---

## 📚 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/questions` | Daftar semua soal |
| POST | `/api/questions` | Tambah soal baru |
| PUT | `/api/questions/:id` | Update soal |
| DELETE | `/api/questions/:id` | Hapus soal |
| GET | `/api/packs` | Daftar paket soal |
| GET | `/api/packs/:id` | Detail paket soal |
| POST | `/api/packs` | Buat paket soal |
| PUT | `/api/packs/:id` | Update paket soal |
| DELETE | `/api/packs/:id` | Hapus paket soal |
| POST | `/api/packs/:id/questions` | Tambah soal ke paket |
| POST | `/api/exam/start` | Mulai ujian |
| POST | `/api/exam/submit` | Kirim jawaban |
| GET | `/api/exam/:id/results` | Hasil ujian |
| GET | `/api/scoreboard-all` | Daftar peringkat |
| POST | `/api/upload-image` | Upload gambar ke Vercel Blob |
