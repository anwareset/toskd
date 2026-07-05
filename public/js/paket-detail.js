const packId = new URLSearchParams(location.search).get("packId");
if (!packId) location.href = "/paket-soal.html";

const packTitle = document.getElementById("pack-title");
const packSubtitle = document.getElementById("pack-subtitle");
const bankList = document.getElementById("bank-questions-list");
const packList = document.getElementById("pack-questions-list");
const addBtn = document.getElementById("add-to-pack-btn");
const saveBtn = document.getElementById("save-order-btn");

let pack = null;
let packQuestions = [];
let allQuestions = [];

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  document.getElementById("loading-bank").style.display = "flex";
  document.getElementById("loading-pack").style.display = "flex";
  try {
    const [pRes, pqRes, aqRes] = await Promise.all([
      fetch(`/api/packs/${packId}`),
      fetch(`/api/packs/${packId}/questions`),
      fetch("/api/questions"),
    ]);
    pack = await pRes.json();
    packQuestions = await pqRes.json();
    allQuestions = await aqRes.json();

    packTitle.textContent = pack.name;
    packSubtitle.textContent = `⏱️ Durasi: ${pack.duration_minutes} Menit | Passing Grade: ${pack.passing_grade}`;

    document.getElementById("loading-bank").style.display = "none";
    document.getElementById("loading-pack").style.display = "none";

    renderLists();
  } catch (e) {
    alert("Gagal memuat detail paket.");
  }
}

function renderLists() {
  const packIds = new Set(packQuestions.map((q) => q.id));
  const available = allQuestions.filter((q) => !packIds.has(q.id));

  // Render Bank list
  if (!available.length) {
    bankList.innerHTML =
      '<p style="color:#64748b;padding:12px">Semua soal sudah dimasukkan ke paket ini.</p>';
  } else {
    bankList.innerHTML = available
      .map(
        (q) => `
      <label class="option-item" style="cursor:pointer;background:#fff;margin-bottom:8px">
        <input type="checkbox" name="add-q" value="${q.id}">
        <span class="option-label">
          <strong>[${q.question_type.toUpperCase()}]</strong> ${esc(q.content.substring(0, 100))}...
        </span>
      </label>
    `,
      )
      .join("");
  }

  // Render Pack questions
  if (!packQuestions.length) {
    packList.innerHTML =
      '<p style="color:#64748b;padding:24px;text-align:center">Belum ada soal dalam paket ini.</p>';
    saveBtn.disabled = true;
  } else {
    packList.innerHTML = packQuestions
      .map(
        (q, i) => `
      <div class="pack-question-item" draggable="true" data-id="${q.id}" data-index="${i}">
        <span class="q-num">Soal ${i + 1}</span>
        <span class="q-preview">${esc(q.content.replace(/<[^>]*>/g, ""))}</span>
        <button class="btn-danger" style="padding:4px 8px;font-size:0.8rem" onclick="removeQuestion(${q.id})">Hapus</button>
      </div>
    `,
      )
      .join("");
    setupDragAndDrop();
  }
}

addBtn.onclick = async () => {
  const checked = Array.from(
    bankList.querySelectorAll('input[name="add-q"]:checked'),
  ).map((el) => parseInt(el.value));
  if (!checked.length) {
    alert("Pilih soal yang ingin dimasukkan!");
    return;
  }

  if (packQuestions.length + checked.length > 35) {
    alert("Maksimal 35 soal per paket!");
    return;
  }

  for (let i = 0; i < checked.length; i++) {
    const qNum = packQuestions.length + 1;
    await fetch(`/api/packs/${packId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: checked[i], question_number: qNum }),
    });
  }
  init();
};

window.removeQuestion = async (qId) => {
  if (!confirm("Hapus soal ini dari paket?")) return;
  try {
    const res = await fetch(`/api/packs/${packId}/questions/${qId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    alert("Gagal menghapus soal dari paket.");
  }
};

// Drag and Drop
let dragSourceEl = null;

function setupDragAndDrop() {
  const items = packList.querySelectorAll(".pack-question-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
  });
}

function handleDragStart(e) {
  this.classList.add("dragging");
  dragSourceEl = this;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", this.innerHTML);
}

function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();
  if (dragSourceEl !== this) {
    const srcIdx = parseInt(dragSourceEl.dataset.index);
    const destIdx = parseInt(this.dataset.index);

    // Reorder packQuestions array
    const temp = packQuestions[srcIdx];
    packQuestions.splice(srcIdx, 1);
    packQuestions.splice(destIdx, 0, temp);

    renderLists();
    saveBtn.disabled = false;
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove("dragging");
}

saveBtn.onclick = async () => {
  if (packQuestions.length < 1 || packQuestions.length > 35) {
    alert("Setiap paket harus memiliki antara 1 sampai 35 soal!");
    return;
  }
  saveBtn.disabled = true;
  const payload = packQuestions.map((q, i) => ({
    question_id: q.id,
    question_number: i + 1,
  }));
  try {
    const res = await fetch(`/api/packs/${packId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: payload }),
    });
    if (!res.ok) throw new Error();
    alert("Urutan soal berhasil disimpan!");
    init();
  } catch (err) {
    alert("Gagal menyimpan urutan soal.");
    saveBtn.disabled = false;
  }
};

init();
