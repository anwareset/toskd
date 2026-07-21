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
const confirmSoalListEl = document.getElementById("confirm-soal-list");

// ==== Notification modal (info-only, single OK button) ====
// Replaces native alert() for bulk-delete success notifications (per user
// request 2026-07-21). Mirror of the same pattern in public/js/paket-detail.js.
const kelolaNotificationModal = document.getElementById("notification-modal");
const kelolaNotificationTitleEl = document.getElementById("notification-title");
const kelolaNotificationMessageEl = document.getElementById("notification-message");
const kelolaNotificationOkBtn = document.getElementById("notification-ok-btn");
if (kelolaNotificationOkBtn) {
  kelolaNotificationOkBtn.addEventListener("click", () => {
    if (kelolaNotificationModal) kelolaNotificationModal.close();
  });
}
function showNotification(title, message) {
  if (!kelolaNotificationModal) {
    // Fallback if modal markup didn't load.
    alert(message);
    return;
  }
  if (kelolaNotificationTitleEl) kelolaNotificationTitleEl.textContent = title;
  if (kelolaNotificationMessageEl) kelolaNotificationMessageEl.textContent = message;
  kelolaNotificationModal.showModal();
}

// ==== Single Delete (per-row "Hapus" button) confirm modal ====
// Mirror of the bulk-delete-confirm-modal but for a single question.
// Replaces the old native confirm() dialog so the admin can SEE which
// paket soal the question is tied to before confirming — same UX
// affordance as the bulk flow. See public/kelola-soal.html for the
// <dialog id="single-delete-confirm-modal"> markup.
const singleDeleteConfirmModal = document.getElementById("single-delete-confirm-modal");
const singleDeleteConfirmBtn = document.getElementById("single-delete-confirm-btn");
const singleDeleteCancelBtn = document.getElementById("single-delete-cancel-btn");
const singleConfirmIdEl = document.getElementById("single-confirm-id");
const singleConfirmSoalListEl = document.getElementById("single-confirm-soal-list");
// pendingSingleDeleteId holds the id of the question the user is
// about to delete while the confirm modal is open. Set by
// window.deleteQuestion() when the modal opens; cleared after the
// confirm handler runs the DELETE call (success or failure).
let pendingSingleDeleteId = null;
// In-flight guard for window.deleteQuestion: set synchronously true
// at the start of the call (before the first await) so a fast
// double-click on the per-row Hapus button sees the flag as true
// and returns immediately — preventing a second concurrent fetch
// that would later throw InvalidStateError when it calls showModal()
// on a dialog the first call already opened. The `.open` property
// can't be used for this because the modal isn't open yet during the
// await window. Cleared in the finally block of deleteQuestion.
// Per code-reviewer-glm Round-2 critical feedback.
let isDeleteQuestionInFlight = false;

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

// ========================================================================
// ============================================================================
// ============================================================================
// ============================================================================
// Markdown ![alt](url) → image embed (Round-9d, 2026-07-19)
// ============================================================================
// Per user request 2026-07-19: USE markdown syntax only, REMOVE raw URL
// whole-text auto-embed. Admin must type `![alt](url)` explicitly to
// insert an image; bare pasted URLs pass through as plain text. This
// makes the intent unambiguous — embed vs text is controlled by
// formatting, not by guessing.
//
// Single method: only the markdown syntax is intercepted at Quill's
// clipboard parser via addMatcher(Node.TEXT_NODE). Plain URL paste
// falls through as text verbatim.
//
// Idempotency: __imagePasteBound flag on the quill instance prevents
// duplicate matchers if initQuillEditors() is repeatedly invoked.
// ============================================================================
// Same regex shape as tests/test-image-url-paste.mjs IMAGE_MD_REGEX
// (mirrored). Captures: 1 = alt text, 2 = url ending in image-ext.
const IMAGE_MD_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^)]*)?)\)/g;

function bindPasteImageHandler(quill) {
  if (quill.__imagePasteBound) return;
  quill.__imagePasteBound = true; // idempotency: skip if already attached

  const Delta = Quill.import("delta");

  quill.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
    const text = node.data;
      if (!text) return delta;

      // Walk markdown regex; preserve inter-match text as text-ops,
      // substitute matches with image embeds. Multiple matches per
      // paste all handled.
      let lastIndex = 0;
      let match;
      let hasMd = false;
      const newDelta = new Delta();
      while ((match = IMAGE_MD_REGEX.exec(text)) !== null) {
        hasMd = true;
        if (match.index > lastIndex) {
          newDelta.insert(text.substring(lastIndex, match.index));
        }
        newDelta.insert({ image: match[2] });
        lastIndex = match.index + match[0].length;
      }
      if (hasMd) {
        if (lastIndex < text.length) {
          newDelta.insert(text.substring(lastIndex));
        }
        return newDelta;
      }
      return delta; // plain text passthrough — no markdown, no embed
  });
}

// Round-12 (2026-07-19): renderInlineMd — mirror of Round-10 inline
// markdown ![]() → <img> helper di exam.js + review.js, brought into
// kelola-soal.js for Edit Soal Preview tab. HTML-input variant (no esc)
// because renderPreview builds HTML strings (q.content is Quill innerHTML,
// already pre-escaped). Applies at 7 sites in renderPreview(): q.content,
// options A-E, q.explanation.
function renderInlineMd(html) {
  if (typeof html !== "string") return html;
  return html.replace(
    IMAGE_MD_REGEX,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin-top:8px">',
  );
}
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

    // Round-9: auto-embed image URLs pasted as a single token
    bindPasteImageHandler(contentEditor);

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

    // Round-9: auto-embed image URLs pasted in explanation too
    bindPasteImageHandler(explanationEditor);

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

// getFilteredQuestions() — shared case-insensitive substring filter over
// the module-level `questions` array, scoped to `q.content` (with HTML
// tags stripped) OR `q.question_type`. Replaces 5 inline copies that
// previously duplicated the same 7-line block in: renderTable,
// updateSelectionUI, the select-all header handler, and the 2 next-page
// bounds-check handlers (top + bottom bar). Single source of truth so
// a future tweak to the search surface (e.g., add options.A-E match
// or add soal id number) changes ONE place, not 5.
//
// State inputs are `questions` (cache populated by /api/questions in
// init() + refreshed on every mutation) and `searchTerm` (module-level,
// written by the search-input handler). Both are well-defined by the
// time any caller fires — renderTable only runs from event handlers that
// mutate AFTER init() has populated `questions`; the search input wires
// `searchTerm` synchronously inside its handler before the next
// reapplyView() call.
//
// O(N) per call but bounded by user input event rate + question count
// (~thousands). No memoization — adding a cache would require tracking
// `questions` mutation (init / add / edit / delete) for invalidation,
// more complexity than the savings warrant.
function getFilteredQuestions() {
  const term = searchTerm.toLowerCase();
  if (!term) return questions;
  return questions.filter((q) => {
    const contentText = (q.content || "").replace(/<[^>]*>/g, "").toLowerCase();
    const typeText = (q.question_type || "").toLowerCase();
    return contentText.includes(term) || typeText.includes(term);
  });
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
  const filtered = getFilteredQuestions();

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
  // Compute "on this page" subset using the shared getFilteredQuestions()
  // helper — same surface as renderTable (matches contentText or tipe).
  const filtered = getFilteredQuestions();
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

// ==== Bulk Delete: confirmation modal — per-soal detail (Round 6 redesign) ====
//
// Per user request: the modal should list each SELECTED soal and the
// packs it's used in (NOT an aggregated unique-pack list). Format per
// row (matches the user's stated example):
//
//     Soal #<id> tipe <type> digunakan di paket <packs>
//     Soal #<id> tipe <type> tidak terkait paket manapun
//
// Soals are rendered in id-ascending order for determinism (stable
// across re-opens, matches DB insertion order which the admin user
// most recently added).
//
// The block is now ALWAYS shown when the modal opens (no display:none
// toggling) — the list always has N rows (one per selected id), even
// when all are orphan soal. The `bulkDeleteBtn` is `disabled` when
// `selectedIds.size === 0`, so this modal can't practically be opened
// with an empty selection; defensively the function renders gracefully
// with an empty ul in that case.
function showBulkDeleteConfirmModal(ids, usageMap) {
  confirmTotalCountEl.textContent = ids.length;
  // Re-query the count span each time in case a previous bulk-delete run
  // destroyed it via textContent assignment on the parent button. If the
  // span is missing, create a placeholder so the count is still visible.
  const countSpan = document.getElementById("modal-confirm-count");
  if (countSpan) {
    countSpan.textContent = ids.length;
  }

  // Build id → question lookup ONCE so each row's tipe is a constant-
  // time read instead of an O(N) array scan per soal. The questions
  // cache is refreshed by init() before bulkDeleteBtn can be used, so
  // every selected id is guaranteed to be present (or moderately stale
  // which is acceptable — modal is just informational).
  const qById = new Map(questions.map((q) => [q.id, q]));
  // Sort ids ascending by numeric value; Set/Array.from iterates in
  // insertion order, but id-ascending matches DB insertion order which
  // is what the user expects.
  const sortedIds = ids.slice().sort((a, b) => a - b);

  const rowHtml = sortedIds
    .map((id) => {
      const q = qById.get(id);
      const tipe = q?.question_type || "—";
      const usage = usageMap[id];
      const hasPacks =
        usage?.used && Array.isArray(usage.packs) && usage.packs.length > 0;
      const packsText = hasPacks ? usage.packs.join(", ") : "tidak terkait paket manapun";
      const verb = hasPacks ? "digunakan" : "tidak terkait";
      return `<li>Soal <strong>#${id}</strong> tipe <em>${esc(tipe)}</em> ${verb} di paket <strong>${esc(packsText)}</strong></li>`;
    })
    .join("");

  confirmSoalListEl.innerHTML = rowHtml;

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
  const filteredCount = getFilteredQuestions().length;
  const totalPages = Math.ceil(filteredCount / rowsPerPage) || 1;
  if (currentPage < totalPages - 1) {
    currentPage++;
    renderTable();
  }
});

document
  .getElementById("next-page-btn-bottom")
  .addEventListener("click", () => {
    const filteredCount = getFilteredQuestions().length;
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
    // Default sort: newest-soal first. Stable by Date comparison;
    // ties preserve DB order (V8 sort is stable). Re-applied on
    // every init() so add/delete/refresh keeps newest-at-top invariant.
    // Falls back to epoch 0 if a row is missing created_at.
    questions.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );
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
    <div style="margin-bottom:16px">${renderInlineMd(content || "(kosong)")}</div>
    <div style="margin-top:16px;line-height:1.8">
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "A" ? "var(--success)" : "inherit"}; min-width: 24px;">A.</span>
        <span>${renderInlineMd(optA || "(belum diisi)")}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "B" ? "var(--success)" : "inherit"}; min-width: 24px;">B.</span>
        <span>${renderInlineMd(optB || "(belum diisi)")}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "C" ? "var(--success)" : "inherit"}; min-width: 24px;">C.</span>
        <span>${renderInlineMd(optC || "(belum diisi)")}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "D" ? "var(--success)" : "inherit"}; min-width: 24px;">D.</span>
        <span>${renderInlineMd(optD || "(belum diisi)")}</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:bold;color:${correct === "E" ? "var(--success)" : "inherit"}; min-width: 24px;">E.</span>
        <span>${renderInlineMd(optE || "(belum diisi)")}</span>
      </div>
    </div>
    <hr style="margin:20px 0;border:0;border-top:1px solid var(--border)">
    <div style="font-weight:bold;margin-bottom:8px">Pembahasan (Kunci: ${correct}):</div>
    <div>${renderInlineMd((explanation || "(belum diisi)").replace(/(\r?\n)/g, "<br>"))}</div>
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
  // Round-8 TDZ fix: declare question_type BEFORE correct_answer because
  // the latter calls isTkpType(question_type). Originally the in-function
  // order was: correct_answer (read from #correct-ans dropdown, didn't
  // need question_type) THEN question_type (read for other validation).
  // After Round-8 derives correct_answer from bobot for TKP, the
  // dependency flipped — must declare question_type first to avoid
  // ReferenceError: Cannot access 'question_type' before initialization
  // (line 842 TDZ throw on submit). 
  const question_type = document.getElementById("q-question-type").value;
  // Round-8 (user request): TKP no longer needs an explicit Kunci Jawaban
  // Benar dropdown — auto-derive correct_answer from the option with the
  // highest bobot weight, mirroring the bulk-parser's enrichTkpBobot.
  // The dropdown is hidden for TKP (CSS `.tkp-mode #correct-ans-group`),
  // but is still read in the binary path (TWK/TIU) below.
  const correct_answer = isTkpType(question_type)
    ? deriveCorrectAnswerFromBobot()
    : document.getElementById("correct-ans").value;
  const explanation = document.getElementById("q-explanation").value.trim();

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
    // TKP weighted-scoring (spec §5.1 / §8): include option_scores whenever
    // question_type starts with "TKP". Null otherwise so the server clears any
    // stale weight values for binary soal (V5 tolerated).
    // Round-8 case fix: readBobotValues() iterates BOBOT_LETTERS = ["a",
    // "b", "c", "d", "e"] (lowercase) and writes the keys verbatim, so
    // it returns {a:2, b:1, c:5, d:3, e:4} for a fully filled TKP soal.
    // Server-side validateOptionScores() (src/server.js line ~370) checks
    // keys against the canonical uppercase set ["A","B","C","D","E"] and
    // rejects anything else — PostgREST 400 Bad Request on the soal POST.
    // Fix: uppercase the keys at the boundary before sending. We don't
    // rewrite readBobotValues() itself because local callers (validateBobot,
    // applyBobotUiState helpers) iterate BOBOT_LETTERS lowercase to look
    // up `values[letter]` and changing the return shape would break them.
    // Inline Object.fromEntries + map is fine — runs once per submit.
    option_scores: isTkpType(question_type)
      ? Object.fromEntries(
          Object.entries(readBobotValues()).map(([k, v]) => [
            k.toUpperCase(),
            v,
          ]),
        )
      : null,
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
    showNotification("✓ Soal Disimpan", "Soal berhasil disimpan.");
    init();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    showNotification("❌ Gagal Menyimpan", "Gagal menyimpan soal. Coba lagi.");
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

  // TKP weighted-scoring (per spec §5.1 / §8): populate Bobot inputs from
  // q.option_scores and switch the form into TKP visual mode. The helper
  // also runs validation so submit is enabled for a valid TKP soal.
  setBobotFromQuestion(q);

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

// Delete question — opens the single-delete confirm modal (mirror of
// the bulk-delete flow) so the admin can SEE which paket soal the
// question is tied to before confirming. Replaces the old native
// confirm() dialog. The actual DELETE call happens in the
// singleDeleteConfirmBtn click handler below, after the user confirms.
// pendingSingleDeleteId bridges the two handlers.
window.deleteQuestion = async (id) => {
  // Guard against double-click race: set the in-flight flag
  // SYNCHRONOUSLY (before the first await) so a fast double-click on
  // the Hapus button sees the flag as true and returns immediately.
  // The `.open` property can't guard this because the modal isn't
  // open yet during the await fetch window — both concurrent calls
  // would pass an `.open` check, both would later try showModal(),
  // and the second would throw InvalidStateError (misreported by the
  // catch block as "Gagal memeriksa soal"). The flag is cleared in
  // the finally block below. Per code-reviewer-glm Round-2 critical
  // feedback (Round-1 `.open` guard was ineffective for the typical
  // double-click-before-fetch-resolves race).
  if (isDeleteQuestionInFlight) return;
  isDeleteQuestionInFlight = true;
  try {
    // Check usage first (same endpoint as the old confirm() flow).
    const usageRes = await wrapFetch(`/api/questions/${id}/usage`);
    const usage = await usageRes.json();

    // Populate the modal with the question's pack-usage detail.
    pendingSingleDeleteId = id;
    singleConfirmIdEl.textContent = `#${id}`;

    const q = questions.find((x) => x.id === id);
    const tipe = q?.question_type || "—";
    const hasPacks =
      usage?.used && Array.isArray(usage.packs) && usage.packs.length > 0;
    const packsText = hasPacks ? usage.packs.join(", ") : "tidak terkait paket manapun";
    const verb = hasPacks ? "digunakan" : "tidak terkait";
    singleConfirmSoalListEl.innerHTML =
      `<li>Soal <strong>#${id}</strong> tipe <em>${esc(tipe)}</em> ${verb} di paket <strong>${esc(packsText)}</strong></li>`;

    singleDeleteConfirmModal.showModal();
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    showNotification("❌ Gagal Memeriksa", "Gagal memeriksa soal. Coba lagi.");
    console.error("Single usage pre-fetch failed:", err);
  } finally {
    isDeleteQuestionInFlight = false;
  }
};

// ==== Single Delete: confirmation modal cancel button ====
// Mirrors the bulk-delete cancel handler. Closes the modal and clears
// the pending id so a stale value can't leak into a future confirm.
if (singleDeleteCancelBtn) {
  singleDeleteCancelBtn.addEventListener("click", () => {
    if (singleDeleteConfirmModal) singleDeleteConfirmModal.close();
    pendingSingleDeleteId = null;
  });
}

// ==== Single Delete: confirmation modal submit button ====
// Runs the actual DELETE /api/questions/:id call after the user
// confirms. Mirrors the bulk-delete confirm handler's UX pattern:
// disable both buttons during the in-flight DELETE, show "Menghapus...",
// re-enable in finally. On success, close modal + init() to refresh
// the table; on failure, alert + keep modal open so the user can retry.
if (singleDeleteConfirmBtn) {
  singleDeleteConfirmBtn.addEventListener("click", async () => {
    const id = pendingSingleDeleteId;
    if (id == null) {
      if (singleDeleteConfirmModal) singleDeleteConfirmModal.close();
      return;
    }

    singleDeleteConfirmBtn.disabled = true;
    singleDeleteCancelBtn.disabled = true;
    const originalConfirmLabel = singleDeleteConfirmBtn.textContent;
    singleDeleteConfirmBtn.textContent = "Menghapus...";

    try {
      const res = await wrapFetch(`/api/questions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (singleDeleteConfirmModal) singleDeleteConfirmModal.close();
      pendingSingleDeleteId = null;
      init();
    } catch (err) {
      if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
      console.error("Single delete submit failed:", err);
      showNotification("❌ Gagal Menghapus", "Gagal menghapus soal. Coba lagi.");
    } finally {
      singleDeleteConfirmBtn.disabled = false;
      singleDeleteCancelBtn.disabled = false;
      singleDeleteConfirmBtn.textContent = originalConfirmLabel;
    }
  });
}

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
  const filtered = getFilteredQuestions();
  const start = currentPage * rowsPerPage;
  const pageData = filtered.slice(start, start + rowsPerPage);
  if (e.target.checked) {
    pageData.forEach((q) => selectedIds.add(q.id));
  } else {
    pageData.forEach((q) => selectedIds.delete(q.id));
  }
  // Re-render the body so the row checkboxes visually reflect the
  // updated `selectedIds`. The header checkbox's `checked` state was
  // already set by the user's click; only the row DOM nodes need to
  // re-sync. renderTable() ends with updateSelectionUI(), which also
  // re-asserts the 3-state header from selectedIds (defensive in case
  // the state machine ever drifts). Without renderTable(), the row
  // `<input>`s would still appear unchecked even though selectedIds
  // is correct (the `isSelected` attribute is set in the HTML
  // template, not on a live DOM node).
  renderTable();
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
    showNotification("❌ Gagal Memeriksa", "Gagal memeriksa soal. Coba lagi.");
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
  bulkDeleteCancelBtn.disabled = true;    // Save innerHTML (NOT textContent) so the inner <span id="modal-confirm-count">
    // survives the text change and can be re-created on restore (fix: count
    // stays stale on next modal open if the span is destroyed).
    const originalConfirmInner = bulkDeleteConfirmBtn.innerHTML;
    bulkDeleteConfirmBtn.innerHTML = "Menghapus...";

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
    showNotification("❌ Gagal Menghapus", "Gagal menghapus soal. Coba lagi.");
  } finally {
    bulkDeleteConfirmBtn.disabled = false;
    bulkDeleteCancelBtn.disabled = false;      bulkDeleteConfirmBtn.innerHTML = originalConfirmInner;
    if (overlayMsg) overlayMsg.textContent = "";
    loadingOverlay.style.display = "none";
  }
});

// handleBulkDeleteResponse — prune deleted ids, close modal, show notification,
// trigger table refresh. Per spec Section 4.9 + Appendix A: selectedIds
// retained for failed ids (enables user retry without re-selecting).
// Notifikasi memakai showNotification() (modal, bukan native alert())
// per user request 2026-07-21.
function handleBulkDeleteResponse(data, submittedIds) {
  const deleted = data.deleted || [];
  const failed = data.failed || [];

  // Prune successfully-deleted; failed stays (already in selectedIds).
  for (const id of deleted) selectedIds.delete(id);

  bulkDeleteConfirmModal.close();

  let notifTitle = "✓ Soal Dihapus";
  let notifMsg = `${deleted.length} soal berhasil dihapus`;
  if (failed.length > 0) {
    const firstReason = failed[0]?.reason || "unknown error";
    notifTitle = "⚠️ Hapus Sebagian Gagal";
    notifMsg = `${deleted.length} berhasil, ${failed.length} gagal — contoh #${failed[0].id}: ${firstReason}`;
  }
  showNotification(notifTitle, notifMsg);

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
    // Round-9f (2026-07-19): bulk editor stays plain-text only —
    // ![]() syntax paste renders as TEXT (no Quill image embed) so
    // parseBulkInput() can still extract the URL string via getText().
    // The Preview tab converts the same ![]() syntax to <img> via
    // renderInlinePreview() (defined near renderBulkPreview).

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

// Round-15 helper (2026-07-19): bulk-preview-summary now lives in TWO
// places — inside the Data tab <details> info-bar AND inline above
// the read-only render area in Preview tab (see kelola-soal.html
// `class="bulk-preview-summary"` markup). Routing all textContent
// updates through this class-based querySelectorAll iteration keeps
// the two banners in lockstep with one call site, and avoids the
// duplicate-id HTML anti-pattern that would result from copy-pasting
// `<span id="bulk-preview-summary">` into a second location. Both
// elements keep their distinct ids (bulk-preview-summary in Data tab,
// bulk-preview-summary-preview in Preview tab) for any explicit-id
// lookups that may exist elsewhere. No-op when the modal is closed
// because both elements are inside #q-bulk-modal (DOM-removed if
// <dialog> is force-closed by the OS, but in the project's lifecycle
// the modal stays in DOM as a hidden <dialog>).
function setBulkPreviewSummary(text) {
  document.querySelectorAll(".bulk-preview-summary").forEach((el) => {
    el.textContent = text;
  });
}

function updateBulkSummary(parsed, valid, invalid, newFormatCount) {
  // Round-15: route ALL status updates through setBulkPreviewSummary
  // so the Data tab info-bar + Preview tab inline banner stay in
  // sync with one source of truth. Was: direct assignment to a single
  // getElementById'd element (the prior Data-tab-only banner). Caller
  // contract unchanged — same status string, same params.
  if (parsed.length === 0) {
    setBulkPreviewSummary("Belum ada soal terdeteksi");
    return;
  }
  if (invalid === 0) {
    const oldFormatCount = parsed.length - newFormatCount;
    if (newFormatCount === parsed.length) {
      setBulkPreviewSummary(`${parsed.length} soal valid (semua dengan premise) terdeteksi ✓`);
    } else if (newFormatCount === 0) {
      setBulkPreviewSummary(`${parsed.length} soal valid (tanpa premise) terdeteksi ✓`);
    } else {
      setBulkPreviewSummary(`${parsed.length} soal valid (${newFormatCount} dengan premise, ${oldFormatCount} tanpa) terdeteksi ✓`);
    }
  } else {
    setBulkPreviewSummary(`${valid} valid · ${invalid} invalid dari ${parsed.length} blok`);
  }
}

// IMAGE_INLINE_REGEX — markdown ![]() image syntax, mirrors the
// pattern in bindPasteImageHandler (tests/test-image-url-paste.mjs
// IMAGE_MD_REGEX). Used by renderInlinePreview for bulk-preview rendering
// (NOT for paste interception — Round-9f keeps bulk paste plain-text).
const IMAGE_INLINE_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^)]*)?)\)/g;

// renderInlinePreview(rawText) — for bulk Preview tab. Converts markdown
// ![]() syntax to inline <img> tags while HTML-escaping non-match text.
// Idempotent — empty input returns empty string; no match returns just
// esc(rawText). Used at 3 sites in renderBulkPreview (premise li,
// question p, plain question div).
function renderInlinePreview(rawText) {
  if (!rawText) return "";
  // Defensive lastIndex reset — IMAGE_INLINE_REGEX is /g-flagged,
  // lastIndex persists across calls. Without reset, the second call's
  // match would resume from where the first left off.
  IMAGE_INLINE_REGEX.lastIndex = 0;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = IMAGE_INLINE_REGEX.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(esc(rawText.substring(lastIndex, match.index)));
    }
    parts.push(
      `<img src="${esc(match[2])}" alt="${esc(match[1])}" class="bulk-md-image">`,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < rawText.length) {
    parts.push(esc(rawText.substring(lastIndex)));
  }
  return parts.join("");
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
          // Round-4 verbatim display: inline `list-style-type: none`
          // suppresses the browser's default `1./2./3.` prefix on
          // top of the user's typed markers (`1)`, `2)`, etc.). The
          // class `bulk-preview-ol` carries the same suppression
          // — CSS in styles.css has it scoped to `.bulk-preview-ol`
          // as a defense-in-depth fallback if the inline style is
          // stripped by a future Quill round-trip.
          const olHtml = `<ol class="bulk-preview-ol" style="list-style-type: none; margin: 0; padding-left: 0;">${b.premises
            .map((p) => `<li>${renderInlinePreview(p)}</li>`)
            .join("")}</ol>`;
          // Multi-line question support (catalog case #B): if the
          // block's question contains `\n`-separated paragraphs,
          // emit one <p> per paragraph so each renders as its own
          // row in the modal preview.
          if (b.question) {
            const paragraphs = b.question
              .split("\n")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            const pHtml = paragraphs
              .map((p) => `<p class="bulk-preview-question">${renderInlinePreview(p)}</p>`)
              .join("");
            questionHtml = `${olHtml}${pHtml}`;
          } else {
            questionHtml = olHtml;
          }
        } else {
          questionHtml = `<div class="bulk-preview-question-plain">${renderInlinePreview(b.question)}</div>`;
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
        const pembahasanLine = `<div class="bulk-preview-pembahasan"><em>Pembahasan:</em><br>${renderInlinePreview(b.explanation).replace(/\n/g, "<br>")}</div>`;
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
  if (typeSelect) {
    typeSelect.value = "TWK Pilar Negara";
    // Re-evaluate the binary-vs-TKP help block after the JS-forced
    // value reset. Programmatic `el.value = "…"` does NOT fire
    // 'change', so the listener attached in initBulkHelpModeToggle()
    // won't run on its own for a modal re-open — call setBulkHelpMode
    // explicitly so the binary help is shown on first open. Idempotent.
    setBulkHelpMode(typeSelect.value);
  }

  window.lastBulkParse = [];
  // Round-15: reset BOTH Data-tab + Preview-tab summary banners via
  // the shared class helper. Replaces the prior single-id lookup.
  setBulkPreviewSummary("Belum ada soal terdeteksi");
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
      // TKP weighted-scoring (spec §5.1 / §9.2): bulk-parser attaches
      // option_scores to TKP blocks via tkpWeightsFromKey(key). Forward it
      // to the server so bulk-inserted TKP soal persist with weights.
      // Binary blocks leave it null so the server stores NULL.
      option_scores: b.option_scores ?? null,
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
    showNotification("✓ Soal Ditambahkan", `${data.inserted ?? validBlocks.length} soal berhasil ditambahkan`);
    init(); // refresh table to show new rows
  } catch (err) {
    if (err.message === "wrapFetch:SESSION_EXPIRED" || err.message.startsWith("wrapFetch:SERVER_ERROR_")) return;
    alert("Gagal menyimpan soal bulk. Coba lagi.");
    console.error("Bulk save failed:", err);
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
};

// ============================================================================
// TKP weighted-scoring UI integration (per tkp-scoring-spec.md §8, §19.1)
// ============================================================================
//
// We add five small helpers to manage the per-option Bobot inputs that the
// modal now contains. The integration points:
//   * applyBobotUiState(qtype)   — toggles `.tkp-mode` class on the form,
//                                  runs validation, paints per-input/helper,
//                                  banner, and disables submit on invalid.
//   * readBobotValues()          — returns {a..e: int|null|NaN} from inputs.
//   * validateBobot(values)      — invariant {1,2,3,4,5} distinct + range.
//   * setBobotFromQuestion(q)    — editQuestion hook: populates from
//                                  `q.option_scores` (TKP) or blanks (binary).
//   * initTkpListeners()         — attaches change/input listeners once.
//
// Submit payload at line ~888 injects `option_scores` only when the type
// starts with "TKP" (case-insensitive); bulk-post handler is unaffected —
// the parser already attaches option_scores for TKP blocks (`bulk-parser.js`).
// ============================================================================

const BOBOT_LETTERS = ["a", "b", "c", "d", "e"];

function isTkpType(qtype) {
  return typeof qtype === "string" && qtype.trim().toUpperCase().startsWith("TKP");
}

// Round-8 (user request): TKP correct answer is auto-derived from the
// option carrying the highest bobot weight. Validates that bobot values
// are integers 1..5 (the validateBobot() gate in applyBobotUiState
// already enforces full permutation {1..5}, so max is non-null when
// this is called from form.onsubmit after a passing validation). Ties
// go to the LOWEST letter (deterministic; should not occur in practice
// per spec §10 but defensive). Returns NULL if bobot is partial.
function deriveCorrectAnswerFromBobot() {
  const bobots = readBobotValues();
  let maxL = null;
  let maxW = -Infinity;
  for (const letter of BOBOT_LETTERS) {
    const w = bobots[letter];
    if (!Number.isInteger(w) || w < 1 || w > 5) continue;
    if (w > maxW) {
      maxW = w;
      maxL = letter.toUpperCase();
    }
  }
  return maxL;
}

function readBobotValues() {
  const out = {};
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    if (!inp) {
      out[letter] = null;
      continue;
    }
    const raw = inp.value.trim();
    if (raw === "") {
      out[letter] = null;
      continue;
    }
    const n = Number(raw);
    out[letter] = Number.isFinite(n) ? n : NaN;
  }
  return out;
}

function validateBobot(values) {
  const errors = [];
  const numeric = [];
  for (const letter of BOBOT_LETTERS) {
    const v = values[letter];
    if (v == null) {
      // empty input — ok if we are not in TKP mode (caller decides); in TKP
      // mode we still count this as "missing", so the user sees a hint.
      continue;
    }
    if (Number.isNaN(v)) {
      errors.push(`Bobot ${letter.toUpperCase()} harus bilangan`);
      continue;
    }
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      errors.push(`Bobot ${letter.toUpperCase()} harus bilangan bulat 1–5`);
      continue;
    }
    numeric.push(v);
  }
  if (numeric.length === 5 && new Set(numeric).size !== 5) {
    errors.push("Bobot harus 5 nilai unik (1,2,3,4,5)");
  }
  return {
    ok: errors.length === 0 && numeric.length === 5,
    errors,
  };
}

// Best-effort submit-button selector — the modal has a primary Save button
// which is either a `<button class="...q-submit-btn">` or the existing
// `.btn-primary` inside the modal. We target multiple candidates and toggle
// each so a future rename does not silently disable validation.
function setSubmitDisabled(disabled) {
  // Scoped to `#q-form` only so we don't accidentally disable the bulk-save
  // button in another modal that may share the page. The actual manage-soal
  // Save button is `<button type="submit" class="btn-primary">` inside
  // `#q-form`; we keep a defensive selector so a future rename (e.g. adding
  // a `q-submit-btn` class or `data-q-submit` hook) doesn't silently bypass
  // gating.
  const formEl = document.getElementById("q-form");
  if (!formEl) return;
  const candidates = formEl.querySelectorAll(
    'button[type="submit"], .q-submit-btn, [data-q-submit]'
  );
  candidates.forEach((b) => {
    if ("disabled" in b) b.disabled = disabled;
  });
}

// syncBobotDropdowns — Round-7 mutual-exclusion wiring.
//
// Each of the 5 .bobot-input selects renders only the values 1..5 that
// are NOT YET chosen by the other 4 selects (covered letter's own
// current value is preserved so the user doesn't see their own pick
// disappear under them while they re-pick).
//
// Algorithm per letter L:
//   reads L's currently-selected value LVal ("" or "1"-"5").
//   collects OTHER letters' values into a Set<MVal> (NOT L's own).
//   available = [1..5] \ otherValues
//   options = ["\u2014" (placeholder)] + available
//   if LVal is non-empty AND LVal is NOT in available (a stale value
//     from a previous edit that's now conflicting with another
//     select's newer pick), reset L to "" placeholder.
//   else preserve LVal.
//
// Called whenever a select's value changes, when the form opens
// (setBobotFromQuestion / applyBobotUiState), and via the listeners
// installed in initTkpListeners.
function syncBobotDropdowns() {
  // Round-7 followup fix: original aggregate-set approach accidentally
  // excluded the letter's OWN current value from its own option list
  // (the closure over `usedByOther` captured every select's value
  // including the current one). Fix is a per-letter scan that skips
  // the current letter when building the "used by others" set.
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    if (!inp) continue;
    const myValue = inp.value;
    // Build "used by the other 4 siblings" by scanning BOBOT_LETTERS
    // and skipping `letter` itself. Without this skip, the closed-over
    // aggregate (used in the original implementation) included the
    // current select's value in its exclusion set — silently erasing
    // the user's own pick after every sync round (caught by
    // code-reviewer-minimax-m3 Round-7 review).
    const usedByOthers = new Set();
    for (const otherLetter of BOBOT_LETTERS) {
      if (otherLetter === letter) continue;
      const other = document.getElementById(`q-bobot-${otherLetter}`);
      if (other && other.value !== "") usedByOthers.add(other.value);
    }
    const available = [1, 2, 3, 4, 5].filter(
      (n) => !usedByOthers.has(String(n)),
    );
    inp.innerHTML =
      `<option value="">—</option>` +
      available.map((n) => `<option value="${n}">${n}</option>`).join("");
    inp.value = myValue; // restore own pick; falls back to "" if option gone
  }
}

function applyBobotUiState(qtype) {
  const tkp = isTkpType(qtype);
  form.classList.toggle("tkp-mode", tkp);
  // Round-8 (user bug-fix): trigger syncBobotDropdowns EVERY time the
  // modal enters TKP mode so the user sees options [—, 1, 2, 3, 4, 5]
  // on each `<select>` from the FIRST render. Previously, sync only
  // fired from (a) the `change` event listener AND (b) setBobotFromQuestion
  // for edit-mode. Add-mode (modal opened with type already TKP, OR
  // user changes type from binary to TKP) had no trigger — dropdowns
  // stuck at the HTML-initial `<option value="">—</option>` placeholder.
  // applyBobotUiState is the single chokepoint for "TKP state entered"
  // so calling sync here covers all paths:
  //   • Page-load initial pass (when type defaults to TKP)
  //   • `typeSelect.change` event when user picks a TKP subtype
  //   • editQuestion → setBobotFromQuestion → applyBobotUiState (rerun)
  //   • Any other future re-renders through this entry point
  if (tkp) syncBobotDropdowns();

  if (!tkp) {
    // Binary flow: clear TKP visual marks. Submit stays enabled — the form
    // still requires the existing single-radio `correct_answer`.
    for (const letter of BOBOT_LETTERS) {
      const inp = document.getElementById(`q-bobot-${letter}`);
      const helper = document.getElementById(`q-bobot-${letter}-helper`);
      if (inp) {
        inp.classList.remove("bobot-input--valid", "bobot-input--invalid");
        inp.value = "";
      }
      if (helper) helper.textContent = "rentang 1–5";
    }
    const banner = document.getElementById("bobot-tkp-status");
    if (banner) {
      banner.classList.remove("bobot-status-banner--fail");
      banner.classList.add("bobot-status-banner--ok");
    }
    const chip = document.getElementById("bobot-tkp-chip");
    if (chip) chip.textContent = "✓ Bobot valid";
    setSubmitDisabled(false);
    return { ok: true, errors: [] };
  }

  // TKP flow: validate, paint, gate submit.
  const values = readBobotValues();
  const result = validateBobot(values);
  const banner = document.getElementById("bobot-tkp-status");
  const chip = document.getElementById("bobot-tkp-chip");
  if (banner) {
    banner.classList.toggle("bobot-status-banner--ok", result.ok);
    banner.classList.toggle("bobot-status-banner--fail", !result.ok);
  }
  if (chip) {
    chip.textContent = result.ok ? "✓ Bobot valid" : "✗ Bobot tidak valid";
  }
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    const helper = document.getElementById(`q-bobot-${letter}-helper`);
    if (!inp) continue;
    const v = values[letter];
    const valid = Number.isInteger(v) && v >= 1 && v <= 5;
    inp.classList.toggle("bobot-input--valid", valid);
    inp.classList.toggle("bobot-input--invalid", !valid && v != null);
    if (helper) {
      if (!valid && v != null) helper.textContent = "harus 1–5";
      else helper.textContent = "rentang 1–5";
    }
  }
  setSubmitDisabled(!result.ok);
  return result;
}

function initTkpListeners() {
  if (typeof form === "undefined" || !form) return;
  const typeSelect = document.getElementById("q-question-type");
  if (typeSelect) {
    typeSelect.addEventListener("change", () => {
      applyBobotUiState(typeSelect.value || "");
    });
  }
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    if (!inp) continue;
    // Round-7: switched event from "input" to "change". <select>
    // dispatches `change` when the user picks an option, which is the
    // HTML-spec canonical event for selects. (`input` also fires on
    // selects but `change` is more semantically correct.) After picking,
    // we (a) re-run syncBobotDropdowns so the other 4 selects drop the
    // picked value from their option lists, then (b) refresh the
    // banner/chip via applyBobotUiState to reflect the new state.
    inp.addEventListener("change", () => {
      syncBobotDropdowns();
      applyBobotUiState(
        (document.getElementById("q-question-type") || {}).value || "",
      );
    });
  }
  // Initial pass so the chip/banner reflects the current state (handles
  // both freshly-opened modal and edit-populated soal).
  applyBobotUiState(
    (document.getElementById("q-question-type") || {}).value || "",
  );
}

function setBobotFromQuestion(q) {
  if (!q) return;
  const tkp = isTkpType(q.question_type);
  form.classList.toggle("tkp-mode", tkp);
  // Round-7 5-step population order is REQUIRED so the <select>
  // options exist BEFORE we assign values (.value assignment on a
  // select whose options don't include the value silently falls back
  // to the first option — i.e. "" placeholder by default):
  //   1. Clear all values so subsequent sync has deterministic state.
  //   2. Run syncBobotDropdowns to populate a full "all 5 values
  //      available" option list on each select (since all are empty).
  //   3. Now assign real values from q.option_scores — option elements
  //      for those values now exist from step 2, so the assignment
  //      sticks.
  //   4. Re-run syncBobotDropdowns so the option lists reflect the
  //      now-real mutual exclusion (each select drops the values
  //      picked by its 4 siblings from its available list).
  //   5. applyBobotUiState refreshes the banner/chip/submit gating
  //      based on the freshly-populated dropdowns.
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    if (inp) inp.value = "";
  }
  syncBobotDropdowns();
  for (const letter of BOBOT_LETTERS) {
    const inp = document.getElementById(`q-bobot-${letter}`);
    if (!inp) continue;
    const upperLetter = letter.toUpperCase();
    const w = q.option_scores
      ? Number(q.option_scores[upperLetter])
      : null;
    if (tkp && Number.isInteger(w) && w >= 1 && w <= 5) {
      inp.value = String(w);
    }
    // ELSE: leave empty (placeholder). Old behavior of explicitly
    // setting .value="" is now done by the step-1 clear loop above.
  }
  syncBobotDropdowns();
  applyBobotUiState(q.question_type);
}

// ============== Bulk-Add help block — TKP vs binary toggle ==============
// Spec: tkp-scoring-spec.md §9.1 + #q-bulk-modal layout (kelola-soal.html
// lines ~779-866). The bulk-add modal renders TWO sibling
// `.bulk-format-help` <details> blocks marked with `data-help-mode`
// ("binary" | "tkp"). This helper shows the block whose mode matches
// the currently-selected Tipe Soal and hides the other, so the user
// sees the paste-syntax example that applies to their selection.
//
// Why two blocks instead of one dynamic one:
// - Static markup is inspect-friendly in dev tools + doesn't require
//   re-rendering on every change. JS only flips `style.display`.
// - Keeps the optical diff obvious to the designer/CSS team — a new
//   theme accent (`.bulk-format-help--tkp`) on the TKP block reads as
//   "different rule set" without needing colour/logic coordination
//   with content injection.
//
// Implementation notes:
// - Uses a TKP prefix-match (`startsWith("TKP")` after upper-casing)
//   so any of the 6 TKP sub-categories in the <select> optgroup
//   ("TKP Pelayanan Publik", "TKP Jejaring Kerja", ...) trigger the
//   TKP help block. Reuses the project-wide `isTkpType()` helper
//   (defined later in this file, near `BOBOT_LETTERS`) as the single
//   source of truth for the TKP prefix check. A future rename of
//   `isTkpType` would fail loudly across every TKP branch in the
//   project (single-question modal Bobot wiring, bulk-post handler,
//   this toggle) — a connected refactor is far easier to spot than
//   a silently-disconnected inline copy that drifts out of sync.
// - Operates via `style.display` because the TKP <details> already
//   has inline `style="display: none; …"` set in markup so the TKP
//   block starts hidden (initial q-type is "TWK Pilar Negara"). Setting
//   `display = ""` reverts to the cascade (block-level details).
// - Scoped to `#q-bulk-modal` so future `.bulk-format-help` usages
//   outside the bulk modal are unaffected by this toggle.
function setBulkHelpMode(questionType) {
  // Direct call to the project-wide `isTkpType()` (defined later in
  // this file). Hoisting guarantee: `isTkpType` is a `function`
  // declaration, so it is callable from any following code regardless
  // of source order. The bulk-add-btn handler calls setBulkHelpMode
  // only on user click (long after script parse), and
  // initBulkHelpModeToggle() runs on DOMContentLoaded (also post-parse),
  // so the function is fully initialized by the time either path runs.
  const isTkp = isTkpType(questionType || "");
  const blocks = document.querySelectorAll(
    "#q-bulk-modal [data-help-mode]",
  );
  blocks.forEach((el) => {
    const wantsTkp = el.dataset.helpMode === "tkp";
    // Show block iff its declared mode matches the current
    // question-type family. Setting display="" lets the cascade
    // compute the natural `display` for the element (block-level
    // for <details>), which preserves the user-closed state when
    // they re-open the modal later.
    el.style.display = wantsTkp === isTkp ? "" : "none";
  });
}

// Attach the change listener on `bulk-q-question-type` once the DOM is
// reachable. Idempotent — safe to call multiple times (skipped on
// re-call via a sentinel dataset flag so dev-tools HMR or page refetch
// don't accumulate handlers). The listener fires only on USER-DRIVEN
// changes; the `bulk-add-btn` open handler explicitly calls
// setBulkHelpMode() after resetting the select to "TWK Pilar Negara" —
// JS-set values do NOT fire 'change' events, so the manual call is
// required for the initial re-open.
function initBulkHelpModeToggle() {
  const typeSelect = document.getElementById("bulk-q-question-type");
  if (!typeSelect) return;
  if (typeSelect.dataset.helpModeToggleInit === "1") return;
  typeSelect.dataset.helpModeToggleInit = "1";
  typeSelect.addEventListener("change", () => {
    setBulkHelpMode(typeSelect.value);
  });
  // Set initial state on first load — default q-type is TWK so the
  // binary block is initially visible. Harmless if the select was
  // already mutated by some other script tag.
  setBulkHelpMode(typeSelect.value);
}

// Wire up listeners once the form is reachable. Existing init() also runs
// at body-load, but the form itself is in DOM from page load (no lazy mount),
// so a plain readyState check is sufficient and idempotent.
//
// `initBulkHelpModeToggle` is bundled into the same readyState gate so the
// bulk-modal help toggle is initialized atomically with the rest of the
// TKP/Bobot wiring — no second DOMContentLoaded subscription needed.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initTkpListeners();
      initBulkHelpModeToggle();
    });
  } else {
    initTkpListeners();
    initBulkHelpModeToggle();
  }
}

