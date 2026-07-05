const tableEl = document.getElementById("questions-table");
const bodyEl = document.getElementById("questions-body");
const loadingEl = document.getElementById("loading");
const modal = document.getElementById("q-modal");
const form = document.getElementById("q-form");
const modalTitle = document.getElementById("modal-title");
const imgGroup = document.getElementById("image-group");
const imgInput = document.getElementById("q-image");
const imgPreview = document.getElementById("image-preview");

let questions = [];
let base64Image = null;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  try {
    const res = await fetch("/api/questions");
    questions = await res.json();
    loadingEl.style.display = "none";
    tableEl.style.display = "table";
    bodyEl.innerHTML = questions
      .map(
        (q, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">${esc(q.content.replace(/<[^>]*>/g, ""))}</td>
        <td><strong>${q.question_type.toUpperCase()}</strong></td>
        <td>${q.image_url ? `<img src="${q.image_url}" style="height:40px;border-radius:4px">` : "-"}</td>
        <td><span class="btn-success" style="padding:2px 8px;border-radius:4px;font-size:0.8rem">${q.correct_answer}</span></td>
        <td>
          <button class="btn-secondary" onclick="editQuestion(${q.id})">Edit</button>
          <button class="btn-danger" onclick="deleteQuestion(${q.id})">Hapus</button>
        </td>
      </tr>
    `,
      )
      .join("");
  } catch (e) {
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat bank soal.</p>';
  }
}

function renderPreview() {
  const content = document.getElementById("q-content-text").value;
  const question_type = document.querySelector(
    'input[name="q-type"]:checked',
  ).value;
  const optA = document.getElementById("opt-a").value;
  const optB = document.getElementById("opt-b").value;
  const optC = document.getElementById("opt-c").value;
  const optD = document.getElementById("opt-d").value;
  const optE = document.getElementById("opt-e").value;
  const correct = document.getElementById("correct-ans").value;
  const explanation = document.getElementById("q-explanation").value;
  const existing_image_url =
    document.getElementById("existing-image-url").value;

  let imgHtml = "";
  if (question_type === "figural") {
    const src = base64Image || existing_image_url;
    if (src) {
      imgHtml = `<div style="margin-top:12px"><img src="${src}" style="max-height:200px;border-radius:8px"></div>`;
    }
  }

  const previewArea = document.getElementById("preview-render-area");
  previewArea.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px">Pertanyaan:</div>
    <div style="margin-bottom:16px">${content || "(kosong)"}</div>
    ${imgHtml}
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
      <div><span style="font-weight:bold;color:${correct === "A" ? "var(--success)" : "inherit"}">A.</span> ${optA || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "B" ? "var(--success)" : "inherit"}">B.</span> ${optB || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "C" ? "var(--success)" : "inherit"}">C.</span> ${optC || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "D" ? "var(--success)" : "inherit"}">D.</span> ${optD || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "E" ? "var(--success)" : "inherit"}">E.</span> ${optE || "(belum diisi)"}</div>
    </div>
    <hr style="margin:20px 0;border:0;border-top:1px solid #e2e8f0">
    <div style="font-weight:bold;margin-bottom:8px">Pembahasan (Kunci: ${correct}):</div>
    <div>${explanation || "(belum diisi)"}</div>
  `;

  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([previewArea]).catch(() => {});
  }
}

// Dialog tabs
const tabs = document.querySelectorAll(".tab-btn");
function switchTab(tabId) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.toggle("active", c.id === tabId));
  if (tabId === "tab-preview") {
    renderPreview();
  }
}
tabs.forEach((tab) => {
  tab.onclick = () => switchTab(tab.dataset.tab);
});

function resetTabs() {
  switchTab("tab-content");
}

document.getElementById("add-q-btn").onclick = () => {
  form.reset();
  document.getElementById("q-id").value = "";
  document.getElementById("existing-image-url").value = "";
  base64Image = null;
  imgPreview.style.display = "none";
  imgGroup.style.display = "none";
  modalTitle.textContent = "Tambah Soal Baru";
  resetTabs();
  modal.showModal();
};

document.getElementById("close-modal-btn").onclick = () => modal.close();

// Type radio switcher
document.querySelectorAll('input[name="q-type"]').forEach((r) => {
  r.onchange = () => {
    if (r.value === "figural") imgGroup.style.display = "block";
    else imgGroup.style.display = "none";
  };
});

// Base64 file converter
imgInput.onchange = () => {
  const file = imgInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    base64Image = e.target.result;
    imgPreview.style.display = "block";
    imgPreview.innerHTML = `<img src="${base64Image}" style="max-height:150px;border-radius:4px">`;
  };
  reader.readAsDataURL(file);
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById("q-id").value;
  const content = document.getElementById("q-content-text").value.trim();
  const question_type = document.querySelector(
    'input[name="q-type"]:checked',
  ).value;
  const options = {
    A: document.getElementById("opt-a").value.trim(),
    B: document.getElementById("opt-b").value.trim(),
    C: document.getElementById("opt-c").value.trim(),
    D: document.getElementById("opt-d").value.trim(),
    E: document.getElementById("opt-e").value.trim(),
  };
  const correct_answer = document.getElementById("correct-ans").value;
  const explanation = document.getElementById("q-explanation").value.trim();
  const existing_image_url =
    document.getElementById("existing-image-url").value;

  if (!content) {
    alert("Teks / Pertanyaan wajib diisi!");
    switchTab("tab-content");
    document.getElementById("q-content-text").focus();
    return;
  }
  if (!options.A || !options.B || !options.C || !options.D || !options.E) {
    alert("Semua Opsi Jawaban (A-E) wajib diisi!");
    switchTab("tab-options");
    if (!options.A) document.getElementById("opt-a").focus();
    else if (!options.B) document.getElementById("opt-b").focus();
    else if (!options.C) document.getElementById("opt-c").focus();
    else if (!options.D) document.getElementById("opt-d").focus();
    else if (!options.E) document.getElementById("opt-e").focus();
    return;
  }
  if (!correct_answer) {
    alert("Kunci Jawaban Benar wajib dipilih!");
    switchTab("tab-options");
    document.getElementById("correct-ans").focus();
    return;
  }
  if (!explanation) {
    alert("Pembahasan Cara Pengerjaan wajib diisi!");
    switchTab("tab-explanation");
    document.getElementById("q-explanation").focus();
    return;
  }

  const payload = {
    content,
    question_type,
    options,
    correct_answer,
    explanation,
    image: base64Image,
    image_url: existing_image_url,
  };

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/questions/${id}` : "/api/questions";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    modal.close();
    init();
  } catch (err) {
    alert("Gagal menyimpan soal.");
  }
};

window.editQuestion = (id) => {
  const q = questions.find((x) => x.id === id);
  if (!q) return;
  document.getElementById("q-id").value = q.id;
  document.getElementById("q-content-text").value = q.content;
  document.querySelector(
    `input[name="q-type"][value="${q.question_type}"]`,
  ).checked = true;

  if (q.question_type === "figural") {
    imgGroup.style.display = "block";
    if (q.image_url) {
      document.getElementById("existing-image-url").value = q.image_url;
      imgPreview.style.display = "block";
      imgPreview.innerHTML = `<img src="${q.image_url}" style="max-height:150px;border-radius:4px">`;
    } else {
      imgPreview.style.display = "none";
    }
  } else {
    imgGroup.style.display = "none";
    imgPreview.style.display = "none";
  }

  document.getElementById("opt-a").value = q.options.A;
  document.getElementById("opt-b").value = q.options.B;
  document.getElementById("opt-c").value = q.options.C;
  document.getElementById("opt-d").value = q.options.D;
  document.getElementById("opt-e").value = q.options.E;
  document.getElementById("correct-ans").value = q.correct_answer;
  document.getElementById("q-explanation").value = q.explanation;

  base64Image = null;
  modalTitle.textContent = "Edit Soal";
  resetTabs();
  modal.showModal();
};

window.deleteQuestion = async (id) => {
  try {
    const usageRes = await fetch(`/api/questions/${id}/usage`);
    const usage = await usageRes.json();
    let msg = "Apakah Anda yakin ingin menghapus soal ini dari Bank Soal?";
    if (usage.used) {
      msg = `Soal ini digunakan di ${usage.packs.join(", ")}. Hapus?`;
    }
    if (!confirm(msg)) return;
    const res = await fetch(`/api/questions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    alert("Gagal menghapus soal.");
  }
};

init();
