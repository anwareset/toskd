const filterEl = document.getElementById("pack-filter");
const sortFilterEl = document.getElementById("sort-filter");
const loadingEl = document.getElementById("loading");
const tableEl = document.getElementById("score-table");
const bodyEl = document.getElementById("score-body");
const emptyEl = document.getElementById("empty-msg");
const pagEl = document.getElementById("pagination");
let allResults = [],
  currentPage = 1;
const perPage = 20;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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
    loadData();
  };
  sortFilterEl.onchange = () => {
    currentPage = 1;
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
      return;
    }
    tableEl.style.display = "table";
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
      return `<tr><td>${s + i + 1}</td><td>${esc(r.participant_name)}</td><td>${esc(r.question_packs?.name || "-")}</td><td>${r.score}</td><td class="${sc}">${r.status}</td><td>${d}</td></tr>`;
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
  renderPage();
};
init();
