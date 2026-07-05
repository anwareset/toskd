const resultId = new URLSearchParams(location.search).get("id");
if (!resultId) location.href = "/";

let result = null,
  questions = [],
  currentIndex = 0;
const loadingEl = document.getElementById("loading");
const infoEl = document.getElementById("result-info");
const bodyEl = document.getElementById("review-body");
const qNoEl = document.getElementById("question-no");
const contentEl = document.getElementById("question-content");
const optionsEl = document.getElementById("options-container");
const explanationEl = document.getElementById("explanation");
const counterEl = document.getElementById("q-counter");
const gridEl = document.getElementById("answer-grid");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  try {
    const r = await fetch(`/api/exam/${resultId}/results`);
    result = await r.json();
    const q = await fetch(`/api/packs/${result.pack_id}/questions`);
    questions = await q.json();
    loadingEl.style.display = "none";
    infoEl.style.display = "flex";
    bodyEl.style.display = "flex";
    const sc = result.status === "Lulus PG" ? "status-pass" : "status-fail";
    infoEl.innerHTML = `
      <div class="stat"><span class="value">${esc(result.participant_name)}</span><span class="label">Nama Peserta</span></div>
      <div class="stat"><span class="value">${esc(result.question_packs?.name || "-")}</span><span class="label">Paket Soal</span></div>
      <div class="stat"><span class="value">${result.score} / ${questions.length * 5}</span><span class="label">Skor</span></div>
      <div class="stat"><span class="value ${sc}">${result.status}</span><span class="label">Status</span></div>`;
    buildGrid();
    renderQuestion(0);
  } catch (e) {
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat hasil.</p>';
  }
}

function buildGrid() {
  gridEl.innerHTML = questions
    .map((q, i) => {
      const a = result.answers[q.id];
      let c = "not-answered";
      if (a === q.correct_answer) c = "correct";
      else if (a) c = "incorrect";
      return `<button class="${c}" data-i="${i}">${i + 1}</button>`;
    })
    .join("");
  gridEl.onclick = (e) => {
    if (e.target.dataset.i !== undefined) renderQuestion(+e.target.dataset.i);
  };
}

function renderQuestion(idx) {
  currentIndex = idx;
  const q = questions[idx];
  const a = result.answers[q.id];
  qNoEl.textContent = `Soal ${idx + 1}`;
  let html = q.content;
  if (q.image_url)
    html += `<img src="${q.image_url}" style="max-width:100%;margin-top:12px;border-radius:8px">`;
  contentEl.innerHTML = html;
  optionsEl.innerHTML = Object.entries(q.options)
    .map(([k, v]) => {
      let cls = "option-item";
      if (k === q.correct_answer) cls += " correct-answer";
      else if (k === a && a !== q.correct_answer) cls += " wrong-answer";
      return `<div class="${cls}"><input type="radio" disabled ${k === a ? "checked" : ""}><span class="option-label"><strong>${k}.</strong> ${v}</span></div>`;
    })
    .join("");
  explanationEl.style.display = "block";
  explanationEl.innerHTML = `<strong>Pembahasan:</strong><br>${q.explanation}`;
  counterEl.textContent = `${idx + 1} / ${questions.length}`;
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === questions.length - 1;
  gridEl
    .querySelectorAll("button")
    .forEach((b, i) => b.classList.toggle("active", i === idx));
  if (window.MathJax?.typesetPromise)
    MathJax.typesetPromise([contentEl, optionsEl, explanationEl]).catch(
      () => {},
    );
}

prevBtn.onclick = () => {
  if (currentIndex > 0) renderQuestion(currentIndex - 1);
};
nextBtn.onclick = () => {
  if (currentIndex < questions.length - 1) renderQuestion(currentIndex + 1);
};
init();
