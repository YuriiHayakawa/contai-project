// Define o tema antes da primeira pintura: a escolha salva ("light" ou "dark") ou, sem ela
// (Automático), a preferência do sistema. É um arquivo externo, na própria origem, porque a
// política de segurança de conteúdo bloqueia script embutido. A chave e os valores são os
// mesmos de src/lib/theme.ts.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("contai-theme");
  } catch (_error) {
    // Armazenamento bloqueado pelo navegador: vale a preferência do sistema.
  }
  if (theme !== "dark" && theme !== "light") {
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
})();
