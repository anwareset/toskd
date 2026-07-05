(function () {
  // Load Theme
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);

  document.addEventListener("DOMContentLoaded", () => {
    // Check if in Exam Session
    const isExam = window.location.pathname.endsWith("exam.html");

    // Create Global Header
    const header = document.createElement("header");
    header.className = "global-header";

    const title = document.createElement("a");
    title.className = `global-header-title${isExam ? " no-link" : ""}`;
    title.textContent = "TOSKD CAT";
    if (!isExam) {
      title.href = "/";
    }

    const toggle = document.createElement("button");
    toggle.className = "theme-toggle-btn";
    toggle.innerHTML = savedTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

    toggle.onclick = () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      toggle.innerHTML = newTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
    };

    header.appendChild(title);
    header.appendChild(toggle);

    // Insert Header at the top of the body
    document.body.insertBefore(header, document.body.firstChild);
  });
})();
