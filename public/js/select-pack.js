let selectedPackId = null;
let packsList = [];
const grid = document.getElementById("pack-grid");
const loading = document.getElementById("loading");
const modal = document.getElementById("name-modal");
const nameInput = document.getElementById("participant-name");

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function loadPacks() {
  try {
    const res = await fetch("/api/packs");
    const packs = await res.json();
    loading.style.display = "none";
    if (!packs.length) {
      grid.innerHTML =
        '<p style="color:#64748b">Belum ada paket soal tersedia.</p>';
      return;
    }
    const packsWithCounts = await Promise.all(
      packs.map(async (p) => {
        const qRes = await fetch(`/api/packs/${p.id}/questions`);
        const qs = await qRes.json();
        return { ...p, count: qs.length };
      }),
    );
    packsList = packsWithCounts;
    grid.innerHTML = packsWithCounts
      .map(
        (p) => `
      <div class="card">
        <h3>${esc(p.name)}</h3>
        <p>⏱️ Durasi: ${p.duration_minutes} Menit</p>
        <p>📝 Jumlah Soal: ${p.count}</p>
        <p>🎯 Nilai Kelulusan: ${p.passing_grade}</p>
        <button class="btn-primary" onclick="selectPack(${p.id})">Pilih Paket</button>
      </div>`,
      )
      .join("");
  } catch (e) {
    loading.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat paket soal.</p>';
  }
}

function selectPack(id) {
  const p = packsList.find((x) => x.id === id);
  if (p && (p.count < 1 || p.count > 35)) {
    alert(
      `Paket ini memiliki ${p.count} soal. Untuk memulai ujian, paket harus memiliki antara 1 sampai 35 soal.`,
    );
    return;
  }
  selectedPackId = id;
  nameInput.value = "";
  modal.showModal();
}
document.getElementById("cancel-btn").onclick = () => modal.close();
document.getElementById("start-btn").onclick = () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.style.borderColor = "var(--danger)";
    nameInput.focus();
    return;
  }
  location.href = `/exam.html?packId=${selectedPackId}&name=${encodeURIComponent(name)}`;
};
nameInput.addEventListener(
  "input",
  () => (nameInput.style.borderColor = "#d1d5db"),
);
loadPacks();
