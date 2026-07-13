// ============================================================================
// wrapFetch: credentials: 'same-origin' (default tapi eksplisit) + 401 = "session
// expired" toast; 5xx = server error toast. Throws SESSION_EXPIRED /
// SERVER_ERROR_<status> so caller's catch can early-return and avoid duplicate
// alerts (toast is already shown).
//
// Headers: caller's `options.headers` ALWAYS win (spread LAST). Default
// Content-Type: application/json only if (a) body isn't FormData AND (b) caller
// didn't set Content-Type.
//
// KEEP IN SYNC: kelola-soal.js, paket-soal.js, paket-detail.js — spec §7.5
// ============================================================================
async function wrapFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body &&
      !(options.body instanceof FormData) &&
      !options.headers?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    handleSessionExpired();
    throw new Error("wrapFetch:SESSION_EXPIRED");
  }
  if (res.status >= 500) {
    showServerErrorToast();
    throw new Error(`wrapFetch:SERVER_ERROR_${res.status}`);
  }
  return res;
}

function handleSessionExpired() {
  // Try to preserve unsaved form state (best-effort)
  try {
    const openModal = document.querySelector("dialog[open]");
    if (openModal) {
      const form = openModal.querySelector("form");
      if (form) {
        const snapshot = {};
        for (const el of form.elements) {
          if (el.name) snapshot[el.name] = el.value;
        }
        snapshot._timestamp = Date.now();
        localStorage.setItem("toskd_unsaved_admin_form", JSON.stringify(snapshot));
      }
    }
  } catch (err) {
    // localStorage may be disabled — ignore
  }

  if (window.toskdSessionExpiredNotified) return;
  window.toskdSessionExpiredNotified = true;
  const msg = document.createElement("div");
  msg.className = "session-expired-toast";
  msg.innerHTML = `
    <div style="
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      background: var(--danger); color: white; padding: 16px 20px;
      border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      max-width: 360px;
    ">
      <strong>⚠️ Sesi habis</strong>
      <p style="margin: 8px 0 12px 0; font-size: 0.9rem">
        Login ulang untuk melanjutkan. Data yang sedang Anda edit telah disimpan sementara.
      </p>
      <button id="relogin-now-btn" class="btn-primary" style="font-size: 0.9rem">
        Login Ulang
      </button>
    </div>
  `;
  document.body.appendChild(msg);
  document.getElementById("relogin-now-btn").onclick = () => {
    const next_ = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${next_}`);
  };
}

function showServerErrorToast() {
  if (window.toskdServerErrorNotified) return;
  window.toskdServerErrorNotified = true;
  const msg = document.createElement("div");
  msg.className = "server-error-toast";
  msg.innerHTML = `
    <div style="
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      background: var(--warning, #b8860b); color: white; padding: 16px 20px;
      border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      max-width: 360px;
    ">
      <strong>⚠️ Server error</strong>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem">
        Aksi tidak dapat diselesaikan. Coba lagi dalam beberapa saat.
      </p>
    </div>
  `;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 8000);
}

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
    const res = await wrapFetch("/api/packs");
    packs = await res.json();

    // Fetch count for each
    const counts = await Promise.all(
      packs.map(async (p) => {
        const qRes = await wrapFetch(`/api/packs/${p.id}/questions`);
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
      .join("");  } catch (e) {
    if (e.message === "wrapFetch:SESSION_EXPIRED" || e.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    loadingEl.innerHTML = '<p style="color:var(--danger)">Gagal memuat paket soal.</p>';
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
    const res = await wrapFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, duration_minutes, passing_grade }),
    });
    if (!res.ok) throw new Error();
    modal.close();
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
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
    const res = await wrapFetch(`/api/packs/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menghapus paket soal.");
  }
};

init();
