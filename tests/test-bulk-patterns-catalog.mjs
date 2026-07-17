// tests/test-bulk-patterns-catalog.mjs
// Catalogs every supported bulk-add pattern by feeding a representative
// sample through parseBlock + previewHtmlForCell and printing the result.
// Used as a reference for the "what patterns are supported" question.
// Run: node tests/test-bulk-patterns-catalog.mjs
import { parseBlock, previewHtmlForCell } from "../public/js/bulk-parser.js";

const RULE = "─".repeat(72);

function dump(name, rawBlock, qType = "TWK Pilar Negara") {
  const r = parseBlock(rawBlock, 0, qType);
  console.log(RULE);
  console.log(`# ${name}`);
  console.log(`   Tipe Soal : ${qType}\n`);
  console.log("┌── INPUT ─────────────────────────────────────────────────────");
  rawBlock.split("\n").forEach((l) => console.log(`│ ${l}`));
  console.log("└──────────────────────────────────────────────────────────────");
  if (!r || r.status !== "valid") {
    const errs = r?.errors ?? ["(empty block)"];
    console.log(`\n✗ INVALID : ${errs.join(" · ")}`);
    return;
  }
  console.log(`\n✓ VALID`);
  console.log(`  correct_answer  : ${r.correct_answer}`);
  if (r.option_scores) {
    console.log(`  option_scores   : ${JSON.stringify(r.option_scores)}  (TKP, Bobot: override applied)`);
  } else if (qType.startsWith("TKP")) {
    console.log(`  option_scores   : null  (TKP, admin assigns Bobot via single-question modal)`);
  }
  console.log(`  content (stored): ${r.content}`);
  console.log(`\n┌── PREVIEW (1-line table cell via previewHtmlForCell) ────────`);
  console.log(`│ ${previewHtmlForCell(r.content)}`);
  console.log("└──────────────────────────────────────────────────────────────");
}

// ─────────────────────────────────────────────────────────────────────────
// 1. OLD FORMAT — question directly on line 1, no premises.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "1. OLD FORMAT (no premises, plain text)",
  `Apa ibu kota negara Indonesia?
A. Surabaya
B. Bandung
C. Jakarta
D. Yogyakarta
E. Medan
C
Ibu kota Indonesia adalah Jakarta, yang terletak di pulau Jawa dan merupakan pusat pemerintahan sejak era kemerdekaan.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 2. NEW FORMAT — numbered premises 1) 2) 3) before question.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "2. NEW FORMAT (numbered premises 1) 2) 3) + question)",
  `1) Warga negara Indonesia wajib membayar pajak.
2) Pajak digunakan untuk membiayai pembangunan infrastruktur.
3) Partisipasi aktif masyarakat dalam pembangunan sangat dibutuhkan.
Mengapa kepatuhan membayar pajak penting bagi pembangunan nasional?
A. Agar masyarakat mendapat subsidi langsung dari pemerintah
B. Karena pajak menjadi sumber utama pembiayaan pembangunan
C. Supaya masyarakat memiliki penghasilan tambahan
D. Untuk menghindari sanksi dari pihak berwajib
E. Agar pemerintah daerah memiliki anggaran lebih besar
B
Pajak merupakan sumber pendapatan negara terbesar yang digunakan untuk membiayai berbagai proyek infrastruktur publik seperti jalan, jembatan, dan fasilitas umum lainnya.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 3. NEW FORMAT with LEAD-IN — sentence-ending intro before premises.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "3. NEW FORMAT + LEAD-IN (sentence-ending intro before premises)",
  `Perhatikan pernyataan-pernyataan berikut ini!
1) Semua mahasiswa yang lulus seleksi akan menerima beasiswa.
2) Beasiswa hanya diberikan kepada mahasiswa berprestasi.
3) Mahasiswa penerima beasiswa wajib mempertahankan IPK minimal 3,5.
Berdasarkan pernyataan di atas, kesimpulan yang paling tepat adalah?
A. Beasiswa diberikan kepada semua mahasiswa tanpa syarat
B. Hanya mahasiswa berprestasi yang dapat menerima beasiswa
C. Mahasiswa dengan IPK di bawah 3,5 tidak berhak atas beasiswa
D. Beasiswa dapat diberikan kepada siapa saja yang mendaftar
E. Semua mahasiswa akan otomatis menerima beasiswa
C
Pernyataan 1 menyebutkan bahwa hanya mahasiswa yang lulus seleksi yang menerima beasiswa; pernyataan 2 menjelaskan bahwa seleksi berdasarkan prestasi; pernyataan 3 menambah syarat mempertahankan IPK minimal 3,5. Gabungan ketiganya menunjukkan bahwa mahasiswa dengan IPK di bawah 3,5 tidak berhak mempertahankan beasiswa.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 4. BARE-PREMISE FORMAT (explicit question, Indonesian silogisme).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "4. BARE-PREMISE NEW FORMAT (no numeric markers, explicit question)",
  `Semua kucing adalah mamalia.
Semua mamalia bernapas dengan paru-paru.
Tidak semua mamalia hidup di air.
Kesimpulan yang tepat adalah?
A. Semua kucing hidup di air
B. Semua kucing bernapas dengan paru-paru
C. Semua mamalia hidup di air
D. Kucing bukan mamalia
E. Semua mamalia bernapas dengan insang
B
Premis 1: kucing → mamalia; premis 2: mamalia → bernapas dengan paru-paru. Disusun transitif menghasilkan kucing bernapas dengan paru-paru, sehingga pilihan B paling tepat.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 5. BARE-PREMISE FORMAT (implicit question — TIU silogisme style).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "5. BARE-PREMISE NEW FORMAT (no numeric markers, implicit question)",
  `Jika hujan turun, jalan menjadi basah.
Jalan tidak basah hari ini.
A. Hujan tidak turun hari ini
B. Hujan turun hari ini
C. Jalan selalu basah setiap hari
D. Jalan tidak pernah kering
E. Hujan hanya turun di malam hari
A
Dari premis 1, jalan basah ⇒ hujan. Premis 2: jalan tidak basah. Dengan modus tollens, disimpulkan hujan tidak turun hari ini.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 6. BARE-PREMISE FORMAT (single-line joined sentences).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "6. BARE-PREMISE (multiple sentences joined on one line, auto-split)",
  `Semua warga negara berhak atas pendidikan. Pendidikan adalah tanggung jawab negara. Negara menyediakan fasilitas pendidikan gratis.
Kesimpulan yang tepat adalah?
A. Pendidikan bukan tanggung jawab negara
B. Warga negara berhak mendapatkan pendidikan gratis
C. Hanya sebagian warga negara yang mendapat pendidikan
D. Pendidikan disediakan oleh pihak swasta
E. Negara tidak menyediakan pendidikan gratis
B
Premis-premis yang digabung pada satu baris dipisah otomatis oleh parser berdasarkan delimiter '. ' sebelum uppercase.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 7. TKP + Bobot: default cyclic (A=5 B=4 C=3 D=2 E=1).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "7. TKP + Bobot (default cyclic, A=5 B=4 C=3 D=2 E=1)",
  `1) Sikap gotong royong harus ditumbuhkan sejak dini.
2) Anak yang terbiasa berbagi dengan teman sebayanya akan tumbuh menjadi pribadi yang mudah bekerja sama.
3) Berbeda dengan anak yang lebih suka menyendiri dan jarang berinteraksi dengan lingkungan sosial.
Manakah pernyataan yang paling tepat menggambarkan pentingnya gotong royong?
A. Anak yang terbiasa berbagi akan tumbuh menjadi pribadi yang mudah bekerja sama.
B. Anak yang lebih suka menyendiri akan tumbuh menjadi individu yang mandiri.
C. Gotong royong tidak diajarkan di sekolah formal melainkan di lingkungan keluarga.
D. Gotong royong hanya relevan di lingkungan desa, bukan di perkotaan.
E. Gotong royong harus ditanamkan sejak usia dewasa agar berjalan efektif.
A
Bobot: A=5, B=4, C=3, D=2, E=1
Jawaban A paling mencerminkan pentingnya gotong royong karena menggambarkan hasil positif dari kebiasaan berbagi sejak dini.`,
  "TKP Pelayanan Publik",
);

// ─────────────────────────────────────────────────────────────────────────
// 8. TKP + Bobot: non-cyclic (A=2, B=1, C=5, D=3, E=4) — Bobot overrides Kunci.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "8. TKP + Bobot (NON-CYCLIC A=2 B=1 C=5 D=3 E=4, Bobot overrides Kunci ke C)",
  `1) Pelayanan publik yang berkualitas harus memenuhi kebutuhan masyarakat.
2) Pemerintah daerah memiliki peran penting dalam pelayanan publik.
3) Partisipasi masyarakat diperlukan untuk meningkatkan kualitas pelayanan.
4) Transparansi informasi merupakan bagian dari pelayanan publik.
Pernyataan manakah yang paling tepat terkait pelayanan publik?
A. Pelayanan publik hanya menjadi tanggung jawab pemerintah pusat.
B. Masyarakat tidak memiliki peran dalam pelayanan publik.
C. Pelayanan publik yang berkualitas membutuhkan kolaborasi pemerintah dan masyarakat.
D. Transparansi tidak penting dalam pelayanan publik.
E. Pelayanan publik hanya berlaku di kota besar.
C
Bobot: A=2, B=1, C=5, D=3, E=4
Pilihan C mendapat bobot tertinggi (5) sesuai dengan peran aktif masyarakat dalam pelayanan publik.`,
  "TKP Pelayanan Publik",
);

// ─────────────────────────────────────────────────────────────────────────
// 9. TKP WITHOUT Bobot: — INVALID (per tkp-scoring-spec.md §9.1 + §10
// V1-strict applied to bulk endpoint; bobot TKP wajib diisi).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "9. TKP WITHOUT Bobot: (INVALID — bobot TKP wajib diisi per §9.1)",
  `1) Integritas merupakan salah satu nilai dasar ASN.
2) ASN yang berintegritas akan bekerja dengan jujur dan transparan.
3) Pelanggaran integritas dapat merugikan masyarakat luas.
Mengapa integritas penting bagi seorang ASN?
A. Agar mendapat promosi jabatan lebih cepat
B. Supaya mendapat gaji yang lebih tinggi
C. Untuk menjaga kepercayaan masyarakat terhadap pemerintah
D. Agar tidak dimutasikan ke daerah terpencil
E. Supaya mendapat penghargaan dari atasan
C
Integritas ASN penting karena menjaga kepercayaan publik terhadap institusi pemerintah.`,
  "TKP Pelayanan Publik",
);

// ─────────────────────────────────────────────────────────────────────────
// 10. MULTIPLE BLOCKS — separated by '---'.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "10. MULTIPLE BLOCKS (parsed together, separated by '---')",
  `Apa lambang sila pertama Pancasila?
A. Banteng
B. Garuda
C. Bintang
D. Padi dan kapas
E. Rantai
C
Sila pertama Pancasila dilambangkan oleh bintang emas dengan latar belakang hitam.

---

Berapa jumlah sila dalam Pancasila?
A. Tiga
B. Empat
C. Lima
D. Enam
E. Tujuh
C
Pancasila terdiri dari lima sila yang merupakan dasar negara Indonesia.

---

Sebutkan warna bendera Indonesia!
A. Merah putih
B. Merah hitam
C. Putih merah
D. Biru putih
E. Hijau kuning
A
Bendera Indonesia terdiri dari dua warna, merah di bagian atas dan putih di bagian bawah.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 11. INVALID examples — common mistakes.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "11a. INVALID: only 4 options (min 8 lines required for old format)",
  `Apa ibu kota provinsi Jawa Barat?
A. Bandung
B. Cirebon
C. Bekasi
D. Bogor
B
Ibu kota Jawa Barat adalah Bandung.`,
);

dump(
  "11b. INVALID: kunci letter out of range",
  `Siapa presiden pertama Indonesia?
A. Soekarno
B. Soeharto
C. Habibie
D. Wahid
E. Megawati
Z
Soekarno adalah presiden pertama Indonesia yang memproklamasikan kemerdekaan pada 17 Agustus 1945.`,
);

dump(
  "11c. INVALID: numbered premise skips from 1 to 3 (sequential numbering required)",
  `1) Premis pertama.
3) Premis ketiga — nomor 2 hilang.
Pertanyaan di sini?
A. Opsi A
B. Opsi B
C. Opsi C
D. Opsi D
E. Opsi E
A
Pembahasan singkat.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 12. TWK 1-line reading-passage — per spec §9.1.
//
// Indonesian TWK CAT items commonly pack the entire bacaan (reading passage)
// onto a single, possibly long line where multiple sentences are joined by
// ". " (admin authors copy-paste paragraphs directly from a doc without
// inserting newlines between sentences). The parser handles this case via
// `expandToSentencesBefore` → `splitSentences`, which auto-splits the
// joined sentences into N premises. The block stays VALID and the stored
// `<ol><li>…</li></ol><p>question</p>` preserves each sentence as its
// own `<li>` for the exam/review renderer.
//
// Without this auto-split, a realistic TWK passage (long single line with
// several sentences) could be misinterpreted; with it, the parser treats
// the line as N logical premises and emits the same `<ol>…<p>` shape as a
// multi-line passage. Case #6 demonstrates the same splitting mechanic in
// the abstract; this case anchors it to TWK with a realistic bacaan-style
// input that any TWK admin would actually paste.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "12. VALID: bare-premise TWK reading-passage — 1 long passage line + explicit question (auto-splits into 3 premises)",
  `Pancasila merupakan dasar negara Indonesia yang mengandung lima sila sebagai pedoman hidup berbangsa dan bernegara. Kelima sila tersebut mencerminkan nilai-nilai luhur yang telah disepakati para pendiri bangsa. Sebagai warga negara, kita wajib memahami dan mengamalkan nilai-nilai Pancasila dalam kehidupan sehari-hari.
Berdasarkan bacaan di atas, manakah pernyataan yang paling tepat?
A. Pancasila hanya berfungsi sebagai simbol negara tanpa implementasi nyata.
B. Nilai-nilai Pancasila harus dipahami dan diamalkan oleh seluruh warga negara.
C. Pancasila tidak relevan dengan tantangan kehidupan modern saat ini.
D. Pancasila bersifat opsional dan dapat diabaikan sebagian.
E. Pancasila hanya berlaku di lingkungan pendidikan formal.
B
Bunyi Pembukaan UUD 1945 menegaskan bahwa Pancasila adalah dasar negara; nilai-nilainya harus dipahami dan diamalkan oleh seluruh lapisan masyarakat, bukan sekadar dihafal atau dijadikan slogan.`,
);
// ─────────────────────────────────────────────────────────────────────────
// 13. VALID — 1-line multi-sentence question paragraph + A-E → OLD format.
//     User-reported bug fix (see tests/test-bulk-parser.mjs §8.31).
//
// The previous post-expansion gate (`newOptIdx >= 2`) mis-classified this
// as bare-premise because the 1-line paragraph auto-splits into 3 sentences
// via splitSentences. The pre-expansion gate (`explicitOptIdx >= 2`) now
// correctly skips bare-premise when only 1 original line precedes option A.
//
// Compare to cases #6 / #12 — those have a SEPARATE explicit question
// line, so explicitOptIdx = 2 and bare-premise triggers (auto-splits the
// 1-line passage into N premises). Case #13 has NO separate question
// line, so explicitOptIdx = 1 and the whole paragraph becomes content.
// ─────────────────────────────────────────────────────────────────────────
dump(
  "13. VALID: 1-line multi-sentence question paragraph + A-E → OLD format (verbatim content, not auto-split)",
  `Contoh soal yang hanya satu baris. Tapi soal ini terdiri dari beberapa kalimat. Namun soal ini bukanlah soal yang harus ditampilkan sebagai soal berpremis dengan nomor!
A. A
B. B
C. C
D. D
E. E
D
Pembahasan singkat untuk soal ini: ini adalah soal single-line multi-sentence yang seharusnya ditampilkan sebagai old format, bukan sebagai soal berpremis dengan nomor.`,
);

// ─────────────────────────────────────────────────────────────────────────
// 14. VALID — 1 premise (single-sentence) + 1 multi-sentence question
//     paragraph + A-E → bare-premise with VERBATIM question.
//
// User-reported bug fix complement to case #13 (the previous user bug).
// When the candidate question source line ENDS WITH ?/!/… the admin
// intended it as a complete question paragraph — parseBarePremiseNewFormatBlock
// uses it VERBATIM (no internal split). The preceding single-sentence
// premise line is preserved as-is.
//
// Compare:
//   - Case #6 / #12 (multi-sentence premise + separate question line ending
//     with ?/!/…) → still bare-premise auto-split, but premise line is
//     multi-sentence so it splits N ways → N premises + question verbatim.
//   - Case #14 (single-sentence premise + multi-sentence question ending
//     with !) → still bare-premise, premise is 1 sentence so no split →
//     1 premise + verbatim question (matches user's expected output).
//   - §8.30 (premise + preamble+question on same line ending with "adalah")
//     → bare-premise INTERNAL-split (last chunk = question).
// ─────────────────────────────────────────────────────────────────────────
dump(
  "14. VALID: 1 single-sentence premise + 1 multi-sentence question paragraph + A-E → 1 premise + verbatim question (user's new bug)",
  `Ini adalah contoh soal yang hanya ada satu premis.
Tapi baris kedua dari soal ini adalah sebuah teks panjang yang terdiri dari beberapa kalimat. Ini adalah kalimat kedua di baris kedua soal. Dan ini adalah kalimat ketiga di baris kedua soal. Sehingga seharusnya soal ini hanya ditampilkan 1 baris premis, lalu newline dan 1 baris teks biasa (bukan premis)!
A. A
B. B
C. C
D. D
E. E
D
Pembahasan soal: soal ini adalah contoh soal dengan satu premis di baris pertama dan question paragraph multi-kalimat di baris kedua, sehingga disimpan sebagai 1 premise + 1 verbatim question.`,
);
