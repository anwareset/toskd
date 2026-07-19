let selectedPackId = null;
let packsList = [];
let currentSearch = "";
const grid = document.getElementById("pack-grid");
const loading = document.getElementById("loading");
const loadingStatus = document.getElementById("loading-status");
const searchInput = document.getElementById("pack-search");
const searchClear = document.getElementById("pack-search-clear");
const modal = document.getElementById("name-modal");
const nameInput = document.getElementById("participant-name");

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Filter packsList by name (case-insensitive). Pure function: returns
// a NEW filtered array, doesn't mutate packsList. Empty query string
// returns the original list (preserves order from loadPacks, which
// mirrors server Round-19 newest-first order). Plain toLowerCase()
// suffices — locale-aware lowercasing (toLocaleLowerCase("id")) is
// theatrical here because String.includes operates on raw chars, so
// the locale arg would never change the result for SKD pack names.
function filterPacks(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((p) => String(p.name || "").toLowerCase().includes(q));
}

function renderPacks(list, opts = {}) {
  const message =
    list.length === 0
      ? opts.emptyMessage || "Tidak ada paket yang cocok dengan pencarian."
      : null;
  if (message) {
    grid.innerHTML = `<p class="grid-empty-state">${esc(message)}</p>`;
    return;
  }
  grid.innerHTML = list
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
}

function setLoadingStatus(text) {
  if (!loadingStatus) return;
  if (text) {
    loadingStatus.textContent = text;
    loadingStatus.hidden = false;
  } else {
    loadingStatus.hidden = true;
    loadingStatus.textContent = "";
  }
}

function updateClearVisibility() {
  if (!searchClear || !searchInput) return;
  searchClear.hidden = searchInput.value.length === 0;
}

async function loadPacks() {
  // Disable search while packs haven't loaded yet so the input
  // visually signals "wait for data" instead of accepting keystrokes
  // the listener would silently drop (per code-reviewer Round-21 V2).
  if (searchInput) searchInput.disabled = true;
  try {
    const res = await fetch("/api/packs");
    const packs = await res.json();
    loading.style.display = "none";
    if (!packs.length) {
      packsList = [];
      renderPacks([], {
        emptyMessage: "Belum ada paket soal tersedia.",
      });
      return;
    }
    // Per-pack count phase: show inline progress so the user has
    // visibility that the page is still loading (initial spinner
    // overlay is already gone at this point per Round-21 design).
    setLoadingStatus(
      `Memuat detail paket… 0 dari ${packs.length} selesai`,
    );
    let done = 0;
    const packsWithCounts = await Promise.all(
      packs.map(async (p) => {
        const qRes = await fetch(`/api/packs/${p.id}/questions`);
        const qs = await qRes.json();
        done += 1;
        // Suppress the "Y dari Y selesai" tick on the final iteration
        // — it would only flash for one frame before setLoadingStatus(null)
        // hides the bar entirely, per user Round-21 polish request.
        if (done < packs.length) {
          setLoadingStatus(
            `Memuat detail paket… ${done} dari ${packs.length} selesai`,
          );
        }
        return { ...p, count: qs.length };
      }),
    );
    packsList = packsWithCounts;
    setLoadingStatus(null);
    const filtered = filterPacks(packsList, currentSearch);
    renderPacks(filtered);
  } catch (e) {
    loading.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat paket soal.</p>';
    setLoadingStatus(null);
  } finally {
    // Re-enable search regardless of success/error so the user can
    // still try a query after a failure (filtered list is empty in
    // the error path but the input stays usable for retry).
    if (searchInput) searchInput.disabled = false;
  }
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value;
    updateClearVisibility();
    // Defensive guard: loadPacks already disables the input during
    // in-flight load, so this branch shouldn't actually fire while
    // packsList is empty. Kept as belt-and-suspenders against future
    // refactors that might drop the disabled lifecycle.
    if (packsList.length === 0) return;
    const q = currentSearch.trim();
    const filtered = filterPacks(packsList, currentSearch);
    if (filtered.length === 0 && q) {
      renderPacks([], {
        emptyMessage: `Tidak ada paket yang cocok dengan “${q}”. Coba kata kunci lain.`,
      });
    } else {
      renderPacks(filtered);
    }
  });
  updateClearVisibility();
}

if (searchClear) {
  searchClear.addEventListener("click", () => {
    if (!searchInput) return;
    searchInput.value = "";
    currentSearch = "";
    updateClearVisibility();
    if (packsList.length === 0) return;
    renderPacks(packsList);
    searchInput.focus();
  });
}

function selectPack(id) {
  const p = packsList.find((x) => x.id === id);
  if (p && (p.count < 1 || p.count > 110)) {
    alert(
      `Paket ini memiliki ${p.count} soal. Untuk memulai ujian, paket harus memiliki antara 1 sampai 110 soal.`,
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
  // Exam Timer Persistence (spec: specs/exam-timer-persistence-spec.md, AC1):
  // generate SID sekali per "Mulai" click — jadi exam.html bisa pakai wall-clock
  // untuk resume timer walaupun user me-refresh.
  const sid =
    globalThis.crypto?.randomUUID?.() ??
    (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
  location.href = `/exam.html?packId=${selectedPackId}&name=${encodeURIComponent(name)}&sid=${sid}`;
};
nameInput.addEventListener(
  "input",
  () => (nameInput.style.borderColor = ""),
);
loadPacks();
