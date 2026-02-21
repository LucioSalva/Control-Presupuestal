(() => {
  const navHtml = `
    <nav class="navbar navbar-expand-lg cp-main-nav shadow-sm">
      <div class="container-fluid">
        <a class="navbar-brand fw-semibold" href="index.html">
          <i class="bi bi-currency-dollar me-2"></i>Control Presupuestal
        </a>
        <div class="logo-container">
          <img src="/img/ayuntamiento-de-ecatepec.png" alt="Ayuntamiento de Ecatepec" class="navbar-logo">
        </div>
        <div class="ms-auto d-flex gap-2 align-items-center">
          <span id="userInfo" class="text-white fw-bold"></span>
          <button id="btnLogout" class="btn btn-sm btn-outline-light bi bi-door-open">Cerrar sesión</button>
        </div>
      </div>
    </nav>
    <nav class="navbar navbar-expand-lg navbar-light bg-light shadow-sm cp-tabs-nav">
      <div class="container-fluid">
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cpTabsNav" aria-controls="cpTabsNav" aria-expanded="false" aria-label="Abrir menú">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="cpTabsNav">
          <ul class="navbar-nav me-auto mb-2 mb-lg-0 cp-tabs">
            <li class="nav-item">
              <a class="nav-link" href="index.html">Inicio</a>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Operación</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="suficiencia_presupuestal.html">Suficiencia Presupuestal</a></li>
                <li><a class="dropdown-item" href="comprometido.html">Comprometido</a></li>
                <li><a class="dropdown-item" href="devengado.html">Devengado</a></li>
                <li><a class="dropdown-item" href="expedientes_entrega.html">Entregas Expedientes</a></li>
              </ul>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Catálogos</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="projects.html">Proyectos</a></li>
                <li><a class="dropdown-item" href="partidas_base.html">Carga Partidas</a></li>
              </ul>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Dashboards</a>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="dashboard_partidas.html">Dashboard Partidas</a></li>
                <li><a class="dropdown-item" href="dashboard_partidas_grafica.html">Gráficas Partidas</a></li>
                <li><a class="dropdown-item" href="suficiencia_historial.html">Historial de Suficiencias</a></li>
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountNavbar();
      setActive();
    });
  } else {
    mountNavbar();
    setActive();
  }
})();
