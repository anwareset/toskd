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

    packTitle.textContent = pack.name;
    packSubtitle.textContent = `⏱️ Durasi: ${pack.duration_minutes} Menit | Passing Grade: ${pack.passing_grade}`;

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
      .map(
        (q) => `
      <label class="option-item" style="cursor:pointer;background:var(--surface);margin-bottom:8px">
        <input type="checkbox" name="add-q" value="${q.id}"${tentativeSelections.has(parseInt(q.id, 10)) ? " checked" : ""}>
        <span class="option-label">
          <strong>[${esc(q.question_type.toUpperCase())}]</strong> ${window.bulkParser.previewHtmlForCell(q.content)}
        </span>
      </label>
    `,
      )
      .join("");
    typesetMath(bankList);
    updateAddButtonLabel();
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
        <span class="q-num">Soal ${i + 1}</span>
        <span class="q-preview">${window.bulkParser.previewHtmlForCell(q.content)}</span>
        <button class="btn-danger" style="padding:4px 8px;font-size:0.8rem" onclick="removeQuestion(${q.id})">Hapus</button>        </div>
    `,
      )
      .join("");
    typesetMath(packList);
    setupDragAndDrop();
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
  addBtn.textContent =
    n === 0
      ? "Masukkan Soal Terpilih ke Paket"
      : `Masukkan ${n} Soal Terpilih ke Paket`;
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
  }
});

// setControlsLocked — lock or unlock every bank-side control during the
// add-to-pack POST loop (spec §4.6). Reads addBtn.disabled as the single
// source of truth for "is the panel busy" so drag/removeQ guards share
// the same state without a parallel flag.
// `locked=true` ⇒ all bank inputs/selects/buttons + addBtn + saveBtn
// become disabled; `locked=false` ⇒ re-enable everything (saveBtn only
// re-enables per its own logic — keep it disabled if user hasn't dragged).
function setControlsLocked(locked) {
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
  // saveBtn stays disabled after unlock unless pack has drag-reorder
  // state. We track this cheaply by toggling disabled here and letting
  // handleDrop + renderLists own the re-enable logic for that button.
  if (locked) saveBtn.disabled = true;
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

  if (packQuestions.length + checked.length > 35) {
    alert("Maksimal 35 soal per paket!");
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
      const qNum = packQuestions.length + 1;
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
    alert(`${checked.length} soal berhasil ditambahkan ke paket`);
  }
};

window.removeQuestion = async (qId) => {
  // Spec §4.6 — guard against clicks while add-to-pack loop is mid-flight.
  if (addBtn.disabled) return;
  if (!confirm("Hapus soal ini dari paket?")) return;
  try {
    const res = await wrapFetch(`/api/packs/${packId}/questions/${qId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menghapus soal dari paket.");
  }
};

// Drag and Drop
let dragSourceEl = null;

function setupDragAndDrop() {
  const items = packList.querySelectorAll(".pack-question-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
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
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", this.innerHTML);
}

function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  return false;
}

function handleDrop(e) {
  // Spec §4.6 — defensive guard against drop events firing after lock.
  if (addBtn.disabled) return;
  if (e.stopPropagation) e.stopPropagation();
  if (dragSourceEl !== this) {
    const srcIdx = parseInt(dragSourceEl.dataset.index);
    const destIdx = parseInt(this.dataset.index);

    // Reorder packQuestions array
    const temp = packQuestions[srcIdx];
    packQuestions.splice(srcIdx, 1);
    packQuestions.splice(destIdx, 0, temp);

    renderLists();
    saveBtn.disabled = false;
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove("dragging");
}

saveBtn.onclick = async () => {
  if (packQuestions.length < 1 || packQuestions.length > 35) {
    alert("Setiap paket harus memiliki antara 1 sampai 35 soal!");
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
    alert("Urutan soal berhasil disimpan!");
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menyimpan urutan soal.");
    saveBtn.disabled = false;
  }
};

init();
