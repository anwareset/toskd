/* Exam Timer Persistence — see specs/exam-timer-persistence-spec.md
   AC1: started_at ditulis sekali di init() saat TIMER_KEY belum ada
   AC2: silent auto-resume (tanpa konfirmasi dialog)
   AC3: auto-submit pada init() jika timeLeft <= 0 (laptop sleep semalam)
   AC4: TIMER_KEY + ANSWERS_KEY di-remove saat submitExam() berhasil
   AC5: storage event listener untuk multi-tab sync
   AC6: wall-clock (timeLeft = duration − elapsed), bukan tick-count
   AC7/AC8: tidak ada perubahan server; tanpa sid di URL tetap tidak crash
*/
// Round-17 (2026-08-09): renderInlineMd — thin local wrapper over the
// shared helper in public/js/markdown-image.js (single source of truth;
// the regex + render logic previously lived here AND in review.js /
// kelola-soal.js with slight drift). Input is already-pre-escaped HTML
// (Quill innerHTML / DB rows), so the shared HTML-input variant is used
// (no local esc — that would double-escape entities like `&amp;`).
// Loaded before exam.js via <script type="module"> in exam.html, so
// window.MarkdownImage is set when this runs. Used in renderQuestion()
// below at 2 sites: q.content + per-option label.
function renderInlineMd(html) {
  return window.MarkdownImage?.renderInlineMd(html) ?? html;
}

const params = new URLSearchParams(location.search);
const packId = params.get("packId");
const participantName = decodeURIComponent(params.get("name") || "");
const sid = params.get("sid") || generateSid();

// Defense (2026-08-19): nama wajib valid — mirror rules modal select-pack
// (alfabet + spasi, tanpa spasi di awal). URL yang di-tamper manual → kembali
// ke select-pack; mencegah terjebak di submit yang pasti 400 dari server.
function isValidParticipantName(raw) {
  if (typeof raw !== "string") return false;
  const name = raw.trim();
  if (!name) return false;
  if (raw !== raw.trimStart()) return false;
  if (name.length > 100) return false;
  return /^[A-Za-z][A-Za-z ]*$/.test(name);
}

if (!packId || !isValidParticipantName(participantName)) {
  location.href = "/select-pack.html";
}

function generateSid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32)
  );
}

// Try/catch wrapper around localStorage untuk graceful fallback kalau browser
// dalam mode private (Safari) atau storage di-disable (R7)
const safeStorage = (() => {
  try {
    const probe = "__exam_probe_" + Date.now().toString(36);
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    };
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
})();

const TIMER_KEY = `exam_${sid}_startedAt`;
const ANSWERS_KEY = `exam_${sid}_answers`;
// Legacy key dari versi sebelum spec ini (exam_<packId>_answers). Tetap di-baca
// supaya peserta dengan sesi lama tidak kehilangan jawaban yang sudah diisi.
const LEGACY_ANSWERS_KEY = `exam_${packId}_answers`;

let questions = [],
  currentIndex = 0,
  answers = {},
  timeLeft = 0,
  timerInterval = null;

const packNameEl = document.getElementById("pack-name");
const timerEl = document.getElementById("timer");
const qNoEl = document.getElementById("question-no");
const qContentEl = document.getElementById("question-content");
const optionsEl = document.getElementById("options-container");
const counterEl = document.getElementById("q-counter");
const gridEl = document.getElementById("answer-grid");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const endBtn = document.getElementById("end-exam-btn");

// Try/catch wrapper around sessionStorage (defense-in-depth untuk private
// browsing mode atau storage yang di-disable — mirip safeStorage untuk
// localStorage). Return null pada getItem jika storage tidak tersedia.
const safeSession = (() => {
  try {
    const probe = "__exam_sess_" + Date.now().toString(36);
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return {
      getItem: (k) => sessionStorage.getItem(k),
      setItem: (k, v) => sessionStorage.setItem(k, v),
    };
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
})();

// Tampilkan overlay ramah saat partisipan mencoba kembali ke halaman ujian
// setelah sudah menyelesaikannya (Back-button detection via sessionStorage).
function showAlreadyDoneOverlay() {
  const resultId = safeSession.getItem(`exam_done_result_${sid}`);
  const reviewBtnHtml = resultId
    ? `<button class="btn-secondary" id="exam-done-review-btn" style="width:100%;margin-bottom:8px">📋 Lihat Hasil Ujian</button>`
    : "";

  const overlay = document.createElement("div");
  overlay.id = "exam-done-overlay";
  overlay.innerHTML = `
    <div class="exam-done-card">
      <div class="exam-done-icon">✅</div>
      <h2>Ujian Telah Selesai</h2>
      <p>Kamu sudah menyelesaikan ujian ini sebelumnya.</p>
      ${reviewBtnHtml}
      <button class="btn-primary" id="exam-done-home-btn">🏠 Kembali ke Beranda</button>
      <p class="exam-done-timer">Kamu akan diarahkan otomatis dalam <span id="exam-done-countdown">5</span> detik…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Tombol "Lihat Hasil Ujian" (hanya muncul jika resultId tersedia).
  const reviewBtn = document.getElementById("exam-done-review-btn");
  if (reviewBtn) {
    reviewBtn.onclick = () => {
      clearInterval(interval);
      location.href = `/review.html?id=${resultId}`;
    };
  }

  // Tombol manual "Kembali ke Beranda".
  document.getElementById("exam-done-home-btn").onclick = () => {
    clearInterval(interval);
    location.href = "/";
  };

  // Auto-redirect countdown (5 detik).
  let sec = 5;
  const countdownEl = document.getElementById("exam-done-countdown");
  const interval = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(interval);
      location.href = "/";
    } else {
      countdownEl.textContent = sec;
    }
  }, 1000);
}

async function init() {
  // Client-side defense: jika sesi ini sudah pernah submit (flag dari
  // submitExam), redirect langsung ke home — mencegah Back-button
  // menciptakan sesi ujian baru. sessionStorage bertahan di dalam tab
  // yang sama (termasuk navigasi Back/Forward).
  if (safeSession.getItem(`exam_done_${sid}`)) {
    showAlreadyDoneOverlay();
    return;
  }

  let pack;
  try {
    const [packRes, qRes] = await Promise.all([
      fetch(`/api/packs/${packId}`),
      fetch(`/api/packs/${packId}/questions`),
    ]);
    // Paket yang diblokir visibility (admin-only utk non-admin / archived)
    // → server 403 { error: "Forbidden" } (pack-visibility-spec.md §4.2).
    // Tampilkan pesan jelas, jangan lanjut render ujian.
    if (packRes.status === 403 || qRes.status === 403) {
      qContentEl.textContent =
        "Paket ini tidak tersedia untuk dikerjakan.";
      packNameEl.textContent = "Paket tidak tersedia";
      return;
    }
    pack = await packRes.json();
    questions = await qRes.json();
  } catch {
    packNameEl.textContent = "Gagal memuat ujian";
    return;
  }
  if (!questions.length) {
    qContentEl.textContent = "Paket ini belum memiliki soal.";
    return;
  }
  packNameEl.textContent = pack.name;

  const duration = pack.duration_minutes * 60;
  const savedStartedAt = safeStorage.getItem(TIMER_KEY);
  if (savedStartedAt) {
    // AC6 wall-clock: timeLeft = duration − (Date.now() − startedAt)/1000
    const elapsed = Math.floor((Date.now() - +savedStartedAt) / 1000);
    timeLeft = Math.max(0, duration - elapsed);
  } else {
    timeLeft = duration;
    // AC1: tulis sekali di init() saat key belum ada (idempotent)
    safeStorage.setItem(TIMER_KEY, Date.now().toString());
  }

  loadAnswers();

  // AC3: auto-submit kalau timer sudah habis saat halaman dimuat (mis. laptop tidur)
  if (timeLeft <= 0) {
    await submitExam();
    return;
  }

  buildGrid();
  renderQuestion(0);
  startTimer();

  // AC5: multi-tab sync via storage event
  window.addEventListener("storage", (e) => {
    if (e.key === TIMER_KEY && e.newValue) {
      const elapsed = Math.floor((Date.now() - +e.newValue) / 1000);
      timeLeft = Math.max(0, duration - elapsed);
      updateTimerDisplay();
    }
  });
}

function loadAnswers() {
  // Try new key first (per-sid), fallback ke legacy per-pack kalau ada
  const saved =
    safeStorage.getItem(ANSWERS_KEY) ??
    safeStorage.getItem(LEGACY_ANSWERS_KEY);
  if (saved) {
    try {
      answers = JSON.parse(saved);
      // Migrasi satu arah: tulis ke key baru supaya submit berikutnya hanya
      // menghapus key baru + legacy idempotent di clear.
      if (!safeStorage.getItem(ANSWERS_KEY)) {
        safeStorage.setItem(ANSWERS_KEY, saved);
      }
    } catch {}
  }
}

function buildGrid() {
  gridEl.innerHTML = questions
    .map(
      (q, i) =>
        `<button class="${answers[q.id] ? "answered" : "unanswered"}" data-i="${i}">${i + 1}</button>`,
    )
    .join("");
  gridEl.onclick = (e) => {
    if (e.target.dataset.i !== undefined) renderQuestion(+e.target.dataset.i);
  };
}

function updateGrid() {
  gridEl.querySelectorAll("button").forEach((b, i) => {
    b.className = answers[questions[i].id] ? "answered" : "unanswered";
    if (i === currentIndex) b.classList.add("active");
  });
}

function renderQuestion(idx) {
  currentIndex = idx;
  const q = questions[idx];
  qNoEl.textContent = `Soal ${idx + 1}`;
  let html = renderInlineMd(q.content);
  if (q.image_url)
    html += `<img src="${q.image_url}" referrerpolicy="no-referrer" style="max-width:100%;margin-top:12px;border-radius:8px">`;
  qContentEl.innerHTML = html;
  const sel = answers[q.id] || "";
  optionsEl.innerHTML = Object.entries(q.options)
    .map(
      ([k, v]) => `
    <label class="option-item${sel === k ? " selected" : ""}">
      <input type="radio" name="ans" value="${k}" ${sel === k ? "checked" : ""}>
      <span class="option-label"><strong>${k}.</strong> ${renderInlineMd(v)}</span>
    </label>`,
    )
    .join("");
  optionsEl.querySelectorAll("input").forEach(
    (r) =>
      (r.onchange = () => {
        answers[q.id] = r.value;
        safeStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
        optionsEl
          .querySelectorAll(".option-item")
          .forEach((el) => el.classList.remove("selected"));
        r.closest(".option-item").classList.add("selected");
        updateGrid();
      }),
  );
  counterEl.textContent = `${idx + 1} / ${questions.length}`;
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === questions.length - 1;
  updateGrid();
  if (window.MathJax?.typesetPromise)
    MathJax.typesetPromise([qContentEl, optionsEl]).catch(() => {});
}

function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      submitExam();
    }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60),
    s = timeLeft % 60;
  timerEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function submitExam() {
  clearInterval(timerInterval);
  endBtn.disabled = true;
  try {
    const res = await fetch("/api/exam/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pack_id: +packId,
        participant_name: participantName,
        answers,
      }),
    });
    const result = await res.json();

    // Defense (2026-08-19): nama tidak valid → 400 dari server (modal sudah
    // mencegah, ini hanya untuk sesi legacy/URL tamper). Balik ke select-pack.
    if (res.status === 400) {
      alert(result.error || "Nama peserta tidak valid. Silakan mulai ulang.");
      location.href = "/select-pack.html";
      return;
    }

    // Bersihkan localStorage + set sessionStorage flag (berlaku untuk
    // kedua path: 409 duplicate maupun success). Hanya redirectId
    // yang berbeda: existing_id dari 409, atau id dari response sukses.
    safeStorage.removeItem(TIMER_KEY);
    safeStorage.removeItem(ANSWERS_KEY);
    safeStorage.removeItem(LEGACY_ANSWERS_KEY);
    safeSession.setItem(`exam_done_${sid}`, "1");

    // Server-side duplicate guard: redirect ke review halaman yang sudah ada.
    const redirectId =
      res.status === 409 ? result.existing_id : result.id;
    // Simpan resultId agar overlay "Ujian Telah Selesai" bisa
    // menampilkan tombol "Lihat Hasil Ujian".
    safeSession.setItem(`exam_done_result_${sid}`, String(redirectId));
    location.href = `/review.html?id=${redirectId}`;
  } catch {
    alert("Gagal mengirim jawaban. Coba lagi.");
    endBtn.disabled = false;
  }
}

prevBtn.onclick = () => {
  if (currentIndex > 0) renderQuestion(currentIndex - 1);
};
nextBtn.onclick = () => {
  if (currentIndex < questions.length - 1) renderQuestion(currentIndex + 1);
};
const endExamModal = document.getElementById("end-exam-modal");
const endExamCancelBtn = document.getElementById("end-exam-cancel-btn");
const endExamConfirmBtn = document.getElementById("end-exam-confirm-btn");

endBtn.onclick = () => {
  endExamModal.showModal();
};

endExamCancelBtn.onclick = () => {
  endExamModal.close();
};

endExamConfirmBtn.onclick = () => {
  endExamModal.close();
  submitExam();
};
init();
