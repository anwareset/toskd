// public/js/review.js
// ============================================================================
// Per-question rendering + answer grid for /review.html.
// TKP weighted-scoring integration per tkp-scoring-spec.md §13.1 + §13.2 +
// §7.1 (partial grid class) + §7.2 (stats panel subtest breakdown).
//
// The renderQuestion function has two code paths now:
//   * isTkp(q) = true  → per-weight class on each option card, inline
//                         [N pts] badge, thick border on participant's pick.
//   * isTkp(q) = false → unchanged binary flow (green/red highlights).
// ============================================================================

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

// unwrapParagraph — strip the outer <p>...</p> wrapper that Quill
// adds by default to every block of content (sofas, options, dll).
// Tanpa strip, opsi seperti "<p>\(x^2\)</p>" tampil di review.html
// sebagai "<p>\(x^2\)</p>" (literal text) karena esc() mengubah
// <p> menjadi &lt;p&gt;. Padahal MathJax di belakang layar sudah
// render LaTeX-nya — hasilnya math formula muncul tapi dikelilingi
// teks "<p>" dan "</p>" yang visually noisy.
//
// Pendekatan: regex sederhana yang匹配 single <p>...</p> wrapper
// di awal-akhir string. Multi-paragraph options (rare) tidak
// di-strip — fallback ke original content. Aman karena output
// masih di-escape() sebelum di-innerHTML-kan (no XSS risk).
function unwrapParagraph(html) {
  if (typeof html !== "string") return html;
  const trimmed = html.trim();
  const m = trimmed.match(/^<p>([\s\S]*)<\/p>$/i);
  return m ? m[1] : trimmed;
}

// TKP detection per spec §4: question_type starts with "TKP" (case-insensitive).
function isTkp(q) {
  return (
    !!q &&
    typeof q.question_type === "string" &&
    q.question_type.trim().toUpperCase().startsWith("TKP")
  );
}

function questionPoints(q) {
  const a = (result.answers || {})[q.id];
  if (!a) return 0;
  if (isTkp(q)) {
    const w = Number(((q.option_scores || {})[a]) || 0);
    return Number.isFinite(w) ? w : 0;
  }
  return a === q.correct_answer ? 5 : 0;
}

// Per-subtest breakdown (spec §6.2 / §7.2): counts denotes the per-subtest
// MAX (which is 5 × N_subtest); earned is the participant's per-subtest sum.
function computeBreakdowns() {
  const counts = { TWK: 0, TIU: 0, TKP: 0 };
  const earned = { TWK: 0, TIU: 0, TKP: 0 };
  for (const q of questions) {
    const a = (result.answers || {})[q.id];
    const t = (q.question_type || "").trim().toUpperCase();
    if (isTkp(q)) {
      counts.TKP += 5;
      earned.TKP += questionPoints(q);
      continue;
    }
    let bucket = null;
    if (t.startsWith("TWK")) bucket = "TWK";
    else bucket = "TIU"; // catch-all for binary (TIU + future free-text)
    if (bucket) {
      counts[bucket] += 5;
      earned[bucket] += a === q.correct_answer ? 5 : 0;
    }
  }
  return { counts, earned };
}

async function init() {
  try {
    const r = await fetch(`/api/exam/${resultId}/results`);
    result = await r.json();
    const q = await fetch(`/api/packs/${result.pack_id}/questions`);
    questions = (await q.json()) || [];
    loadingEl.style.display = "none";
    infoEl.style.display = "flex";
    bodyEl.style.display = "flex";
    const sc = result.status === "Lulus PG" ? "status-pass" : "status-fail";

    const bd = computeBreakdowns();

    // Subtest breakdown harus HANYA menampilkan subtes yang termasuk
    // dalam paket ini (per paket-soal-pack-type-spec.md §2). Paket
    // Single-TWK hanya menampilkan TWK; Combo TWK+TIU menampilkan
    // keduanya; Combo 3-subtes menampilkan ketiganya. Legacy packs
    // (pre-migration-003, tidak ada field subtests) default ke
    // semua 3 subtes via schema DEFAULT ARRAY['TWK','TIU','TKP'].
    // Order dari pack.subtests[] dihormati (mengikuti urutan pilihan
    // admin di paket-soal.html), bukan diurut ulang ke TWK/TIU/TKP.
    const packSubtests = Array.isArray(result.question_packs?.subtests) && result.question_packs.subtests.length
      ? result.question_packs.subtests
      : ["TWK", "TIU", "TKP"];
    const subtestChips = packSubtests
      .map((sub) => {
        // Uppercase untuk lookup key di bd.earned / bd.counts (computeBreakdowns
        // normalizes ke TWK/TIU/TKP uppercase). esc() menjaga agar tidak ada
        // HTML injection dari label subtes (meskipun schema CHECK memastikan
        // hanya TWK/TIU/TKP yang valid, defense-in-depth).
        const subUpper = String(sub).toUpperCase();
        return `<strong>${esc(subUpper)}</strong> ${bd.earned[subUpper] || 0}/${bd.counts[subUpper] || 0}`;
      })
      .join(" · ");

    infoEl.innerHTML = `
      <div class="stat"><span class="value">${esc(result.participant_name)}</span><span class="label">Nama Peserta</span></div>
      <div class="stat"><span class="value">${esc(result.question_packs?.name || "-")}</span><span class="label">Paket Soal</span></div>
      <div class="stat"><span class="value">${result.score} / ${questions.length * 5}</span><span class="label">Skor</span></div>
      <div class="stat"><span class="value ${sc}">${esc(result.status)}</span><span class="label">Status</span></div>
      <div class="review-stats-subtest">
        Subtest: ${subtestChips}
      </div>`;
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
      let ptsAttr = "";
      let pts = 0;
      if (!a) {
        c = "not-answered";
      } else if (isTkp(q)) {
        pts = Number(((q.option_scores || {})[a]) || 0);
        // Per user feedback 2026-07-18: always emit data-pts on TKP
        // buttons (correct/incorrect/partial/unanswered), so the CSS
        // [data-pts]::after rule can render the bobot superscript on
        // every TKP answer-grid cell, not just partial cases. Spec §7.1
        // only required partial; this generalizes to "every TKP cell
        // shows the points the participant scored".
        ptsAttr = ` data-pts="${pts}"`;
        if (pts === 5) c = "correct";
        else if (pts === 0) c = "incorrect";
        else c = "partial";
      } else {
        c = a === q.correct_answer ? "correct" : "incorrect";
      }
      // Floating bobot chip on TKP cell corners (per user feedback
      // 2026-07-18 round 7). Mirrors the .weight-N palette already
      // established on .option-item so chip color reinforces the same
      // weight signal at answer-grid zoom level. Chip is more
      // thumb-readable than the 0.65rem ::after superscript on mobile.
      // Hidden for unanswered TKP (if (!a) branch -- we never reach
      // here) and for binary cells (TWK/TIU emit no chip because
      // tkpCell is false -- weight concept does not apply).
      const tkpCell = isTkp(q) && a;
      const chipHtml = tkpCell
        ? `<span class="q-bobot-chip weight-${pts}">${pts}</span>`
        : "";
      return `<button class="${c}"${ptsAttr} data-i="${i}">${chipHtml}${i + 1}</button>`;
    })
    .join("");
  gridEl.onclick = (e) => {
    const btn = e.target.closest("button");
    if (btn && btn.dataset.i !== undefined) renderQuestion(+btn.dataset.i);
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

  if (isTkp(q)) {
    // TKP rendering per spec §13.1 / §13.2.
    // Per user feedback 2026-07-18: tkp-unanswered-caption div removed --
    // the per-question "Bobot Anda: X poin" caption was redundant with the
    // bobot badge already shown inline on each option and the bobot
    // indicator now displayed on the answer-grid button (see buildGrid +
    // data-pts attribute + CSS [data-pts]::after rule). Cleanup without
    // information loss: bobot is visible at both the option-row level
    // (per-option weight badge) AND the question-list level (answer-grid
    // superscript).
    let html2 = "";
    for (const [k, v] of Object.entries(q.options || {})) {
      const w = Number(((q.option_scores || {})[k]) || 0);
      const cls = ["option-item", `weight-${w}`];
      if (a === k) cls.push("weight-pick");
      const isPick = a === k;
      const badgeText = w > 0 ? `${w} pts` : "0 pts";
      const badgeCls = isPick
        ? "weight-badge weight-badge--pick"
        : "weight-badge";
      html2 += `<div class="${cls.join(" ")}"><input type="radio" disabled${
        isPick ? " checked" : ""
      }><span class="option-label"><strong>${esc(k)}.</strong> ${esc(unwrapParagraph(v))}</span><span class="${badgeCls}">${badgeText}</span></div>`;
    }
    optionsEl.innerHTML = html2;
  } else {
    // Binary rendering unchanged per spec §13.3.
    optionsEl.innerHTML = Object.entries(q.options || {})
      .map(([k, v]) => {
        let cls = "option-item";
        if (k === q.correct_answer) cls += " correct-answer";
        else if (k === a && a !== q.correct_answer) cls += " wrong-answer";
        return `<div class="${cls}"><input type="radio" disabled${
          k === a ? " checked" : ""
        }><span class="option-label"><strong>${esc(k)}.</strong> ${esc(unwrapParagraph(v))}</span></div>`;
      })
      .join("");
  }

  explanationEl.style.display = "block";
  let expHtml = `<strong>Pembahasan:</strong><br>${q.explanation || ""}`;
  if (q.explanation_image_url) {
    expHtml += `<br><img src="${q.explanation_image_url}" style="max-width:100%;margin-top:12px;border-radius:8px">`;
  }
  explanationEl.innerHTML = expHtml;
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
