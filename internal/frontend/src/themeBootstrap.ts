// Apply theme before React mounts to prevent flash of wrong theme
(function () {
  const stored = localStorage.getItem("diffmil.theme");
  let theme: string;
  if (stored === "light" || stored === "dark") {
    theme = stored;
  } else {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
