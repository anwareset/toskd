const params = new URLSearchParams(location.search);
const packId = params.get("packId");
const participantName = decodeURIComponent(params.get("name") || "");
if (!packId || !participantName) location.href = "/select-pack.html";

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
  try {
    const [packRes, qRes] = await Promise.all([
      fetch(`/api/packs/${packId}`),
      fetch(`/api/packs/${packId}/questions`),
    ]);
    const pack = await packRes.json();
    questions = await qRes.json();
    if (!questions.length) {
      qContentEl.textContent = "Paket ini belum memiliki soal.";
      return;
    }
    packNameEl.textContent = pack.name;
    timeLeft = pack.duration_minutes * 60;
    const saved = localStorage.getItem(`exam_${packId}_answers`);
    if (saved)
      try {
        answers = JSON.parse(saved);
      } catch (e) {}
    buildGrid();
    renderQuestion(0);
    startTimer();
  } catch (e) {
    packNameEl.textContent = "Gagal memuat ujian";
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
        localStorage.setItem(`exam_${packId}_answers`, JSON.stringify(answers));
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
    localStorage.removeItem(`exam_${packId}_answers`);
    location.href = `/review.html?id=${result.id}`;
  } catch (e) {
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
