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

// ============================================================================
// paket-soal-pagination-spec.md §3 — DOM refs + state model
// ============================================================================

// DOM refs (resolved once at script load). All IDs match paket-soal.html.
const tableEl = document.getElementById("pack-table");
const bodyEl = document.getElementById("pack-body");
const loadingEl = document.getElementById("loading");
const emptyMsgEl = document.getElementById("empty-msg");
const controlsTopEl = document.getElementById("controls-top");
const controlsBottomEl = document.getElementById("controls-bottom");
const rowsPerPageTopEl = document.getElementById("rows-per-page-top");
const rowsPerPageBottomEl = document.getElementById("rows-per-page-bottom");
const searchInputEl = document.getElementById("search-input");
const prevPageBtnTopEl = document.getElementById("prev-page-btn-top");
const prevPageBtnBottomEl = document.getElementById("prev-page-btn-bottom");
const nextPageBtnTopEl = document.getElementById("next-page-btn-top");
const nextPageBtnBottomEl = document.getElementById("next-page-btn-bottom");
const pageInfoTopEl = document.getElementById("page-info-top");
const pageInfoBottomEl = document.getElementById("page-info-bottom");
const modal = document.getElementById("pack-modal");
const form = document.getElementById("pack-form");
const modalTitle = document.getElementById("modal-title");

// ==== State (single in-memory object — no URL sync) ====
//
// `currentPage` is 1-indexed (matches "Halaman 1 dari 1" UI text; matches the
// scoreboard-pagination spec precedent). Existing kelola-soal.js uses 0-indexed;
// paket-soal is intentionally different per spec §3.1.
//
// `sortColumn` is "created_at" on first paint (the implicit default per
// interview Round 1: "paket terbaru → terlama"). After a user clicks a
// header, sortColumn becomes one of the 4 SORT_KEYS entries below.
//
// `countsById` is populated by parallel GET /api/packs/<id>/questions
// fetches in init() so the Jumlah Soal column can render + sort by it.
// Existing pre-refactor code used a parallel-array `counts[i]`; the
// keyed-by-id form is more resilient if we ever fetch + sort out of
// order or paginate server-side.
const state = {
  packs: [],
  countsById: {},
  rowsPerPage: 10,
  currentPage: 1,
  searchTerm: "",
  sortColumn: "created_at",
  sortDir: "desc",
};

// ==== Sort key maps (spec §5) ====
//
// `name`/`duration_minutes`/`passing_grade`/`question_count` are the 4
// user-clickable sort columns. `created_at` is NOT in SORT_KEYS because
// there is no visible Tanggal column — it's the implicit default only.
//
// DEFAULT_DIR encodes each column's first-click direction (Round 1: All
// numeric columns "Largest first"; Nama Paket first click is A→Z).
const SORT_KEYS = {
  name: (r) => r.name || "",
  duration_minutes: (r) => Number(r.duration_minutes || 0),
  passing_grade: (r) => Number(r.passing_grade || 0),
  question_count: (r) => Number(state.countsById[r.id] || 0),
};
const DEFAULT_DIR = {
  name: "asc", // A → Z
  duration_minutes: "desc", // longest first
  passing_grade: "desc", // highest first
  question_count: "desc", // most first
};
const DIRECTION_SIGN = { asc: 1, desc: -1 };
const DIR_GLYPH = { asc: " ▲", desc: " ▼" };

// Extractor for the implicit default sort (created_at). Returns ms-since-
// epoch so the comparator's numeric branch handles it cleanly.
const CREATED_AT_EXTRACTOR = (r) =>
  new Date(r.created_at || 0).getTime();

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ============================================================================
// paket-soal-pagination-spec.md §5.3 — Comparator
// ============================================================================
//
// Single global comparator invoking SORT_KEYS for active user-sortable
// columns, or CREATED_AT_EXTRACTOR for the implicit default.
// Tiebreaks by id ascending per Round 3 (deterministic across reloads).
function comparator(a, b) {
  // Primary: active sort value
  let av, bv;
  if (state.sortColumn === "created_at") {
    av = CREATED_AT_EXTRACTOR(a);
    bv = CREATED_AT_EXTRACTOR(b);
  } else {
    av = SORT_KEYS[state.sortColumn]?.(a) ?? 0;
    bv = SORT_KEYS[state.sortColumn]?.(b) ?? 0;
  }

  let cmp;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv), "id", {
      sensitivity: "base",
    });
  }
  if (cmp !== 0) return cmp * DIRECTION_SIGN[state.sortDir];

  // Tiebreak: id ascending (per spec §5.3)
  return Number(a.id) - Number(b.id);
}

// ============================================================================
// paket-soal-pagination-spec.md §3.3 — reapplyView() (the single pipeline)
// ============================================================================
//
// steps: search-filter → sort → paginate → render. Every state mutation
// (search input, sort click, rows-per-page change, page button click)
// converges here. Defined as synchronous after the initial fetch.
function reapplyView() {
  // 1) Search filter (case-insensitive Nama Paket substring only).
  const term = state.searchTerm;
  const source = Array.isArray(state.packs) ? state.packs : [];
  const filtered = source.filter((p) => {
    if (!term) return true;
    return (p.name || "").toLowerCase().includes(term);
  });

  // 2) Sort (STABLE — Array.prototype.sort is stable per ECMA-262 since
  // ES2019, so the comparator's id tiebreak is what gives us full
  // determinism on equal-primary rows).
  filtered.sort(comparator);

  // 3) Paginate.
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.rowsPerPage));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;
  const startIdx = (state.currentPage - 1) * state.rowsPerPage;
  const pageData = filtered.slice(startIdx, startIdx + state.rowsPerPage);

  // 4) Render (body, bars, empty state, sort indicators).
  renderBody(pageData, startIdx);
  renderBars(total, totalPages);
  updateEmptyState(total, term);
  updateSortIndicators();
}

// ==== Render: table body ====
function renderBody(pageData, startIdx) {
  bodyEl.innerHTML = pageData
    .map((p, i) => {
      const count = state.countsById[p.id];
      return `
        <tr>
          <td>${startIdx + i + 1}</td>
          <td title="${esc(p.name)}">${esc(p.name)}</td>
          <td>${p.duration_minutes} Menit</td>
          <td>${p.passing_grade}</td>
          <td>${count ?? 0} Soal</td>
          <td>
            <button class="btn-secondary" onclick="editPack(${p.id})">Edit</button>
            <button class="btn-primary" onclick="location.href='/paket-detail.html?packId=${p.id}'">Lihat Soal</button>
            <button class="btn-danger" onclick="deletePack(${p.id})">Hapus</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// ==== Render: pagination bars ====
function renderBars(total, totalPages) {
  const info = `Halaman ${state.currentPage} dari ${totalPages}`;
  pageInfoTopEl.textContent = info;
  pageInfoBottomEl.textContent = info;

  const atFirst = state.currentPage <= 1;
  const atLast = state.currentPage >= totalPages;
  prevPageBtnTopEl.disabled = atFirst;
  prevPageBtnBottomEl.disabled = atFirst;
  nextPageBtnTopEl.disabled = atLast;
  nextPageBtnBottomEl.disabled = atLast;

  // Show bars iff we have at least one row visible (post-search).
  // Hide bars AND table when total === 0 (empty state owns the screen).
  const hasRows = total > 0;
  controlsTopEl.style.display = hasRows ? "flex" : "none";
  controlsBottomEl.style.display = hasRows ? "flex" : "none";
}

// ==== Render: empty-state message ====
//
// Two distinct messages per Round 3:
//   - truly empty (no packs exist in DB): invitation to add
//   - search yields 0: surface the query in the message for clarity
function updateEmptyState(total, query) {
  if (total > 0) {
    emptyMsgEl.style.display = "none";
    return;
  }
  emptyMsgEl.style.display = "block";
  tableEl.style.display = "none";

  // state.packs.length === 0 means the server returned no packs at all.
  // (If state.packs has rows but filtered is empty, the user is searching.)
  if (state.packs.length === 0) {
    emptyMsgEl.textContent =
      "Belum ada paket soal. Tambah paket baru via tombol di atas.";
  } else {
    emptyMsgEl.textContent = `Tidak ada paket yang cocok dengan pencarian "${query || ""}".`;
  }
}

// ==== Render: sort indicators (spec §8.2) ====
//
// Only the ACTIVE column shows ▲ or ▼. Inactive sortable columns render
// an empty span (the cursor:pointer + hover bg is the affordance).
function updateSortIndicators() {
  document.querySelectorAll("#pack-table th.sortable").forEach((th) => {
    const span = th.querySelector(".sort-indicator");
    if (!span) return;

    // The implicit default "created_at" is NOT a sortable <th> (no
    // matching dataset column), so visually no glyph appears — see
    // spec §15 Open Questions for the rationale.
    if (
      th.dataset.sortColumn === state.sortColumn &&
      SORT_KEYS[state.sortColumn]
    ) {
      span.textContent = DIR_GLYPH[state.sortDir];
      th.setAttribute(
        "aria-sort",
        state.sortDir === "asc" ? "ascending" : "descending"
      );
    } else {
      span.textContent = "";
      th.setAttribute("aria-sort", "none");
    }
  });
}

// ============================================================================
// Spec §3.2 — init() (initial fetch + populate state + first render)
// ============================================================================
async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  controlsTopEl.style.display = "none";
  controlsBottomEl.style.display = "none";
  emptyMsgEl.style.display = "none";

  try {
    const res = await wrapFetch("/api/packs");
    state.packs = await res.json();

    // Parallel: get question count for every pack via /api/packs/<id>/questions.
    // Defensive: if any single count-fetch errors (e.g. transient DB blip),
    // we don't blow up the whole table; we just don't have a number for
    // that pack (rendered as "0 Soal"). wrapFetch will toast 401/5xx and
    // throw; we catch below to keep the partial data visible.
    const countEntries = await Promise.all(
      state.packs.map(async (p) => {
        try {
          const cRes = await wrapFetch(`/api/packs/${p.id}/questions`);
          const qs = await cRes.json();
          return [p.id, Array.isArray(qs) ? qs.length : 0];
        } catch (e) {
          // Treat 401 / 5xx throw same as the parent catch (already toasted).
          if (
            e.message === "wrapFetch:SESSION_EXPIRED" ||
            e.message.startsWith("wrapFetch:SERVER_ERROR_")
          ) {
            throw e; // bubble up — parent's catch handles
          }
          // Non-toast error: store 0 and continue so the table can still
          // render the OTHER packs.
          console.warn(
            `[paket-soal] failed to fetch count for pack ${p.id}:`,
            e
          );
          return [p.id, 0];
        }
      })
    );
    state.countsById = Object.fromEntries(countEntries);

    loadingEl.style.display = "none";
    tableEl.style.display = "table";
    reapplyView();
  } catch (e) {
    if (
      e.message === "wrapFetch:SESSION_EXPIRED" ||
      e.message.startsWith("wrapFetch:SERVER_ERROR_")
    )
      return;
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat paket soal.</p>';
  }
}

// ============================================================================
// Event listeners — header sort, rows-per-page, prev/next, search
// ============================================================================

// --- Header click delegation ---
// Attached ONCE on <thead>; survives innerHTML re-renders of <tbody>.
// Same handler reused by keydown (Enter/Space on focused <th>).
const theadEl = tableEl.querySelector("thead");
theadEl.addEventListener("click", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th) return;
  const col = th.dataset.sortColumn;
  if (!col || !SORT_KEYS[col]) return;

  if (state.sortColumn === col) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortColumn = col;
    state.sortDir = DEFAULT_DIR[col];
  }
  state.currentPage = 1;
  reapplyView();
});

// --- Header keyboard (Enter/Space activates the focused <th>) ---
theadEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const th = e.target.closest("th.sortable");
  if (!th) return;
  e.preventDefault(); // Enter shouldn't submit, Space shouldn't scroll
  th.click(); // reuse click handler (single source of truth)
});

// --- Rows-per-page (top + bottom, synced) ---
rowsPerPageTopEl.addEventListener("change", (e) => {
  const v = parseInt(e.target.value, 10);
  state.rowsPerPage = Number.isFinite(v) && v > 0 ? v : 10;
  rowsPerPageBottomEl.value = String(state.rowsPerPage);
  state.currentPage = 1;
  reapplyView();
});
rowsPerPageBottomEl.addEventListener("change", (e) => {
  const v = parseInt(e.target.value, 10);
  state.rowsPerPage = Number.isFinite(v) && v > 0 ? v : 10;
  rowsPerPageTopEl.value = String(state.rowsPerPage);
  state.currentPage = 1;
  reapplyView();
});

// --- Page prev/next (clamped; respects current filter) ---
function gotoPage(delta) {
  const term = state.searchTerm;
  const filtered = (state.packs || []).filter((p) =>
    !term || (p.name || "").toLowerCase().includes(term)
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / state.rowsPerPage)
  );
  if (delta === -1 && state.currentPage > 1) state.currentPage--;
  if (delta === +1 && state.currentPage < totalPages) state.currentPage++;
  reapplyView();
}
prevPageBtnTopEl.addEventListener("click", () => gotoPage(-1));
prevPageBtnBottomEl.addEventListener("click", () => gotoPage(-1));
nextPageBtnTopEl.addEventListener("click", () => gotoPage(+1));
nextPageBtnBottomEl.addEventListener("click", () => gotoPage(+1));

// --- Search (live, no debounce — dataset is small; reapplyView is O(N log N) max) ---
searchInputEl.addEventListener("input", (e) => {
  state.searchTerm = e.target.value.trim().toLowerCase();
  state.currentPage = 1;
  reapplyView();
});

// ============================================================================
// Add / Edit / Delete modal handlers — UNCHANGED from pre-refactor
// ============================================================================

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
    if (
      err.message === "wrapFetch:SESSION_EXPIRED" ||
      err.message.startsWith("wrapFetch:SERVER_ERROR_")
    )
      return;
    alert("Gagal menyimpan paket soal.");
  }
};

window.editPack = (id) => {
  const p = state.packs.find((x) => x.id === id);
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
    if (
      err.message === "wrapFetch:SESSION_EXPIRED" ||
      err.message.startsWith("wrapFetch:SERVER_ERROR_")
    )
      return;
    alert("Gagal menghapus paket soal.");
  }
};

// Kick off the initial load.
init();
