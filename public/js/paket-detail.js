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

// Pagination & Search State
let bankRowsPerPage = 10;
let bankCurrentPage = 0;
let bankSearchTerm = "";

// tentativeSelections — Set<number> of question IDs the user has ticked
// for add-to-pack. Outlives each renderBankList()'s innerHTML rewrite so
// selections persist across page changes, search filter changes, and
// rows-per-page changes. Reset on full page reload only.
//
// Single source of truth for "is this question selected to be added?"
// across the UI: updateAddButtonLabel reads Set.size; the render template
// applies `checked` attribute when Set.has(id); addBtn.onclick reads
// checked = Array.from(Set).filter(availableIds.has). After successful
// add, the loop's success-count prefixes are deleted from Set so
// re-render doesn't re-check them.
let tentativeSelections = new Set();

// packSelectedIds — Set<number> of question IDs the user has ticked in
// the pack-questions-list for bulk remove. Persistent across
// renderLists()'s innerHTML rewrite so per-row checkbox state stays
// in sync with render template (`checked` attribute when Set.has(id)).
// Cleared (partially or fully) by the bulk-remove confirm handler after
// each DELETE resolves, mirroring the tentativeSelections lifecycle for
// add-to-pack. Used by updatePackSelectionUI() for the count display,
// the select-all 3-state checkbox, and the bulk-remove button's
// disabled flag.
let packSelectedIds = new Set();

// ==== Pack-list / bulk-remove element refs ====
// Declared at top-level so handlers below can reference them. Mirrors
// the single-delete-confirm-modal pattern (kelola-soal.html /
// paket-soal.html): the modal popup is a sibling <dialog> in
// paket-detail.html (mirrors .bulk-delete-summary layout); pending data
// bridges the open handler (clicking bulk-remove button) and the
// confirm handler (running the DELETE loop). Note: no
// `isPackBulkRemoveInFlight` flag — the click handler is fully
// synchronous before showModal() (no awaits; all data from cached
// packQuestions), so a fast double-click is prevented by showModal()'s
// dialog inertness, NOT by a flag. Per code-reviewer Round-1 feedback
// #2.
const bankSelectAllCheckbox = document.getElementById("bank-select-all-checkbox");
const bankSelectAllCheckboxBottom = document.getElementById("bank-select-all-checkbox-bottom");
const packSelectAllCheckbox = document.getElementById("pack-select-all-checkbox");
const packSelectAllCheckboxBottom = document.getElementById("pack-select-all-checkbox-bottom");
const packSelectionCountEl = document.getElementById("pack-selection-count");
const bulkRemoveBtn = document.getElementById("bulk-remove-pack-btn");
const bulkRemoveCountEl = document.getElementById("bulk-remove-pack-count");
const bulkRemoveConfirmModal = document.getElementById("bulk-remove-confirm-modal");
const bulkRemoveModalConfirmBtn = document.getElementById("bulk-remove-confirm-btn");
const bulkRemoveModalCancelBtn = document.getElementById("bulk-remove-cancel-btn");
const bulkRemoveConfirmCountEl = document.getElementById("bulk-remove-confirm-count");
const bulkRemoveModalCountEl = document.getElementById("bulk-remove-modal-count");
const bulkRemovePackListEl = document.getElementById("bulk-remove-pack-list");
const loadingPackAdd = document.getElementById("loading-pack-add");

// ==== Notification modal (info-only, single OK button) ====
// Replaces native alert() for SUCCESS notifications in this file
// (per user request 2026-07-20). Errors that wrapFetch hasn't already
// shown as toast (SESSION_EXPIRED / SERVER_ERROR_) still use alert()
// because they may need to interrupt user attention; success messages
// are informational and pair naturally with a dismissable modal.
const notificationModal = document.getElementById("notification-modal");
const notificationTitleEl = document.getElementById("notification-title");
const notificationMessageEl = document.getElementById("notification-message");
const notificationOkBtn = document.getElementById("notification-ok-btn");
if (notificationOkBtn) {
  notificationOkBtn.addEventListener("click", () => {
    if (notificationModal) notificationModal.close();
  });
}
function showNotification(title, message) {
  if (!notificationModal) {
    // Fallback if modal markup didn't load — keep behavior identical to
    // old native alert so admin still sees the notification.
    alert(message);
    return;
  }
  if (notificationTitleEl) notificationTitleEl.textContent = title;
  if (notificationMessageEl) notificationMessageEl.textContent = message;
  notificationModal.showModal();
}

// ==== Usage modal (chip "Dipakai" di option-item bank list) ====
// Menampilkan daftar paket soal LAIN yang memakai sebuah soal. Reuse
// komponen dialog.modal — pattern notification-modal (single OK).
// JS: openUsageModal() di bawah. See paket-detail-usage-chip-spec.md.
const usageModal = document.getElementById("usage-modal");
const usageModalTitle = document.getElementById("usage-modal-title");
const usageModalBody = document.getElementById("usage-modal-body");
const usageModalOkBtn = document.getElementById("usage-modal-ok-btn");
if (usageModalOkBtn) {
  usageModalOkBtn.addEventListener("click", () => {
    if (usageModal) usageModal.close();
  });
}

// questionUsage — cache Map<id, { used, packs }> dari POST
// /api/questions/bulk-usage (satu round-trip per chunk, endpoint cap 1000
// ids/request). Usage TIDAK berubah selama halaman terbuka: bank list
// mengecualikan paket saat ini (add/remove hanya menyentuh paket ini),
// jadi fetch sekali saat init cukup dan tetap akurat.
const questionUsage = new Map();

// Fetch usage SEMUA soal bank dalam chunk PARALEL (Promise.all). Kegagalan
// TIDAK menggagalkan halaman — chip "Dipakai" saja yang tidak muncul
// (caller catch). Pakai fetch polos (bukan wrapFetch) supaya kegagalan
// non-kritikal tidak memunculkan toast "Server error" yang menyesatkan
// saat halaman sebenarnya tetap jalan.
async function fetchQuestionUsage(ids) {
  const CHUNK = 400;
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(ids.slice(i, i + CHUNK));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch("/api/questions/bulk-usage", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = await res.json();
      for (const [idStr, usage] of Object.entries(map)) {
        questionUsage.set(parseInt(idStr, 10), usage);
      }
    }),
  );
}

// Chip "Dipakai" untuk soal yang terpakai di paket soal LAIN (mirror
// .bank-timestamp tapi bisa diklik). Bank list mengecualikan paket saat
// ini, jadi packs dari usage endpoint = paket lain saja. Klik → modal
// daftar paket; hover/focus → tooltip daftar paket. Tidak dirender jika
// soal tidak terpakai di paket lain.
function renderUsageChip(q) {
  const usage = questionUsage.get(parseInt(q.id, 10));
  const packs = usage?.packs || [];
  if (packs.length === 0) return "";
  return `
      <span class="bank-usage-wrap">
        <button type="button" class="bank-usage-chip" data-q-id="${q.id}"
          aria-label="Soal dipakai di ${packs.length} paket soal lain. Klik untuk melihat daftar.">
          Dipakai
        </button>
        <span class="bank-usage-tooltip" role="tooltip">
          <strong>Dipakai di ${packs.length} paket soal:</strong>
          <ul>${packs.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        </span>
      </span>`;
}

// Modal daftar paket yang memakai soal (pattern notification-modal).
function openUsageModal(packs) {
  if (!usageModal) return;
  if (usageModalTitle) usageModalTitle.textContent = "📦 Dipakai di Paket Soal";
  if (usageModalBody) {
    if (!packs.length) {
      usageModalBody.innerHTML =
        '<p style="margin: 0">Soal ini tidak digunakan di paket soal lain.</p>';
    } else {
      usageModalBody.innerHTML =
        `<p style="margin: 0 0 10px; color: var(--text-muted)">` +
        `Soal ini dipakai di ${packs.length} paket soal:</p>` +
        `<ul style="margin: 0 0 0 18px; padding: 0">${packs
          .map((n) => `<li>${esc(n)}</li>`)
          .join("")}</ul>`;
    }
  }
  usageModal.showModal();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Render any \( ... \) or \[ ... \] LaTeX delimiters inside the given
// element. Safe to call when MathJax is not yet loaded — guarded by the
// optional chain. `.catch(() => {})` ensures a single failed typeset
// (e.g. transient error) doesn't break the rest of the page render.
// Quill formula <span>s already render via their stored KaTeX HTML and
// do not require an explicit re-typeset call.
function typesetMath(rootEl) {
  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([rootEl]).catch(() => {});
  }
}

// previewHtmlForCell — imported from public/js/bulk-parser.js via the
// globalThis.bulkParser side-effect (see <script type="module"
// src="/js/bulk-parser.js"> in kelola-soal.html — same script is
// implicitly available on paket-detail.html via the shared layout).
// Strip block elements (<ol>, <img>) from a Quill-rendered HTML
// string and replace with compact inline markers so the preview
// cells in the bank list and pack list stay 1-line. See
// bulk-parser.js for the full implementation and rationale
// (spec: bulk-add-format-v2-spec.md §10.1).
//
// We re-bind to a local const for readability at call sites:
//   const cell = previewHtmlForCell(q.content);

// Bank-row timestamp chip helpers (per user request 2026-07-18).
// formatIndonesianRelative -- Indonesian relative-time phrases:
// 'baru saja' -> 'X menit lalu' -> 'X jam lalu' -> 'X hari lalu' ->
// 'X minggu lalu' -> 'X bulan lalu' -> 'X tahun lalu'. Granularity
// tiers by diff between now() and the ISO timestamp. Defensive
// against missing/invalid date (returns fallback string instead
// of 'NaN hari lalu' breaking the row).
function formatIndonesianRelative(isoString) {
  if (!isoString) return "baru saja";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "tanggal tidak valid";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + " menit lalu";
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour + " jam lalu";
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return diffDay + " hari lalu";
  if (diffDay < 30) return Math.floor(diffDay / 7) + " minggu lalu";
  if (diffDay < 365) return Math.floor(diffDay / 30) + " bulan lalu";
  return Math.floor(diffDay / 365) + " tahun lalu";
}

// formatIndonesianFull -- Indonesian-locale full timestamp for hover
// tooltip on the chip. Browser-native toLocaleString handles timezone
// conversion to admin's local zone (typically WIB GMT+7).
// dateStyle:medium + timeStyle:short gives a concise but unambiguous
// format. Returns empty string for missing/invalid dates so the
// tooltip simply does not show instead of showing 'Invalid Date'.
function formatIndonesianFull(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

async function init() {
  document.getElementById("loading-bank").style.display = "flex";
  document.getElementById("loading-pack").style.display = "flex";
  try {
    const [pRes, pqRes, aqRes] = await Promise.all([
      wrapFetch(`/api/packs/${packId}`),
      wrapFetch(`/api/packs/${packId}/questions`),
      wrapFetch("/api/questions"),
    ]);
    pack = await pRes.json();
    packQuestions = await pqRes.json();
    allQuestions = await aqRes.json();
    // Bank list order: newest-added soal first (per user request
    // 2026-07-18). Server GET /api/questions has no ORDER BY clause so
    // client-side sort is the only place to enforce a deterministic
    // chronological-feeling list. Defensive `|| 0` epoch fallback for
    // rows missing `created_at` (legacy or future migration edge
    // cases). Same pattern as kelola-soal.js line 685 + paket-soal.js
    // `sortColumn: "created_at"` default — consistent across pages.
    // In-place `.sort()` mutates the array reference that renderBankList
    // iterates from, so all downstream filter/search/pagination sees
    // the ordered list with no extra variable to maintain.
    allQuestions.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );

    // Fetch usage (paket mana saja yang memakai tiap soal) untuk chip
    // "Dipakai" di option-item. Gagal di sini TIDAK menggagalkan halaman
    // — chip saja yang tidak muncul (paket-detail-usage-chip-spec.md).
    try {
      await fetchQuestionUsage(allQuestions.map((q) => q.id));
    } catch (err) {
      console.error("Fetch question usage failed:", err);
    }

    packTitle.textContent = pack.name;
    const subLabels = (
      Array.isArray(pack.subtests) && pack.subtests.length
        ? pack.subtests
        : ["TWK", "TIU", "TKP"]
    )
      .map((s) => s.toUpperCase())
      .join(" + ");
    // Subtitle: tidak ada lagi Single/Combo wording — cukup tampilkan
    // daftar subtes yang dipilih admin (1-3 token, dipisah ' + ').
    // Legacy packs tanpa subtests default ke 3 subtes.
    packSubtitle.textContent = `⏱️ Durasi: ${pack.duration_minutes} Menit | Passing Grade: ${pack.passing_grade} | Subtes: ${subLabels}`;

    document.getElementById("loading-bank").style.display = "none";
    document.getElementById("loading-pack").style.display = "none";

    renderLists();
  } catch (e) {
    if (e.message === "wrapFetch:SESSION_EXPIRED" || e.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal memuat detail paket.");
  }
}

function renderBankList() {
  const packIds = new Set(packQuestions.map((q) => q.id));
  let available = allQuestions.filter((q) => !packIds.has(q.id));

  // Pack-subtests filter (Single/Combo dropdown in paket-soal.html).
  // Default to all 3 if pack.subtests is missing (legacy packs).
  const packSubtests =
    Array.isArray(pack?.subtests) && pack.subtests.length
      ? pack.subtests
      : ["TWK", "TIU", "TKP"];
  available = available.filter((q) => {
    const qt = String(q.question_type || "").trim().toUpperCase();
    return packSubtests.some((p) => qt.startsWith(p));
  });

  // Apply search filter
  if (bankSearchTerm) {
    const term = bankSearchTerm.toLowerCase();
    available = available.filter((q) => {
      const contentText = (q.content || "")
        .replace(/<[^>]*>/g, "")
        .toLowerCase();
      const typeText = (q.question_type || "").toLowerCase();
      return contentText.includes(term) || typeText.includes(term);
    });
  }

  const totalPages = Math.ceil(available.length / bankRowsPerPage) || 1;
  if (bankCurrentPage >= totalPages) bankCurrentPage = totalPages - 1;
  if (bankCurrentPage < 0) bankCurrentPage = 0;

  // Update page info
  const pageInfo = `Halaman ${bankCurrentPage + 1} dari ${totalPages}`;
  document.getElementById("bank-page-info-top").textContent = pageInfo;
  document.getElementById("bank-page-info-bottom").textContent = pageInfo;

  // Enable/disable buttons
  const isFirst = bankCurrentPage === 0;
  const isLast = bankCurrentPage >= totalPages - 1;
  document.getElementById("bank-prev-btn-top").disabled = isFirst;
  document.getElementById("bank-prev-btn-bottom").disabled = isFirst;
  document.getElementById("bank-next-btn-top").disabled = isLast;
  document.getElementById("bank-next-btn-bottom").disabled = isLast;

  // Slice for current page
  const start = bankCurrentPage * bankRowsPerPage;
  const pageData = available.slice(start, start + bankRowsPerPage);

  if (!available.length) {
    bankList.innerHTML =
      '<p style="color:var(--text-muted);padding:12px">Semua soal sudah dimasukkan ke paket ini.</p>';
  } else if (!pageData.length) {
    bankList.innerHTML =
      '<p style="color:var(--text-muted);padding:12px">Tidak ada soal yang cocok.</p>';
  } else {
    bankList.innerHTML = pageData
      .map((q) => {
        const ts = formatIndonesianFull(q.created_at);
        return `
      <label class="option-item" style="cursor:pointer;background:var(--surface);margin-bottom:8px">
        <input type="checkbox" name="add-q" value="${q.id}"${tentativeSelections.has(parseInt(q.id, 10)) ? " checked" : ""}>
        <span class="option-label">
          <strong>[${esc(q.question_type.toUpperCase())}]</strong> ${window.bulkParser.previewHtmlForCell(q.content)}
        </span>
        <span class="bank-timestamp-wrap">
          <time class="bank-timestamp" datetime="${esc(q.created_at || "")}" aria-label="Ditambahkan ${esc(formatIndonesianRelative(q.created_at))}${ts ? `. ${ts}` : ""}">🕐 ${esc(formatIndonesianRelative(q.created_at))}</time>
          ${ts ? `<span class="bank-timestamp-tooltip" role="tooltip"><strong>Ditambahkan</strong>${esc(ts)}</span>` : ""}
        </span>
        ${renderUsageChip(q)}
      </label>
    `;
      })
      .join("");
    typesetMath(bankList);
    updateAddButtonLabel();
    updateBankSelectAllState();
  }

  // Show/hide controls
  const controlsTop = document.getElementById("bank-controls-top");
  const controlsBottom = document.getElementById("bank-controls-bottom");
  if (allQuestions.length > 0) {
    controlsTop.style.display = "flex";
    controlsBottom.style.display = "flex";
  } else {
    controlsTop.style.display = "none";
    controlsBottom.style.display = "none";
  }
}

function renderLists() {
  renderBankList();

  // Render Pack questions
  if (!packQuestions.length) {
    packList.innerHTML =
      '<p style="color:var(--text-muted);padding:24px;text-align:center">Belum ada soal dalam paket ini.</p>';
    saveBtn.disabled = true;
  } else {
    packList.innerHTML = packQuestions
      .map(
        (q, i) => `
      <div class="pack-question-item" draggable="true" data-id="${q.id}" data-index="${i}">
        <input type="checkbox" class="pack-row-checkbox" data-q-id="${q.id}"${packSelectedIds.has(q.id) ? " checked" : ""} aria-label="Pilih soal #${i + 1}">
        <span class="q-num">Soal ${i + 1}</span>
        <span class="q-preview">${window.bulkParser.previewHtmlForCell(q.content)}</span>
        <button class="btn-danger" style="padding:4px 8px;font-size:0.8rem" onclick="removeQuestion(${q.id})">Hapus</button>      </div>
    `,
      )
      .join("");
    typesetMath(packList);
    setupDragAndDrop();
  }

  // Sync count display + select-all 3-state + bulk-remove button after
  // every render (mandatory because renderLists rebuilds the DOM, so
  // delegated `change` events on packList re-derive packSelectedIds from
  // the rendered checkbox state). updatePackSelectionUI() also syncs
  // bulk-remove button + count text + select-all indeterminate.
  updatePackSelectionUI();
}

// updateBankSelectAllState — mirrors updateSelectionUI() in kelola-soal.js
// but scoped to bank-list. Computes 3-state (checked / unchecked /
// indeterminate) for BOTH the top + bottom header select-all
// checkboxes based on how many of the CURRENT PAGE'S row checkboxes
// are checked (per user request 2026-07-20: select-all di atas dan
// bawah). Note the Set (tentativeSelections) authors state on a
// per-id basis but the header checkboxes are UI affordances for the
// CURRENT PAGE ONLY — when a user pages away, the Set retains their
// selections but the headers re-sync against the new page's
// checkboxes. Called by:
//   - The delegated change handler in bankList (per-row toggle)
//   - The select-all change handlers (after proving the visible rows)
//   - renderBankList() at every page change / filter change
function updateBankSelectAllState() {
  const cbs = bankList.querySelectorAll('input[name="add-q"]');
  const total = cbs.length;
  const checked = Array.from(cbs).filter((cb) => cb.checked).length;
  let state;
  if (total === 0 || checked === 0) state = { indeterminate: false, checked: false };
  else if (checked === total) state = { indeterminate: false, checked: true };
  else state = { indeterminate: true, checked: false };
  if (bankSelectAllCheckbox) {
    bankSelectAllCheckbox.indeterminate = state.indeterminate;
    bankSelectAllCheckbox.checked = state.checked;
  }
  if (bankSelectAllCheckboxBottom) {
    bankSelectAllCheckboxBottom.indeterminate = state.indeterminate;
    bankSelectAllCheckboxBottom.checked = state.checked;
  }
}

// updatePackSelectionUI — mirror of updateSelectionUI() for the pack-list.
// Pack-list is single-page (no pagination), so the select-all checkbox
// reflects packSelectedIds.size === packQuestions.length instead of a
// per-page slice. Reads from packSelectedIds (state) NOT from rendered
// DOM, so packSelectedIds must be the source of truth for both the
// row checkboxes (rendered from Set.has(id)) and the count UI (from
// Set.size). Called by:
//   - renderLists() at every render (post-rebuild sync)
//   - The delegated change handler in packList (per-row toggle)
//   - The select-all change handler (after toggling all ids)
function updatePackSelectionUI() {
  const total = packSelectedIds.size;
  if (packSelectionCountEl) {
    packSelectionCountEl.textContent =
      total === 0 ? "0 dipilih" : `${total} dipilih`;
  }
  if (bulkRemoveCountEl) bulkRemoveCountEl.textContent = total;
  if (bulkRemoveBtn) bulkRemoveBtn.disabled = total === 0;
  // Sync both top + bottom pack-select-all checkboxes in a single
  // pass (per user request 2026-07-20: select-all di atas dan bawah).
  // Both checkboxes derive their 3-state from the same packSelectedIds
  // (source of truth) — looping over an array of refs prevents future
  // state-divergence bugs if the 3-state logic ever changes here.
  // DRY pattern mirrors updateBankSelectAllState() above.
  for (const cb of [packSelectAllCheckbox, packSelectAllCheckboxBottom]) {
    if (!cb) continue;
    if (total === 0) {
      cb.indeterminate = false;
      cb.checked = false;
    } else if (total === packQuestions.length) {
      cb.indeterminate = false;
      cb.checked = true;
    } else {
      cb.indeterminate = true;
      cb.checked = false;
    }
  }
}

// Pagination Event Listeners
document
  .getElementById("bank-rows-per-page-top")
  .addEventListener("change", (e) => {
    bankRowsPerPage = parseInt(e.target.value);
    document.getElementById("bank-rows-per-page-bottom").value = e.target.value;
    bankCurrentPage = 0;
    renderBankList();
  });

document
  .getElementById("bank-rows-per-page-bottom")
  .addEventListener("change", (e) => {
    bankRowsPerPage = parseInt(e.target.value);
    document.getElementById("bank-rows-per-page-top").value = e.target.value;
    bankCurrentPage = 0;
    renderBankList();
  });

document.getElementById("bank-prev-btn-top").addEventListener("click", () => {
  if (bankCurrentPage > 0) {
    bankCurrentPage--;
    renderBankList();
  }
});

document
  .getElementById("bank-prev-btn-bottom")
  .addEventListener("click", () => {
    if (bankCurrentPage > 0) {
      bankCurrentPage--;
      renderBankList();
    }
  });

document.getElementById("bank-next-btn-top").addEventListener("click", () => {
  const packIds = new Set(packQuestions.map((q) => q.id));
  let avail = allQuestions.filter((q) => !packIds.has(q.id));
  if (bankSearchTerm) {
    const term = bankSearchTerm.toLowerCase();
    avail = avail.filter((q) => {
      const ct = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
      const tt = (q.question_type || "").toLowerCase();
      return ct.includes(term) || tt.includes(term);
    });
  }
  const totalPages = Math.ceil(avail.length / bankRowsPerPage) || 1;
  if (bankCurrentPage < totalPages - 1) {
    bankCurrentPage++;
    renderBankList();
  }
});

document
  .getElementById("bank-next-btn-bottom")
  .addEventListener("click", () => {
    const packIds = new Set(packQuestions.map((q) => q.id));
    let avail = allQuestions.filter((q) => !packIds.has(q.id));
    if (bankSearchTerm) {
      const term = bankSearchTerm.toLowerCase();
      avail = avail.filter((q) => {
        const ct = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
        const tt = (q.question_type || "").toLowerCase();
        return ct.includes(term) || tt.includes(term);
      });
    }
    const totalPages = Math.ceil(avail.length / bankRowsPerPage) || 1;
    if (bankCurrentPage < totalPages - 1) {
      bankCurrentPage++;
      renderBankList();
    }
  });

document.getElementById("bank-search-input").addEventListener("input", (e) => {
  bankSearchTerm = e.target.value;
  bankCurrentPage = 0;
  renderBankList();
});

// ============================================================================
// updateAddButtonLabel — count-aware button text (spec §4.4). Reads the
// current count of checked `add-q` checkboxes and rewrites addBtn.textContent.
// N=0 keeps the default Indonesian label; N>=1 inserts the count.
// ============================================================================
function updateAddButtonLabel() {
  // Read from tentativeSelections (the Set), not live DOM, so the label
  // reflects the user's TOTAL checked count across ALL pages / filter
  // states \u2014 not just checkboxes currently rendered.
  const n = tentativeSelections.size;
  const longLabel =
    n === 0
      ? "Masukkan Soal Terpilih ke Paket"
      : `Masukkan ${n} Soal Terpilih ke Paket`;
  const shortLabel =
    n === 0 ? "Masukkan ke Paket" : `Masukkan ${n} Soal`;
  // innerHTML (bukan textContent) supaya dua varian label
  // (.btn-label-long / .btn-label-short) tetap tersedia; CSS media query
  // memilih varian mana yang tampil di desktop vs mobile.
  // Catatan: TIDAK pakai aria-hidden pada span pendek — varian yang
  // tidak tampil sudah keluar dari accessibility tree via display:none,
  // jadi accessible name tombol selalu berasal dari label yang terlihat.
  addBtn.innerHTML =
    `<span class="btn-label-long">${longLabel}</span>` +
    `<span class="btn-label-short">${shortLabel}</span>`;
}

// Delegates a single change listener so check/uncheck between renders is
// captured. The checkbox DOM nodes are rebuilt by `renderBankList()` so
// per-node listeners would not survive; a parent-level delegation does.
// The Set.toggle keeps the source-of-truth in sync with the DOM check
// state so subsequent renders can re-apply the checked attribute.
bankList.addEventListener("change", (e) => {
  if (e.target.matches('input[name="add-q"]')) {
    const id = parseInt(e.target.value, 10);
    if (e.target.checked) {
      tentativeSelections.add(id);
    } else {
      tentativeSelections.delete(id);
    }
    updateAddButtonLabel();
    updateBankSelectAllState();
  }
});

// Chip "Dipakai" → modal daftar paket (delegated: renderBankList rebuilds
// DOM tiap render, jadi listener parent-level seperti change handler
// add-q). preventDefault + stopPropagation supaya klik button di dalam
// <label> tidak ikut meng-toggle checkbox add-q.
bankList.addEventListener("click", (e) => {
  const chip = e.target.closest(".bank-usage-chip");
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  const qId = parseInt(chip.dataset.qId, 10);
  openUsageModal(questionUsage.get(qId)?.packs || []);
});

// Same delegation strategy for packList — renderLists() rebuilds the
// DOM but parent-level change listener catches per-row toggles, mutating
// packSelectedIds (source of truth) + calling updatePackSelectionUI() to
// sync count display, select-all 3-state, and bulk-remove button.
packList.addEventListener("change", (e) => {
  if (e.target.matches('input.pack-row-checkbox')) {
    const id = parseInt(e.target.dataset.qId, 10);
    if (e.target.checked) {
      packSelectedIds.add(id);
    } else {
      packSelectedIds.delete(id);
    }
    updatePackSelectionUI();
  }
});

// ==== Bank-list: select-all header checkbox (TOP + BOTTOM mirror) ====
// When user toggles EITHER header (top or bottom), mirror the checked
// state onto every row checkbox on the CURRENT PAGE and update
// tentativeSelections. The sibling header (the unw-toggled one) is
// synced via updateBankSelectAllState() at the end. Off-page
// selections are preserved (Set source-of-truth) — only the visible
// rows are flipped.
function handleBankSelectAllChange(e) {
  const checked = e.target.checked;
  e.target.indeterminate = false;
  const cbs = bankList.querySelectorAll('input[name="add-q"]');
  cbs.forEach((cb) => {
    const id = parseInt(cb.value, 10);
    cb.checked = checked;
    if (checked) tentativeSelections.add(id);
    else tentativeSelections.delete(id);
  });
  updateAddButtonLabel();
  updateBankSelectAllState();
}
if (bankSelectAllCheckbox) bankSelectAllCheckbox.addEventListener("change", handleBankSelectAllChange);
if (bankSelectAllCheckboxBottom) bankSelectAllCheckboxBottom.addEventListener("change", handleBankSelectAllChange);

// ==== Pack-list: select-all header checkbox (TOP + BOTTOM mirror) ====
// Pack-list has no pagination, so the headers reflect ALL pack
// questions. Toggling EITHER header flips all rows + packSelectedIds
// Set + re-renders. The sibling header (the unw-toggled one) gets
// re-derived via updatePackSelectionUI() during renderLists() at the
// end. Centralized in a handler function so the two event listeners
// stay in lockstep.
function handlePackSelectAllChange(e) {
  const checked = e.target.checked;
  e.target.indeterminate = false;
  if (checked) {
    packSelectedIds = new Set(packQuestions.map((q) => q.id));
  } else {
    packSelectedIds.clear();
  }
  renderLists();
}
if (packSelectAllCheckbox) packSelectAllCheckbox.addEventListener("change", handlePackSelectAllChange);
if (packSelectAllCheckboxBottom) packSelectAllCheckboxBottom.addEventListener("change", handlePackSelectAllChange);

// ==== Pack-list: bulk-remove button → confirmation modal ====
// Opens the bulk-remove-confirm-modal populated with the sorted list of
// selected soal + their pack-order index. The handler body is fully
// synchronous (no awaits; all data from cached packQuestions), so the
// modal opens in the same tick — dialog inertness from showModal()
// prevents a fast double-click from re-opening the modal. No in-flight
// flag needed. Per code-reviewer Round-1 feedback #2.
if (bulkRemoveBtn) {
  bulkRemoveBtn.addEventListener("click", () => {
    if (packSelectedIds.size === 0) return;
    const n = packSelectedIds.size;
    if (bulkRemoveConfirmCountEl) bulkRemoveConfirmCountEl.textContent = n;
    if (bulkRemoveModalCountEl) bulkRemoveModalCountEl.textContent = n;

    // Sort by id ascending so the modal list order matches user
    // expectation (mirror bulk-delete-confirm-modal from
    // kelola-soal.js). Index lookup via packQuestions.findIndex
    // converts each id back to its pack-order number for display.
    const sortedIds = Array.from(packSelectedIds).sort((a, b) => a - b);
    const rowHtml = sortedIds
      .map((id) => {
        const idx = packQuestions.findIndex((q) => q.id === id);
        const q = idx >= 0 ? packQuestions[idx] : null;
        const qNum = idx >= 0 ? `Soal ${idx + 1}` : `#${id}`;
        const preview = q
          ? window.bulkParser.previewHtmlForCell(q.content)
          : "—";
        return `<li><strong>${esc(qNum)}</strong>: ${preview}</li>`;
      })
      .join("");
    if (bulkRemovePackListEl) bulkRemovePackListEl.innerHTML = rowHtml;

    if (bulkRemoveConfirmModal) bulkRemoveConfirmModal.showModal();
  });
}

// ==== Pack-list bulk-remove: cancel button ====
if (bulkRemoveModalCancelBtn) {
  bulkRemoveModalCancelBtn.addEventListener("click", () => {
    if (bulkRemoveConfirmModal) bulkRemoveConfirmModal.close();
  });
}

// ==== Pack-list bulk-remove: confirm button ====
// Runs sequential DELETE /api/packs/:packId/questions/:qId for each
// selected id (mirror addBtn.onclick sequential POST loop). Sequential
// (NOT Promise.allSettled) chosen per thinker-with-files-gemini
// Round-1 feedback #3 to avoid concurrent pack_questions mutations.
// Uses setControlsLocked(true/false) to lock BOTH panels for the
// duration of the DELETE loop — extends beyond addBtn-only locking
// (per code-reviewer Round-1 feedback #1) so the user cannot launch a
// concurrent add-to-pack POST loop, toggle bank-side checkboxes, or
// click any other control that would mutate packQuestions mid-loop.
// On session/server error, the wrapFetch toast is already visible —
// we bail without alert. Partial failures notify with a summary so
// the user can retry; successfully-removed ids are pruned from
// packSelectedIds and the list re-renders via init().
if (bulkRemoveModalConfirmBtn) {
  bulkRemoveModalConfirmBtn.addEventListener("click", async () => {
    const ids = Array.from(packSelectedIds);
    if (ids.length === 0) {
      if (bulkRemoveConfirmModal) bulkRemoveConfirmModal.close();
      return;
    }

    bulkRemoveModalConfirmBtn.disabled = true;
    bulkRemoveModalCancelBtn.disabled = true;
    const originalLabel = bulkRemoveModalConfirmBtn.textContent;
    bulkRemoveModalConfirmBtn.textContent = "Menghapus...";

    // Lock both panels (bank checkboxes/pagination/search + addBtn +
    // pack row checkboxes + pack-select-all + saveBtn) to prevent
    // concurrent mutation of packQuestions during the DELETE loop.
    // Per code-reviewer Round-1 feedback #1.
    setControlsLocked(true);

    let successCount = 0;
    let isSessionOrServerErr = false;
    let alertMessage = null;

    try {
      for (let i = 0; i < ids.length; i++) {
        await wrapFetch(`/api/packs/${packId}/questions/${ids[i]}`, {
          method: "DELETE",
        });
        successCount = i + 1;
      }
    } catch (err) {
      if (
        err.message === "wrapFetch:SESSION_EXPIRED" ||
        err.message.startsWith("wrapFetch:SERVER_ERROR_")
      ) {
        isSessionOrServerErr = true;
      } else if (successCount > 0 && successCount < ids.length) {
        alertMessage = `${successCount} dari ${ids.length} soal berhasil dihapus dari paket. Sisanya gagal dan dapat dicoba lagi.`;
      } else {
        alertMessage = "Gagal menghapus soal dari paket.";
      }
    }

    if (!isSessionOrServerErr) {
      // Partial cleanup: drop successfully-removed ids so re-render
      // highlights the remaining (un-removed) selections for retry.
      // Sequential-index cleanup pairs 1:1 with the sequential DELETE
      // loop above — the assurance comes from the loop's monotonic
      // successCount. If this code is ever refactored to
      // Promise.allSettled, replace this with a Set keyed by id.
      for (let i = 0; i < successCount; i++) {
        packSelectedIds.delete(ids[i]);
      }
      if (bulkRemoveConfirmModal) bulkRemoveConfirmModal.close();
      await init();
      if (alertMessage) {
        alert(alertMessage);
      } else if (successCount === ids.length) {
        showNotification(
          "✓ Soal Dihapus dari Paket",
          `${ids.length} soal berhasil dihapus dari paket`,
        );
      }
    }

    bulkRemoveModalConfirmBtn.disabled = false;
    bulkRemoveModalCancelBtn.disabled = false;
    bulkRemoveModalConfirmBtn.textContent = originalLabel;
    // Unlock both panels. After init() + renderLists() ran
    // updatePackSelectionUI(), derived state (e.g. bulkRemoveBtn) is
    // already re-applied; setControlsLocked(false) just lifts the
    // blanket lock on inputs/pagination/saveBtn.
    setControlsLocked(false);
  });
}

// setControlsLocked — lock or unlock every input control on BOTH panels
// during any panel-busy operation (spec §4.6: add-to-pack POST loop;
// also extended per code-reviewer Round-1 feedback #1 to cover
// bulk-remove DELETE loop). Reads addBtn.disabled as the canonical
// "is the panel busy" state so drag/removeQ guards share the same
// signal without a parallel flag.
//
// Scope (locked=true): all bank inputs/selects/buttons + addBtn +
// packList row checkboxes + packSelectAllCheckbox + saveBtn become
// disabled. bulkRemoveBtn is INTENTIONALLY excluded here because its
// enabled state is derived from packSelectedIds.size via
// updatePackSelectionUI(); derived states are restored by init() →
// renderLists() → updatePackSelectionUI() AFTER the lock is lifted,
// and forcing bulkRemoveBtn to a fixed value here would fight with the
// derivation. `locked=false` simply re-enables everything; saveBtn
// stays disabled unless pack has drag-reorder state — that re-enable
// is owned by handleDrop + renderLists, not here.
function setControlsLocked(locked) {
  // Bank-list controls
  bankList.querySelectorAll('input[name="add-q"]').forEach((el) => {
    el.disabled = locked;
  });
  document.getElementById("bank-rows-per-page-top").disabled = locked;
  document.getElementById("bank-rows-per-page-bottom").disabled = locked;
  document.getElementById("bank-prev-btn-top").disabled = locked;
  document.getElementById("bank-prev-btn-bottom").disabled = locked;
  document.getElementById("bank-next-btn-top").disabled = locked;
  document.getElementById("bank-next-btn-bottom").disabled = locked;
  document.getElementById("bank-search-input").disabled = locked;
  // Cursor focus on disabled inputs is jarring — blur it explicitly.
  if (locked && document.activeElement === document.getElementById("bank-search-input")) {
    document.activeElement.blur();
  }
  addBtn.disabled = locked;
  // Pack-list controls (added per code-reviewer Round-1 feedback #1 to
  // prevent concurrent row-checkbox toggles + select-all clicks during
  // the bulk-remove DELETE loop, which would otherwise mutate
  // packSelectedIds/packQuestions while the loop is reading that state).
  packList.querySelectorAll('input.pack-row-checkbox').forEach((el) => {
    el.disabled = locked;
  });
  if (packSelectAllCheckbox) packSelectAllCheckbox.disabled = locked;
  // saveBtn stays disabled after unlock unless pack has drag-reorder
  // state. We track this cheaply by toggling disabled here and letting
  // handleDrop + renderLists own the re-enable logic for that button.
  if (locked) saveBtn.disabled = true;
  // Toggle loading overlay for pack column (mirror #loading-add on bank
  // column). Shows spinner + dims pack-questions-list and its controls
  // during add-to-pack POST loop or DELETE loop. Created per user
  // request 2026-07-21.
  if (loadingPackAdd) loadingPackAdd.style.display = locked ? "flex" : "none";
}

addBtn.onclick = async () => {
  // ---- Source-of-truth resolution ----
  // tentativeSelections is the user's intent (across all pages / filters).
  // availableIds is the server's authoritative "still addable" list
  // (already filtered to NOT be in packQuestions + search filter).
  // Same apply-search logic as renderBankList() to stay consistent.
  const packIds = new Set(packQuestions.map((q) => q.id));
  let availableForSubmit = allQuestions.filter((q) => !packIds.has(q.id));
  if (bankSearchTerm) {
    const term = bankSearchTerm.toLowerCase();
    availableForSubmit = availableForSubmit.filter((q) => {
      const ct = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
      const tt = (q.question_type || "").toLowerCase();
      return ct.includes(term) || tt.includes(term);
    });
  }
  const availableIds = new Set(availableForSubmit.map((q) => q.id));

  // Drain ghost IDs from tentativeSelections: anything the user had
  // selected but is no longer available (server-side deletion, race
  // with another tab, etc.). Without this, the button label would lie
  // ("Masukkan 5 Soal...") while we actually POST fewer.
  for (const id of Array.from(tentativeSelections)) {
    if (!availableIds.has(id)) tentativeSelections.delete(id);
  }
  updateAddButtonLabel();

  const checked = Array.from(tentativeSelections).filter((id) =>
    availableIds.has(id),
  );
  if (!checked.length) {
    alert("Pilih soal yang ingin dimasukkan!");
    return;
  }

  if (packQuestions.length + checked.length > 110) {
    alert("Maksimal 110 soal per paket!");
    return;
  }

  // Spec §4.5–4.7: full-panel overlay + lock controls + partial-failure
  // tracking. The synchronous alert() at the end runs AFTER the overlay
  // is hidden so the user sees the refreshed (or partially-updated)
  // bank list under the dialog instead of a frozen spinner.
  const overlay = document.getElementById("loading-add");
  overlay.style.display = "flex";
  setControlsLocked(true);

  let successCount = 0;
  let isSessionOrServerErr = false;
  let alertMessage = null;
  try {
    for (let i = 0; i < checked.length; i++) {
      // Bug-fix 2026-08-12: qNum harus NAIK per iterasi. Dulu konstan
      // (packQuestions.length + 1) sehingga semua soal dalam satu batch
      // POST dengan question_number yang SAMA → urutan tampilan paket
      // menjadi acak dan berubah-ubah setelah add/delete (tie-break
      // PostgREST untuk nomor duplikat tidak stabil). `checked` sudah
      // dalam urutan centang checkbox (Set insertion order), jadi +i di
      // sini memetakan posisi centang → nomor soal di paket.
      // Catatan: server kini juga menormalkan question_number via max+1
      // (POST /api/packs/:id/questions) — nilai ini defense-in-depth
      // agar kontrak klien-server tetap benar.
      const qNum = packQuestions.length + i + 1;
      await wrapFetch(`/api/packs/${packId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: checked[i],
          question_number: qNum,
        }),
      });
      successCount = i + 1;
    }
  } catch (err) {
    if (
      err.message === "wrapFetch:SESSION_EXPIRED" ||
      err.message.startsWith("wrapFetch:SERVER_ERROR_")
    ) {
      isSessionOrServerErr = true;
    } else if (successCount > 0 && successCount < checked.length) {
      alertMessage = `${successCount} dari ${checked.length} soal berhasil ditambahkan ke paket. Sisanya gagal dan dapat dicoba lagi.`;
    } else {
      alertMessage = "Gagal menambahkan soal ke paket.";
    }
  } finally {
    overlay.style.display = "none";
  }

  if (isSessionOrServerErr) {
    // Toast already visible. Just unlock + return (no init, no Set
    // cleanup — preserve user's full selection for retry).
    setControlsLocked(false);
    return;
  }

  // Cleanup successfully-added IDs from tentativeSelections so the
  // re-rendered bank list after init() doesn't re-check them.
  //   - Full success (successCount === checked.length): drop them all.
  //   - Partial failure (successCount > 0 && < checked.length): drop
  //     only the first successCount IDs; the rest stay checked so the
  //     user can re-click add after addressing the failure cause.
  for (let i = 0; i < successCount; i++) {
    tentativeSelections.delete(checked[i]);
  }
  updateAddButtonLabel();

  await init();
  setControlsLocked(false);

  if (alertMessage) {
    alert(alertMessage);
  } else if (successCount === checked.length) {
    showNotification(
      "✓ Soal Ditambahkan",
      `${checked.length} soal berhasil ditambahkan ke paket`,
    );
  }
};

// ==== Remove Question from Pack: confirm modal element refs + in-flight guard ====
// Replaces the old native confirm() dialog so the admin can SEE which
// question will be removed from the pack before confirming. Mirror of
// the single-delete-confirm-modal pattern in kelola-soal.html.
// pendingRemoveQId bridges removeQuestion (opens modal) and the confirm
// handler (runs the DELETE call). isRemoveQInFlight prevents double-click
// race on the per-row Hapus button — set synchronously before the first
// await so a fast double-click sees the flag as true and returns
// immediately (the `.open` property can't guard this because the modal
// isn't open yet during the await window).
const removeQConfirmModal = document.getElementById("remove-question-confirm-modal");
const removeQConfirmBtn = document.getElementById("remove-q-confirm-btn");
const removeQCancelBtn = document.getElementById("remove-q-cancel-btn");
const removeQNumEl = document.getElementById("remove-q-num");
const removeQDetailListEl = document.getElementById("remove-q-detail-list");
let pendingRemoveQId = null;
let isRemoveQInFlight = false;

// Remove question from pack — opens the confirm modal (replaces native
// confirm()) populated with the question number + preview from the
// cached packQuestions array. The actual DELETE call happens in the
// removeQConfirmBtn click handler below, after the user confirms.
window.removeQuestion = async (qId) => {
  // Spec §4.6 — guard against clicks while add-to-pack loop is mid-flight.
  if (addBtn.disabled) return;
  // Guard against double-click race (in-flight flag pattern per
  // code-reviewer-glm feedback from the kelola-soal single-delete
  // feature — the `.open` guard was ineffective for the typical
  // double-click-before-resolves race).
  if (isRemoveQInFlight) return;
  isRemoveQInFlight = true;
  try {
    // Look up the question from cached packQuestions to show the
    // question number (1-based index in pack order) + preview.
    const qIndex = packQuestions.findIndex((q) => q.id === qId);
    const q = qIndex >= 0 ? packQuestions[qIndex] : null;
    const qNum = qIndex >= 0 ? `Soal ${qIndex + 1}` : `#${qId}`;
    const preview = q
      ? window.bulkParser.previewHtmlForCell(q.content)
      : "—";

    pendingRemoveQId = qId;
    removeQNumEl.textContent = qNum;
    removeQDetailListEl.innerHTML =
      `<li><strong>${esc(qNum)}</strong>: ${preview}</li>`;

    if (removeQConfirmModal) removeQConfirmModal.showModal();
  } catch (err) {
    console.error("Remove question modal open failed:", err);
  } finally {
    isRemoveQInFlight = false;
  }
};

// ==== Remove Question: confirmation modal cancel button ====
if (removeQCancelBtn) {
  removeQCancelBtn.addEventListener("click", () => {
    if (removeQConfirmModal) removeQConfirmModal.close();
    pendingRemoveQId = null;
  });
}

// ==== Remove Question: confirmation modal submit button ====
// Runs the actual DELETE /api/packs/:packId/questions/:qId call after
// the user confirms. Mirrors the single-delete confirm handler pattern:
// disable both buttons during the in-flight DELETE, show "Menghapus...",
// re-enable in finally. On success, close modal + init() to refresh.
if (removeQConfirmBtn) {
  removeQConfirmBtn.addEventListener("click", async () => {
    const qId = pendingRemoveQId;
    if (qId == null) {
      if (removeQConfirmModal) removeQConfirmModal.close();
      return;
    }

    removeQConfirmBtn.disabled = true;
    removeQCancelBtn.disabled = true;
    const originalConfirmLabel = removeQConfirmBtn.textContent;
    removeQConfirmBtn.textContent = "Menghapus...";

    // Tampilkan loading overlay pada pack column selama proses DELETE
    // (user request 2026-07-21: loading indikator saat hapus soal).
    if (loadingPackAdd) loadingPackAdd.style.display = "flex";

    try {
      const res = await wrapFetch(`/api/packs/${packId}/questions/${qId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (removeQConfirmModal) removeQConfirmModal.close();
      pendingRemoveQId = null;
      await init();
    } catch (err) {
      if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
      console.error("Remove question submit failed:", err);
      alert("Gagal menghapus soal dari paket. Coba lagi.");
    } finally {
      removeQConfirmBtn.disabled = false;
      removeQCancelBtn.disabled = false;
      removeQConfirmBtn.textContent = originalConfirmLabel;
      // Sembunyikan loading overlay setelah DELETE selesai (sukses/
      // gagal). init() di path sukses akan memicu renderLists() yang
      // memanggil setControlsLocked(false) — overlay di-sembunyikan
      // dari sana; ini jaga-jaga untuk path gagal.
      if (loadingPackAdd) loadingPackAdd.style.display = "none";
    }
  });
}

// ==== Drag & Drop (mengatur urutan nomor soal) ====
// Desktop: HTML5 drag events. Mobile/touch: Pointer Events live-reorder
// (HTML5 drag TIDAK berjalan di layar sentuh). Keduanya memakai helper
// reorderQuestion() yang sama sehingga array packQuestions selalu sinkron
// dengan urutan visual daftar.
let dragSourceEl = null;

function setupDragAndDrop() {
  const items = packList.querySelectorAll(".pack-question-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
  });
  // Mobile: jalur kedua via Pointer Events (no-op di perangkat tanpa
  // sentuhan sehingga drag desktop tidak berubah).
  setupTouchDragAndDrop();
}

// reorderQuestion — pindahkan soal dari srcIdx ke destIdx di array
// packQuestions DAN pindahkan node DOM-nya (live reorder) + sync ulang
// atribut data-index semua item. Dipakai oleh drag desktop (handleDrop)
// dan drag sentuh (pointerup). Mengembalikan false bila argumen tidak
// valid / tidak terjadi perpindahan.
function reorderQuestion(srcIdx, destIdx) {
  if (
    !Number.isInteger(srcIdx) ||
    !Number.isInteger(destIdx) ||
    srcIdx < 0 ||
    destIdx < 0 ||
    srcIdx >= packQuestions.length ||
    destIdx >= packQuestions.length ||
    srcIdx === destIdx
  ) {
    return false;
  }
  const temp = packQuestions[srcIdx];
  packQuestions.splice(srcIdx, 1);
  packQuestions.splice(destIdx, 0, temp);

  // Pindahkan node DOM agar posisi visual ikut berubah seketika.
  const items = packList.querySelectorAll(".pack-question-item");
  if (items.length === packQuestions.length) {
    const srcNode = items[srcIdx];
    const destNode = items[destIdx];
    if (srcNode && destNode) {
      if (srcIdx < destIdx) {
        destNode.after(srcNode);
      } else {
        destNode.before(srcNode);
      }
      // Sync ulang data-index (urutan DOM kini = urutan array) supaya
      // lookup index berikutnya (drag kedua, drop berikutnya) tetap benar.
      packList
        .querySelectorAll(".pack-question-item")
        .forEach((el, i) => el.setAttribute("data-index", String(i)));
    }
  }
  return true;
}

// reorderQuestionFinalize — re-render daftar dari array (sudah berurutan)
// supaya label "Soal N", checkbox state, dan tombol Simpan ikut ter-update,
// lalu aktifkan tombol "Simpan Urutan Soal". WAJIB dipanggil setelah drop
// selesai (desktop & touch): tanpa renderLists() di sini, label nomor soal
// akan basi (tidak mengikuti urutan baru) — inilah bug yang diperbaiki dari
// rilis sebelumnya (reorderQuestionFinalize pernah didefinisikan tapi tidak
// pernah dipanggil).
function reorderQuestionFinalize() {
  renderLists();
  saveBtn.disabled = false;
}

// Bersihkan indikator drop-target di semua item (dipakai drag desktop +
// touch) setelah drop selesai / drag dibatalkan. Atribut data-drop-side
// ikut dihapus supaya tidak ada nilai basi dari drag sebelumnya.
function clearDropTargets() {
  packList.querySelectorAll(".pack-question-item").forEach((el) => {
    el.classList.remove("drop-target");
    delete el.dataset.dropSide;
  });
}

function handleDragStart(e) {
  // Spec §4.6 — lock drag-reorder while add-to-pack loop is busy.
  if (addBtn.disabled) {
    e.preventDefault();
    return;
  }
  this.classList.add("dragging");
  dragSourceEl = this;
  // Nonaktifkan transisi item selama drag berlangsung (lihat CSS
  // #pack-questions-list.drag-active) — transisi dasar item inilah yang
  // membuat highlight drop-target terlihat stutter saat bergerak cepat.
  packList.classList.add("drag-active");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(this.dataset.id));
  e.dataTransfer.setData("text/html", this.innerHTML);
}

function handleDragOver(e) {
  if (addBtn.disabled) return false;
  if (e.preventDefault) e.preventDefault();
  // dropEffect "move" wajib — tanpa ini browser menunjukkan kursor
  // "tidak boleh drop" walau drop sebenarnya diterima.
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  // Indikator posisi jatuh (garis aksen atas/bawah) di item yang sedang
  // dilintasi, konsisten dengan indikator drag sentuh.
  clearDropTargets();
  if (dragSourceEl && dragSourceEl !== this) {
    const rect = this.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    this.classList.add("drop-target");
    this.dataset.dropSide = before ? "before" : "after";
  }
  return false;
}

function handleDrop(e) {
  // Spec §4.6 — defensive guard against drop events firing after lock.
  if (addBtn.disabled) return false;
  if (e.stopPropagation) e.stopPropagation();
  if (dragSourceEl && dragSourceEl !== this) {
    reorderQuestion(
      parseInt(dragSourceEl.dataset.index, 10),
      parseInt(this.dataset.index, 10),
    );
    reorderQuestionFinalize();
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove("dragging");
  packList.classList.remove("drag-active");
  clearDropTargets();
  dragSourceEl = null;
}

// ---- Touch drag & drop (mobile) ----
// HTML5 drag events TIDAK berjalan di layar sentuh. Untuk perangkat touch
// dipakai Pointer Events dengan pola "tandai lalu lepas":
//   pointerdown → mulai pantau (belum drag; masih tap biasa)
//   pointermove → setelah melewati ambang gerak (~8px) baru "drag"; item
//                 yang diseret mengikuti jari (transform + .touch-dragging)
//                 dan item di bawah jari ditandai garis aksen atas/bawah
//                 (drop indicator). Auto-scroll saat jari mendekati tepi
//                 daftar supaya item di luar viewport terjangkau.
//   pointerup   → reorderQuestion() + reorderQuestionFinalize() (render
//                 ulang supaya label "Soal N" ikut ter-update) lalu animasi
//                 drop meluncur dari posisi ghost ke posisi final.
// Ambang gerak memastikan tap biasa (checkbox, tombol Hapus, klik item)
// tetap berfungsi normal; drag yang terjadi dibatalkan klik lanjutannya
// lewat preventDefault() di pointerup.
let touchDragState = null;
const TOUCH_DRAG_THRESHOLD_PX = 6;

function isTouchDragDevice() {
  return (
    (window.PointerEvent &&
      window.matchMedia &&
      window.matchMedia("(pointer: coarse)").matches) ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

function setupTouchDragAndDrop() {
  if (!isTouchDragDevice()) return;
  const items = packList.querySelectorAll(".pack-question-item");
  items.forEach((item) => {
    item.addEventListener("pointerdown", onPackItemPointerDown);
    item.addEventListener("pointermove", onPackItemPointerMove);
    item.addEventListener("pointerup", onPackItemPointerUp);
    item.addEventListener("pointercancel", onPackItemPointerCancel);
  });
}

function onPackItemPointerDown(e) {
  if (addBtn.disabled) return;
  // Jangan mulai drag bila sentuhan dimulai dari kontrol interaktif
  // (checkbox pilih, tombol Hapus) — tap di sana harus tetap berfungsi.
  if (e.target.closest("input, button, a, select")) return;
  const item = e.currentTarget;
  const rect = item.getBoundingClientRect();
  touchDragState = {
    source: item,
    startX: e.clientX,
    startY: e.clientY,
    // Jarak jari terhadap posisi item saat drag dimulai — konstan
    // sepanjang drag, sehingga ghost selalu mengikuti jari dengan
    // offset yang sama persis.
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    dragging: false,
    suppressClick: false,
    lastClientX: e.clientX,
    lastClientY: e.clientY,
    // Layout yang dibutuhkan saat drag di-cache SEKALI di sini
    // (listRect; sourceRect + itemRects diisi saat drag benar-benar
    // mulai) supaya pointermove tidak memaksa reflow per event —
    // inilah sumber stutter di versi sebelumnya. Item TIDAK bergerak
    // selama drag (tidak ada live reorder), jadi cache tetap valid;
    // auto-scroll hanya menggeser koordinat konten via scrollDelta.
    listRect: packList.getBoundingClientRect(),
    startScrollTop: packList.scrollTop,
    sourceRect: null,
    itemRects: null,
    markedEl: null,
    markedSide: null,
  };
}

function onPackItemPointerMove(e) {
  if (!touchDragState || touchDragState.source !== e.currentTarget) return;
  const s = touchDragState;

  if (!s.dragging) {
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    // Belum melewati ambang gerak → masih tap; biarkan scroll sentuh
    // normal terjadi.
    if (Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD_PX) return;
    s.dragging = true;
    s.suppressClick = true;
    s.source.classList.add("touch-dragging");
    // Nonaktifkan transisi item selama drag (lihat CSS drag-active).
    packList.classList.add("drag-active");
    // Ukur posisi source + SEMUA item SEKALI. Karena tidak ada live
    // reorder, posisi relatif item terhadap daftar tidak berubah —
    // hit-test berikutnya murni aritmetika, tanpa reflow.
    s.sourceRect = s.source.getBoundingClientRect();
    s.itemRects = Array.from(
      packList.querySelectorAll(".pack-question-item"),
      (el) => {
        const r = el.getBoundingClientRect();
        return { el, top: r.top, bottom: r.bottom };
      },
    );
    if (s.source.setPointerCapture) {
      try {
        s.source.setPointerCapture(e.pointerId);
      } catch (err) {
        // abaikan — pointer capture gagal bukan kondisi fatal
      }
    }
  }

  // Auto-scroll daftar saat jari mendekati tepi atas/bawah (list bisa
  // lebih panjang dari viewport; tanpa ini item di luar layar tidak
  // bisa dijangkau saat drag). listRect di-cache dari pointerdown.
  const EDGE = 44;
  if (e.clientY < s.listRect.top + EDGE) {
    packList.scrollTop -= 10;
  } else if (e.clientY > s.listRect.bottom - EDGE) {
    packList.scrollTop += 10;
  }
  const scrollDelta = packList.scrollTop - s.startScrollTop;

  // Ghost mengikuti jari — posisi layout source dihitung dari cache
  // (sourceRect) minus scrollDelta, TANPA getBoundingClientRect per
  // event. Scroll vertikal tidak menggeser posisi horizontal, jadi
  // hanya srcTop yang dikurangi delta. Transform murni visual
  // (kompositor-only berkat will-change: transform pada
  // .touch-dragging).
  const srcLeft = s.sourceRect.left;
  const srcTop = s.sourceRect.top - scrollDelta;
  s.source.style.transform = `translate(${e.clientX - srcLeft - s.grabX}px, ${e.clientY - srcTop - s.grabY}px)`;
  s.lastClientX = e.clientX;
  s.lastClientY = e.clientY;

  // Hit-test posisi jatuh via cache itemRects + scrollDelta (tanpa
  // elementFromPoint / tanpa reflow): item di bawah jari ditandai,
  // atas/bawah sesuai separuh item. Item SUMBER di-skip dari hit-test
  // (padanan perilaku visibility:hidden + elementFromPoint di versi
  // lama) supaya item yang berada di posisi layout sumber tetap bisa
  // dijadikan target.
  const relY = e.clientY + scrollDelta;
  let targetItem = null;
  let before = false;
  for (const it of s.itemRects) {
    if (it.el === s.source) continue;
    if (relY >= it.top && relY < it.bottom) {
      targetItem = it.el;
      before = relY < it.top + (it.bottom - it.top) / 2;
      break;
    }
  }
  if (!targetItem) {
    // Tidak di atas item lain — bersihkan mark bila ada.
    if (s.markedEl) {
      s.markedEl.classList.remove("drop-target");
      delete s.markedEl.dataset.dropSide;
      s.markedEl = null;
      s.markedSide = null;
    }
    return;
  }
  const side = before ? "before" : "after";
  // Tulis DOM hanya saat target/sisi BERUBAH (bukan tiap pointermove)
  // — mengurangi write + paint selama drag.
  if (s.markedEl !== targetItem || s.markedSide !== side) {
    if (s.markedEl) {
      s.markedEl.classList.remove("drop-target");
      delete s.markedEl.dataset.dropSide;
    }
    targetItem.classList.add("drop-target");
    targetItem.dataset.dropSide = side;
    s.markedEl = targetItem;
    s.markedSide = side;
  }
}

// pointercancel — gestur dibatalkan sistem (mis. gerakan back-swipe,
// scroll takeover). Bersihkan state TANPA melakukan reorder (beda dari
// pointerup yang meng-commit hasil drag).
function onPackItemPointerCancel(e) {
  const s = touchDragState;
  touchDragState = null;
  if (!s || s.source !== e.currentTarget) return;
  s.source.classList.remove("touch-dragging");
  s.source.style.transform = "";
  packList.classList.remove("drag-active");
  clearDropTargets();
}

function onPackItemPointerUp(e) {
  const s = touchDragState;
  touchDragState = null;
  if (!s || s.source !== e.currentTarget) {
    // pointerup jatuh di luar source (mis. setPointerCapture gagal) —
    // bersihkan state drag yang mungkin tersisa supaya class
    // drag-active tidak bocor (transisi item tidak boleh mati permanen).
    if (s) {
      s.source.classList.remove("touch-dragging");
      s.source.style.transform = "";
      packList.classList.remove("drag-active");
      clearDropTargets();
    }
    return;
  }

  s.source.classList.remove("touch-dragging");
  // Drag selesai — kembalikan transisi item (dinonaktifkan selama drag
  // via #pack-questions-list.drag-active) SEBELUM animasi drop jalan.
  packList.classList.remove("drag-active");

  if (s.suppressClick && e.cancelable) e.preventDefault();
  if (!s.dragging || addBtn.disabled) {
    s.source.style.transform = "";
    return;
  }

  // Target terakhir yang ditandai (di-track incremental, tanpa query).
  const targetItem = s.markedEl;
  clearDropTargets();

  if (!targetItem) {
    s.source.style.transform = "";
    return;
  }

  // Hitung indeks tujuan berdasar sisi jatuh (sebelum/sesudah target).
  const srcIdx = parseInt(s.source.dataset.index, 10);
  const targetIdx = parseInt(targetItem.dataset.index, 10);
  if (!Number.isInteger(srcIdx) || !Number.isInteger(targetIdx)) {
    s.source.style.transform = "";
    return;
  }
  const before = targetItem.dataset.dropSide === "before";
  let destIdx;
  if (before) {
    destIdx = srcIdx < targetIdx ? targetIdx - 1 : targetIdx;
  } else {
    destIdx = srcIdx < targetIdx ? targetIdx : targetIdx + 1;
  }
  if (destIdx === srcIdx) {
    s.source.style.transform = "";
    return;
  }

  // Ukur posisi item saat ini + delta drag terakhir — dipakai untuk
  // menghitung offset awal animasi drop nanti.
  const id = s.source.dataset.id;
  const srcRect = s.source.getBoundingClientRect();
  const dragDeltaX = s.lastClientX - srcRect.left - s.grabX;
  const dragDeltaY = s.lastClientY - srcRect.top - s.grabY;

  // Reorder array + RENDER ULANG (fix bug rilis sebelumnya: tanpa
  // reorderQuestionFinalize() label "Soal N" tidak pernah ter-update
  // setelah drag sentuh). Animasi drop menyusul setelah render.
  reorderQuestion(srcIdx, destIdx);
  reorderQuestionFinalize();

  applyDropAnim(id, srcRect, dragDeltaX, dragDeltaY);
}

// Animasi drop: item hasil render (posisi final di layout) dimulai dari
// posisi ghost lama, lalu meluncur ke posisi aslinya. Tanpa animasi ini
// item yang dirender ulang langsung muncul di posisi final — tampak
// "nyentak".
function applyDropAnim(id, srcRect, dragDeltaX, dragDeltaY) {
  let item = null;
  if (id) {
    if (window.CSS && typeof CSS.escape === "function") {
      item = packList.querySelector(
        `.pack-question-item[data-id="${CSS.escape(id)}"]`,
      );
    } else {
      packList
        .querySelectorAll(".pack-question-item")
        .forEach((el) => {
          if (String(el.dataset.id) === String(id)) item = el;
        });
    }
  }
  if (!item) return;

  // Mulai dari posisi ghost: posisi visual awal = (posisi item lama +
  // delta drag), lalu transisi ke posisi aslinya di layout.
  item.classList.add("drop-anim");
  const rect = item.getBoundingClientRect();
  const offsetX = srcRect.left + dragDeltaX - rect.left;
  const offsetY = srcRect.top + dragDeltaY - rect.top;
  item.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

  // Paksa satu frame agar offset awal terbaca, baru transisi ke 0.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      item.style.transform = "";
    });
  });

  let done = false;
  const finalize = () => {
    if (done) return;
    done = true;
    item.classList.remove("drop-anim");
  };
  item.addEventListener("transitionend", finalize, { once: true });
  window.setTimeout(finalize, 250);
}

saveBtn.onclick = async () => {
  if (packQuestions.length < 1 || packQuestions.length > 110) {
    alert("Setiap paket harus memiliki antara 1 sampai 110 soal!");
    return;
  }
  saveBtn.disabled = true;
  const payload = packQuestions.map((q, i) => ({
    question_id: q.id,
    question_number: i + 1,
  }));
  try {
    const res = await wrapFetch(`/api/packs/${packId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: payload }),
    });
    if (!res.ok) throw new Error();
    showNotification(
      "✓ Urutan Tersimpan",
      "Urutan soal berhasil disimpan!",
    );
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menyimpan urutan soal.");
    saveBtn.disabled = false;
  }
};

init();
