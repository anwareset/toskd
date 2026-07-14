const filterEl = document.getElementById("pack-filter");
const sortFilterEl = document.getElementById("sort-filter");
const loadingEl = document.getElementById("loading");
const tableEl = document.getElementById("score-table");
const bodyEl = document.getElementById("score-body");
const emptyEl = document.getElementById("empty-msg");
const pagEl = document.getElementById("pagination");
let allResults = [],
  currentPage = pageFromUrl();
const perPage = 20;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ===== URL ↔ pagination state sync =====
// Read ?page=N from the URL. parseInt returns NaN for non-numeric /
// empty strings; guard with Number.isFinite + > 0 so we fall back to
// page 1 for ?page=0, ?page=abc, or no param at all.
function pageFromUrl() {
  const p = parseInt(new URLSearchParams(location.search).get("page"), 10);
  return Number.isFinite(p) && p > 0 ? p : 1;
}
// Mirror currentPage into the URL. We omit ?page=1 entirely so the
// canonical URL stays /scoreboard.html (bookmarkable, matches the
// server's static-file lookup). Use replaceState for state corrections
// (initial clamp, filter resets) and pushState for user-initiated
// navigation (pag button clicks) so browser back traverses them.
function setPageInUrl(page, { replace = false } = {}) {
  const url = new URL(location.href);
  if (page > 1) url.searchParams.set("page", page);
  else url.searchParams.delete("page");
  const state = { page };
  if (replace) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
}

async function init() {
  const r = await fetch("/api/packs");
  const packs = await r.json();
  filterEl.innerHTML =
    '<option value="">Semua Paket</option>' +
    packs
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join("");
  filterEl.onchange = () => {
    currentPage = 1;
    // Pack filter changes the result set — page=1 is meaningless for
    // the new set. replaceState (don't pollute history) so the user's
    // back-button goes to wherever they came from, not to a stale
    // ?page=N on the previous pack.
    setPageInUrl(1, { replace: true });
    loadData();
  };
  sortFilterEl.onchange = () => {
    currentPage = 1;
    setPageInUrl(1, { replace: true });
    sortData();
    renderPage();
  };
  loadData();
}

function sortData() {
  const sortBy = sortFilterEl.value;
  if (sortBy === "score_desc") {
    allResults.sort((a, b) => b.score - a.score);
  } else if (sortBy === "date_desc") {
    allResults.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

async function loadData() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  emptyEl.style.display = "none";
  const pid = filterEl.value;
  const url = pid
    ? `/api/scoreboard-all?pack_id=${pid}`
    : "/api/scoreboard-all";
  try {
    const r = await fetch(url);
    allResults = await r.json();
    sortData();
    loadingEl.style.display = "none";
    if (!allResults.length) {
      emptyEl.style.display = "block";
      pagEl.innerHTML = "";
      // Mirror the same clamp discipline as the data-present branch:
      // ?page=2 on an empty result set should not leave a stale page
      // bookmark when the user reloads it later. Hard reset to 1.
      if (currentPage > 1) {
        currentPage = 1;
        setPageInUrl(1, { replace: true });
      }
      return;
    }
    tableEl.style.display = "table";
    // Clamp currentPage to the actual data range. Deep-linking with
    // ?page=99 when only 1 page exists must land on page 1 (or the
    // last page if data shrank since the URL was bookmarked), not
    // render an empty table. replaceState (not pushState) so the
    // correction isn't a new history step on top of the user's
    // already-recorded entry.
    const tp = Math.ceil(allResults.length / perPage);
    if (currentPage > tp) {
      currentPage = tp;
      setPageInUrl(tp, { replace: true });
    }
    renderPage();
  } catch (e) {
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat data.</p>';
  }
}

function renderPage() {
  const s = (currentPage - 1) * perPage;
  const pg = allResults.slice(s, s + perPage);
  bodyEl.innerHTML = pg
    .map((r, i) => {
      const d = new Date(r.created_at).toLocaleDateString("id-ID");
      const sc = r.status === "Lulus PG" ? "status-pass" : "status-fail";
      // Wrap participant name in a link to /review.html?id=<id> so
      // clicking the row's most meaningful cell opens the pembahasan
      // for that candidate. Defensive: fall back to plain text if id
      // is missing (shouldn't happen — exam_results.id is an IDENTITY
      // PK — but graceful no-op avoids a broken <a href>).
      const nameCell = r.id
        ? `<a class="participant-link" href="/review.html?id=${encodeURIComponent(r.id)}" title="Lihat pembahasan untuk ${esc(r.participant_name)}">${esc(r.participant_name)}</a>`
        : esc(r.participant_name);
      return `<tr><td>${s + i + 1}</td><td>${nameCell}</td><td>${esc(r.question_packs?.name || "-")}</td><td>${r.score}</td><td class="${sc}">${r.status}</td><td>${d}</td></tr>`;
    })
    .join("");
  const tp = Math.ceil(allResults.length / perPage);
  pagEl.innerHTML =
    tp <= 1
      ? ""
      : Array.from(
          { length: tp },
          (_, i) =>
            `<button class="${i + 1 === currentPage ? "btn-primary" : "btn-secondary"}" onclick="goPage(${i + 1})">${i + 1}</button>`,
        ).join("");
}
window.goPage = (p) => {
  currentPage = p;
  // pushState so each page click becomes a history entry — that's
  // what gives us browser-back navigation between pages within the
  // scoreboard (popstate handler below reads the new page from URL).
  setPageInUrl(p);
  renderPage();
};

// Same-document history navigation: when the user back-buttons
// across pushState entries we wrote in goPage(), the URL changes but
// the document doesn't reload. Re-read the page from the URL and
// re-render against the already-loaded allResults. Skip if data
// hasn't loaded yet — the initial load path (init() → loadData())
// reads ?page= on its own, so there's nothing to do here.
window.addEventListener("popstate", () => {
  if (!allResults.length) return;
  const urlPage = pageFromUrl();
  const tp = Math.ceil(allResults.length / perPage);
  currentPage = Math.max(1, Math.min(urlPage, tp));
  renderPage();
});
init();
