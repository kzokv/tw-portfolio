// Vakwen mockup shell — renders sidebar + topbar from data attributes on <body>.
// Usage: <body data-section="dashboard" data-crumb-here="Dashboard"> ... <main class="main">…</main> </body>
//        For admin: add data-admin to <body>.
// URL params: ?theme=dark · ?sidebar=collapsed · ?menu=open
(() => {
  const sp = new URLSearchParams(location.search);
  if (sp.get("theme") === "dark") document.documentElement.classList.add("dark");
  if (sp.get("sidebar") === "collapsed") document.documentElement.dataset.sidebar = "collapsed";
  if (sp.get("density") === "comfortable") document.documentElement.dataset.density = "comfortable";
  if (sp.get("menu") === "open") document.documentElement.dataset.menu = "open";

  const body = document.body;
  const section = body.dataset.section || "dashboard";
  const isAdmin = body.hasAttribute("data-admin");
  const crumbs = (body.dataset.crumbs || "").split("›").map(s => s.trim()).filter(Boolean);
  const crumbHere = body.dataset.crumbHere || (crumbs.length ? crumbs.pop() : "");

  const userNav = [
    ["dashboard", "▦", "Dashboard"],
    ["portfolio", "◧", "Portfolio"],
    ["transactions", "↔", "Transactions"],
    ["cash-ledger", "$", "Cash ledger"],
    ["dividends", "◔", "Dividends"],
    ["sharing", "↗", "Sharing"],
  ];
  const adminNav = [
    ["admin", "▦", "Overview"],
    ["admin-settings", "⚙", "Settings"],
    ["admin-users", "👥", "Users"],
    ["admin-instruments", "◫", "Instruments"],
    ["admin-invites", "✉", "Invites"],
    ["admin-providers", "◇", "Providers"],
    ["admin-audit-log", "≣", "Audit log"],
  ];
  const navItems = isAdmin ? adminNav : userNav;
  const operatorItems = isAdmin ? [] : [["admin", "⚙", "Admin"], ["settings", "⊕", "Settings"]];

  // sidebar
  const navHtml = navItems.map(([key, icon, label]) =>
    `<a class="nav-item${section === key ? " active" : ""}"><span class="icon">${icon}</span><span class="lbl">${label}</span></a>`
  ).join("");
  const operatorHtml = operatorItems.length
    ? `<div class="nav-section">Operator</div>` +
      operatorItems.map(([key, icon, label]) =>
        `<a class="nav-item${section === key ? " active" : ""}"><span class="icon">${icon}</span><span class="lbl">${label}</span></a>`
      ).join("")
    : `<div class="nav-section">Back</div><a class="nav-item"><span class="icon">←</span><span class="lbl">Back to app</span></a>`;

  const sidebarRail = isAdmin ? ' style="box-shadow: inset -3px 0 0 hsl(var(--warning));"' : "";
  const sidebarHtml = `
    <aside class="sidebar"${sidebarRail}>
      <button class="sidebar-toggle" title="Collapse sidebar">‹</button>
      <div class="sidebar-brand">
        <div class="logo">V</div>
        <span class="lbl">Vakwen</span>
      </div>
      ${navHtml}
      ${operatorHtml}
    </aside>`;

  // topbar
  const crumbsHtml = `
    <div class="crumbs">
      <span>Vakwen</span>
      ${isAdmin ? `<span>›</span><span class="badge badge-warning" style="height:18px; font-size:10px;">Admin</span>` : ""}
      ${crumbs.map(c => `<span>›</span><span>${c}</span>`).join("")}
      ${crumbHere ? `<span>›</span><span class="here">${crumbHere}</span>` : ""}
    </div>`;

  const topbarHtml = `
    <header class="topbar">
      ${crumbsHtml}
      <div class="cmd-trigger">
        <span>🔍</span>
        <span>Search anything…</span>
        <kbd>⌘K</kbd>
      </div>
      <div class="theme-seg">
        <button title="Light">☀</button>
        <button class="on" title="System">🌓</button>
        <button title="Dark">🌙</button>
      </div>
      <button class="btn btn-ghost btn-icon" title="Notifications">🔔</button>
      <button class="avatar-trigger" title="Account menu">
        <div class="avatar">A</div>
        <span class="chev">▼</span>
      </button>
      <div id="profile-menu" class="menu" style="display:${document.documentElement.dataset.menu === "open" ? "block" : "none"};">
        <div class="menu-header">
          <div class="name">Alex Lin</div>
          <div class="email">alex@example.com</div>
        </div>
        <div class="menu-item">👤 Profile<span class="kbd">G&nbsp;P</span></div>
        <div class="menu-item">⚙ Settings<span class="kbd">G&nbsp;S</span></div>
        <div class="menu-item">↗ Sharing</div>
        <div class="menu-divider"></div>
        <div class="menu-item">↻ Recompute all positions<span class="kbd">⌘R</span></div>
        <div class="menu-item">🌓 Theme · System</div>
        <div class="menu-item">⌘ Command palette<span class="kbd">⌘K</span></div>
        <div class="menu-divider"></div>
        <div class="menu-item">⌫ Sign out</div>
      </div>
    </header>`;

  // Render
  const main = body.querySelector("main.main");
  const wrap = document.createElement("div");
  wrap.className = "shell";
  wrap.innerHTML = sidebarHtml + `<div class="page-wrap">${topbarHtml}</div>`;
  body.insertBefore(wrap, main);
  wrap.querySelector(".page-wrap").appendChild(main);
})();
