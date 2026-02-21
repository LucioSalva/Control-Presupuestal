(() => {
  const API = window.API_URL || "";
  const token = localStorage.getItem("cp_token");
  const userRaw = localStorage.getItem("cp_usuario");

  if (!token || !userRaw) {
    window.location.replace("login.html");
    return;
  }

  const tbody = document.getElementById("tbodyHistorial");
  const fBuscar = document.getElementById("fBuscar");
  const fEstatus = document.getElementById("fEstatus");
  const fPageSize = document.getElementById("fPageSize");
  const lblResumen = document.getElementById("lblResumen");
  const lblPaginacion = document.getElementById("lblPaginacion");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnRefresh = document.getElementById("btnRefresh");

  let allRows = [];
  let filtered = [];
  let page = 1;
  let pageSize = Number(fPageSize?.value || 25);
  let timersInterval = null;
  let refreshInterval = null;

  function authHeaders() {
    return { Authorization: `Bearer ${token}` };
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: authHeaders() });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      if (res.status === 401) {
        window.location.replace("login.html");
        return null;
      }
      if (res.status === 403) {
        if (window.Swal) {
          await Swal.fire("Acceso denegado", "No tienes permiso para ver el historial.", "error");
        } else {
          alert("No tienes permiso para ver el historial.");
        }
        window.location.replace("suficiencia_presupuestal.html");
        return null;
      }
      const msg = data?.error || "Error al consultar el servidor";
      throw new Error(msg);
    }
    return data;
  }

  function parseDateSafe(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function diffToDaysHours(ms) {
    const total = Math.max(0, ms);
    const days = Math.floor(total / (24 * 60 * 60 * 1000));
    const hours = Math.floor((total % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return { days, hours };
  }

  function mapEstado(estadoRaw) {
    const e = String(estadoRaw || "").trim().toUpperCase();
    if (e === "ACTIVO") return "VIGENTE";
    if (e === "CANCELADO") return "CANCELADA";
    if (e === "CADUCADO") return "EXPIRADA";
    return "—";
  }

  function statusClass(estado) {
    if (estado === "VIGENTE") return "status-vigente";
    if (estado === "CANCELADA") return "status-cancelada";
    if (estado === "EXPIRADA") return "status-expirada";
    return "status-otro";
  }

  function formatElapsed(row) {
    const created = parseDateSafe(row.created_at);
    if (!created) return "—";
    const diff = Date.now() - created.getTime();
    const r = diffToDaysHours(diff);
    return `${r.days}d ${r.hours}h`;
  }

  function formatRemaining(row, estado) {
    if (estado === "CANCELADA" || estado === "EXPIRADA") return "0d 0h";
    const expires = parseDateSafe(row.expires_at);
    if (!expires) return "—";
    const diff = expires.getTime() - Date.now();
    const r = diffToDaysHours(diff);
    return `${r.days}d ${r.hours}h`;
  }

  function normalizeText(v) {
    return String(v || "").trim().toUpperCase();
  }

  function applyFilters() {
    const q = normalizeText(fBuscar?.value);
    const est = normalizeText(fEstatus?.value);

    filtered = allRows.filter((row) => {
      const estado = mapEstado(row.estado);
      if (est && estado !== est) return false;
      if (!q) return true;
      const noSuf = normalizeText(row.no_suficiencia);
      const cancel = normalizeText(row.cancel_reason);
      return noSuf.includes(q) || estado.includes(q) || cancel.includes(q);
    });

    page = 1;
    renderTable();
  }

  function paginate(rows) {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }

  function renderTable() {
    if (!tbody) return;
    if (!filtered.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted py-4">Sin resultados.</td></tr>';
      if (lblResumen) lblResumen.textContent = "0 registros";
      if (lblPaginacion) lblPaginacion.textContent = "";
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > totalPages) page = totalPages;
    const rows = paginate(filtered);

    tbody.innerHTML = rows
      .map((row) => {
        const estado = mapEstado(row.estado);
        const elapsed = formatElapsed(row);
        const remaining = formatRemaining(row, estado);
        const motivo = String(row.cancel_reason || "").trim() || "—";
        const id = Number(row.id);
        return `
          <tr>
            <td class="fw-semibold">${row.no_suficiencia || "—"}</td>
            <td><span class="status-pill ${statusClass(estado)}">${estado}</span></td>
            <td>${elapsed}</td>
            <td>${remaining}</td>
            <td class="text-muted">${motivo}</td>
            <td class="text-center">
              <a class="btn btn-sm btn-outline-primary" href="suficiencia_presupuestal.html?id=${id}">
                Ver
              </a>
            </td>
          </tr>
        `;
      })
      .join("");

    if (lblResumen) lblResumen.textContent = `${filtered.length} registros`;
    if (lblPaginacion) lblPaginacion.textContent = `Página ${page} de ${totalPages}`;
    if (btnPrev) btnPrev.disabled = page <= 1;
    if (btnNext) btnNext.disabled = page >= totalPages;
  }

  async function loadHistorial() {
    const data = await fetchJson(`${API}/api/suficiencias/historial`);
    if (!data || !Array.isArray(data.data)) return;
    allRows = data.data;
    applyFilters();
  }

  function bindEvents() {
    fBuscar?.addEventListener("input", applyFilters);
    fEstatus?.addEventListener("change", applyFilters);
    fPageSize?.addEventListener("change", () => {
      pageSize = Number(fPageSize.value || 25);
      page = 1;
      renderTable();
    });
    btnPrev?.addEventListener("click", () => {
      if (page > 1) {
        page -= 1;
        renderTable();
      }
    });
    btnNext?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (page < totalPages) {
        page += 1;
        renderTable();
      }
    });
    btnRefresh?.addEventListener("click", loadHistorial);
  }

  function startTimers() {
    if (timersInterval) clearInterval(timersInterval);
    timersInterval = setInterval(renderTable, 5000);
  }

  function startRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadHistorial, 30000);
  }

  bindEvents();
  loadHistorial();
  startTimers();
  startRefresh();
})();
