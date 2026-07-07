(function () {
  // Load Theme
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);

  document.addEventListener("DOMContentLoaded", () => {
    const path = window.location.pathname;
    // Skip global header on sensitive pages
    // (exam: locked timer bar; review: post-exam results view).
    const skipHeader =
      path.endsWith("exam.html") || path.endsWith("review.html");
    if (skipHeader) return;

    // Create Global Header
    const header = document.createElement("header");
    header.className = "global-header";

    const title = document.createElement("a");
    title.className = "global-header-title";
    title.textContent = "TOSKD CAT";
    title.href = "/";

    // Hide the nav menu items on the homepage landing — that page
    // already surfaces the same destinations as large .btn-main cards.
    // Brand title and theme toggle are still rendered above them.
    const isHome = path === "/" || path.endsWith("/index.html");

    let nav = null;
    if (!isHome) {
      nav = document.createElement("nav");
      nav.className = "global-header-nav";
      const navLinks = [
        { href: "/select-pack.html", label: "Pilih Paket" },
        { href: "/bank-soal.html", label: "Bank Soal" },
        { href: "/scoreboard.html", label: "Scoreboard" },
      ];
      navLinks.forEach((link) => {
        const a = document.createElement("a");
        a.className = "global-header-link";
        a.href = link.href;
        a.textContent = link.label;
        nav.appendChild(a);
      });
    }

    const toggle = document.createElement("button");
    toggle.className = "theme-toggle-btn";
    toggle.setAttribute("aria-label", "Toggle dark/light theme");
    toggle.innerHTML = savedTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

    toggle.onclick = () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      toggle.innerHTML = newTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
    };

    header.appendChild(title);
    if (nav) header.appendChild(nav);
    header.appendChild(toggle);

    // Insert Header at the top of the body
    document.body.insertBefore(header, document.body.firstChild);
  });
})();
