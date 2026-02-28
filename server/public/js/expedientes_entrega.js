(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  const inputAnio = document.getElementById("inputAnio");
  const selectMes = document.getElementById("selectMes");
  const selectTipoOrigen = document.getElementById("selectTipoOrigen");
  const inputBuscarOrigen = document.getElementById("inputBuscarOrigen");
  const btnBuscarOrigen = document.getElementById("btnBuscarOrigen");
  const tbodyOrigen = document.getElementById("tbodyOrigen");
  const labelOrigen = document.getElementById("labelOrigen");
  const thOrigenFolio = document.getElementById("thOrigenFolio");

  const currentEntregaId = document.getElementById("currentEntregaId");
  const idSuficiencia = document.getElementById("idSuficiencia");
  const idComprometido = document.getElementById("idComprometido");
  const idDevengado = document.getElementById("idDevengado");
  const idDgeneral = document.getElementById("idDgeneral");
  const idDauxiliar = document.getElementById("idDauxiliar");
  const partidaClave = document.getElementById("partidaClave");

  const inputFolio = document.getElementById("inputFolio");
  const chkFolioDiferido = document.getElementById("chkFolioDiferido");
  const selectFolioDiferido = document.getElementById("selectFolioDiferido");
  const wrapFolioDiferido = document.getElementById("wrapFolioDiferido");
  const btnGenerarFolio = document.getElementById("btnGenerarFolio");
  const origenData = {
    dependencia: "",
    concepto: "",
    importe: 0,
  };
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
  const filtroFolio = document.getElementById("filtroFolio");
  const filtroSearch = document.getElementById("filtroSearch");
  const btnBuscarFolio = document.getElementById("btnBuscarFolio");
  const btnRecargarListado = document.getElementById("btnRecargarListado");
  const tbodyEntregas = document.getElementById("tbodyEntregas");

  let origenRows = [];
  let folioBase = "";

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

  function buildDiferidoOptions() {
    const opts = ['<option value="01">D-01</option>'];
    for (let i = 2; i <= 99; i += 1) {
      const val = String(i).padStart(2, "0");
      opts.push(`<option value="${val}">D-${val}</option>`);
    }
    selectFolioDiferido.innerHTML = opts.join("");
  }

  function getMesPadded() {
    return String(selectMes.value || "").padStart(2, "0");
  }

  function updateFolioInput() {
    if (!folioBase) {
      inputFolio.value = "";
      return;
    }
    if (chkFolioDiferido.checked) {
      const suf = selectFolioDiferido.value || "01";
      inputFolio.value = `${folioBase} D-${suf}`;
      return;
    }
    inputFolio.value = folioBase;
  }

  async function fetchNextFolioBase() {
    const anio = Number(inputAnio.value || 0);
    const mes = Number(selectMes.value || 0);
    if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) return;
    const qs = new URLSearchParams();
    qs.set("anio", String(anio));
    qs.set("mes", String(mes));
    const data = await fetchJson(`${API}/api/expedientes-entrega/next-folio?${qs.toString()}`, {
      headers: { ...authHeaders() },
    });
    folioBase = data?.base || "";
    updateFolioInput();
  }

  async function fetchNextDiferido() {
    if (!folioBase) return;
    const anio = Number(inputAnio.value || 0);
    const mes = Number(selectMes.value || 0);
    if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) return;
    const qs = new URLSearchParams();
    qs.set("anio", String(anio));
    qs.set("mes", String(mes));
    qs.set("base", folioBase);
    const data = await fetchJson(`${API}/api/expedientes-entrega/next-folio?${qs.toString()}`, {
      headers: { ...authHeaders() },
    });
    if (data?.next_diferido) {
      selectFolioDiferido.value = data.next_diferido;
    }
    updateFolioInput();
  }

  function toggleDiferidoUI() {
    if (chkFolioDiferido.checked) {
      wrapFolioDiferido.classList.remove("d-none");
    } else {
      wrapFolioDiferido.classList.add("d-none");
    }
    updateFolioInput();
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
    folioBase = "";
    origenData.dependencia = "";
    origenData.concepto = "";
    origenData.importe = 0;
    inputFechaEntrega.value = "";
    inputFechaRecibido.value = "";
    selectEstatus.value = "ENTREGADO";
    chkEntregoComprometido.checked = false;
    chkEntregoDevengado.checked = false;
    chkFolioDiferido.checked = false;
    selectFolioDiferido.value = "01";
    inputObservaciones.value = "";
    labelOrigen.textContent = "Sin expediente seleccionado";
    toggleDiferidoUI();
    fetchNextFolioBase().catch(() => {});
  }

  function fillFromOrigen(row) {
    if (!row) return;
    idSuficiencia.value = row.id_suficiencia || "";
    idComprometido.value = row.id_comprometido || "";
    idDevengado.value = row.id_devengado || "";
    idDgeneral.value = row.id_dgeneral || "";
    idDauxiliar.value = row.id_dauxiliar || "";
    partidaClave.value = row.partida_clave || "";
    origenData.dependencia = row.dependencia || "";
    origenData.concepto = row.concepto || "";
    origenData.importe = Number(row.importe || 0);
    labelOrigen.textContent =
      row.tipo === "SUF"
        ? `No. de Suficiencia ${row.folio || ""}`
        : `Origen ${row.tipo} - ${row.folio || ""}`;
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
      folio: String(inputFolio.value || "").trim(),
      dependencia: origenData.dependencia || null,
      concepto: origenData.concepto || null,
      importe: String(origenData.importe || 0),
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
    if (thOrigenFolio) {
      thOrigenFolio.textContent =
        selectTipoOrigen.value === "SUF" ? "No. de Suficiencia" : "Folio";
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
    if (filtroFolio?.value.trim()) qs.set("folio", filtroFolio.value.trim());
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
        '<tr><td colspan="11" class="text-center text-muted py-3">Sin registros</td></tr>';
      return;
    }
    tbodyEntregas.innerHTML = rows
      .map(
        (row, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${row.folio || ""}</td>
          <td>${row.dependencia || ""}</td>
          <td>${row.concepto || ""}</td>
          <td class="text-center">${row.entrego_comprometido ? "●" : ""}</td>
          <td class="text-center">${row.entrego_devengado ? "●" : ""}</td>
          <td class="text-end">${money(row.importe)}</td>
          <td>${formatDate(row.fecha_entrega_tesoreria)}</td>
          <td>${formatDate(row.fecha_recibido_presupuesto)}</td>
          <td class="text-center">${row.estatus || ""}</td>
          <td>${row.observaciones || ""}</td>
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
    {
      const rawFolio = String(row.folio || "").trim().toUpperCase();
      const match = rawFolio.match(/^(\d{2}-\d+)(?:\s+D-(\d{2}))?$/);
      folioBase = match ? match[1] : rawFolio;
      if (match?.[2]) {
        chkFolioDiferido.checked = true;
        selectFolioDiferido.value = match[2];
      } else {
        chkFolioDiferido.checked = false;
      }
      toggleDiferidoUI();
      updateFolioInput();
    }
    origenData.dependencia = row.dependencia || "";
    origenData.concepto = row.concepto || "";
    origenData.importe = Number(row.importe || 0);
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
    const mes = getMesPadded();
    if (!payload.folio) {
      await Swal.fire("Error", "No se pudo generar el folio.", "error");
      return;
    }
    const match = payload.folio.match(/^(\d{2})-(\d+)(?:\s+D-(\d{2}))?$/);
    if (!match || match[1] !== mes) {
      await Swal.fire("Error", `El folio debe iniciar con ${mes}-`, "error");
      return;
    }

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


  btnGuardarEntrega?.addEventListener("click", () => {
    guardarEntrega().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo guardar", "error");
    });
  });

  btnLimpiarEntrega?.addEventListener("click", () => {
    clearForm();
  });

  btnGenerarFolio?.addEventListener("click", () => {
    fetchNextFolioBase()
      .then(() => {
        if (chkFolioDiferido.checked) return fetchNextDiferido();
        return null;
      })
      .catch((err) => {
        Swal.fire("Error", err.message || "No se pudo generar folio", "error");
      });
  });

  chkFolioDiferido?.addEventListener("change", () => {
    toggleDiferidoUI();
    if (chkFolioDiferido.checked) {
      fetchNextDiferido().catch(() => {});
    }
  });

  selectFolioDiferido?.addEventListener("change", () => {
    updateFolioInput();
  });

  selectMes?.addEventListener("change", () => {
    fetchNextFolioBase()
      .then(() => {
        if (chkFolioDiferido.checked) return fetchNextDiferido();
        return null;
      })
      .catch(() => {});
  });

  selectTipoOrigen?.addEventListener("change", () => {
    if (thOrigenFolio) {
      thOrigenFolio.textContent =
        selectTipoOrigen.value === "SUF" ? "No. de Suficiencia" : "Folio";
    }
  });

  inputAnio?.addEventListener("change", () => {
    fetchNextFolioBase()
      .then(() => {
        if (chkFolioDiferido.checked) return fetchNextDiferido();
        return null;
      })
      .catch(() => {});
  });

  btnRecargarListado?.addEventListener("click", () => {
    filtroAnio.value = "";
    filtroMes.value = "";
    if (filtroFolio) filtroFolio.value = "";
    filtroSearch.value = "";
    cargarEntregas().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo cargar", "error");
    });
  });

  btnBuscarFolio?.addEventListener("click", () => {
    cargarEntregas().catch((err) => {
      Swal.fire("Error", err.message || "No se pudo cargar", "error");
    });
  });

  filtroFolio?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      cargarEntregas().catch((err) => {
        Swal.fire("Error", err.message || "No se pudo cargar", "error");
      });
    }
  });

  setPeriodoDefaults();
  buildDiferidoOptions();
  toggleDiferidoUI();
  if (thOrigenFolio) {
    thOrigenFolio.textContent =
      selectTipoOrigen.value === "SUF" ? "No. de Suficiencia" : "Folio";
  }
  clearForm();
  cargarEntregas().catch(() => {});
})();
