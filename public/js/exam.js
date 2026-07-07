/* Exam Timer Persistence — see specs/exam-timer-persistence-spec.md
   AC1: started_at ditulis sekali di init() saat TIMER_KEY belum ada
   AC2: silent auto-resume (tanpa konfirmasi dialog)
   AC3: auto-submit pada init() jika timeLeft <= 0 (laptop sleep semalam)
   AC4: TIMER_KEY + ANSWERS_KEY di-remove saat submitExam() berhasil
   AC5: storage event listener untuk multi-tab sync
   AC6: wall-clock (timeLeft = duration − elapsed), bukan tick-count
   AC7/AC8: tidak ada perubahan server; tanpa sid di URL tetap tidak crash
*/
const params = new URLSearchParams(location.search);
const packId = params.get("packId");
const participantName = decodeURIComponent(params.get("name") || "");
const sid = params.get("sid") || generateSid();

if (!packId || !participantName) location.href = "/select-pack.html";

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

async function init() {
  let pack;
  try {
    const [packRes, qRes] = await Promise.all([
      fetch(`/api/packs/${packId}`),
      fetch(`/api/packs/${packId}/questions`),
    ]);
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
  let html = q.content;
  if (q.image_url)
    html += `<img src="${q.image_url}" style="max-width:100%;margin-top:12px;border-radius:8px">`;
  qContentEl.innerHTML = html;
  const sel = answers[q.id] || "";
  optionsEl.innerHTML = Object.entries(q.options)
    .map(
      ([k, v]) => `
    <label class="option-item${sel === k ? " selected" : ""}">
      <input type="radio" name="ans" value="${k}" ${sel === k ? "checked" : ""}>
      <span class="option-label"><strong>${k}.</strong> ${v}</span>
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
    // AC4: bersihkan semua key yang terkait sesi ini
    safeStorage.removeItem(TIMER_KEY);
    safeStorage.removeItem(ANSWERS_KEY);
    safeStorage.removeItem(LEGACY_ANSWERS_KEY);
    location.href = `/review.html?id=${result.id}`;
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
endBtn.onclick = () => {
  if (confirm("Apakah Anda yakin ingin mengakhiri ujian?")) submitExam();
};
init();
