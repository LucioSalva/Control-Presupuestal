/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Historial de Reconducciones
 *  Archivo: reconducciones_historial.js
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
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const token =
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    "";
  const userRaw = localStorage.getItem("cp_usuario");

  if (!token || !userRaw) {
    window.location.replace("login.html");
    return;
  }

  let currentUser = null;
  try {
    currentUser = JSON.parse(userRaw);
  } catch {
    window.location.replace("login.html");
    return;
  }

  const dgClave = String(currentUser?.dgeneral_clave || "").trim().toUpperCase();
  const daClave = String(currentUser?.dauxiliar_clave || "").trim().toUpperCase();
  const isL00117 = dgClave === "L00" && daClave === "117";

  if (!isL00117) {
    if (window.Swal) {
      window.Swal.fire({
        icon: "warning",
        title: "Acceso restringido",
        text: "Solo L00 117 puede ver esta página.",
        confirmButtonColor: "#BC955C",
      }).then(() => {
        window.location.replace("index.html");
      });
    } else {
      alert("Solo L00 117 puede ver esta página.");
      window.location.replace("index.html");
    }
    return;
  }

  let lastGeneratedKey = "";
  const setLastGeneratedKey = (value) => {
    lastGeneratedKey = String(value || "").trim().toUpperCase();
    updateClaveUI();
  };

  const authHeaders = () => {
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  const el = {
    txtClave: document.getElementById("txtClave"),
    btnGenerarClave: document.getElementById("btnGenerarClave"),
    btnCopiarClave: document.getElementById("btnCopiarClave"),
    tbodyClaves: document.getElementById("tbodyClaves"),
    tbody: document.getElementById("tbodyRecon"),
    fBuscar: document.getElementById("fBuscar"),
    fEstatus: document.getElementById("fEstatus"),
    fPageSize: document.getElementById("fPageSize"),
    lblResumen: document.getElementById("lblResumen"),
    lblPaginacion: document.getElementById("lblPaginacion"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnRefresh: document.getElementById("btnRefresh"),
  };

  let allRows = [];
  let filtered = [];
  let page = 1;
  let pageSize = Number(el.fPageSize?.value || 25);

  const MXN = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  });

  function formatCurrency(v) {
    const n = Number(v || 0);
    return MXN.format(Number.isFinite(n) ? n : 0);
  }

  function formatDate(value) {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("es-MX");
  }

  function updateClaveUI() {
    if (!el.txtClave) return;
    el.txtClave.textContent = lastGeneratedKey || "—";
  }

  async function fetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!r.ok) {
      const msg =
        data?.db?.message ||
        data?.db ||
        data?.error ||
        data?.message ||
        `HTTP ${r.status} en ${url}`;
      throw new Error(msg);
    }
    return data;
  }

  async function generarClave() {
    if (!window.Swal) return;
    const result = await window.Swal.fire({
      title: "Generar clave por área",
      html: `
        <input id="swal-dg" class="swal2-input" placeholder="DG (Ej. L00)" maxlength="3">
        <input id="swal-da" class="swal2-input" placeholder="DA (Ej. 137)" maxlength="3">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Generar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#BC955C",
      preConfirm: () => {
        const dg = String(document.getElementById("swal-dg")?.value || "")
          .trim()
          .toUpperCase();
        const da = String(document.getElementById("swal-da")?.value || "")
          .trim()
          .toUpperCase();
        if (!dg || !da) {
          window.Swal.showValidationMessage("Captura DG y DA");
          return null;
        }
        if (dg.length !== 3 || da.length !== 3) {
          window.Swal.showValidationMessage("DG y DA deben tener 3 caracteres");
          return null;
        }
        return { dg, da };
      },
    });
    if (!result.isConfirmed) return;
    const payload = result.value;
    const data = await fetchJson(`${API}/api/reconducciones/clave/generar-area`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const clave = String(data?.clave || "").trim().toUpperCase();
    if (!clave) throw new Error("No se pudo generar la clave.");
    setLastGeneratedKey(clave);
    if (window.Swal) {
      await window.Swal.fire({
        icon: "success",
        title: "Clave generada",
        text: `${clave} - ${payload.dg} ${payload.da}`,
        confirmButtonColor: "#BC955C",
      });
    }
    await loadClaves();
  }

  async function copiarClave() {
    const clave = lastGeneratedKey;
    if (!clave) {
      if (window.Swal) {
        await window.Swal.fire({
          icon: "warning",
          title: "Sin clave",
          text: "Genera una clave primero.",
          confirmButtonColor: "#BC955C",
        });
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(clave);
      if (window.Swal) {
        await window.Swal.fire({
          icon: "success",
          title: "Copiado",
          text: "Clave copiada al portapapeles.",
          confirmButtonColor: "#BC955C",
        });
      }
    } catch {
      if (window.Swal) {
        await window.Swal.fire({
          icon: "warning",
          title: "No se pudo copiar",
          text: "Copia manualmente la clave.",
          confirmButtonColor: "#BC955C",
        });
      }
    }
  }

  function applyFilters() {
    const search = String(el.fBuscar?.value || "").trim().toUpperCase();
    const estatus = String(el.fEstatus?.value || "").trim().toUpperCase();
    filtered = allRows.filter((r) => {
      if (estatus && String(r.estatus || "").toUpperCase() !== estatus) return false;
      if (!search) return true;
      const hay = [
        r.id,
        r.oficio,
        r.tipo_movimiento,
        r.estatus,
      ]
        .map((v) => String(v || "").toUpperCase())
        .join(" ");
      return hay.includes(search);
    });
    page = 1;
    renderTable();
  }

  function paginate(rows) {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }

  function renderTable() {
    if (!el.tbody) return;
    if (!filtered.length) {
      el.tbody.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Sin resultados.</td></tr>';
      if (el.lblResumen) el.lblResumen.textContent = "0 registros";
      if (el.lblPaginacion) el.lblPaginacion.textContent = "";
      if (el.btnPrev) el.btnPrev.disabled = true;
      if (el.btnNext) el.btnNext.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > totalPages) page = totalPages;
    const rows = paginate(filtered);

    el.tbody.innerHTML = rows
      .map((r) => {
        const estatus = String(r.estatus || "—").toUpperCase();
        return `
          <tr>
            <td class="fw-semibold">${r.id || "—"}</td>
            <td>${r.oficio || "—"}</td>
            <td>${formatDate(r.fecha_elaboracion)}</td>
            <td>${r.tipo_movimiento || "—"}</td>
            <td><span class="badge bg-light text-dark">${estatus}</span></td>
            <td class="text-end">${formatCurrency(r.origen_total || 0)}</td>
            <td class="text-end">${formatCurrency(r.destino_total || 0)}</td>
            <td class="text-end">${formatCurrency(r.diferencia || 0)}</td>
            <td class="text-center">
              <a class="btn btn-sm btn-outline-primary" href="reconducciones.html?id=${r.id}">Ver/Editar</a>
            </td>
          </tr>
        `;
      })
      .join("");

    if (el.lblResumen) el.lblResumen.textContent = `${filtered.length} registros`;
    if (el.lblPaginacion) el.lblPaginacion.textContent = `Página ${page} de ${totalPages}`;
    if (el.btnPrev) el.btnPrev.disabled = page <= 1;
    if (el.btnNext) el.btnNext.disabled = page >= totalPages;
  }

  async function loadClaves() {
    if (!el.tbodyClaves) return;
    try {
      const data = await fetchJson(`${API}/api/reconducciones/clave/listar`, {
        headers: authHeaders(),
      });
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        el.tbodyClaves.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted py-2">Sin claves</td></tr>';
        return;
      }
      el.tbodyClaves.innerHTML = rows
        .map((r) => {
          const area = `${r.dg_clave || "—"} ${r.da_clave || "—"}`.trim();
          const status = String(r.status || "—").toUpperCase();
          return `
            <tr>
              <td class="fw-semibold">${r.clave || "—"}</td>
              <td>${area}</td>
              <td>${status}</td>
              <td>${formatDate(r.created_at)}</td>
              <td>${formatDate(r.used_at)}</td>
            </tr>
          `;
        })
        .join("");
    } catch {
      el.tbodyClaves.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-2">Sin claves</td></tr>';
    }
  }

  async function loadHistorial() {
    try {
      const data = await fetchJson(`${API}/api/reconducciones`, { headers: authHeaders() });
      allRows = Array.isArray(data) ? data : [];
      applyFilters();
    } catch (err) {
      if (window.Swal) {
        await window.Swal.fire({
          icon: "warning",
          title: "Historial bloqueado",
          text: err.message || "No fue posible cargar el historial.",
          confirmButtonColor: "#BC955C",
        });
      }
      allRows = [];
      applyFilters();
    }
  }

  function bindEvents() {
    el.fBuscar?.addEventListener("input", applyFilters);
    el.fEstatus?.addEventListener("change", applyFilters);
    el.fPageSize?.addEventListener("change", () => {
      pageSize = Number(el.fPageSize.value || 25);
      page = 1;
      renderTable();
    });
    el.btnPrev?.addEventListener("click", () => {
      if (page > 1) {
        page -= 1;
        renderTable();
      }
    });
    el.btnNext?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (page < totalPages) {
        page += 1;
        renderTable();
      }
    });
    el.btnRefresh?.addEventListener("click", loadHistorial);
    el.btnGenerarClave?.addEventListener("click", async () => {
      await generarClave();
    });
    el.btnCopiarClave?.addEventListener("click", copiarClave);
  }

  updateClaveUI();
  bindEvents();
  loadClaves();
  loadHistorial();
})();
