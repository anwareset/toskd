// public/js/scoreboard.js
//
// Spec: scoreboard-pagination-spec.md §6.
// State model: allResults (server cache) → filteredResults (search filter) →
// sorted (comparator) → paginated (slice). Everything client-side. No URL
// sync (Round 2): reload resets state to defaults.
//
// Sort key resolvers (extract the comparable value from a row) and the
// DEFAULT_DIR map give the column's first-click direction (Round 1).
// Stable id-based tiebreak so two rows with identical sort keys never
// shuffle between re-renders (§8.14).

const loadingEl = document.getElementById("loading");
const tableEl = document.getElementById("score-table");
const bodyEl = document.getElementById("score-body");
const emptyEl = document.getElementById("empty-msg");
const controlsTopEl = document.getElementById("controls-top");
const controlsBottomEl = document.getElementById("controls-bottom");

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
    renderTable();
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
    // Stable tiebreak: id ascending so equal-key rows have deterministic
    // ordering across re-renders (§8.14).
    return Number(a.id || 0) - Number(b.id || 0);
  };
}

function renderTable() {
  const start = (currentPage - 1) * rowsPerPage;
  const pageData = filteredResults.slice(start, start + rowsPerPage);
  bodyEl.innerHTML = pageData
    .map((r, i) => {
      const globalIdx = start + i + 1;
      const d = new Date(r.created_at).toLocaleDateString("id-ID");
      const sc = r.status === "Lulus PG" ? "status-pass" : "status-fail";
      // Participant name deep-links to the pembahasan review page.
      // Defensive fallback (r.id missing) preserves the existing tolerant
      // behavior of the previous implementation.
      const nameCell = r.id
        ? `<a class="participant-link" href="/review.html?id=${encodeURIComponent(r.id)}" title="Lihat pembahasan untuk ${esc(r.participant_name)}">${esc(r.participant_name)}</a>`
        : esc(r.participant_name);
      // Spec: kelola-soal-mobile-table-spec §6.2 — sticky-left on the No
      // column only (scoreboard has no Aksi column → no sticky-right).
      return `<tr><td class="sticky-col-left">${globalIdx}</td><td>${nameCell}</td><td>${esc(r.question_packs?.name || "-")}</td><td>${r.score}</td><td class="${sc}">${r.status}</td><td>${d}</td></tr>`;
    })
    .join("");

  tableEl.style.display = "table";
  // Remove `inert` now that the table is renderable.
  tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", false);
  controlsTopEl.style.display = "flex";
  controlsBottomEl.style.display = "flex";
  emptyEl.style.display = "none";
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
  controlsTopEl.style.display = "none";
  controlsBottomEl.style.display = "none";
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

init();
