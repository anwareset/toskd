// public/js/scoreboard.js
//
// Spec: scoreboard-pagination-spec.md §6.
// State model: allResults (server cache) → filteredResults (search filter) →
// sorted (comparator) → paginated (slice). Everything client-side. No URL
// sync (Round 2): reload resets state to defaults.
//
// Sort key resolvers (extract the comparable value from a row) and the
// DEFAULT_DIR map give the column's first-click direction (Round 1).
// Stable created_at-desc tiebreak: when two rows have identical sort keys,
// the newest participant ranks higher (recently-created first). Deterministic
// so rows never shuffle between re-renders (§8.14).

const loadingEl = document.getElementById("loading");
const tableEl = document.getElementById("score-table");
const bodyEl = document.getElementById("score-body");
const emptyEl = document.getElementById("empty-msg");
const controlsTopEl = document.getElementById("controls-top");
const controlsBottomEl = document.getElementById("controls-bottom");

// Admin-only selection UI (2026-08-19) — mirror bulk-delete kelola-soal.js:
// selectedIds Set + header select-all 3-state + selection pill + tombol
// Hapus Terpilih. Kolom checkbox/Aksi tersembunyi utk non-admin via CSS
// #score-table.admin-mode (lihat .admin-actions di styles.css).
const selectAllCheckbox = document.getElementById(
  "scoreboard-select-all-checkbox",
);
const bulkDeleteBtn = document.getElementById("scoreboard-bulk-delete-btn");
const selectionPill = document.getElementById("scoreboard-selection-pill");
const selectionPillText = document.getElementById(
  "scoreboard-selection-pill-text",
);
const clearSelectionBtn = document.getElementById(
  "scoreboard-clear-selection-btn",
);
const selectedIds = new Set();

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Module-level state (§6.1).
let allResults = [];
let filteredResults = [];
let rowsPerPage = 25; // default: middle option of 10/25/50/100
let currentPage = 1;
let searchTerm = "";
let sortColumn = "score"; // initial active sort (Round 1: Skor DESC)
let sortDir = "desc";

// Sort key resolvers. Returning a consistent type per column is critical —
// string columns lowercased to enable case-insensitive alpha sort; numeric
// columns coerced via Number() so subtraction compares numerically; date
// columns coerced via .getTime() so dates sort as millisecond epochs.
const SORT_KEYS = {
  participant_name: (r) => (r.participant_name || "").toLowerCase(),
  "question_packs.name": (r) => (r.question_packs?.name || "").toLowerCase(),
  score: (r) => Number(r.score || 0),
  status: (r) => (r.status || "").toLowerCase(),
  created_at: (r) => new Date(r.created_at || 0).getTime(),
};

// First-click direction per column (Round 1).
const DEFAULT_DIR = {
  participant_name: "asc",
  "question_packs.name": "asc",
  score: "desc",
  status: "asc",
  created_at: "desc",
};

// ====== Init ======
async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  // Wrapper is tab-indexed (region) — opt out of focus + a11y tree while
  // the inner table is hidden. (See spec §6 + a11y audit.)
  tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", true);
  emptyEl.style.display = "none";
  controlsTopEl.style.display = "none";
  controlsBottomEl.style.display = "none";

  try {
    const r = await fetch("/api/scoreboard-all");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    allResults = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[scoreboard] failed to load data:", e);
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat data.</p>';
    return;
  }

  loadingEl.style.display = "none";

  // Bind interactions BEFORE first render so any synchronous click that
  // races the render is still handled correctly.
  bindSearch();
  bindRowsPerPage("top");
  bindRowsPerPage("bottom");
  bindNav("top");
  bindNav("bottom");
  bindSortHeaders();

  wireAdminReset();
  // Admin check dijalankan terpisah dari tombol reset (2026-08-11) supaya
  // link participant → review.html tidak bergantung pada keberadaan markup
  // tombol reset — dua fitur admin-only yang independen.
  checkAdmin();

  // Selection & delete (2026-08-19) — delegation ONCE sebelum render pertama
  // supaya checkbox/aksi yang muncul belakangan tetap tertangani.
  setupCheckboxDelegation();
  bindSelectAll();
  bindClearSelection();
  bindDeleteActions();

  reapplyView();
}

// ====== View pipeline (§6.3): search → sort → page → render ======
function reapplyView() {
  // 1. Search (§4 Round 2: case-insensitive over participant_name + paket name).
  searchTerm =
    document.getElementById("search-input").value.trim();
  const term = searchTerm.toLowerCase();
  filteredResults = !term
    ? allResults.slice()
    : allResults.filter((r) => {
        const name = (r.participant_name || "").toLowerCase();
        const pack = (r.question_packs?.name || "").toLowerCase();
        return name.includes(term) || pack.includes(term);
      });

  // 1b. Pre-compute stable-id ranking for the No column (spec §4.2).
  // Each row's No is its 1-based position in the original
  // /api/scoreboard-all response (allResults). Stays attached across
  // sort/filter/pagination since allResults never re-orders.
  // Computed once per reapplyView() call (O(N) construction, O(1) per
  // pageData lookup); cheaper than per-row indexOf on every render.
  const rankById = new Map();
  allResults.forEach((r, i) => rankById.set(r.id, i + 1));

  // 2. Sort.
  filteredResults.sort(comparator(sortColumn, sortDir));

  // 3. Page clamp.
  const totalPages = Math.max(
    1,
    Math.ceil(filteredResults.length / rowsPerPage),
  );
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // 4. Render.
  if (filteredResults.length === 0) {
    renderEmpty();
  } else {
    renderTable(rankById);
    renderPaginationBars(totalPages);
    updateSortIndicators();
  }
}

function comparator(col, dir) {
  const key = SORT_KEYS[col];
  if (!key) return (a, b) => Number(a.id || 0) - Number(b.id || 0);
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    // Stable tiebreak: created_at descending so equal-key rows rank newest
    // participant higher. Deterministic across re-renders (§8.14).
    const da = new Date(a.created_at || 0).getTime();
    const db = new Date(b.created_at || 0).getTime();
    return db - da;
  };
}

function renderTable(rankById) {
  const start = (currentPage - 1) * rowsPerPage;
  const pageData = filteredResults.slice(start, start + rowsPerPage);
  bodyEl.innerHTML = pageData
    .map((r, i) => {
      // Stable id (spec §4.2): row's 1-based position in the original
      // /api/scoreboard-all response (allResults). Stable across sort /
      // filter / pagination — sort moves ROWS, not their No. Falls back
      // to em-dash for missing or corrupted r.id.
      const rawIdx = rankById.get(r.id);
      const trophyMap = { 1: "🥇", 2: "🥈", 3: "🥉" };
      const globalIdx = rawIdx != null && trophyMap[rawIdx]
        ? `<span title="Peringkat ${rawIdx}">${trophyMap[rawIdx]}</span>`
        : rawIdx ?? "—";
      const d = new Date(r.created_at).toLocaleDateString("id-ID");
      const sc = r.status === "Lulus PG" ? "status-pass" : "status-fail";
      // Participant name deep-links to the pembahasan review page.
      // Defensive fallback (r.id missing) preserves the existing tolerant
      // behavior of the previous implementation.
      // Deep-link ke review.html hanya untuk admin (2026-08-11): peserta
  // public melihat nama sebagai teks polos — hasil orang lain tidak boleh
  // diakses (server-side juga enforce 403 di /api/exam/:id/results).
  const nameCell =
    r.id && isAdmin
      ? `<a class="participant-link" href="/review.html?id=${encodeURIComponent(r.id)}" title="Lihat pembahasan untuk ${esc(r.participant_name)}">${esc(r.participant_name)}</a>`
      : esc(r.participant_name);
      // Spec: kelola-soal-mobile-table-spec §6.2 + revisi 2026-08-19:
      //   - No column sticky-left HANYA saat non-admin (checkbox col tersembunyi
      //     → No = kolom pertama). Saat admin, checkbox col (sticky-left) jadi
      //     kolom pertama dan No kembali plain — mirror kelola-soal (checkbox
      //     sticky-left, No plain) supaya TIDAK ada offset sticky yang rapuh.
      //   - Aksi col sticky-right (mirror kolom Aksi kelola-soal).
      //   - Nama peserta diberi class .score-name-col eksplisit (max-width +
      //     ellipsis) agar lebarnya STABIL di kedua mode — sebelumnya gaya
      //     Nama datang dari rule global nth-child(2) yang berubah posisinya
      //     saat checkbox disisipkan → kolom terlihat bergeser.
      //   - .admin-actions disembunyikan utk non-admin via CSS
      //     #score-table.admin-mode.
      const noClass = isAdmin ? "" : "sticky-col-left";
      const checkboxTd = `<td class="col-checkbox sticky-col-left admin-actions"><input type="checkbox" class="row-checkbox" data-id="${r.id}" ${selectedIds.has(r.id) ? "checked" : ""} aria-label="Pilih hasil ${esc(r.participant_name)}"></td>`;
      const aksiTd = `<td class="sticky-col-right admin-actions"><button type="button" class="btn-danger" data-action="delete" data-id="${r.id}" aria-label="Hapus hasil ${esc(r.participant_name)}">Hapus</button></td>`;
      return `<tr>${checkboxTd}<td class="${noClass}">${globalIdx}</td><td class="score-name-col">${nameCell}</td><td>${esc(r.question_packs?.name || "-")}</td><td>${r.score}</td><td class="${sc}">${r.status}</td><td>${d}</td>${aksiTd}</tr>`;
    })
    .join("");

  tableEl.style.display = "table";
  // Remove `inert` now that the table is renderable.
  tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", false);
  controlsTopEl.style.display = "flex";
  controlsBottomEl.style.display = "flex";
  emptyEl.style.display = "none";

  // Sync selection pill + header checkbox 3-state after every render
  // (mirror updateSelectionUI kelola-soal.js). Reads selectedIds (state,
  // not DOM) + current filtered pageData (view).
  updateSelectionUI();
}

function renderEmpty() {
  // Distinguish two empty causes (§6.3 + §15.5/15.6).
  const isTrulyEmpty = allResults.length === 0;
  emptyEl.textContent = isTrulyEmpty
    ? "Belum ada data hasil ujian."
    : "Tidak ada hasil yang cocok dengan pencarian…";
  tableEl.style.display = "none";
  tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", true);
  emptyEl.style.display = "block";
  if (isTrulyEmpty) {
    // Belum ada data sama sekali → tidak ada yang bisa dicari/di-paginate:
    // sembunyikan kedua bar kontrol (termasuk #search-input di bar atas).
    controlsTopEl.style.display = "none";
    controlsBottomEl.style.display = "none";
  } else {
    // Search menghasilkan nol → PERTAHANKAN bar atas (#controls-top) yang
    // berisi #search-input supaya user bisa mengedit/menghapus query-nya
    // (bug-fix 2026-08-15: sebelumnya bar ikut disembunyikan sehingga form
    // input search menghilang padahal masih ada data). Bar bawah
    // disembunyikan; trio pagination di-disable + page-info di-reset di
    // bawah (tidak ada halaman yang bisa dinavigasi).
    controlsTopEl.style.display = "flex";
    controlsBottomEl.style.display = "none";
  }
  // Clear pagination text + disable buttons defensively.
  document.getElementById("page-info-top").textContent = "Halaman 1 dari 1";
  document.getElementById("page-info-bottom").textContent = "Halaman 1 dari 1";
  for (const suffix of ["top", "bottom"]) {
    document.getElementById(`prev-page-btn-${suffix}`).disabled = true;
    document.getElementById(`next-page-btn-${suffix}`).disabled = true;
  }
}

function renderPaginationBars(totalPages) {
  const text = `Halaman ${currentPage} dari ${totalPages}`;
  document.getElementById("page-info-top").textContent = text;
  document.getElementById("page-info-bottom").textContent = text;
  const disablePrev = currentPage <= 1;
  const disableNext = currentPage >= totalPages;
  for (const suffix of ["top", "bottom"]) {
    document.getElementById(`prev-page-btn-${suffix}`).disabled = disablePrev;
    document.getElementById(`next-page-btn-${suffix}`).disabled = disableNext;
  }
  // Sync the rows-per-page dropdowns so both visualize the active value.
  for (const suffix of ["top", "bottom"]) {
    document.getElementById(`rows-per-page-${suffix}`).value =
      String(rowsPerPage);
  }
}

// ====== Sort header indicators (§6.9) ======
// Only the active column shows ▲/▼ (Round 3). Inactive columns get no glyph.
// aria-sort follows the WAI-ARIA pattern for sortable column headers.
function updateSortIndicators() {
  const ths = document.querySelectorAll("#score-table th.sortable");
  ths.forEach((th) => {
    const isActive = th.dataset.sortColumn === sortColumn;
    // Reset aria + glyph state.
    th.setAttribute("aria-sort", "none");
    const existing = th.querySelector(".sort-indicator");
    if (existing) existing.remove();
    if (isActive) {
      th.setAttribute(
        "aria-sort",
        sortDir === "asc" ? "ascending" : "descending",
      );
      const span = document.createElement("span");
      span.className = "sort-indicator";
      span.setAttribute("aria-hidden", "true");
      span.textContent = sortDir === "asc" ? "▲" : "▼";
      th.appendChild(span);
    }
  });
}

// ====== Handlers ======
function bindSearch() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    currentPage = 1; // Round 2: reset on search change
    reapplyView();
  });
}

function bindRowsPerPage(suffix) {
  const el = document.getElementById(`rows-per-page-${suffix}`);
  el.addEventListener("change", () => {
    rowsPerPage = parseInt(el.value, 10) || 25;
    currentPage = 1; // Round 2: reset on rows-per-page change
    // Sync the other dropdown to keep both visually aligned.
    const other = suffix === "top" ? "bottom" : "top";
    document.getElementById(`rows-per-page-${other}`).value =
      String(rowsPerPage);
    reapplyView();
  });
}

function bindNav(suffix) {
  document
    .getElementById(`prev-page-btn-${suffix}`)
    .addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        reapplyView();
      }
    });
  document
    .getElementById(`next-page-btn-${suffix}`)
    .addEventListener("click", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(filteredResults.length / rowsPerPage),
      );
      if (currentPage < totalPages) {
        currentPage++;
        reapplyView();
      }
    });
}

function bindSortHeaders() {
  // Single delegated listener on the entire thead. Covers all 5 sortable
  // columns with one handler. Keyboard activation: Enter/Space on the
  // focused <th> also reaches the click path because we don't prevent
  // the synthetic click bubbling.
  document
    .querySelector("#score-table thead")
    .addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;
      // Toggle opacity-style tabindex handling: <th> isn't natively
      // focusable, so set tabindex on the first render (§9 / a11y nice-to-have).
      const col = th.dataset.sortColumn;
      if (sortColumn === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDir = DEFAULT_DIR[col] || "asc";
      }
      currentPage = 1; // Round 2: reset on sort change
      reapplyView();
    });
}

// ====== Admin-only: selection + delete (2026-08-19) ======
// Tiga tipe penghapusan: (1) single via tombol Hapus per-row,
// (2) bulk via checkbox + Hapus Terpilih, (3) reset-all (sudah ada).
// Pattern seleksi mirror kelola-soal.js (bulk-delete): selectedIds Set,
// header checkbox 3-state, selection pill, tombol Hapus Terpilih.

// updateSelectionUI() — sinkronkan pill + tombol Hapus Terpilih + header
// checkbox 3-state dari selectedIds (state) + pageData view (filteredResults
// dihalaman saat ini). Strict-scope: header checkbox mencerminkan baris
// halaman ini SAJA; seleksi lintas halaman tetap terlihat via pill.
function updateSelectionUI() {
  const total = selectedIds.size;
  const start = (currentPage - 1) * rowsPerPage;
  const pageData = filteredResults.slice(start, start + rowsPerPage);
  const onThisPage = pageData.filter((r) => selectedIds.has(r.id)).length;
  const totalOnPage = pageData.length;

  // Sembunyikan tombol Reset All saat ada checkbox ticked (revisi 2026-08-19):
  // mencegah salah pencet — admin mengira reset hanya menghapus baris terpilih,
  // padahal Reset All menghapus SEMUA hasil. Muncul lagi setelah seleksi
  // dibersihkan (clear selection / seleksi habis). updateSelectionUI dipanggil
  // di tiap perubahan seleksi + tiap render, jadi state selalu sinkron.
  if (resetScoreboardBtn) {
    resetScoreboardBtn.style.display = isAdmin && total === 0 ? "" : "none";
  }

  if (total === 0) {
    selectionPill.style.display = "none";
    bulkDeleteBtn.disabled = true;
  } else {
    selectionPill.style.display = "inline-flex";
    if (total === totalOnPage && total > 0) {
      selectionPillText.textContent = `${total} dipilih di halaman ini`;
    } else {
      selectionPillText.textContent = `${total} dipilih total · ${onThisPage} di halaman ini`;
    }
    bulkDeleteBtn.disabled = false;
  }

  // Header checkbox 3-state (mirror state machine kelola-soal).
  if (totalOnPage === 0 || onThisPage === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (onThisPage === totalOnPage) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

// setupCheckboxDelegation() — delegated `change` handler ONCE di bodyEl.
// Konversi toggle .row-checkbox jadi mutasi selectedIds (mirror kelola-soal).
let checkboxDelegationInstalled = false;
function setupCheckboxDelegation() {
  if (checkboxDelegationInstalled) return;
  if (!bodyEl) return;
  checkboxDelegationInstalled = true;
  bodyEl.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-checkbox");
    if (!cb) return;
    const id = Number(cb.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUI();
  });
}

// bindSelectAll() — header checkbox: centang/lepas SEMUA baris di halaman
// saat ini (strict-scope, mirror kelola-soal).
function bindSelectAll() {
  if (!selectAllCheckbox) return;
  selectAllCheckbox.addEventListener("change", () => {
    const start = (currentPage - 1) * rowsPerPage;
    const pageData = filteredResults.slice(start, start + rowsPerPage);
    for (const r of pageData) {
      if (selectAllCheckbox.checked) selectedIds.add(r.id);
      else selectedIds.delete(r.id);
    }
    // Re-render (bukan hanya updateSelectionUI) supaya checkbox ROW ikut
    // menampilkan state checked — mirror kelola-soal.js (select-all handler
    // re-render body; renderTable diakhiri updateSelectionUI).
    reapplyView();
  });
}

// bindClearSelection() — membersihkan seleksi (revisi 2026-08-19):
//   - klik di MANA PUN pada selection pill (termasuk teks "N dipilih")
//   - tombol ✕ di dalam pill (tetap berfungsi; kliknya ikut ter-bubble ke
//     pill handler — clear idempotent, jadi aman dieksekusi dua kali)
//
// WAJIB reapplyView(), bukan sekadar updateSelectionUI(): checkbox ROW
// dirender dari selectedIds di renderTable, jadi state DOM baru sinkron
// setelah tabel di-render ulang (renderTable diakhiri updateSelectionUI
// → pill/header ikut bersih).
function bindClearSelection() {
  const clearSelection = () => {
    selectedIds.clear();
    reapplyView();
  };
  if (selectionPill) {
    selectionPill.addEventListener("click", clearSelection);
  }
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", clearSelection);
  }
}

// bindDeleteActions() — satu modal konfirmasi utk dua alur hapus:
//   single: klik tombol "Hapus" per-row (data-action="delete") → [id]
//   bulk  : klik #scoreboard-bulk-delete-btn → Array.from(selectedIds)
// Konfirmasi: DELETE /api/scoreboard/:id (single) atau
// POST /api/scoreboard/bulk-delete { ids } (bulk) — keduanya requireAdmin.
const deleteModal = document.getElementById("scoreboard-delete-modal");
const deleteTitle = document.getElementById("scoreboard-delete-title");
const deleteDesc = document.getElementById("scoreboard-delete-desc");
const deleteList = document.getElementById("scoreboard-delete-list");
const deleteCancelBtn = document.getElementById("scoreboard-delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("scoreboard-delete-confirm-btn");
let pendingDeleteIds = [];
let isDeleteInFlight = false;

function openDeleteModal(ids) {
  if (!deleteModal) return;
  pendingDeleteIds = ids;
  const rows = ids
    .map((id) => allResults.find((r) => r.id === id))
    .filter(Boolean);
  if (rows.length === 1) {
    const r = rows[0];
    deleteTitle.textContent = "🗑 Konfirmasi Hapus Hasil";
    deleteDesc.textContent = `Anda akan menghapus hasil ujian milik "${r.participant_name}" (paket "${r.question_packs?.name || "-"}", skor ${r.score}, ${r.status}).`;
  } else {
    deleteTitle.textContent = `🗑 Konfirmasi Hapus ${rows.length} Hasil`;
    deleteDesc.textContent = `Anda akan menghapus ${rows.length} hasil ujian berikut:`;
  }
  deleteList.innerHTML = rows
    .map(
      (r) =>
        `<li><strong>${esc(r.participant_name)}</strong> — ${esc(r.question_packs?.name || "-")} · skor ${r.score} · ${esc(r.status)}</li>`,
    )
    .join("");
  deleteModal.showModal();
}

async function confirmDelete() {
  if (isDeleteInFlight || pendingDeleteIds.length === 0) return;
  isDeleteInFlight = true;
  const originalText = deleteConfirmBtn.textContent;
  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.textContent = "Menghapus…";
  try {
    let r;
    if (pendingDeleteIds.length === 1) {
      r = await fetch(`/api/scoreboard/${pendingDeleteIds[0]}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
    } else {
      r = await fetch("/api/scoreboard/bulk-delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pendingDeleteIds }),
      });
    }
    if (r.status === 401) {
      // Sesi admin kedaluwarsa mid-use → sembunyikan seluruh UI admin.
      hideAdminUi();
      deleteModal?.close();
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const deletedSet = new Set(pendingDeleteIds);
    allResults = allResults.filter((row) => !deletedSet.has(row.id));
    for (const id of pendingDeleteIds) selectedIds.delete(id);
    deleteModal?.close();
    reapplyView();
    showNotification(
      "✓ Hapus Berhasil",
      `${data.deleted} hasil ujian telah dihapus.`,
    );
  } catch (err) {
    console.error("[scoreboard] delete failed:", err);
    deleteModal?.close();
    showNotification(
      "❌ Gagal Menghapus",
      "Gagal menghapus hasil ujian. Coba lagi.",
    );
  } finally {
    isDeleteInFlight = false;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = originalText;
  }
}

function bindDeleteActions() {
  // Tombol "Hapus" per-row (single) — delegated click di bodyEl.
  bodyEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='delete']");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (Number.isInteger(id) && id > 0) openDeleteModal([id]);
  });
  // Tombol "Hapus Terpilih" (bulk).
  bulkDeleteBtn?.addEventListener("click", () => {
    if (selectedIds.size === 0) return;
    openDeleteModal(Array.from(selectedIds));
  });
  deleteCancelBtn?.addEventListener("click", () => deleteModal?.close());
  deleteConfirmBtn?.addEventListener("click", confirmDelete);
}

// hideAdminUi() — cabut seluruh UI admin (dipakai saat sesi 401: reset
// maupun delete). Setelah logout/expired, kolom checkbox/Aksi disembunyikan
// lagi dan seleksi dibersihkan.
function hideAdminUi() {
  isAdmin = false;
  selectedIds.clear();
  if (resetScoreboardBtn) resetScoreboardBtn.style.display = "none";
  if (bulkDeleteBtn) bulkDeleteBtn.style.display = "none";
  updateSelectionUI();
  tableEl.classList.remove("admin-mode");
  // Kembalikan sticky No column (kolom pertama saat non-admin).
  document
    .getElementById("scoreboard-no-col")
    ?.classList.add("sticky-col-left");
}

// ====== Admin-only: Reset Scoreboard ======
// Button (#reset-scoreboard-btn) is hidden in markup; shown only when the
// session cookie authenticates as admin (GET /api/admin/me — same pattern
// as theme.js wireAuth). Confirm via the dialog.modal pattern (mirror of
// paket-soal delete-pack modal), then DELETE /api/scoreboard (requireAdmin)
// clears all exam_results — resetting BOTH the scoreboard AND the live
// "Dikerjakan N×" completion_count on paket-soal/select-pack.
const resetScoreboardBtn = document.getElementById("reset-scoreboard-btn");
const resetScoreboardModal = document.getElementById("reset-scoreboard-modal");
const resetScoreboardConfirmBtn = document.getElementById(
  "reset-scoreboard-confirm-btn",
);
const resetScoreboardCancelBtn = document.getElementById(
  "reset-scoreboard-cancel-btn",
);
const resetScoreboardCountEl = document.getElementById(
  "reset-scoreboard-count",
);
let isResetInFlight = false;
// Admin-only UI state (2026-08-11): di-set oleh checkAdmin() setelah
// GET /api/admin/me resolve. Dipakai untuk (a) menampilkan tombol
// Reset Scoreboard dan (b) merender link participant → review.html
// HANYA untuk admin — peserta public melihat nama sebagai teks polos
// (server juga enforce via 403 di /api/exam/:id/results).
let isAdmin = false;

// ====== Notification modal (info-only, single OK button) ======
// Replaces native alert() for reset success feedback (per user request
// 2026-08-11). Mirror of the same pattern in public/js/kelola-soal.js &
// public/js/paket-detail.js. Markup di public/scoreboard.html.
const scoreboardNotificationModal = document.getElementById("notification-modal");
const scoreboardNotificationTitleEl = document.getElementById("notification-title");
const scoreboardNotificationMessageEl = document.getElementById("notification-message");
const scoreboardNotificationOkBtn = document.getElementById("notification-ok-btn");
if (scoreboardNotificationOkBtn) {
  scoreboardNotificationOkBtn.addEventListener("click", () => {
    if (scoreboardNotificationModal) scoreboardNotificationModal.close();
  });
}
function showNotification(title, message) {
  if (!scoreboardNotificationModal) {
    // Fallback if modal markup didn't load.
    alert(message);
    return;
  }
  if (scoreboardNotificationTitleEl) scoreboardNotificationTitleEl.textContent = title;
  if (scoreboardNotificationMessageEl) scoreboardNotificationMessageEl.textContent = message;
  scoreboardNotificationModal.showModal();
}

// ====== Admin check (shared by Reset button + participant links) ======
// GET /api/admin/me with the session cookie. 401/network → isAdmin stays
// false: reset button hidden + participant names render as plain text
// (no deep-link to review.html). Re-renders once resolved so links appear
// even if renderTable already ran before the async fetch completed.
async function checkAdmin() {
  try {
    const res = await fetch("/api/admin/me", { credentials: "same-origin" });
    if (!res.ok) return; // logged out
    const data = await res.json();
    if (!data?.username) return;
    isAdmin = true;
    if (resetScoreboardBtn) resetScoreboardBtn.style.display = "";
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = "";
    // Kolom checkbox/Aksi hanya aktif saat admin (CSS #score-table.admin-mode
    // mengontrol visibilitas .admin-actions). Saat admin, No column TIDAK
    // sticky (checkbox col jadi kolom pertama — mirror kelola-soal).
    tableEl.classList.add("admin-mode");
    document
      .getElementById("scoreboard-no-col")
      ?.classList.remove("sticky-col-left");
    reapplyView();
  } catch (err) {
    console.warn("[scoreboard] auth check failed:", err);
  }
}

function wireAdminReset() {
  if (!resetScoreboardBtn) return;

  resetScoreboardBtn.addEventListener("click", () => {
    resetScoreboardCountEl.textContent = allResults.length
      ? `${allResults.length} hasil ujian akan dihapus permanen.`
      : "Tidak ada hasil ujian yang tercatat saat ini.";
    resetScoreboardModal?.showModal();
  });

  resetScoreboardCancelBtn?.addEventListener("click", () => {
    resetScoreboardModal?.close();
  });

  resetScoreboardConfirmBtn?.addEventListener("click", async () => {
    if (isResetInFlight) return;
    isResetInFlight = true;
    resetScoreboardConfirmBtn.disabled = true;
    resetScoreboardConfirmBtn.textContent = "Mereset…";
    try {
      const r = await fetch("/api/scoreboard", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (r.status === 401) {
        // Session expired mid-use → hide ALL admin UI + close modal.
        hideAdminUi();
        resetScoreboardModal?.close();
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      allResults = [];
      filteredResults = [];
      resetScoreboardModal?.close();
      // Re-render: empty-state "Belum ada data hasil ujian." appears.
      reapplyView();
      showNotification(
        "✓ Reset Berhasil",
        `${data.deleted} hasil ujian telah dihapus. Scoreboard kosong dan counter "Dikerjakan N×" kembali ke 0.`,
      );
      console.log(`[scoreboard] reset done, deleted=${data.deleted ?? 0}`);
    } catch (err) {
      console.error("[scoreboard] reset failed:", err);
      // Tutup modal konfirmasi lalu tampilkan error via modal notifikasi
      // (bukan pesan inline) — konsisten dengan pola kelola-soal/paket-detail.
      resetScoreboardModal?.close();
      showNotification("❌ Gagal Mereset", "Gagal mereset. Coba lagi.");
    } finally {
      isResetInFlight = false;
      resetScoreboardConfirmBtn.disabled = false;
      resetScoreboardConfirmBtn.textContent = "Ya, Reset";
    }
  });
}

init();
