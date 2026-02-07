(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const userInfo = document.getElementById("userInfo");
  const btnLogout = document.getElementById("btnLogout");
  (() => {
    "use strict";

    const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

    // ---------------------------
    // Auth helpers
    // ---------------------------
    function getToken() {
      return (
        localStorage.getItem("cp_token") ||
        sessionStorage.getItem("cp_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("token") ||
        ""
      );
    }

    function getUser() {
      try {
        const raw = localStorage.getItem("cp_usuario");
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    function pickUserName(u) {
      if (!u) return "";
      return (
        u.nombre ||
        u.name ||
        u.usuario ||
        u.username ||
        u.user ||
        u.email ||
        "Usuario"
      );
    }

    function authHeaders() {
      const t = getToken();
      return t ? { Authorization: `Bearer ${t}` } : {};
    }

    async function fetchJson(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });

      let data = null;
      try {
        data = await res.json();
      } catch {}

      if (res.status === 401) {
        await Swal.fire(
          "Sesión expirada",
          "Vuelve a iniciar sesión.",
          "warning",
        );
        window.location.href = "login.html";
        throw new Error("401");
      }

      if (!res.ok) {
        const msg = data?.error || `Error HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data;
    }

    function escapeHtml(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    // ---------------------------
    // Start when DOM is ready
    // ---------------------------
    document.addEventListener("DOMContentLoaded", () => {
      // Si no hay token, al login (antes de hacer cualquier cosa)
      if (!getToken()) {
        window.location.href = "login.html";
        return;
      }

      // ---------------------------
      // DOM
      // ---------------------------
      const userInfo = document.getElementById("userInfo");
      const btnLogout = document.getElementById("btnLogout");

      const btnReload = document.getElementById("btnReload");
      const btnNueva = document.getElementById("btnNueva");

      const q = document.getElementById("q");
      const btnClear = document.getElementById("btnClear");

      const pageSize = document.getElementById("pageSize");
      const page = document.getElementById("page");
      const btnPrev = document.getElementById("btnPrev");
      const btnNext = document.getElementById("btnNext");

      const tbody = document.getElementById("tbody");
      const countInfo = document.getElementById("countInfo");

      // Modal
      const modalEl = document.getElementById("modalPartida");
      const frm = document.getElementById("frmPartida");
      const modalTitle = document.getElementById("modalTitle");
      const id = document.getElementById("id");
      const clave = document.getElementById("clave");
      const partida = document.getElementById("partida");

      // Validación mínima: si faltan ids, avisamos (y no tronamos silencioso)
      const missing = [];
      if (!tbody) missing.push("#tbody");
      if (!countInfo) missing.push("#countInfo");
      if (!modalEl) missing.push("#modalPartida");
      if (!frm) missing.push("#frmPartida");
      if (!modalTitle) missing.push("#modalTitle");
      if (!id) missing.push("#id");
      if (!clave) missing.push("#clave");
      if (!partida) missing.push("#partida");

      if (missing.length) {
        console.error(
          "[PARTIDAS] Faltan elementos en el HTML:",
          missing.join(", "),
        );
        Swal.fire(
          "Error",
          "Faltan elementos en el HTML (ids). Revisa consola.",
          "error",
        );
        return;
      }

      // Bootstrap/SweetAlert check
      if (typeof bootstrap === "undefined") {
        console.error(
          "[PARTIDAS] bootstrap undefined. Revisa orden de scripts en el HTML.",
        );
        Swal.fire(
          "Error",
          "Bootstrap no cargó. Revisa el orden de scripts.",
          "error",
        );
        return;
      }
      if (typeof Swal === "undefined") {
        console.error("[PARTIDAS] Swal undefined. Revisa SweetAlert2.");
        alert("SweetAlert2 no cargó.");
        return;
      }

      const modal = new bootstrap.Modal(modalEl);

      // ---------------------------
      // User header
      // ---------------------------
      const u = getUser();
      if (userInfo) userInfo.textContent = pickUserName(u);

      // ---------------------------
      // State
      // ---------------------------
      let all = [];
      let filtered = [];
      let currentPage = 1;

      // ---------------------------
      // UI
      // ---------------------------
      function render() {
        const ps = Number(pageSize?.value) || 20;
        const start = (currentPage - 1) * ps;
        const end = start + ps;
        const slice = filtered.slice(start, end);

        if (slice.length === 0) {
          tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Sin resultados.</td></tr>`;
        } else {
          tbody.innerHTML = slice
            .map((r) => {
              const c = escapeHtml(r.clave);
              const p = escapeHtml(r.partida);
              return `
              <tr>
                <td><span class="badge text-bg-dark">${c}</span></td>
                <td>${p}</td>
                <td class="text-end">
                  <button type="button" class="btn btn-outline-primary btn-sm me-1" data-action="edit" data-id="${r.id}">
                    <i class="bi bi-pencil-square"></i>
                  </button>
                  <button type="button" class="btn btn-outline-danger btn-sm" data-action="del" data-id="${r.id}">
                    <i class="bi bi-trash3"></i>
                  </button>
                </td>
              </tr>
            `;
            })
            .join("");
        }

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / ps));
        if (currentPage > totalPages) currentPage = totalPages;

        if (page) page.value = String(currentPage);
        countInfo.textContent = `${total} registro(s) — Página ${currentPage} de ${totalPages}`;
      }

      function applyFilter() {
        const term = String(q?.value || "")
          .trim()
          .toLowerCase();
        filtered = !term
          ? [...all]
          : all.filter(
              (r) =>
                String(r.clave || "")
                  .toLowerCase()
                  .includes(term) ||
                String(r.partida || "")
                  .toLowerCase()
                  .includes(term),
            );

        currentPage = 1;
        render();
      }

      function openNew() {
        id.value = "";
        clave.value = "";
        partida.value = "";
        modalTitle.textContent = "Nueva partida";
        modal.show();
        setTimeout(() => clave.focus(), 150);
      }

      function openEdit(row) {
        id.value = row.id;
        clave.value = row.clave || "";
        partida.value = row.partida || "";
        modalTitle.textContent = "Editar partida";
        modal.show();
        setTimeout(() => partida.focus(), 150);
      }

      // ---------------------------
      // API
      // ---------------------------
      async function load() {
        tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Cargando…</td></tr>`;

        const data = await fetchJson(`${API}/api/catalogos/partidas`, {
          headers: { ...authHeaders() },
        });

        all = Array.isArray(data) ? data : data?.rows || [];
        filtered = [...all];
        currentPage = 1;
        applyFilter();
      }

      async function save() {
        const payload = {
          clave: String(clave.value || "").trim(),
          partida: String(partida.value || "").trim(),
        };

        if (!payload.clave || !payload.partida) {
          Swal.fire("Faltan datos", "Completa clave y descripción.", "warning");
          return;
        }

        const editingId = String(id.value || "").trim();

        if (!editingId) {
          await fetchJson(`${API}/api/catalogos/partidas`, {
            method: "POST",
            headers: { ...authHeaders() },
            body: JSON.stringify(payload),
          });
          await Swal.fire("Listo", "Partida creada.", "success");
        } else {
          await fetchJson(
            `${API}/api/catalogos/partidas/${encodeURIComponent(editingId)}`,
            {
              method: "PUT",
              headers: { ...authHeaders() },
              body: JSON.stringify(payload),
            },
          );
          await Swal.fire("Listo", "Partida actualizada.", "success");
        }

        modal.hide();
        await load();
      }

      async function remove(idToDelete) {
        const ok = await Swal.fire({
          title: "¿Eliminar partida?",
          text: "Esta acción no se puede deshacer.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Sí, eliminar",
          cancelButtonText: "Cancelar",
        });

        if (!ok.isConfirmed) return;

        await fetchJson(
          `${API}/api/catalogos/partidas/${encodeURIComponent(idToDelete)}`,
          {
            method: "DELETE",
            headers: { ...authHeaders() },
          },
        );

        await Swal.fire("Eliminada", "Partida eliminada.", "success");
        await load();
      }

      // ---------------------------
      // Events
      // ---------------------------
      btnLogout?.addEventListener("click", () => {
        localStorage.removeItem("cp_token");
        sessionStorage.removeItem("cp_token");
        localStorage.removeItem("token");
        sessionStorage.removeItem("token");
        window.location.href = "login.html";
      });

      btnReload?.addEventListener("click", () =>
        load().catch((e) => Swal.fire("Error", e.message, "error")),
      );
      btnNueva?.addEventListener("click", openNew);

      q?.addEventListener("input", applyFilter);
      btnClear?.addEventListener("click", () => {
        q.value = "";
        applyFilter();
        q.focus();
      });

      pageSize?.addEventListener("change", () => {
        currentPage = 1;
        render();
      });

      btnPrev?.addEventListener("click", () => {
        currentPage = Math.max(1, currentPage - 1);
        render();
      });

      btnNext?.addEventListener("click", () => {
        const ps = Number(pageSize?.value) || 20;
        const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
        currentPage = Math.min(totalPages, currentPage + 1);
        render();
      });

      page?.addEventListener("change", () => {
        const ps = Number(pageSize?.value) || 20;
        const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
        let v = Number(page.value);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > totalPages) v = totalPages;
        currentPage = v;
        render();
      });

      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const rid = btn.getAttribute("data-id");
        const row = all.find((x) => String(x.id) === String(rid));
        if (!row) return;

        try {
          if (action === "edit") openEdit(row);
          if (action === "del") await remove(row.id);
        } catch (e) {
          Swal.fire(
            "Error",
            e.message || "No se pudo completar la acción.",
            "error",
          );
        }
      });

      frm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        save().catch((e) =>
          Swal.fire("Error", e.message || "No se pudo guardar.", "error"),
        );
      });

      // ---------------------------
      // Init
      // ---------------------------
      load().catch((e) => {
        console.error("[PARTIDAS] load error:", e);
        Swal.fire(
          "Error",
          e.message || "No se pudo cargar el catálogo.",
          "error",
        );
      });
    });
  })();

  const btnReload = document.getElementById("btnReload");
  const btnNueva = document.getElementById("btnNueva");

  const q = document.getElementById("q");
  const btnClear = document.getElementById("btnClear");

  const pageSize = document.getElementById("pageSize");
  const page = document.getElementById("page");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");

  const tbody = document.getElementById("tbody");
  const countInfo = document.getElementById("countInfo");

  // Modal
  const modalEl = document.getElementById("modalPartida");
  const modal = new bootstrap.Modal(modalEl);
  const frm = document.getElementById("frmPartida");
  const modalTitle = document.getElementById("modalTitle");
  const id = document.getElementById("id");
  const clave = document.getElementById("clave");
  const partida = document.getElementById("partida");

  // ---------------------------
  // Auth helpers
  // ---------------------------
  function getToken() {
    return (
      localStorage.getItem("cp_token") ||
      sessionStorage.getItem("cp_token") ||
      localStorage.getItem("token") ||
      sessionStorage.getItem("token") ||
      ""
    );
  }

  function getUser() {
    try {
      const raw = localStorage.getItem("cp_usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

    if (res.status === 401) {
      Swal.fire("Sesión expirada", "Vuelve a iniciar sesión.", "warning");
      setTimeout(() => (window.location.href = "login.html"), 800);
      throw new Error("401");
    }

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) {
      const msg = data?.error || `Error HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------------------------
  // State
  // ---------------------------
  let all = []; // catálogo completo (para filtrar rápido)
  let filtered = []; // resultado filtrado
  let currentPage = 1;

  // ---------------------------
  // UI
  // ---------------------------
  function render() {
    const ps = Number(pageSize.value) || 20;
    const start = (currentPage - 1) * ps;
    const end = start + ps;
    const slice = filtered.slice(start, end);

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Sin resultados.</td></tr>`;
    } else {
      tbody.innerHTML = slice
        .map((r) => {
          const c = escapeHtml(r.clave);
          const p = escapeHtml(r.partida);
          return `
            <tr>
              <td><span class="badge text-bg-dark">${c}</span></td>
              <td>${p}</td>
              <td class="text-end">
                <button class="btn btn-outline-primary btn-sm me-1" data-action="edit" data-id="${r.id}">
                  <i class="bi bi-pencil-square"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm" data-action="del" data-id="${r.id}">
                  <i class="bi bi-trash3"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / ps));
    if (currentPage > totalPages) currentPage = totalPages;

    page.value = String(currentPage);
    countInfo.textContent = `${total} registro(s) — Página ${currentPage} de ${totalPages}`;
  }

  function applyFilter() {
    const term = String(q.value || "")
      .trim()
      .toLowerCase();
    if (!term) {
      filtered = [...all];
    } else {
      filtered = all.filter((r) => {
        return (
          String(r.clave || "")
            .toLowerCase()
            .includes(term) ||
          String(r.partida || "")
            .toLowerCase()
            .includes(term)
        );
      });
    }
    currentPage = 1;
    render();
  }

  function openNew() {
    id.value = "";
    clave.value = "";
    partida.value = "";
    modalTitle.textContent = "Nueva partida";
    modal.show();
    setTimeout(() => clave.focus(), 150);
  }

  function openEdit(row) {
    id.value = row.id;
    clave.value = row.clave || "";
    partida.value = row.partida || "";
    modalTitle.textContent = "Editar partida";
    modal.show();
    setTimeout(() => partida.focus(), 150);
  }

  // ---------------------------
  // API
  // ---------------------------
  async function load() {
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Cargando…</td></tr>`;
    const data = await fetchJson(`${API}/api/catalogos/partidas`, {
      headers: { ...authHeaders() },
    });

    // esperamos [{id, clave, partida}]
    all = Array.isArray(data) ? data : data?.rows || [];
    filtered = [...all];
    currentPage = 1;
    applyFilter();
  }

  async function save() {
    const payload = {
      clave: String(clave.value || "").trim(),
      partida: String(partida.value || "").trim(),
    };

    if (!payload.clave || !payload.partida) {
      Swal.fire("Faltan datos", "Completa clave y descripción.", "warning");
      return;
    }

    const editingId = String(id.value || "").trim();

    try {
      if (!editingId) {
        await fetchJson(`${API}/api/catalogos/partidas`, {
          method: "POST",
          headers: { ...authHeaders() },
          body: JSON.stringify(payload),
        });
        Swal.fire("Listo", "Partida creada.", "success");
      } else {
        await fetchJson(
          `${API}/api/catalogos/partidas/${encodeURIComponent(editingId)}`,
          {
            method: "PUT",
            headers: { ...authHeaders() },
            body: JSON.stringify(payload),
          },
        );
        Swal.fire("Listo", "Partida actualizada.", "success");
      }

      modal.hide();
      await load();
    } catch (e) {
      Swal.fire("Error", e.message || "No se pudo guardar.", "error");
    }
  }

  async function remove(idToDelete) {
    const ok = await Swal.fire({
      title: "¿Eliminar partida?",
      text: "Esta acción no se puede deshacer.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
    });

    if (!ok.isConfirmed) return;

    try {
      await fetchJson(
        `${API}/api/catalogos/partidas/${encodeURIComponent(idToDelete)}`,
        {
          method: "DELETE",
          headers: { ...authHeaders() },
        },
      );
      Swal.fire("Eliminada", "Partida eliminada.", "success");
      await load();
    } catch (e) {
      Swal.fire("Error", e.message || "No se pudo eliminar.", "error");
    }
  }

  // ---------------------------
  // Events
  // ---------------------------
  btnLogout?.addEventListener("click", () => {
    localStorage.removeItem("cp_token");
    sessionStorage.removeItem("cp_token");
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    window.location.href = "login.html";
  });

  btnReload?.addEventListener("click", load);
  btnNueva?.addEventListener("click", openNew);

  q?.addEventListener("input", () => applyFilter());
  btnClear?.addEventListener("click", () => {
    q.value = "";
    applyFilter();
    q.focus();
  });

  pageSize?.addEventListener("change", () => {
    currentPage = 1;
    render();
  });

  btnPrev?.addEventListener("click", () => {
    currentPage = Math.max(1, currentPage - 1);
    render();
  });

  btnNext?.addEventListener("click", () => {
    const ps = Number(pageSize.value) || 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
    currentPage = Math.min(totalPages, currentPage + 1);
    render();
  });

  page?.addEventListener("change", () => {
    const ps = Number(pageSize.value) || 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
    let v = Number(page.value);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > totalPages) v = totalPages;
    currentPage = v;
    render();
  });

  tbody?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const rid = btn.getAttribute("data-id");

    const row = all.find((x) => String(x.id) === String(rid));
    if (!row) return;

    if (action === "edit") openEdit(row);
    if (action === "del") await remove(row.id);
  });

  frm?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    save();
  });

  // ---------------------------
  // Init
  // ---------------------------
  (function init() {
    // mostrar usuario
    const u = getUser();
    if (u) {
      const nombre = u.nombre || u.usuario || "Usuario";
      userInfo.textContent = nombre;
    } else {
      userInfo.textContent = "";
    }

    // si no hay token, al login
    if (!getToken()) {
      window.location.href = "login.html";
      return;
    }

    load().catch((e) => {
      Swal.fire(
        "Error",
        e.message || "No se pudo cargar el catálogo.",
        "error",
      );
    });
  })();
})();
