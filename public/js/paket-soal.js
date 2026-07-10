const tableEl = document.getElementById("pack-table");
const bodyEl = document.getElementById("pack-body");
const loadingEl = document.getElementById("loading");
const modal = document.getElementById("pack-modal");
const form = document.getElementById("pack-form");
const modalTitle = document.getElementById("modal-title");

let packs = [];

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  try {
    const res = await fetch("/api/packs");
    packs = await res.json();

    // Fetch count for each
    const counts = await Promise.all(
      packs.map(async (p) => {
        const qRes = await fetch(`/api/packs/${p.id}/questions`);
        const qs = await qRes.json();
        return qs.length;
      }),
    );

    loadingEl.style.display = "none";
    tableEl.style.display = "table";
    bodyEl.innerHTML = packs
      .map(
        (p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td title="${esc(p.name)}">${esc(p.name)}</td>
        <td>${p.duration_minutes} Menit</td>
        <td>${p.passing_grade}</td>
        <td>${counts[i]} Soal</td>
        <td>
          <button class="btn-secondary" onclick="editPack(${p.id})">Edit</button>
          <button class="btn-primary" onclick="location.href='/paket-detail.html?packId=${p.id}'">Lihat Soal</button>
          <button class="btn-danger" onclick="deletePack(${p.id})">Hapus</button>
        </td>
      </tr>
    `,
      )
      .join("");
  } catch (e) {
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat paket soal.</p>';
  }
}

document.getElementById("add-pack-btn").onclick = () => {
  form.reset();
  document.getElementById("pack-id").value = "";
  modalTitle.textContent = "Tambah Paket Soal";
  modal.showModal();
};

document.getElementById("close-modal-btn").onclick = () => modal.close();

form.onsubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById("pack-id").value;
  const name = document.getElementById("pack-name").value.trim();
  const duration_minutes = parseInt(
    document.getElementById("pack-duration").value,
  );
  const passing_grade = parseInt(document.getElementById("pack-passing").value);

  if (duration_minutes < 1) {
    alert("Durasi minimal 1 menit!");
    return;
  }

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/packs/${id}` : "/api/packs";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, duration_minutes, passing_grade }),
    });
    if (!res.ok) throw new Error();
    modal.close();
    init();
  } catch (err) {
    alert("Gagal menyimpan paket soal.");
  }
};

window.editPack = (id) => {
  const p = packs.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("pack-id").value = p.id;
  document.getElementById("pack-name").value = p.name;
  document.getElementById("pack-duration").value = p.duration_minutes;
  document.getElementById("pack-passing").value = p.passing_grade;
  modalTitle.textContent = "Edit Paket Soal";
  modal.showModal();
};

window.deletePack = async (id) => {
  if (
    !confirm(
      "Apakah Anda yakin ingin menghapus paket soal ini? Semua relasi soal akan terhapus.",
    )
  )
    return;
  try {
    const res = await fetch(`/api/packs/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    alert("Gagal menghapus paket soal.");
  }
};

init();
