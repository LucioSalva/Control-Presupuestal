/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Barra de Navegación
 *  Archivo: navbar.js
 *
 *  © 2025–2026 Humberto Salvador Ruiz Lucio.
 *  Todos los derechos reservados.
 *
 *  AVISO LEGAL: Este software es propiedad exclusiva del
 *  Humberto Salvador Ruiz Lucio. Su reproducción,
 *  distribución o modificación sin autorización escrita previa
 *  del titular queda estrictamente prohibida y será perseguida
 *  conforme a las leyes aplicables en los Estados Unidos Mexicanos.
 *
 *  Software de uso interno exclusivo. No compartir.
 * ================================================================
 */
(() => {
  const navHtml = `
    <nav class="navbar navbar-expand-lg cp-main-nav shadow-sm">
      <div class="container-fluid">
        <a class="navbar-brand fw-semibold" href="index.html">
          <i class="bi bi-currency-dollar me-2"></i>Control Presupuestal
        </a>
        <div class="cp-logo-container">
          <img src="/img/ayuntamiento-de-ecatepec.png" alt="Ayuntamiento de Ecatepec" class="navbar-logo">
        </div>
        <div class="ms-auto d-flex gap-2 align-items-center cp-user-actions">
          <span id="userInfo" class="cp-user text-white fw-bold text-truncate"></span>
          <button id="btnLogout" class="btn btn-sm btn-outline-light">
            <i class="bi bi-door-open me-1"></i>
            <span class="d-none d-sm-inline">Cerrar sesión</span>
            <span class="d-inline d-sm-none">Salir</span>
          </button>
        </div>
      </div>
    </nav>
    <nav class="navbar navbar-expand-lg shadow-sm cp-tabs-nav">
      <div class="container-fluid">
        <button class="cp-hamburger" type="button" data-bs-toggle="collapse" data-bs-target="#cpTabsNav" aria-controls="cpTabsNav" aria-expanded="false" aria-label="Abrir menú">
          <span class="cp-ham-line"></span>
          <span class="cp-ham-line"></span>
          <span class="cp-ham-line"></span>
        </button>
        <div class="collapse navbar-collapse mt-3" id="cpTabsNav">
          <ul class="navbar-nav me-auto cp-tabs">
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Operación</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="suficiencia_presupuestal.html">Suficiencia Presupuestal</a></li>
                <li><a class="dropdown-item" href="comprometido.html">Comprometido</a></li>
                <li><a class="dropdown-item" href="devengado.html">Devengado</a></li>
                <li><a class="dropdown-item" href="expedientes_entrega.html">Entregas Expedientes</a></li>
                <li><a class="dropdown-item" href="reconducciones.html">Reconducciones</a></li>
                <li id="navReconHistorial"><a class="dropdown-item" href="reconducciones_historial.html">Autorización Reconducciones</a></li>
              </ul>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Catálogos</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="partidas_base.html">Carga Partidas</a></li>
              </ul>
            </li>
            <li class="nav-item dropdown" id="cpNavDashboards">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Dashboards</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="dashboard_partidas.html">Dashboard Partidas</a></li>
                <li><a class="dropdown-item" href="dashboard_partidas_grafica.html">Gráficas Partidas</a></li>
                <li><a class="dropdown-item" href="suficiencia_historial.html">Historial de Suficiencias</a></li>
              </ul>
            </li>
            <li class="nav-item dropdown d-none" id="cpNavGod">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Panel GOD</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="consola_god.html">Consola de monitoreo</a></li>
                <li><a class="dropdown-item" href="admin-usuarios.html">Administración de Usuarios</a></li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  `;

  function mountNavbar() {
    const host = document.getElementById("cp-navbar");
    if (host) {
      host.innerHTML = navHtml;
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = navHtml;
    document.body.prepend(wrapper);
  }

  function setupHamburger() {
    const btn = document.querySelector(".cp-hamburger");
    const menu = document.getElementById("cpTabsNav");
    if (!btn || !menu) return;

    // Alternar clase is-active al hacer click
    btn.addEventListener("click", () => {
      btn.classList.toggle("is-active");
    });

    // Sincronizar con el estado real del colapso de Bootstrap
    menu.addEventListener("show.bs.collapse", () => {
      btn.classList.add("is-active");
      btn.setAttribute("aria-expanded", "true");
    });

    menu.addEventListener("hide.bs.collapse", () => {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function setActive() {
    const path = window.location.pathname.split("/").pop() || "index.html";
    const links = document.querySelectorAll(".cp-tabs-nav a[href]");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (href === path) {
        link.classList.add("active");
        const dropdown = link.closest(".dropdown");
        if (dropdown) {
          const toggle = dropdown.querySelector(".dropdown-toggle");
          if (toggle) toggle.classList.add("active");
        }
      }
    });
  }

  function setFavicon() {
    const head = document.head || document.getElementsByTagName("head")[0];
    if (!head) return;
    const href = "/img/logo-flor.ico";
    const existing = head.querySelector(`link[rel="icon"][href="${href}"]`);
    if (existing) return;
    const link1 = document.createElement("link");
    link1.rel = "icon";
    link1.type = "image/x-icon";
    link1.href = href;
    const link2 = document.createElement("link");
    link2.rel = "shortcut icon";
    link2.type = "image/x-icon";
    link2.href = href;
    head.appendChild(link1);
    head.appendChild(link2);
  }

  function applyReconHistorialVisibility() {
    const li = document.getElementById("navReconHistorial");
    if (!li) return;
    try {
      const raw = localStorage.getItem("cp_usuario");
      if (!raw) {
        li.classList.add("d-none");
        return;
      }
      const user = JSON.parse(raw);
      const dg = String(user?.dgeneral_clave || "").trim().toUpperCase();
      const da = String(user?.dauxiliar_clave || "").trim().toUpperCase();
      const isL00117 = dg === "L00" && da === "117";
      if (!isL00117) li.classList.add("d-none");
    } catch {
      li.classList.add("d-none");
    }
  }

  async function applyDashboardsVisibility() {
    try {
      const t =
        localStorage.getItem("cp_token") ||
        sessionStorage.getItem("cp_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("token") ||
        localStorage.getItem("authToken") ||
        sessionStorage.getItem("authToken") ||
        "";
      if (!t) {
        const li = document.getElementById("cpNavDashboards");
        if (li) li.classList.add("d-none");
        return;
      }
      const headers = { Authorization: `Bearer ${t}` };
      const r = await fetch("/api/suficiencias/dashboards-perm", { headers });
      const ok = r.ok ? await r.json() : { allowed: false };
      const allowed = !!ok?.allowed;
      if (!allowed) {
        const li = document.getElementById("cpNavDashboards");
        if (li) li.classList.add("d-none");
      }
    } catch {
      const li = document.getElementById("cpNavDashboards");
      if (li) li.classList.add("d-none");
    }
  }

  function applyGodVisibility() {
    const li = document.getElementById("cpNavGod");
    if (!li) return;
    try {
      const raw = localStorage.getItem("cp_usuario");
      if (!raw) {
        li.classList.add("d-none");
        return;
      }
      const user = JSON.parse(raw);
      const roles = Array.isArray(user?.roles) ? user.roles : [];
      const rolesNorm = roles.map((r) => String(r || "").trim().toUpperCase());
      if (rolesNorm.includes("GOD")) li.classList.remove("d-none");
      else li.classList.add("d-none");
    } catch {
      li.classList.add("d-none");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountNavbar();
      setupHamburger();
      setActive();
      setFavicon();
      applyReconHistorialVisibility();
      applyDashboardsVisibility();
      applyGodVisibility();
    });
  } else {
    mountNavbar();
    setupHamburger();
    setActive();
    setFavicon();
    applyReconHistorialVisibility();
    applyDashboardsVisibility();
    applyGodVisibility();
  }
})();
