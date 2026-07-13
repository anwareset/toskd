(function () {
  const form = document.getElementById("login-form");
  const errorDiv = document.getElementById("login-error");

  // Extract ?next=... from URL
  const urlParams = new URLSearchParams(window.location.search);
  const next = urlParams.get("next") || "/bank-soal.html";

  // Safety: only allow relative paths starting with / (not protocol-relative
  // //evil.com, /\evil.com, /.//evil.com, or absolute URLs) to prevent
  // open-redirect. Regex /^\/[^/\\]/ is stricter than the original
  // `startsWith("/") && !startsWith("//")` check — first char after / must
  // not be / or \. Backslash matters because some browsers normalize
  // /\ to // in URL parsing.
  const safeNext = /^\/[^/\\]/.test(next) ? next : "/bank-soal.html";

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    errorDiv.focus?.();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.style.display = "none";

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Memverifikasi...";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
      showError("Username dan password harus diisi.");
      return;
    }

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin", // ensure cookie is set/used
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        // Success: redirect to safeNext
        window.location.replace(safeNext);
        return;
      }

      // Branch on status: 401 = wrong creds, 400 = bad input (length cap
      // exceeded — server returns 400 for username > 64 or password > 1000).
      // Both 4xx are user-input problems — spec's generic message prevents
      // enumeration. 5xx/other = server-side issue. Don't mislabel 5xx as
      // "wrong password" — user would think their password is the problem
      // when it's actually the server.
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
      if (res.status === 401 || res.status === 400) {
        showError("Username atau password salah. Silakan coba lagi.");
      } else {
        showError("Server error. Coba lagi dalam beberapa saat.");
      }
    } catch (err) {
      console.error("Login error:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
      showError("Terjadi kesalahan jaringan. Coba lagi.");
    }
  });

  // If already authenticated (e.g. user revisits login.html), auto-redirect
  (async function checkIfLoggedIn() {
    try {
      const res = await fetch("/api/admin/me", { credentials: "same-origin" });
      if (res.ok) {
        // Already logged in → skip form, go to safeNext
        window.location.replace(safeNext);
      }
    } catch (err) {
      // Ignore — user just sees the login form
    }
  })();
})();
