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

// Initialize/load questions
async function init() {
  loadingEl.style.display = "flex";
  tableEl.style.display = "none";

  try {
    const res = await fetch("/api/questions");
    questions = await res.json();
    loadingEl.style.display = "none";
    tableEl.style.display = "table";

    bodyEl.innerHTML = questions
      .map(
        (q, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">${esc(
          q.content.replace(/<[^>]*>/g, ""),
        )}</td>
        <td><strong>${q.question_type.toUpperCase()}</strong></td>
        <td>${q.image_url ? `<img src="${q.image_url}" style="height:40px;border-radius:4px">` : "-"}</td>
        <td><span class="btn-success" style="padding:2px 8px;border-radius:4px;font-size:0.8rem">${q.correct_answer}</span></td>
        <td>
          <button class="btn-secondary" onclick="editQuestion(${q.id})">Edit</button>
          <button class="btn-danger" onclick="deleteQuestion(${q.id})">Hapus</button>
        </td>
      </tr>
    `,
      )
      .join("");
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
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
      <div><span style="font-weight:bold;color:${correct === "A" ? "var(--success)" : "inherit"}">A.</span> ${optA || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "B" ? "var(--success)" : "inherit"}">B.</span> ${optB || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "C" ? "var(--success)" : "inherit"}">C.</span> ${optC || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "D" ? "var(--success)" : "inherit"}">D.</span> ${optD || "(belum diisi)"}</div>
      <div><span style="font-weight:bold;color:${correct === "E" ? "var(--success)" : "inherit"}">E.</span> ${optE || "(belum diisi)"}</div>
    </div>
    <hr style="margin:20px 0;border:0;border-top:1px solid #e2e8f0">
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
  switchTab("tab-content");
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

  // Validation
  if (!content || content === "<p><br></p>") {
    alert("Teks / Pertanyaan wajib diisi!");
    switchTab("tab-content");
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
    switchTab("tab-options");
    return;
  }
  if (!correct_answer) {
    alert("Kunci Jawaban Benar wajib dipilih!");
    switchTab("tab-options");
    return;
  }
  if (!explanation || explanation === "<p><br></p>") {
    alert("Pembahasan Cara Pengerjaan wajib diisi!");
    switchTab("tab-explanation");
    return;
  }

  // Default to 'text' type since images are now inline
  const question_type = "text";

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

  // Also set Quill editors if available
  setEditorValues(q.content, q.options, q.explanation);

  modalTitle.textContent = "Edit Soal";
  resetTabs();

  // Initialize Quill editors and tab navigation for edit
  setTimeout(() => {
    if (!quillInitialized) {
      initQuillEditors();
    } else {
      // If already initialized, just set values
      setEditorValues(q.content, q.options, q.explanation);
    }
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
