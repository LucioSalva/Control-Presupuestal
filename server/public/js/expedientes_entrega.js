(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  const inputAnio = document.getElementById("inputAnio");
  const selectMes = document.getElementById("selectMes");
  const selectTipoOrigen = document.getElementById("selectTipoOrigen");
  const inputBuscarOrigen = document.getElementById("inputBuscarOrigen");
  const btnBuscarOrigen = document.getElementById("btnBuscarOrigen");
  const tbodyOrigen = document.getElementById("tbodyOrigen");
  const labelOrigen = document.getElementById("labelOrigen");

  const currentEntregaId = document.getElementById("currentEntregaId");
  const idSuficiencia = document.getElementById("idSuficiencia");
  const idComprometido = document.getElementById("idComprometido");
  const idDevengado = document.getElementById("idDevengado");
  const idDgeneral = document.getElementById("idDgeneral");
  const idDauxiliar = document.getElementById("idDauxiliar");
  const partidaClave = document.getElementById("partidaClave");

  const inputFolio = document.getElementById("inputFolio");
  const inputDependencia = document.getElementById("inputDependencia");
  const inputConcepto = document.getElementById("inputConcepto");
  const inputImporte = document.getElementById("inputImporte");
  const chkEntregoComprometido = document.getElementById("chkEntregoComprometido");
  const chkEntregoDevengado = document.getElementById("chkEntregoDevengado");
  const inputFechaEntrega = document.getElementById("inputFechaEntrega");
  const inputFechaRecibido = document.getElementById("inputFechaRecibido");
  const selectEstatus = document.getElementById("selectEstatus");
  const inputObservaciones = document.getElementById("inputObservaciones");

  const btnGuardarEntrega = document.getElementById("btnGuardarEntrega");
  const btnLimpiarEntrega = document.getElementById("btnLimpiarEntrega");

  const filtroAnio = document.getElementById("filtroAnio");
  const filtroMes = document.getElementById("filtroMes");
  const filtroSearch = document.getElementById("filtroSearch");
  const btnRecargarListado = document.getElementById("btnRecargarListado");
  const tbodyEntregas = document.getElementById("tbodyEntregas");

  let origenRows = [];

  const getToken = () =>
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    "";

  const authHeaders = () => {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (res.status === 401) {
      await Swal.fire("Sesión expirada", "Vuelve a iniciar sesión.", "warning");
      window.location.href = "login.html";
      throw new Error("401");
    }

    if (!res.ok) {
      const message = data?.error || data?.message || text || `HTTP ${res.status}`;
      throw new Error(message);
    }

    return data;
  }

  const money = (v) => {
    if (v === undefined || v === null || isNaN(v)) return "—";
    return Number(v).toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (v) => {
    if (!v) return "";
    const s = String(v);
    if (s.includes("T")) return s.split("T")[0];
    return s;
  };

  const SEARCH_PATTERNS = {
    SUF: /^ECA-\d{4}-\d{2}-SP-\d{4}$/,
    COMP: /^ECA-\d{4}-\d{2}-CP-\d{4}$/,
    DEV: /^ECA-\d{6}-DG-\d{4}$/,
  };

  async function validateSearch(tipo, search) {
    if (!search) return true;
    const rx = SEARCH_PATTERNS[tipo];
    if (rx && !rx.test(search)) {
      await Swal.fire(
        "Formato inválido",
        tipo === "SUF"
          ? "Usa ECA-AAAA-MM-SP-0001"
          : tipo === "COMP"
            ? "Usa ECA-AAAA-MM-CP-0001"
            : "Usa ECA-AAAAMM-DG-0001",
        "warning",
      );
      return false;
    }
    return true;
  }

  function setPeriodoDefaults() {
    const now = new Date();
    inputAnio.value = String(now.getFullYear());
    selectMes.value = String(now.getMonth() + 1);
    filtroAnio.value = String(now.getFullYear());
    filtroMes.value = String(now.getMonth() + 1);
  }

  function clearForm() {
    currentEntregaId.value = "";
    idSuficiencia.value = "";
    idComprometido.value = "";
    idDevengado.value = "";
    idDgeneral.value = "";
    idDauxiliar.value = "";
    partidaClave.value = "";
    inputFolio.value = "";
    inputDependencia.value = "";
    inputConcepto.value = "";
    inputImporte.value = "";
    inputFechaEntrega.value = "";
    inputFechaRecibido.value = "";
    selectEstatus.value = "ENTREGADO";
    chkEntregoComprometido.checked = false;
    chkEntregoDevengado.checked = false;
    inputObservaciones.value = "";
    labelOrigen.textContent = "Sin expediente seleccionado";
  }

  function fillFromOrigen(row) {
    if (!row) return;
    idSuficiencia.value = row.id_suficiencia || "";
    idComprometido.value = row.id_comprometido || "";
    idDevengado.value = row.id_devengado || "";
    idDgeneral.value = row.id_dgeneral || "";
    idDauxiliar.value = row.id_dauxiliar || "";
    partidaClave.value = row.partida_clave || "";
    inputFolio.value = row.folio || "";
    inputDependencia.value = row.dependencia || "";
    inputConcepto.value = row.concepto || "";
    inputImporte.value = money(row.importe);
    labelOrigen.textContent = `Origen ${row.tipo} - ${row.folio || ""}`;
  }

  function buildPayload() {
    return {
      anio: Number(inputAnio.value || 0),
      mes: Number(selectMes.value || 0),
      id_suficiencia: idSuficiencia.value || null,
      id_comprometido: idComprometido.value || null,
      id_devengado: idDevengado.value || null,
      id_dgeneral: idDgeneral.value || null,
      id_dauxiliar: idDauxiliar.value || null,
      partida_clave: partidaClave.value || null,
      folio: inputFolio.value || "",
      dependencia: inputDependencia.value || "",
      concepto: inputConcepto.value || "",
      importe: String(inputImporte.value || "").replace(/[^\d.-]/g, ""),
      entrego_comprometido: chkEntregoComprometido.checked,
      entrego_devengado: chkEntregoDevengado.checked,
      fecha_entrega_tesoreria: inputFechaEntrega.value || null,
      fecha_recibido_presupuesto: inputFechaRecibido.value || null,
      estatus: selectEstatus.value || "ENTREGADO",
      observaciones: inputObservaciones.value || null,
    };
  }

  async function buscarOrigen() {
    const tipo = selectTipoOrigen.value;
    const search = inputBuscarOrigen.value.trim().toUpperCase();
    inputBuscarOrigen.value = search;
    const ok = await validateSearch(tipo, search);
    if (!ok) return;
    const qs = new URLSearchParams();
    qs.set("tipo", tipo);
    if (search) qs.set("search", search);
    const data = await fetchJson(`${API}/api/expedientes-entrega/origen?${qs.toString()}`, {
      headers: { ...authHeaders() },
    });
    origenRows = Array.isArray(data?.rows) ? data.rows : [];
    renderOrigen();
  }

  function renderOrigen() {
    if (!tbodyOrigen) return;
    if (!origenRows.length) {
      tbodyOrigen.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-3">Sin resultados</td></tr>';
      return;
    }
    tbodyOrigen.innerHTML = origenRows
      .map(
        (row, idx) => `
        <tr>
          <td>${row.folio || ""}</td>
          <td>${row.dependencia || ""}</td>
          <td>${row.concepto || ""}</td>
          <td class="text-end">${money(row.importe)}</td>
          <td class="text-center">
            <button class="btn btn-outline-primary btn-sm btn-select-origen" data-idx="${idx}">
              Seleccionar
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  async function cargarEntregas() {
    const qs = new URLSearchParams();
    if (filtroAnio.value) qs.set("anio", filtroAnio.value);
    if (filtroMes.value) qs.set("mes", filtroMes.value);
    if (filtroSearch.value.trim()) qs.set("search", filtroSearch.value.trim());
    const data = await fetchJson(`${API}/api/expedientes-entrega?${qs.toString()}`, {
      headers: { ...authHeaders() },
    });
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    renderEntregas(rows);
  }

  function renderEntregas(rows) {
    if (!tbodyEntregas) return;
    if (!rows.length) {
      tbodyEntregas.innerHTML =
        '<tr><td colspan="8" class="text-center text-muted py-3">Sin registros</td></tr>';
      return;
    }
    tbodyEntregas.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${String(row.anio || "")}-${String(row.mes || "").padStart(2, "0")}</td>
          <td>${row.folio || ""}</td>
          <td>${row.dependencia || ""}</td>
          <td class="text-end">${money(row.importe)}</td>
          <td>${row.estatus || ""}</td>
          <td>${formatDate(row.fecha_entrega_tesoreria)}</td>
          <td>${formatDate(row.fecha_recibido_presupuesto)}</td>
          <td class="text-center">
            <button class="btn btn-outline-secondary btn-sm btn-edit-entrega" data-id="${row.id}">
              Editar
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  async function cargarEntrega(id) {
    const data = await fetchJson(`${API}/api/expedientes-entrega/${id}`, {
      headers: { ...authHeaders() },
    });
    const row = data?.row;
    if (!row) return;
    currentEntregaId.value = row.id;
    inputAnio.value = row.anio || "";
    selectMes.value = row.mes || "";
    idSuficiencia.value = row.id_suficiencia || "";
    idComprometido.value = row.id_comprometido || "";
    idDevengado.value = row.id_devengado || "";
    idDgeneral.value = row.id_dgeneral || "";
    idDauxiliar.value = row.id_dauxiliar || "";
    partidaClave.value = row.partida_clave || "";
    inputFolio.value = row.folio || "";
    inputDependencia.value = row.dependencia || "";
    inputConcepto.value = row.concepto || "";
    inputImporte.value = money(row.importe);
    chkEntregoComprometido.checked = !!row.entrego_comprometido;
    chkEntregoDevengado.checked = !!row.entrego_devengado;
    inputFechaEntrega.value = formatDate(row.fecha_entrega_tesoreria);
    inputFechaRecibido.value = formatDate(row.fecha_recibido_presupuesto);
    selectEstatus.value = row.estatus || "ENTREGADO";
    inputObservaciones.value = row.observaciones || "";
    labelOrigen.textContent = `Entrega ${row.folio || ""}`;
  }

  async function guardarEntrega() {
    const payload = buildPayload();
    const id = currentEntregaId.value;
    const url = id ? `${API}/api/expedientes-entrega/${id}` : `${API}/api/expedientes-entrega`;
    const method = id ? "PATCH" : "POST";

    await fetchJson(url, {
      method,
      headers: { ...authHeaders() },
      body: JSON.stringify(payload),
    });

    await Swal.fire("Listo", "Entrega guardada correctamente.", "success");
    await cargarEntregas();
    if (!id) clearForm();
  }

  btnBuscarOrigen?.addEventListener("click", () => {
    buscarOrigen().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo buscar", "error");
    });
  });

  inputBuscarOrigen?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buscarOrigen().catch((err) => {
        Swal.fire("Error", err.message || "No se pudo buscar", "error");
      });
    }
  });

  tbodyOrigen?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-select-origen");
    if (!btn) return;
    const idx = Number(btn.dataset.idx || -1);
    const row = origenRows[idx];
    fillFromOrigen(row);
  });

  tbodyEntregas?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-edit-entrega");
    if (!btn) return;
    const id = Number(btn.dataset.id || 0);
    if (!Number.isFinite(id) || id <= 0) return;
    cargarEntrega(id).catch((err) => {
      Swal.fire("Error", err.message || "No se pudo cargar", "error");
    });
  });

  btnGuardarEntrega?.addEventListener("click", () => {
    guardarEntrega().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo guardar", "error");
    });
  });

  btnLimpiarEntrega?.addEventListener("click", () => {
    clearForm();
  });

  btnRecargarListado?.addEventListener("click", () => {
    cargarEntregas().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo cargar", "error");
    });
  });

  setPeriodoDefaults();
  clearForm();
  cargarEntregas().catch(() => {});
})();
