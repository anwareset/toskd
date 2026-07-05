# Website CAT SKD CPNS - TIU Subtes

## Tech Stack
- **Hosting**: Vercel
- **Database**: Supabase (PostgreSQL)
- **Storage**: Vercel Blob
- **Backend**: Node.js
- **Frontend**: HTML, CSS, VanillaJS
- **Package Manager**: PNPM

---

## Project Structure
```
toskd/
├── public/                  # Frontend static files
│   ├── index.html           # Halaman utama
│   ├── exam.html            # Halaman ujian
│   ├── review.html          # Halaman pembahasan
│   ├── dashboard.html       # Dashboard bank soal & paket
│   ├── scoreboard.html      # Halaman scoreboard
│   ├── css/
│   │   └── styles.css       # CSS global
│   ├── js/
│   │   ├── main.js         # Logika halaman utama
│   │   ├── exam.js         # Logika ujian
│   │   ├── review.js       # Logika pembahasan
│   │   ├── dashboard.js    # Logika dashboard
│   │   └── scoreboard.js   # Logika scoreboard
│   └── assets/             # Gambar, ikon, dll
├── src/
│   ├── server.js          # Backend server (Node.js)
│   ├── db.js             # Koneksi & operasi Supabase
│   └── blob.js           # Operasi Vercel Blob
├── package.json
└── pnpm-workspace.yaml     # Konfigurasi PNPM
```

---

## Database Schema (Supabase)

### Perintah SQL untuk Supabase:
```sql
-- Tabel untuk menyimpan bank soal
CREATE TABLE questions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content TEXT NOT NULL,                  -- Teks soal (HTML untuk matematika/gambar)
  question_type VARCHAR(20) NOT NULL,    -- 'text', 'math', 'figural'
  image_url TEXT,                       -- URL gambar (jika figural)
  options JSONB NOT NULL,               -- {A: "...", B: "...", C: "...", D: "...", E: "..."}
  correct_answer CHAR(1) NOT NULL,      -- 'A'|'B'|'C'|'D'|'E'
  explanation TEXT NOT NULL,            -- Pembahasan soal
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabel untuk menyimpan paket soal
CREATE TABLE question_packs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  duration_minutes INTEGER NOT NULL,    -- Durasi pengerjaan (menit)
  passing_grade INTEGER NOT NULL DEFAULT 85,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabel relasi soal dalam paket
CREATE TABLE pack_questions (
  pack_id BIGINT REFERENCES question_packs(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES questions(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,      -- Urutan soal dalam paket
  PRIMARY KEY (pack_id, question_id)
);

-- Tabel hasil ujian
CREATE TABLE exam_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_name VARCHAR(255) NOT NULL,
  pack_id BIGINT REFERENCES question_packs(id),
  score INTEGER NOT NULL,                -- Skor akhir (0-100)
  status VARCHAR(20) NOT NULL,           -- 'Lulus PG'|'Tidak Lulus PG'
  answers JSONB NOT NULL,               -- {1: 'A', 2: 'B', ...} (jawaban peserta)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Storage (Vercel Blob)

### Instruksi Konfigurasi:
1. **Setup Vercel Blob**:
   ```bash
   pnpm add @vercel/blob
   ```
2. **Konfigurasi Environment Variables** (`.env.local`):
   ```env
   BLOB_READ_WRITE_TOKEN=your_token_here
   ```
3. **Contoh Kode Upload Gambar** (`src/blob.js`):
   ```javascript
   import { put } from '@vercel/blob';

   export async function uploadImage(file) {
     const { url } = await put(`questions/${file.name}`, file, {
       access: 'public',
     });
     return url;
   }
   ```

---

## Backend API (Node.js)

### Endpoints:
| Method | Endpoint                     | Deskripsi                          |
|--------|-------------------------------|------------------------------------|
| GET    | `/api/questions`              | Daftar semua soal                  |
| POST   | `/api/questions`              | Tambah soal baru                   |
| GET    | `/api/packs`                  | Daftar paket soal                  |
| POST   | `/api/packs`                  | Buat paket soal baru               |
| POST   | `/api/packs/:id/questions`    | Tambah soal ke paket               |
| POST   | `/api/exam/start`             | Mulai ujian (simpan jawaban awal)  |
| POST   | `/api/exam/submit`            | Kirim jawaban akhir                |
| GET    | `/api/exam/:id/results`       | Hasil ujian & pembahasan           |
| GET    | `/api/scoreboard`             | Daftar peringkat peserta           |

### Contoh Kode (`src/server.js`):
```javascript
import { createClient } from '@supabase/supabase-js';
import { uploadImage } from './blob.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Contoh: Tambah soal baru
app.post('/api/questions', async (req, res) => {
  const { content, question_type, options, correct_answer, explanation, image } = req.body;
  let image_url = null;
  
  if (image) {
    image_url = await uploadImage(image);
  }
  
  const { data, error } = await supabase
    .from('questions')
    .insert({ content, question_type, options, correct_answer, explanation, image_url })
    .select();
  
  if (error) return res.status(500).json({ error });
  res.json(data);
});
```

---

## Frontend

### 1. Halaman Utama (`public/index.html`)
```html
<!DOCTYPE html>
<html>
<head>
  <title>CAT SKD CPNS - TIU</title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <h1>CAT SKD CPNS - TIU</h1>
  <p>Sistem ujian berbasis komputer untuk Tes Intelegensi Umum (TIU).</p>
  
  <div class="buttons">
    <button id="start-exam">Mulai Ujian</button>
    <button id="manage-questions">Kelola Bank Soal</button>
    <button id="scoreboard">Scoreboard</button>
  </div>
  
  <script src="/js/main.js"></script>
</body>
</html>
```

### 2. Halaman Ujian (`public/exam.html`)
```html
<div class="exam-container">
  <div class="exam-header">
    <h2 id="pack-name">Paket Soal: ...</h2>
    <div class="timer">Sisa Waktu: <span id="time-left">--:--</span></div>
  </div>
  
  <div class="question-container">
    <div id="question-content">Memuat soal...</div>
    <div class="options">
      <label><input type="radio" name="answer" value="A"> A. <span id="option-A"></span></label>
      <!-- Opsi B-E -->
    </div>
  </div>
  
  <div class="navigation">
    <button id="prev-question">Sebelumnya</button>
    <div class="question-numbers">
      <!-- Dinamis: 1 2 3 4 5 ... -->
    </div>
    <button id="next-question">Selanjutnya</button>
  </div>
  
  <button id="end-exam">Akhiri Ujian</button>
</div>
```

### 3. Logika Ujian (`public/js/exam.js`)
```javascript
// State ujian
let currentPack = null;
let currentQuestion = 0;
let timeLeft = 0;
let timer = null;
let answers = {}; // {1: 'A', 2: 'B', ...}

// Fungsi untuk memuat soal
async function loadQuestion(questionNumber) {
  const res = await fetch(`/api/packs/${currentPack.id}/questions`);
  const questions = await res.json();
  
  const question = questions[questionNumber - 1];
  document.getElementById('question-content').innerHTML = question.content;
  
  // Render opsi jawaban
  Object.entries(question.options).forEach(([key, value]) => {
    document.getElementById(`option-${key}`).textContent = value;
  });
  
  // Cek jawaban sebelumnya
  if (answers[questionNumber]) {
    document.querySelector(`input[name="answer"][value="${answers[questionNumber]}"]`).checked = true;
  }
}

// Timer hitung mundur
function startTimer() {
  timer = setInterval(() => {
    timeLeft--;
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('time-left').textContent =
      `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    
    if (timeLeft <= 0) {
      clearInterval(timer);
      endExam();
    }
  }, 1000);
}

// Akhiri ujian
async function endExam() {
  const res = await fetch('/api/exam/submit', {
    method: 'POST',
    body: JSON.stringify({
      pack_id: currentPack.id,
      participant_name: document.getElementById('participant-name').value,
      answers
    })
  });
  
  const result = await res.json();
  window.location.href = `/review.html?id=${result.id}`;
}
```

---

## Fitur Navigasi Ujian
1. **Memilih Paket Soal**: Card di halaman utama.
2. **Mulai Ujian**:
   - Input nama peserta → tombol "Mulai Ujian" → halaman ujian.
   - Timer mulai berjalan.
3. **Navigasi Soal**:
   - Tombol "Sebelumnya"/"Selanjutnya" atau klik nomor soal.
   - Jawaban otomatis tersimpan di `answers`.
4. **Akhiri Ujian**:
   - Tombol "Akhiri Ujian" → konfirmasi → hasil skor.
5. **Pembahasan Soal**:
   - Tombol "Pembahasan Soal" → halaman review.
   - Warna nomor soal:
     - Biru: Benar
     - Merah: Salah
     - Kuning: Tidak dijawab
   - Klik nomor soal → tampilkan pembahasan.

---

## Scoreboard
### Struktur Tabel:
| Nama Peserta | Skor | Status       |
|--------------|------|--------------|
| Andi         | 95   | Lulus PG     |
| Budi         | 70   | Tidak Lulus PG |

### Query SQL:
```sql
SELECT
  participant_name,
  score,
  status
FROM exam_results
WHERE pack_id = :pack_id
ORDER BY score DESC;
```

---

## Tugas untuk Developer
1. **Setup Proyek**:
   ```bash
   pnpm init
   pnpm add express @supabase/supabase-js @vercel/blob
   ```
2. **Konfigurasi Supabase**: Jalankan perintah SQL di atas.
3. **Konfigurasi Vercel Blob**: Buat token dan simpan di `.env.local`.
4. **Implementasi Backend**: Buat API endpoints di `src/server.js`.
5. **Implementasi Frontend**: Buat halaman HTML/JS di `public/`.
6. **Styling**: CSS di `public/css/styles.css`.
7. **Deploy**:
   - Deploy backend ke Vercel.
   - Deploy frontend (static files) ke Vercel.

---

## Catatan
- **Soal Matematika**: Gunakan library seperti [MathJax](https://www.mathjax.org/) untuk render persamaan.
- **Soal Figural**: Upload gambar ke Vercel Blob, tampilkan di `<img src="...">`.
- **Timer**: Gunakan `setInterval` untuk hitung mundur.
- **State Management**: Simpan jawaban di `localStorage` sebagai fallback jika tab tertutup.
