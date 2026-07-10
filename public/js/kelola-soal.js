// DOM references
const tableEl = document.getElementById("questions-table");
const bodyEl = document.getElementById("questions-body");
const loadingEl = document.getElementById("loading");
const modal = document.getElementById("q-modal");
const form = document.getElementById("q-form");
const modalTitle = document.getElementById("modal-title");

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
        const response = await fetch("/api/upload-image", {
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

// Strip every <img> in a Quill-rendered HTML string and prepend a
// single "📷 Ada Gambar" chip so the table preview cell stays compact
// — rendering full images inside table rows blows out row heights and
// adds nothing useful to a quick-glance preview.
//
// Done in JS rather than CSS because the parent uses `-webkit-line-
// clamp: 3`, which would clip any CSS-`::after`-based chip past line 3.
// Prepending the chip to the rendered HTML parks it on line 1, well
// inside the 3-line budget regardless of where the original image sat
// in the source. Marker styling lives in `styles.css` under `.img-marker`.
function imgToMarker(html) {
  if (!html) return "";
  if (!/<img\b/i.test(html)) return html;
  return (
    '<span class="img-marker">📷 Ada Gambar</span> ' +
    html.replace(/<img\b[^>]*>/gi, "")
  );
}

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
  const pageData = filtered.slice(start, start + rowsPerPage);

  bodyEl.innerHTML = pageData
    .map((q, idx) => {
      const globalIdx = start + idx + 1;
      return `
        <tr>
          <td>${globalIdx}</td>
          <td>${imgToMarker(q.content)}</td>
          <td><strong>${esc(q.question_type || "text")}</strong></td>
          <td><span class="btn-success" style="padding:2px 8px;border-radius:4px;font-size:0.8rem">${q.correct_answer}</span></td>
          <td>
            <button class="btn-secondary" onclick="editQuestion(${q.id})">Edit</button>
            <button class="btn-danger" onclick="deleteQuestion(${q.id})">Hapus</button>
          </td>        </tr>
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
  }
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
  document.getElementById("controls-top").style.display = "none";
  document.getElementById("controls-bottom").style.display = "none";

  try {
    const res = await fetch("/api/questions");
    questions = await res.json();
    loadingEl.style.display = "none";
    tableEl.style.display = "table";

    renderTable();
  } catch (e) {
    loadingEl.innerHTML =
      '<p style="color:var(--danger)">Gagal memuat bank soal.</p>';
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
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    modal.close();
    init();
  } catch (err) {
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
    const usageRes = await fetch(`/api/questions/${id}/usage`);
    const usage = await usageRes.json();

    let msg = "Apakah Anda yakin ingin menghapus soal ini dari Bank Soal?";
    if (usage.used) {
      msg = `Soal ini digunakan di ${usage.packs.join(", ")}. Hapus?`;
    }

    if (!confirm(msg)) return;

    const res = await fetch(`/api/questions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    init();
  } catch (err) {
    alert("Gagal menghapus soal.");
    console.error("Delete failed:", err);
  }
};

// Initialize on load
init();
