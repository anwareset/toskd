// ============================================================================
// wrapFetch: credentials: 'same-origin' (default tapi eksplisit) + 401 = "session
// expired" toast (don't navigate — could lose unsaved Quill content); 5xx =
// server error toast. Throws SESSION_EXPIRED / SERVER_ERROR_<status> so caller's
// catch can early-return and avoid duplicate alerts (the toast is already shown).
//
// Headers: caller's `options.headers` ALWAYS win (spread LAST). Default
// Content-Type: application/json only set if (a) body isn't FormData AND
// (b) caller didn't set Content-Type. This is the bug-fix order from the
// post-implementation thinker pass — the original spec had default spread
// AFTER caller headers, which silently overrode caller's explicit types.
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
  // Try to preserve unsaved form state (best-effort). syncEditorsToTextareas()
  // is called by form.onsubmit BEFORE wrapFetch, so the hidden <textarea>
  // snapshot of Quill content is up-to-date by the time the 401 fires.
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

  // Show non-blocking toast: "Session expired, please login again"
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

// DOM references
const tableEl = document.getElementById("questions-table");
const bodyEl = document.getElementById("questions-body");
const loadingEl = document.getElementById("loading");
const modal = document.getElementById("q-modal");
const form = document.getElementById("q-form");
const modalTitle = document.getElementById("modal-title");

// ==== Bulk Delete selection (per specs/bulk-delete-questions-spec.md
//      Section 4.3 / 4.4 — see Phase 1 implementation) ====
const selectedIds = new Set();
const selectAllCheckbox = document.getElementById("select-all-checkbox");
const bulkDeleteBtn = document.getElementById("bulk-delete-btn");
const selectionPill = document.getElementById("selection-pill");
const selectionPillText = document.getElementById("selection-pill-text");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const bulkDeleteConfirmModal = document.getElementById("bulk-delete-confirm-modal");
const bulkDeleteConfirmBtn = document.getElementById("bulk-delete-confirm-btn");
const bulkDeleteCancelBtn = document.getElementById("bulk-delete-cancel-btn");
const confirmTotalCountEl = document.getElementById("confirm-total-count");
const modalConfirmCountEl = document.getElementById("modal-confirm-count");
const confirmPackImpactEl = document.getElementById("confirm-pack-impact");
const confirmPackListEl = document.getElementById("confirm-pack-list");
const confirmIdListEl = document.getElementById("confirm-id-list");

let questions = [];

// Quill editor instances
let contentEditor = null;
let explanationEditor = null;
let optionEditors = {};
let editorsReady = false;
let quillInitialized = false;

// Custom image handler for Quill
const imageHandler = async function () {
  const input = document.createElement("input");
  input.setAttribute("type", "file");
  input.setAttribute("accept", "image/*");
  input.click();

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Image = e.target.result;

        // Upload to server
        const response = await wrapFetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Image, folder: "questions" }),
        });

        if (!response.ok) throw new Error("Upload failed");

        const { url } = await response.json();

        // Insert image into editor
        const editor = this.quill;
        const range = editor.getSelection();
        editor.insertEmbed(range.index, "image", url);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      // wrapFetch already shows toast for SESSION_EXPIRED / SERVER_ERROR_*
      if (error.message === "SESSION_EXPIRED" || error.message.startsWith("SERVER_ERROR_")) return;
      console.error("Error uploading image:", error);
      alert("Gagal mengupload gambar. Coba lagi.");
    }
  };
};

// Toolbar configuration for Quill
const toolbarOptions = {
  container: [
    ["bold", "italic", "underline", "strike"],
    ["blockquote", "code-block"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", { image: "upload" }],
    ["formula"],
    ["clean"],
  ],
  handlers: {
    image: imageHandler,
  },
};

// Initialize Quill editors
function initQuillEditors() {
  if (quillInitialized || !window.Quill) return;

  try {
    // Destroy existing editors if any (cleanup)
    if (contentEditor) contentEditor = null;
    if (explanationEditor) explanationEditor = null;
    optionEditors = {};

    // Content editor
    contentEditor = new Quill("#q-content-editor", {
      theme: "snow",
      modules: {
        toolbar: toolbarOptions,
      },
      placeholder:
        "Tuliskan pertanyaan disini... Gunakan toolbar untuk memformat teks dan menyisipkan gambar.",
    });

    // Sync content to hidden textarea on change
    contentEditor.on("text-change", () => {
      document.getElementById("q-content-text").value =
        contentEditor.root.innerHTML;
    });

    // Explanation editor
    explanationEditor = new Quill("#q-explanation-editor", {
      theme: "snow",
      modules: {
        toolbar: toolbarOptions,
      },
      placeholder: "Tuliskan langkah penyelesaian...",
    });

    // Sync explanation to hidden textarea on change
    explanationEditor.on("text-change", () => {
      document.getElementById("q-explanation").value =
        explanationEditor.root.innerHTML;
    });

    // Option editors (A-E)
    ["A", "B", "C", "D", "E"].forEach((k) => {
      const editorId = `opt-${k.toLowerCase()}-editor`;
      const textareaId = `opt-${k.toLowerCase()}`;

      optionEditors[k] = new Quill(`#${editorId}`, {
        theme: "snow",
        modules: {
          toolbar: {
            container: [
              ["bold", "italic", "underline"],
              ["link", { image: "upload" }],
              ["formula"],
              ["clean"],
            ],
            handlers: {
              image: imageHandler,
            },
          },
        },
        placeholder: `Isi opsi ${k}`,
      });

      // Sync to hidden textarea on change
      optionEditors[k].on("text-change", () => {
        document.getElementById(textareaId).value =
          optionEditors[k].root.innerHTML;
      });
    });

    editorsReady = true;
    quillInitialized = true;
    console.log("Quill editors initialized successfully");
  } catch (e) {
    console.error("Failed to initialize Quill editors:", e);
    editorsReady = false;
    quillInitialized = false;
  }
}

// Sync all editors to their hidden textareas
function syncEditorsToTextareas() {
  if (!editorsReady) return;

  try {
    if (contentEditor) {
      document.getElementById("q-content-text").value =
        contentEditor.root.innerHTML;
    }

    if (explanationEditor) {
      document.getElementById("q-explanation").value =
        explanationEditor.root.innerHTML;
    }

    ["A", "B", "C", "D", "E"].forEach((k) => {
      if (optionEditors[k]) {
        document.getElementById(`opt-${k.toLowerCase()}`).value =
          optionEditors[k].root.innerHTML;
      }
    });
  } catch (e) {
    console.warn("Sync editors failed:", e);
  }
}

// Set editor values from strings
function setEditorValues(content, options, explanation) {
  if (!editorsReady) return;

  try {
    if (contentEditor && content) {
      contentEditor.root.innerHTML = content;
    }

    if (explanationEditor && explanation) {
      explanationEditor.root.innerHTML = explanation;
    }

    if (options) {
      ["A", "B", "C", "D", "E"].forEach((k) => {
        if (optionEditors[k] && options[k]) {
          optionEditors[k].root.innerHTML = options[k];
        }
      });
    }
  } catch (e) {
    console.warn("Set editor values failed:", e);
  }
}

// Clear all editors
function clearEditors() {
  if (!editorsReady) return;

  try {
    if (contentEditor) contentEditor.root.innerHTML = "";
    if (explanationEditor) explanationEditor.root.innerHTML = "";
    ["A", "B", "C", "D", "E"].forEach((k) => {
      if (optionEditors[k]) optionEditors[k].root.innerHTML = "";
    });
  } catch (e) {
    console.warn("Clear editors failed:", e);
  }
}

// Escape HTML
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// previewHtmlForCell — imported from public/js/bulk-parser.js via the
// globalThis.bulkParser side-effect (see <script type="module"
// src="/js/bulk-parser.js"> in kelola-soal.html). Strip block
// elements (<ol>, <img>) from a Quill-rendered HTML string and
// replace with compact inline markers so the table preview cell
// stays 1-line. See bulk-parser.js for the full implementation
// and rationale (spec: bulk-add-format-v2-spec.md §10.1).
//
// We re-bind to a local const for readability at call sites:
//   const cell = previewHtmlForCell(q.content);

// Pagination & Search State
let rowsPerPage = 10;
let currentPage = 0;
let searchTerm = "";

function renderTable() {
  const filtered = questions.filter((q) => {
    const contentText = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
    const typeText = (q.question_type || "").toLowerCase();
    const term = searchTerm.toLowerCase();
    return contentText.includes(term) || typeText.includes(term);
  });

  const totalPages = Math.ceil(filtered.length / rowsPerPage) || 1;
  if (currentPage >= totalPages) {
    currentPage = totalPages - 1;
  }
  if (currentPage < 0) {
    currentPage = 0;
  }

  // Update page info displays
  const pageInfoText = `Halaman ${currentPage + 1} dari ${totalPages}`;
  document.getElementById("page-info-top").textContent = pageInfoText;
  document.getElementById("page-info-bottom").textContent = pageInfoText;

  // Enable/disable buttons
  const isFirst = currentPage === 0;
  const isLast = currentPage >= totalPages - 1;
  document.getElementById("prev-page-btn-top").disabled = isFirst;
  document.getElementById("prev-page-btn-bottom").disabled = isFirst;
  document.getElementById("next-page-btn-top").disabled = isLast;
  document.getElementById("next-page-btn-bottom").disabled = isLast;

  // Slice questions for current page
  const start = currentPage * rowsPerPage;
  const pageData = filtered.slice(start, start + rowsPerPage);  bodyEl.innerHTML = pageData
    .map((q, idx) => {
      const globalIdx = start + idx + 1;
      const isSelected = selectedIds.has(q.id);      return `
        <tr>
          <td class="col-checkbox sticky-col-left">
            <input type="checkbox"
                   class="row-checkbox"
                   data-id="${q.id}"
                   ${isSelected ? 'checked' : ''}
                   aria-label="Pilih soal #${globalIdx}">
          </td>
          <td>${globalIdx}</td>
          <td>${window.bulkParser.previewHtmlForCell(q.content)}</td>
          <td><strong>${esc(q.question_type || "text")}</strong></td>
          <td><span class="btn-success" style="padding:2px 8px;border-radius:4px;font-size:0.8rem">${q.correct_answer}</span></td>
          <td class="sticky-col-right">
            <button class="btn-secondary" onclick="editQuestion(${q.id})">Edit</button>
            <button class="btn-danger" onclick="deleteQuestion(${q.id})">Hapus</button>
          </td>
        </tr>
    `;
    })
    .join("");

    // Render \( ... \) LaTeX delimiters in question content cells, so
    // injected math formulas become visible in the table preview. Quill
    // formula <span>s already render via their stored KaTeX HTML — no
    // extra KaTeX render call needed. Safe no-op if MathJax isn't loaded
    // yet; the promise swallows any single-typeset error.
    if (window.MathJax?.typesetPromise) {
      MathJax.typesetPromise([bodyEl]).catch(() => {});
    }

    // Show/hide controls containers
  const controlsTop = document.getElementById("controls-top");
  const controlsBottom = document.getElementById("controls-bottom");
  if (questions.length > 0) {
    controlsTop.style.display = "flex";
    controlsBottom.style.display = "flex";
  } else {
    controlsTop.style.display = "none";
    controlsBottom.style.display = "none";
    // Spec Section 4.12: empty-state row when zero questions
    bodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 32px; color: var(--text-muted)">
      Tidak ada soal di Bank Soal. Tambah soal baru via tombol di atas.
    </td></tr>`;
  }

  // Spec Section 4.3 / Section 12: sync pill + bulk-delete button + header
  // checkbox 3-state after every render. Reads selectedIds (state, not DOM)
  // and current filtered pageData (view) — detached from DOM checkbox state
  // to avoid render-then-update loops.
  updateSelectionUI();
}

// ==== Bulk Delete: state machine + body checkbox delegation ====
// Spec: specs/bulk-delete-questions-spec.md Section 4.3 / 4.4 / 4.5 / 4.6

// updateSelectionUI() — synchronises pill, bulk-delete button, and header
// checkbox 3-state from the in-memory `selectedIds` set + current filtered
// pageData. Strict-scope: header checkbox reflects current page rows ONLY
// (cross-page selection tracked via counter pill text per Section 3.1).
function updateSelectionUI() {
  const total = selectedIds.size;
  // Compute "on this page" subset using same filter logic as renderTable
  // (duplicated here intentionally — extracting a shared helper felt like
  // premature abstraction for a 5-line filter that may evolve independently
  // per design notes in spec Section 7 R5).
  const filtered = questions.filter((q) => {
    const contentText = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
    const typeText = (q.question_type || "").toLowerCase();
    const term = searchTerm.toLowerCase();
    return contentText.includes(term) || typeText.includes(term);
  });
  const start = currentPage * rowsPerPage;
  const pageData = filtered.slice(start, start + rowsPerPage);
  const onThisPage = pageData.filter((q) => selectedIds.has(q.id)).length;
  const totalOnPage = pageData.length;

  // Pill + button visibility
  if (total === 0) {
    selectionPill.style.display = "none";
    bulkDeleteBtn.disabled = true;
  } else {
    selectionPill.style.display = "inline-flex";
    // Simplify to "X dipilih di halaman ini" ONLY when there are zero
    // selections on other pages (total selections == this page's row
    // count). Otherwise always show "X total · Y di halaman ini" so
    // cross-page selections stay visible (T5/T27). Fix from CP2 review.
    if (total === totalOnPage && total > 0) {
      selectionPillText.textContent = `${total} dipilih di halaman ini`;
    } else {
      selectionPillText.textContent = `${total} dipilih total · ${onThisPage} di halaman ini`;
    }
    bulkDeleteBtn.disabled = false;
  }

  // Header checkbox 3-state (Section 12 Appendix A state machine)
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

// setupCheckboxDelegation() — attach delegated `change` handler on bodyEl
// ONCE at file-init (Section 4.4a). The handler converts row-checkbox
// toggles into `selectedIds` Set mutations. Guard prevents re-attach on
// hot-reload / multiple init calls. Defensive null-check on bodyEl for
// load-time race resilience (spec minor polish item from R0.1 review).
let checkboxDelegationInstalled = false;
function setupCheckboxDelegation() {
  if (checkboxDelegationInstalled) return;
  if (!bodyEl) return;
  checkboxDelegationInstalled = true;
  bodyEl.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-checkbox");
    if (!cb) return;
    const id = parseInt(cb.dataset.id, 10);
    if (Number.isNaN(id)) return;
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUI();
  });
}

// ==== Bulk Delete: confirmation modal (per spec Section 4.8) ====
// Phase 2 (CP3 stub) — opens the dialog with current selectedIds count +
// (Phase 2) pack impact list. POST /api/questions/bulk-usage pre-fetch
// is NOT wired here (Phase 2 Step 8 / 10). For now we pass an empty
// usageMap {} and the modal shows "no pack impact" placeholder. Real
// Phase 2 will swap this for a fetch + showBulkDeleteConfirmModal call.
function showBulkDeleteConfirmModal(ids, usageMap) {
  const totalIds = ids.length;
  confirmTotalCountEl.textContent = totalIds;
  modalConfirmCountEl.textContent = totalIds;

  // Aggregate pack impact across all selected ids (dedupe sets).
  const allImpactedPacks = new Set();
  for (const id of ids) {
    const usage = usageMap[id];
    if (usage?.used && Array.isArray(usage.packs)) {
      for (const packName of usage.packs) allImpactedPacks.add(packName);
    }
  }

  confirmPackListEl.innerHTML = "";
  if (allImpactedPacks.size > 0) {
    confirmPackImpactEl.style.display = "block";
    for (const packName of allImpactedPacks) {
      const li = document.createElement("li");
      li.textContent = packName;
      confirmPackListEl.appendChild(li);
    }
  } else {
    confirmPackImpactEl.style.display = "none";
  }

  // Collapsible id list — keep modest cap to avoid huge DOM (cap 1000 map).
  // Phase 2 may want pagination within <details>; for v1 we slice.
  const MAX_IDS_SHOWN = 1000;
  const shown = ids.slice(0, MAX_IDS_SHOWN);
  const suffix = ids.length > MAX_IDS_SHOWN
    ? ` … (${ids.length - MAX_IDS_SHOWN} more)`
    : "";
  confirmIdListEl.textContent = shown.join(", ") + suffix;

  bulkDeleteConfirmModal.showModal();
}

// Event Listeners for Pagination & Search
document.getElementById("rows-per-page-top").addEventListener("change", (e) => {
  rowsPerPage = parseInt(e.target.value);
  document.getElementById("rows-per-page-bottom").value = e.target.value;
  currentPage = 0;
  renderTable();
});

document
  .getElementById("rows-per-page-bottom")
  .addEventListener("change", (e) => {
    rowsPerPage = parseInt(e.target.value);
    document.getElementById("rows-per-page-top").value = e.target.value;
    currentPage = 0;
    renderTable();
  });

document.getElementById("prev-page-btn-top").addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage--;
    renderTable();
  }
});

document
  .getElementById("prev-page-btn-bottom")
  .addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderTable();
    }
  });

document.getElementById("next-page-btn-top").addEventListener("click", () => {
  const filteredCount = questions.filter((q) => {
    const contentText = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
    const typeText = (q.question_type || "").toLowerCase();
    const term = searchTerm.toLowerCase();
    return contentText.includes(term) || typeText.includes(term);
  }).length;
  const totalPages = Math.ceil(filteredCount / rowsPerPage) || 1;
  if (currentPage < totalPages - 1) {
    currentPage++;
    renderTable();
  }
});

document
  .getElementById("next-page-btn-bottom")
  .addEventListener("click", () => {
    const filteredCount = questions.filter((q) => {
      const contentText = (q.content || "")
        .replace(/<[^>]*>/g, "")
        .toLowerCase();
      const typeText = (q.question_type || "").toLowerCase();
      const term = searchTerm.toLowerCase();
      return contentText.includes(term) || typeText.includes(term);
    }).length;
    const totalPages = Math.ceil(filteredCount / rowsPerPage) || 1;
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderTable();
    }
  });

document.getElementById("search-input").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  currentPage = 0;
  renderTable();
});

// Initialize/load questions
async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";
  // Wrapper is tab-indexed (region) and stays focusable if its inner table
  // is hidden. Use `inert` to opt the wrapper out of the focus order AND
  // the a11y tree while the table is hidden. (Fix from code-review of
  // kelola-soal-mobile-table-spec implementation.)
  tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", true);
  document.getElementById("controls-top").style.display = "none";
  document.getElementById("controls-bottom").style.display = "none";

  try {
    const res = await wrapFetch("/api/questions");
    questions = await res.json();
    loadingEl.style.display = "none";
    tableEl.style.display = "table";
    // Mirror the inert toggle for the wrapper now that the table is
    // visible. (See init() comment above for rationale.)
    tableEl.closest(".table-scroll-wrapper")?.toggleAttribute("inert", false);

    renderTable();  } catch (e) {
    if (e.message === "wrapFetch:SESSION_EXPIRED" || e.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    loadingEl.innerHTML = '<p style="color:var(--danger)">Gagal memuat bank soal.</p>';
    console.error("Failed to load questions:", e);
  }
}

// Render preview
function renderPreview() {
  syncEditorsToTextareas();

  const content = document.getElementById("q-content-text").value;
  const optA = document.getElementById("opt-a").value;
  const optB = document.getElementById("opt-b").value;
  const optC = document.getElementById("opt-c").value;
  const optD = document.getElementById("opt-d").value;
  const optE = document.getElementById("opt-e").value;
  const correct = document.getElementById("correct-ans").value;
  const explanation = document.getElementById("q-explanation").value;

  const previewArea = document.getElementById("preview-render-area");
  previewArea.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px">Pertanyaan:</div>
    <div style="margin-bottom:16px">${content || "(kosong)"}</div>
    <div style="margin-top:16px;line-height:1.8">
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "A" ? "var(--success)" : "inherit"}; min-width: 24px;">A.</span>
        <span>${optA || "(belum diisi)"}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "B" ? "var(--success)" : "inherit"}; min-width: 24px;">B.</span>
        <span>${optB || "(belum diisi)"}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "C" ? "var(--success)" : "inherit"}; min-width: 24px;">C.</span>
        <span>${optC || "(belum diisi)"}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "D" ? "var(--success)" : "inherit"}; min-width: 24px;">D.</span>
        <span>${optD || "(belum diisi)"}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "E" ? "var(--success)" : "inherit"}; min-width: 24px;">E.</span>
        <span>${optE || "(belum diisi)"}</span>
      </div>
    </div>
    <hr style="margin:20px 0;border:0;border-top:1px solid var(--border)">
    <div style="font-weight:bold;margin-bottom:8px">Pembahasan (Kunci: ${correct}):</div>
    <div>${explanation || "(belum diisi)"}</div>
  `;

  // Typeset with MathJax if available
  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([previewArea]).catch(() => {});
  }
}

// Tab switching
function switchTab(tabId) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.toggle("active", c.id === tabId));

  if (tabId === "tab-preview") {
    renderPreview();
  }
}

// Reset tabs to first tab
function resetTabs() {
  switchTab("tab-data");
}

// scrollToError utility: smooth-scroll to an Element (or selector) and trigger
// 'field-validation-error' border-pulse for 1.5s. Used in form.onsubmit validation
// since modal is now a single editable tab (no auto tab-switch fallback).
// Auto-opens parent <details> if collapsed so the field is visible.
function scrollToError(target) {
  const el =
    typeof target === "string"
      ? document.querySelector(target)
      : target;
  if (!el) return;
  // If target is inside a collapsed <details>, open it first so user can see the error.
  const parentDetails = el.closest("details");
  if (parentDetails && !parentDetails.open) {
    parentDetails.open = true;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("field-validation-error");
  setTimeout(() => el.classList.remove("field-validation-error"), 1500);
}

// Attach event listeners to tab buttons
function initTabNavigation() {
  document.querySelectorAll(".tab-btn").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
    });
  });
}

// Add question button handler
document.getElementById("add-q-btn").onclick = () => {
  form.reset();
  document.getElementById("q-id").value = "";
  modalTitle.textContent = "Tambah Soal Baru";

  clearEditors();
  resetTabs();

  // Initialize Quill editors when modal opens
  // Small timeout to ensure modal is fully rendered
  setTimeout(() => {
    if (!quillInitialized) {
      initQuillEditors();
    }
    initTabNavigation(); // Initialize tab navigation after modal opens
  }, 50);

  modal.showModal();
};

// Close modal
document.getElementById("close-modal-btn").onclick = () => modal.close();

// Form submit
form.onsubmit = async (e) => {
  e.preventDefault();
  syncEditorsToTextareas();

  const id = document.getElementById("q-id").value;
  const content = document.getElementById("q-content-text").value.trim();
  const options = {
    A: document.getElementById("opt-a").value.trim(),
    B: document.getElementById("opt-b").value.trim(),
    C: document.getElementById("opt-c").value.trim(),
    D: document.getElementById("opt-d").value.trim(),
    E: document.getElementById("opt-e").value.trim(),
  };
  const correct_answer = document.getElementById("correct-ans").value;
  const explanation = document.getElementById("q-explanation").value.trim();
  const question_type = document.getElementById("q-question-type").value;

  // Validation: scrollToError (with red border pulse) replaces old switchTab() calls
  // since modal is now a single editable tab — no need to switch.
  if (!content || content === "<p><br></p>") {
    alert("Teks / Pertanyaan wajib diisi!");
    scrollToError(
      document.querySelector("#q-content-editor")?.closest(".data-section-body"),
    );
    return;
  }
  if (
    !options.A ||
    options.A === "<p><br></p>" ||
    !options.B ||
    options.B === "<p><br></p>" ||
    !options.C ||
    options.C === "<p><br></p>" ||
    !options.D ||
    options.D === "<p><br></p>" ||
    !options.E ||
    options.E === "<p><br></p>"
  ) {
    alert("Semua Opsi Jawaban (A-E) wajib diisi!");
    scrollToError(
      document.querySelector("#opt-a-editor")?.closest(".data-section-body"),
    );
    return;
  }
  if (!correct_answer) {
    alert("Kunci Jawaban Benar wajib dipilih!");
    scrollToError("#correct-ans");
    return;
  }
  if (!explanation || explanation === "<p><br></p>") {
    alert("Pembahasan Cara Pengerjaan wajib diisi!");
    scrollToError(
      document
        .querySelector("#q-explanation-editor")
        ?.closest(".data-section-body"),
    );
    return;
  }
  if (!question_type) {
    alert("Tipe Soal wajib dipilih!");
    scrollToError("#q-question-type");
    return;
  }

  const payload = {
    content,
    question_type,
    options,
    correct_answer,
    explanation,
    // No image fields needed - images are inline in content/explanation
    image: null,
    image_url: null,
    explanation_image: null,
    explanation_image_url: null,
  };

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/questions/${id}` : "/api/questions";

  try {
    const res = await wrapFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    modal.close();
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menyimpan soal.");
    console.error("Save failed:", err);
  }
};

// Edit question
window.editQuestion = (id) => {
  const q = questions.find((x) => x.id === id);
  if (!q) return;

  document.getElementById("q-id").value = q.id;

  // Fill hidden textareas directly
  document.getElementById("q-content-text").value = q.content || "";
  document.getElementById("q-explanation").value = q.explanation || "";
  document.getElementById("opt-a").value = q.options.A || "";
  document.getElementById("opt-b").value = q.options.B || "";
  document.getElementById("opt-c").value = q.options.C || "";
  document.getElementById("opt-d").value = q.options.D || "";
  document.getElementById("opt-e").value = q.options.E || "";
  document.getElementById("correct-ans").value = q.correct_answer;
  document.getElementById("q-question-type").value =
    q.question_type || "TWK Pilar Negara";

  modalTitle.textContent = "Edit Soal";
  resetTabs();

  // Initialize Quill editors (if not yet mounted), then unconditionally
  // set their values. `new Quill(...)` is synchronous, so by the time
  // `setEditorValues` runs inside this setTimeout, `editorsReady` is
  // guaranteed to be true (or stays false if `window.Quill` failed to
  // load — in which case `setEditorValues` safely no-ops and the
  // hidden textareas above remain the source of truth on form submit).
  //
  // This fixes the first-Edit prefill bug: previously the immediate
  // `setEditorValues(...)` call ran before Quill mounted on the very
  // first click, so `editorsReady` was still false and the call was a
  // no-op; the data was only shown starting from the 2nd click.
  setTimeout(() => {
    if (!quillInitialized) {
      initQuillEditors();
    }
    setEditorValues(q.content, q.options, q.explanation);
    initTabNavigation(); // Initialize tab navigation after modal opens
  }, 50);

  modal.showModal();
};

// Delete question
window.deleteQuestion = async (id) => {
  try {
    // Check usage first
    const usageRes = await wrapFetch(`/api/questions/${id}/usage`);
    const usage = await usageRes.json();

    let msg = "Apakah Anda yakin ingin menghapus soal ini dari Bank Soal?";
    if (usage.used) {
      msg = `Soal ini digunakan di ${usage.packs.join(", ")}. Hapus?`;
    }

    if (!confirm(msg)) return;

    const res = await wrapFetch(`/api/questions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menghapus soal.");
    console.error("Delete failed:", err);
  }
};

// Initialize on load
init();

// ==================== BULK DELETE WIRING (Phase 1) ====================
// Spec: specs/bulk-delete-questions-spec.md Sections 4.4a + 4.5 + 4.6
// Phase 1 installs the state-machine + selection-state plumbing. The
// picker modal markup, <dialog id="bulk-delete-confirm-modal">, and the
// pre-fetch / submit handlers are Phase 2 (spec Steps 6-11) — not in
// this commit. bulk-delete-btn stays structurally disabled until then.

// Attach body-checkbox delegated listener ONCE (re-entry guard via flag).
setupCheckboxDelegation();

// Header checkbox: select/deselect all rows on current page only. Other
// pages retain their selection (counter pill text reflects total + per-page).
selectAllCheckbox.addEventListener("change", (e) => {
  const filtered = questions.filter((q) => {
    const contentText = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
    const typeText = (q.question_type || "").toLowerCase();
    const term = searchTerm.toLowerCase();
    return contentText.includes(term) || typeText.includes(term);
  });
  const start = currentPage * rowsPerPage;
  const pageData = filtered.slice(start, start + rowsPerPage);
  if (e.target.checked) {
    pageData.forEach((q) => selectedIds.add(q.id));
  } else {
    pageData.forEach((q) => selectedIds.delete(q.id));
  }
  updateSelectionUI();
});

// Pill × button: clear all selections.
clearSelectionBtn.addEventListener("click", () => {
  selectedIds.clear();
  updateSelectionUI();
  renderTable();
});

// Esc shortcut: clear selection when no modal open. Guard against
// <dialog> native close via Esc — we don't want to also wipe selection.
// Fall-through to ring-of-fire: if a delete-confirm modal IS open, the
// Esc press closes the modal first (browser default); selection stays
// intact so the user can retry.
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    selectedIds.size > 0 &&
    !document.querySelector("dialog[open]")
  ) {
    selectedIds.clear();
    updateSelectionUI();
    renderTable();
  }
});

// ==== Bulk Delete: pre-fetch usage + open confirmation modal (Phase 2 Step 10) ====
// Per spec Section 4.7: pre-fetch is single round-trip to
// /api/questions/bulk-usage. If it fails user gets an alert and the
// button state restores (no modal opens). On success the populated
// usageMap is passed to showBulkDeleteConfirmModal which then renders
// the pack-impact list inside the modal markup.
bulkDeleteBtn.onclick = async () => {
  if (selectedIds.size === 0) return; // defensive

  bulkDeleteBtn.disabled = true;
  const originalLabel = bulkDeleteBtn.textContent;
  bulkDeleteBtn.textContent = "Memeriksa...";

  try {
    const ids = Array.from(selectedIds);
    const res = await wrapFetch("/api/questions/bulk-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const usageMap = await res.json();
    showBulkDeleteConfirmModal(ids, usageMap);  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    console.error("Bulk usage pre-fetch failed:", err);
    alert("Gagal memeriksa soal. Coba lagi.");
  } finally {
    bulkDeleteBtn.textContent = originalLabel;
    // Re-enable iff selection is non-empty (user may have cleared it during pre-fetch
    // via Esc; updateSelectionUI handles the canonical case).
    updateSelectionUI();
  }
};

// ==== Bulk Delete: confirmation modal cancel button ====
bulkDeleteCancelBtn.addEventListener("click", () => {
  bulkDeleteConfirmModal.close();
});

// ==== Bulk Delete: confirmation modal submit button (Phase 2 Step 11) ====
// POST /api/questions/bulk-delete with Promise.allSettled best-effort on
// the server side. Client handles the {deleted, failed} response:
// - `deleted` ids pruned from selectedIds (gone from DB)
// - `failed` ids retained in selectedIds so user can retry without re-selecting
// - modal closes, alert shows summary (with first-failed reason if any)
// - init() refetches table to reflect new state. updateSelectionUI runs at
//   end of renderTable() inside init() so pill reflects remaining failed ids.
bulkDeleteConfirmBtn.addEventListener("click", async () => {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) {
    bulkDeleteConfirmModal.close();
    return;
  }

  bulkDeleteConfirmBtn.disabled = true;
  bulkDeleteCancelBtn.disabled = true;
  const originalConfirmLabel = bulkDeleteConfirmBtn.textContent;
  bulkDeleteConfirmBtn.textContent = "Menghapus...";

  // Activate global loading overlay (existing #loading element). Inject
  // progress text into the overlay without replacing the spinner.
  const loadingOverlay = document.getElementById("loading");
  loadingOverlay.style.display = "flex";
  let overlayMsg = loadingOverlay.querySelector("p.bulk-delete-progress");
  if (!overlayMsg) {
    overlayMsg = document.createElement("p");
    overlayMsg.className = "bulk-delete-progress";
    overlayMsg.style.cssText = "color: var(--text); margin-top: 16px;";
    loadingOverlay.appendChild(overlayMsg);
  }
  overlayMsg.textContent = `Menghapus ${ids.length} soal...`;

  try {
    const res = await wrapFetch("/api/questions/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json(); // {deleted: [...], failed: [{id, reason}]}
    handleBulkDeleteResponse(data, ids);  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    console.error("Bulk delete submit failed:", err);
    alert("Gagal menghapus soal. Coba lagi.");
  } finally {
    bulkDeleteConfirmBtn.disabled = false;
    bulkDeleteCancelBtn.disabled = false;
    bulkDeleteConfirmBtn.textContent = originalConfirmLabel;
    if (overlayMsg) overlayMsg.textContent = "";
    loadingOverlay.style.display = "none";
  }
});

// handleBulkDeleteResponse — prune deleted ids, close modal, alert summary,
// trigger table refresh. Per spec Section 4.9 + Appendix A: selectedIds
// retained for failed ids (enables user retry without re-selecting).
function handleBulkDeleteResponse(data, submittedIds) {
  const deleted = data.deleted || [];
  const failed = data.failed || [];

  // Prune successfully-deleted; failed stays (already in selectedIds).
  for (const id of deleted) selectedIds.delete(id);

  bulkDeleteConfirmModal.close();

  let alertMsg = `${deleted.length} soal berhasil dihapus`;
  if (failed.length > 0) {
    const firstReason = failed[0]?.reason || "unknown error";
    alertMsg = `${deleted.length} berhasil, ${failed.length} gagal — contoh #${failed[0].id}: ${firstReason}`;
  }
  alert(alertMsg);

  // Refresh table — init() refetches questions, calls renderTable() which
  // ends with updateSelectionUI(). After refresh, remaining selectedIds
  // (failed-only) reflect in the pill counter (T17 / T18 happy path).
  init();
}

// ==================== BULK ADD FUNCTIONS ====================
// Spec: specs/bulk-add-questions-spec.md
//
// Modal #q-bulk-modal (sibling of q-modal) lets an admin paste a batch
// of questions (8-line blocks separated by '---') into a plain-text
// Quill editor, see parsed blocks in the Preview tab, then save all
// valid blocks via a single POST /api/questions/bulk round-trip.
//
// Globals are intentionally namespaced under `bulk-` IDs or
// `window.bulkPasteEditor` / `window.lastBulkParse` so they cannot
// collide with the single-question modal's globals (contentEditor,
// explanationEditor, optionEditors, editorsReady, quillInitialized).

const bulkModal = document.getElementById("q-bulk-modal");
window.bulkPasteEditor = null;
window.lastBulkParse = [];

function initBulkQuillEditor() {
  // IMPORTANT: Do NOT add a custom onpaste / paste event handler here.
  // Quill's `clipboard.matchVisual: false` module below already
  // intercepts the paste event and inserts the plain text exactly
  // once. We previously also attached an onpaste attribute + JS handler
  // that ran AFTER Quill's clipboard and called insertText() again —
  // a double-insert bug that manifested visually as "a new line at
  // every pasted row" (each `\n` getting wrapped in a redundant <p>).
  // Quill's clipboard handler is sufficient; the text-change listener
  // below still fires and triggers parseBulkInput() for Preview.
  if (window.bulkPasteEditor || !window.Quill) return;

  try {
    window.bulkPasteEditor = new Quill("#bulk-q-paste-editor", {
      theme: "snow",
      modules: {
        toolbar: false, // plain-text only — no formatting UI
        clipboard: {
          matchVisual: false, // strip formatting on paste
        },
      },
      placeholder:
        "Paste banyak soal di sini (plain text). Setiap soal 8 baris (pertanyaan, 5 opsi, kunci, pembahasan). Pisahkan dengan baris '---'.",
    });

    // Re-parse on every text-change (cheap for typical <500-row pastes).
    window.bulkPasteEditor.on("text-change", () => {
      parseBulkInput();
    });

    console.log("Bulk Quill editor initialized");
  } catch (e) {
    console.error("Failed to initialize bulk Quill editor:", e);
  }
}

// Parse plain-text paste content into an array of block records.
// Spec: bulk-add-format-v2-spec.md
//
// The actual parsing logic lives in public/js/bulk-parser.js (loaded
// as `<script type="module">` in kelola-soal.html, side-effect
// attaches to `globalThis.bulkParser`). This wrapper just reads the
// current Tipe Soal dropdown, calls the pure parser, and updates
// the summary + preview DOM.
//
// Each block: { idx, status ('valid'|'invalid'), errors, content,
//   premises, question, options, correct_answer, explanation,
//   question_type }.
//   - For new-format blocks: `content` is HTML `<ol>…<p>…</p>`,
//     `premises` is a string array (may be empty for old format),
//     `question` is the text AFTER all premises.
//   - For old-format blocks: `content` is plain text (backwards
//     compat with v1), `premises` is [].
function parseBulkInput() {
  if (!window.bulkPasteEditor) {
    window.lastBulkParse = [];
    updateBulkSummary([], 0, 0, 0);
    return;
  }

  const rawText = window.bulkPasteEditor.getText();
  const questionType =
    document.getElementById("bulk-q-question-type")?.value ||
    "TWK Pilar Negara";

  // Defensive: if the parser module failed to load (e.g. the ESM
  // script tag was removed or the browser is very old), bail with
  // an empty parse rather than throwing. The user sees no preview
  // and a console error to investigate.
  if (!window.bulkParser || typeof window.bulkParser.parseBulkText !== "function") {
    console.error("[bulk-add] window.bulkParser is not available — bulk-parser.js module failed to load");
    window.lastBulkParse = [];
    updateBulkSummary([], 0, 0, 0);
    return;
  }

  const parsed = window.bulkParser.parseBulkText(rawText, questionType);

  window.lastBulkParse = parsed;
  const validCount = parsed.filter((b) => b.status === "valid").length;
  const invalidCount = parsed.filter((b) => b.status === "invalid").length;
  const newFormatCount = parsed.filter(
    (b) => b.status === "valid" && Array.isArray(b.premises) && b.premises.length > 0,
  ).length;
  updateBulkSummary(parsed, validCount, invalidCount, newFormatCount);
  renderBulkPreview(parsed, validCount, invalidCount);
}

function updateBulkSummary(parsed, valid, invalid, newFormatCount) {
  const summary = document.getElementById("bulk-preview-summary");
  if (!summary) return;
  if (parsed.length === 0) {
    summary.textContent = "Belum ada soal terdeteksi";
    return;
  }
  if (invalid === 0) {
    const oldFormatCount = parsed.length - newFormatCount;
    if (newFormatCount === parsed.length) {
      summary.textContent = `${parsed.length} soal valid (semua dengan premise) terdeteksi ✓`;
    } else if (newFormatCount === 0) {
      summary.textContent = `${parsed.length} soal valid (tanpa premise) terdeteksi ✓`;
    } else {
      summary.textContent = `${parsed.length} soal valid (${newFormatCount} dengan premise, ${oldFormatCount} tanpa) terdeteksi ✓`;
    }
  } else {
    summary.textContent = `${valid} valid · ${invalid} invalid dari ${parsed.length} blok`;
  }
}

// Render Preview tab. Read-only list. Each row: #num + status badge +
// optional error list + stacked fields (pertanyaan, A-E, kunci, bahas).
function renderBulkPreview(parsedBlocks, validCount, invalidCount) {
  const renderArea = document.getElementById("bulk-preview-render-area");
  if (!renderArea) return;

  if (parsedBlocks.length === 0) {
    renderArea.innerHTML =
      '<p style="color: var(--text-muted); text-align: center; padding: 32px">Belum ada soal. Paste soal di tab Data Soal.</p>';
    document.getElementById("bulk-save-btn").disabled = true;
    return;
  }

  renderArea.innerHTML = parsedBlocks
    .map((b, i) => {
      const badgeClass =
        b.status === "valid" ? "bulk-badge-success" : "bulk-badge-danger";
      const badgeText = b.status === "valid" ? "✓ VALID" : "✗ INVALID";
      const errorBlock =
        b.status === "invalid"
          ? `<div class="bulk-error-list">${b.errors
              .map((e) => `• ${esc(e)}`)
              .join("<br>")}</div>`
          : "";
      // Question / premise rendering depends on format. v1 used
      // b.A / b.B / b.key / b.content directly, but the v2 parser
      // (public/js/bulk-parser.js) groups options as {A,B,C,D,E}
      // (object) and exposes correct_answer / question / premises as
      // separate fields. Old-format blocks have b.premises = [] and
      // b.content = b.question (plain text) for backwards compat.
      let questionHtml = "";
      if (b.status === "valid") {
        const isNewFormat =
          Array.isArray(b.premises) && b.premises.length > 0;
        if (isNewFormat) {
          // <ol><li>…</li></ol> + <p>question</p> — the storage format
          // matches what exam/review/paket-detail will render.
          const olHtml = `<ol class="bulk-preview-ol">${b.premises
            .map((p) => `<li>${esc(p)}</li>`)
            .join("")}</ol>`;
          questionHtml = `${olHtml}<p class="bulk-preview-question">${esc(b.question)}</p>`;
        } else {
          questionHtml = `<div class="bulk-preview-question-plain">${esc(b.question)}</div>`;
        }
      }

      // Options A–E with the correct one highlighted. The A./B./etc.
      // prefix is rendered HERE (in the UI) — the parser already
      // stripped it from the stored value, so we re-add it for display.
      let optionsHtml = "";
      if (b.status === "valid" && b.options) {
        optionsHtml = ["A", "B", "C", "D", "E"]
          .map((k) => {
            const isCorrect = b.correct_answer === k;
            const cls = isCorrect
              ? "bulk-option-line bulk-option-correct"
              : "bulk-option-line";
            const text = b.options[k] || "(kosong)";
            return `<div class="${cls}"><span class="bulk-option-key">${k}.</span> ${esc(text)}</div>`;
          })
          .join("");
      }

      // Type + key + pembahasan footer.
      let footerHtml = "";
      if (b.status === "valid") {
        const typeLine = b.question_type
          ? `<div class="bulk-q-line"><em>Tipe: ${esc(b.question_type)}</em></div>`
          : "";
        const keyLine = `<div class="bulk-q-line"><em>[Kunci: ${esc(b.correct_answer)}]</em></div>`;
        const pembahasanLine = `<div class="bulk-preview-pembahasan"><em>Pembahasan:</em><br>${esc(b.explanation).replace(/\n/g, "<br>")}</div>`;
        footerHtml = typeLine + keyLine + pembahasanLine;
      }

      return `
        <div class="bulk-preview-row ${b.status}">
          <div class="bulk-preview-num">#${i + 1}</div>
          <div class="bulk-preview-body">
            <span class="bulk-status-badge ${badgeClass}">${badgeText}</span>
            ${errorBlock}
            <div class="bulk-preview-fields">
              ${questionHtml}
              ${optionsHtml}
              ${footerHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Disable Save when invalid blocks exist (strict mode per Round 1).
  document.getElementById("bulk-save-btn").disabled = invalidCount > 0;

  // Typeset math formulas (\( ... \) or \[ ... \] delimiters in
  // pertanyaan/pembahasan lines). Mirrors the pattern used by
  // single-question renderPreview() in this file and table-preview
  // render in renderTable(). Safe no-op when MathJax hasn't loaded
  // yet; .catch swallows any single typeset error so a transient
  // reload doesn't break Preview rendering.
  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([renderArea]).catch(() => {});
  }
}

// Bulk modal uses its own tab-nav (`.bulk-tab-btn`) to avoid
// conflict with single-question modal's `.tab-btn`/`switchTab` flow.
function switchBulkTab(tabId) {
  document.querySelectorAll(".bulk-tab-btn").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tabId)
  );
  document
    .querySelectorAll("#q-bulk-modal .tab-content")
    .forEach((c) => c.classList.toggle("active", c.id === tabId));
}

function initBulkTabNavigation() {
  // Replace each tab button with a clone to drop any prior listeners
  // (defensive against re-open of modal accumulating handlers).
  document.querySelectorAll(".bulk-tab-btn").forEach((tab) => {
    const fresh = tab.cloneNode(true);
    tab.parentNode.replaceChild(fresh, tab);
    fresh.addEventListener("click", () => switchBulkTab(fresh.dataset.tab));
  });
}

// ---------------------------- Event wiring ----------------------------

document.getElementById("bulk-add-btn").onclick = () => {
  // Reset modal state on each open.
  const typeSelect = document.getElementById("bulk-q-question-type");
  if (typeSelect) typeSelect.value = "TWK Pilar Negara";

  window.lastBulkParse = [];
  document.getElementById("bulk-preview-summary").textContent =
    "Belum ada soal terdeteksi";
  document.getElementById("bulk-preview-render-area").innerHTML =
    '<p style="color: var(--text-muted); text-align: center; padding: 32px">Belum ada soal. Paste soal di tab Data Soal.</p>';
  document.getElementById("bulk-save-btn").disabled = true;
  switchBulkTab("bulk-tab-data");

  // Init/mount Quill editor on first open; reuse on subsequent opens.
  setTimeout(() => {
    if (!window.bulkPasteEditor) {
      initBulkQuillEditor();
    } else {
      window.bulkPasteEditor.setText("");
    }
    initBulkTabNavigation();
    parseBulkInput(); // re-render empty state
  }, 50);

  bulkModal.showModal();
};

document.getElementById("bulk-close-modal-btn").onclick = () => {
  bulkModal.close();
  // Clear paste content so re-open doesn't leak stale state.
  if (window.bulkPasteEditor) window.bulkPasteEditor.setText("");
  window.lastBulkParse = [];
};

// Native <dialog> fires 'close' on Esc and on `.close()` from anywhere.
// The above button handler covers button-click Esc-close, but to be
// defensive we also reset state on the dialog's own 'close' event so
// that any future callers of `bulkModal.close()` (e.g. backdrop click)
// don't leak stale paste/lastBulkParse across opens.
bulkModal.addEventListener("close", () => {
  if (window.bulkPasteEditor) window.bulkPasteEditor.setText("");
  window.lastBulkParse = [];
});

document.getElementById("q-bulk-form").onsubmit = async (e) => {
  e.preventDefault();
  // Re-parse to capture latest Tipe Soal dropdown changes (in case
  // user switched dropdown after paste but before save).
  parseBulkInput();

  const validBlocks = window.lastBulkParse.filter(
    (b) => b.status === "valid"
  );
  if (validBlocks.length === 0) {
    alert("Tidak ada soal valid untuk disimpan.");
    return;
  }

  const saveBtn = document.getElementById("bulk-save-btn");
  saveBtn.disabled = true;
  const originalLabel = saveBtn.textContent;
  saveBtn.textContent = "Menyimpan...";

  const payload = {
    questions: validBlocks.map((b) => ({
      content: b.content,
      // New parser stores options as {A, B, C, D, E} object with the
      // A./B./etc. prefix already stripped (v1 bug fix). correct_answer
      // is the uppercased single letter.
      options: b.options,
      correct_answer: b.correct_answer,
      explanation: b.explanation,
      question_type:
        document.getElementById("bulk-q-question-type")?.value ||
        b.question_type,
    })),
  };

  try {
    const res = await wrapFetch("/api/questions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    bulkModal.close();
    if (window.bulkPasteEditor) window.bulkPasteEditor.setText("");
    window.lastBulkParse = [];
    alert(`${data.inserted ?? validBlocks.length} soal berhasil ditambahkan`);
    init(); // refresh table to show new rows
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menyimpan soal bulk. Coba lagi.");
    console.error("Bulk save failed:", err);
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
};
