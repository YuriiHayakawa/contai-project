// Prévia estática: monta a navegação comum e desenha os ícones.
// No app, a navegação é um componente React e os ícones vêm de lucide-react.

const ICONS = {
  house:
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  transfer: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  utensils:
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  car:
    '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  smile:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  repeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  bag:
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  landmark:
    '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="m12 2 8 5H4z"/>',
  wallet:
    '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  calendar:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  tag:
    '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  tv: '<rect width="20" height="15" x="2" y="7" rx="2"/><path d="m17 2-5 5-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

function svg(name) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    (ICONS[name] || "") +
    "</svg>"
  );
}

const NAV = [
  { id: "painel", label: "Início", icon: "house", href: "painel.html" },
  { id: "lancamentos", label: "Lançamentos", icon: "list", href: "lancamentos.html" },
  { id: "contas", label: "Contas", icon: "wallet", href: "#", desktopOnly: true },
  { id: "categorias", label: "Categorias", icon: "tag", href: "#", desktopOnly: true },
  { id: "importacoes", label: "Importações", icon: "upload", href: "#", desktopOnly: true },
  { id: "assistente", label: "Assistente", icon: "message", href: "assistente.html" },
];

function buildShell() {
  const active = document.body.dataset.active;
  const current = (item) => (item.id === active ? ' aria-current="page"' : "");

  const sidebar = document.createElement("nav");
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Principal");
  sidebar.innerHTML =
    '<a class="wordmark" href="painel.html">Contaí</a>' +
    '<a class="btn btn-primary" href="lancar.html"><span class="icon" data-icon="plus"></span>Novo lançamento</a>' +
    '<ul class="side-list">' +
    NAV.map(
      (item) =>
        `<li><a class="side-item" href="${item.href}"${current(item)}>` +
        `<span class="icon" data-icon="${item.icon}"></span>${item.label}</a></li>`,
    ).join("") +
    "</ul>" +
    '<div class="side-user"><span class="avatar" aria-hidden="true">M</span>' +
    '<span><span class="label">Marina Duarte</span><br><span class="small muted">Configurações</span></span></div>';

  const mobile = NAV.filter((item) => !item.desktopOnly);
  const tab = (item) =>
    `<a class="tab" href="${item.href}"${current(item)}>` +
    `<span class="tab-icon"><span class="icon" data-icon="${item.icon}"></span></span>${item.label}</a>`;

  const bottom = document.createElement("nav");
  bottom.className = "bottom-nav";
  bottom.setAttribute("aria-label", "Principal");
  bottom.innerHTML =
    tab(mobile[0]) +
    tab(mobile[1]) +
    '<a class="tab-launch" href="lancar.html" aria-label="Lançar">' +
    '<span class="icon" data-icon="plus"></span></a>' +
    tab(mobile[2]) +
    '<a class="tab" href="#"><span class="tab-icon"><span class="icon" data-icon="menu"></span></span>Mais</a>';

  const app = document.querySelector(".app");
  app.prepend(sidebar);
  app.append(bottom);
}

function drawIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = svg(el.dataset.icon);
  });
}

// Mantém ?theme= ao navegar entre as telas da prévia.
function keepTheme() {
  if (!location.search) return;
  document.querySelectorAll('a[href$=".html"]').forEach((a) => {
    a.href = a.getAttribute("href") + location.search;
  });
}

if (document.querySelector(".app")) buildShell();
drawIcons();
keepTheme();
