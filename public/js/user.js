// public/js/user.js
// Halaman "User" (terproteksi): form ganti kata sandi admin (self-service).
//   - Verifikasi password lama wajib (R1-Q3)
//   - Password baru minimal 8 karakter (R2-Q2), dua kolom (baru + konfirmasi)
//     divalidasi cocok di klien (R2-Q3)
//   - Sukses → notification modal (pola scoreboard.js :: showNotification)
//     + reset form, tetap di halaman (R3-Q3)
//   - 401 → redirect ke login (aman: form ini tidak menyimpan konten yang
//     belum tersimpan — deviasi sadar dari pola wrapFetch/handleSessionExpired
//     di kelola-soal/paket-soal/paket-detail, admin-auth-spec §7.5)
//   - 400 → mapping pesan server (English) ke Bahasa Indonesia
(function () {
  const form = document.getElementById("password-form");
  const errorDiv = document.getElementById("password-error");
  const currentInput = document.getElementById("current-password");
  const newInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("confirm-password");

  // ===== Notification modal (info-only, single OK button) =====
  // Mirror of the same pattern in scoreboard.js / kelola-soal.js /
  // paket-detail.js. Markup di public/user.html.
  const notifModal = document.getElementById("notification-modal");
  const notifTitle = document.getElementById("notification-title");
  const notifMessage = document.getElementById("notification-message");
  const notifOkBtn = document.getElementById("notification-ok-btn");
  if (notifOkBtn) {
    notifOkBtn.addEventListener("click", () => {
      if (notifModal) notifModal.close();
    });
  }
  function showNotification(title, message) {
    if (!notifModal) {
      // Fallback if modal markup didn't load.
      alert(message);
      return;
    }
    if (notifTitle) notifTitle.textContent = title;
    if (notifMessage) notifMessage.textContent = message;
    notifModal.showModal();
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    errorDiv.focus?.();
  }

  function hideError() {
    errorDiv.style.display = "none";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";

    const current = currentInput.value;
    const next = newInput.value;
    const confirm = confirmInput.value;

    // Client-side validation (server tetap re-validate — defense in depth).
    if (!current || !next) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Password";
      showError("Semua kolom wajib diisi.");
      return;
    }
    if (next.length < 8) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Password";
      showError("Password baru minimal 8 karakter.");
      return;
    }
    if (next !== confirm) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Password";
      showError("Konfirmasi password baru tidak cocok.");
      return;
    }

    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });

      if (res.ok) {
        // Success: reset form + notification modal, stay on page (R3-Q3).
        // Re-enable tombol + kembalikan label DULU supaya form bisa dipakai
        // lagi tanpa refresh (bug-fix 2026-08-27: sebelumnya tombol stuck
        // "Menyimpan..." karena return sebelum restore).
        submitBtn.disabled = false;
        submitBtn.textContent = "Simpan Password";
        form.reset();
        showNotification(
          "✓ Password Diganti",
          "Kata sandi berhasil diubah. Gunakan password baru pada login berikutnya.",
        );
        return;
      }

      // 401 = session expired mid-use → redirect ke login (safeNext pattern
      // sama dengan login.js: hanya path relatif / yang diterima).
      if (res.status === 401) {
        const nextPath = encodeURIComponent(
          window.location.pathname + window.location.search,
        );
        window.location.replace(`/login.html?next=${nextPath}`);
        return;
      }

      // Parse error message (server returns English — map ke Bahasa Indonesia).
      const data = await res.json().catch(() => ({}));
      const serverMsg = typeof data?.error === "string" ? data.error : "";
      let msg;
      if (res.status === 400) {
        if (serverMsg.includes("current password incorrect")) {
          msg = "Password saat ini salah.";
        } else if (serverMsg.includes("at least 8 characters")) {
          msg = "Password baru minimal 8 karakter.";
        } else if (serverMsg.includes("different from the current password")) {
          msg = "Password baru harus berbeda dari password lama.";
        } else {
          msg = "Gagal mengubah password. Silakan coba lagi.";
        }
      } else {
        // 5xx or other server error — don't mislabel as wrong password.
        msg = "Server error. Coba lagi dalam beberapa saat.";
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Password";
      showError(msg);
    } catch (err) {
      console.error("Password change error:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Password";
      showError("Server error. Coba lagi dalam beberapa saat.");
    }
  });
})();
