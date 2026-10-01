// Define o tema antes da primeira pintura: ?theme=dark | ?theme=light, ou a preferência do sistema.
(function () {
  var theme = new URLSearchParams(location.search).get("theme");
  if (theme !== "dark" && theme !== "light") {
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
})();
