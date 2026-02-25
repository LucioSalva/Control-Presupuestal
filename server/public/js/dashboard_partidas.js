(() => {
  const API = window.API_URL || "";
  const token = localStorage.getItem("cp_token");

  if (!token) {
    window.location.replace("login.html");
    return;
  }

  const fPeriodo = document.getElementById("fPeriodo");
  const fAnio = document.getElementById("fAnio");
  const fSegmento = document.getElementById("fSegmento");
  const fVista = document.getElementById("fVista");
  const fArea = document.getElementById("fArea");
  const fPartida = document.getElementById("fPartida");
  const lblSegmento = document.getElementById("lblSegmento");
  const btnAplicar = document.getElementById("btnAplicar");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnGrafica = document.getElementById("btnGrafica");

  const kpiPresupuesto = document.getElementById("kpiPresupuesto");
  const kpiSuficiencia = document.getElementById("kpiSuficiencia");
  const kpiComprometido = document.getElementById("kpiComprometido");
  const kpiDevengado = document.getElementById("kpiDevengado");
  const kpiReconducciones = document.getElementById("kpiReconducciones");
  const kpiSaldo = document.getElementById("kpiSaldo");

  const tbodyCapitulos = document.getElementById("tbodyCapitulos");
  const tbodyDetalle = document.getElementById("tbodyDetalle");
  const modalDetalleEl = document.getElementById("modalDetalle");
  const modalDetalleTitle = document.getElementById("modalDetalleTitle");
  const modalDetalle = modalDetalleEl ? new bootstrap.Modal(modalDetalleEl) : null;

  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

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
      const msg = data?.error || "Error al consultar el servidor";
      if (res.status === 403) {
        await Swal.fire("Acceso denegado", msg, "error");
        window.location.replace("suficiencia_presupuestal.html");
        return null;
      }
      throw new Error(msg);
    }
    return data;
  }

  function money(value) {
    const v = Number(value || 0);
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(v);
  }

  function percent(value) {
    const v = Number(value || 0) * 100;
    return `${v.toFixed(1)}%`;
  }

  function setKpis(kpis) {
    if (kpiPresupuesto) kpiPresupuesto.textContent = money(kpis.presupuesto);
    if (kpiSuficiencia) kpiSuficiencia.textContent = money(kpis.suficiencia);
    if (kpiComprometido) kpiComprometido.textContent = money(kpis.comprometido);
    if (kpiDevengado) kpiDevengado.textContent = money(kpis.devengado);
    if (kpiReconducciones)
      kpiReconducciones.textContent = money(kpis.reconducciones);
    if (kpiSaldo) kpiSaldo.textContent = money(kpis.saldo_disponible);
  }

  function renderCapitulos(rows) {
    if (!tbodyCapitulos) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbodyCapitulos.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Sin resultados.</td></tr>';
      return;
    }

    tbodyCapitulos.innerHTML = rows
      .map((row) => {
        const cap = row.capitulo ?? 0;
        return `
          <tr>
            <td class="fw-semibold">${cap}</td>
            <td class="text-end">${money(row.presupuesto)}</td>
            <td class="text-end">${money(row.suficiencia)}</td>
            <td class="text-end">${money(row.comprometido)}</td>
            <td class="text-end">${money(row.devengado)}</td>
            <td class="text-end">${money(row.reconducciones)}</td>
            <td class="text-end">${money(row.saldo_disponible)}</td>
            <td class="text-end">${percent(row.porcentaje_ejercido)}</td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline-primary" data-capitulo="${cap}">
                Ver detalle
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDetalle(rows) {
    if (!tbodyDetalle) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbodyDetalle.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-3">Sin detalle.</td></tr>';
      return;
    }

    tbodyDetalle.innerHTML = rows
      .map((row) => {
        return `
          <tr>
            <td>${row.clave || ""}</td>
            <td>${row.descripcion || ""}</td>
            <td class="text-end">${money(row.presupuesto)}</td>
            <td class="text-end">${money(row.suficiencia)}</td>
            <td class="text-end">${money(row.comprometido)}</td>
            <td class="text-end">${money(row.devengado)}</td>
            <td class="text-end">${money(row.reconducciones)}</td>
            <td class="text-end">${money(row.saldo_disponible)}</td>
            <td class="text-end">${percent(row.porcentaje_ejercido)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function buildPeriodoOptions() {
    const options = [
      { value: "ANUAL", label: "Año" },
      { value: "MENSUAL", label: "Mes" },
      { value: "BIMESTRAL", label: "Bimestre" },
      { value: "TRIMESTRAL", label: "Trimestre" },
      { value: "SEMESTRAL", label: "Semestre" },
    ];
    fPeriodo.innerHTML = options
      .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
      .join("");
  }

  function buildSegmentoOptions(periodo) {
    if (!fSegmento || !lblSegmento) return;
    let options = [];
    let label = "Mes";

    if (periodo === "ANUAL") {
      label = "Periodo";
      options = [{ value: "1", label: "Todo el año" }];
      fSegmento.disabled = true;
    } else if (periodo === "MENSUAL") {
      label = "Mes";
      options = monthNames.map((m, i) => ({
        value: String(i + 1),
        label: m,
      }));
      fSegmento.disabled = false;
    } else if (periodo === "BIMESTRAL") {
      label = "Bimestre";
      options = [
        { value: "1", label: "Ene - Feb" },
        { value: "2", label: "Mar - Abr" },
        { value: "3", label: "May - Jun" },
        { value: "4", label: "Jul - Ago" },
        { value: "5", label: "Sep - Oct" },
        { value: "6", label: "Nov - Dic" },
      ];
      fSegmento.disabled = false;
    } else if (periodo === "TRIMESTRAL") {
      label = "Trimestre";
      options = [
        { value: "1", label: "Ene - Mar" },
        { value: "2", label: "Abr - Jun" },
        { value: "3", label: "Jul - Sep" },
        { value: "4", label: "Oct - Dic" },
      ];
      fSegmento.disabled = false;
    } else if (periodo === "SEMESTRAL") {
      label = "Semestre";
      options = [
        { value: "1", label: "Ene - Jun" },
        { value: "2", label: "Jul - Dic" },
      ];
      fSegmento.disabled = false;
    }

    lblSegmento.textContent = label;
    fSegmento.innerHTML = options
      .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
      .join("");
  }

  function getFilters() {
    return {
      periodo: fPeriodo?.value || "ANUAL",
      anio: fAnio?.value || new Date().getFullYear(),
      segmento: fSegmento?.value || "1",
      vista: fVista?.value || "CAPITULO",
      id_dgeneral: fArea?.value || "",
      partida: String(fPartida?.value || "").trim(),
    };
  }

  async function loadAreas() {
    if (!fArea) return;
    const data = await fetchJson(`${API}/api/catalogos/dgeneral`);
    if (!data || !Array.isArray(data)) return;
    const options = data
      .map((row) => {
        const id = Number(row?.id);
        const clave = String(row?.clave || "").trim();
        const desc = String(row?.dependencia || "").trim();
        if (!id) return "";
        return `<option value="${id}">${clave} - ${desc}</option>`;
      })
      .filter(Boolean)
      .join("");
    fArea.insertAdjacentHTML("beforeend", options);
  }

  async function loadResumen() {
    if (tbodyCapitulos) {
      tbodyCapitulos.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Cargando...</td></tr>';
    }
    const filters = getFilters();
    const params = new URLSearchParams();
    params.set("periodo", filters.periodo);
    params.set("anio", filters.anio);
    params.set("segmento", filters.segmento);
    params.set("vista", filters.vista);
    if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
    if (filters.partida) params.set("partida", filters.partida);

    const data = await fetchJson(
      `${API}/api/dashboard/partidas-resumen?${params.toString()}`,
    );
    if (!data) return;
    setKpis(data.kpis || {});
    renderCapitulos(data.rows || []);
  }

  async function loadDetalle(capitulo) {
    if (!tbodyDetalle) return;
    tbodyDetalle.innerHTML =
      '<tr><td colspan="9" class="text-center text-muted py-3">Cargando...</td></tr>';
    if (modalDetalleTitle) {
      modalDetalleTitle.textContent = `Detalle de capítulo ${capitulo}`;
    }
    const filters = getFilters();
    const params = new URLSearchParams();
    params.set("periodo", filters.periodo);
    params.set("anio", filters.anio);
    params.set("segmento", filters.segmento);
    params.set("capitulo", String(capitulo));
    if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
    if (filters.partida) params.set("partida", filters.partida);

    const data = await fetchJson(
      `${API}/api/dashboard/partidas-detalle?${params.toString()}`,
    );
    if (!data) return;
    renderDetalle(data.rows || []);
    modalDetalle?.show();
  }

  function bindEvents() {
    fPeriodo?.addEventListener("change", () => {
      buildSegmentoOptions(fPeriodo.value);
    });
    btnAplicar?.addEventListener("click", () =>
      loadResumen().catch((e) => Swal.fire("Error", e.message, "error")),
    );
    btnRefresh?.addEventListener("click", () =>
      loadResumen().catch((e) => Swal.fire("Error", e.message, "error")),
    );
    btnGrafica?.addEventListener("click", () => {
      const filters = getFilters();
      const params = new URLSearchParams();
      params.set("periodo", filters.periodo);
      params.set("anio", filters.anio);
      params.set("segmento", filters.segmento);
      if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
      if (filters.partida) params.set("partida", filters.partida);
      const url = `dashboard_partidas_grafica.html?${params.toString()}`;
      window.open(url, "_blank", "noopener");
    });
    tbodyCapitulos?.addEventListener("click", (e) => {
      const target = e.target.closest("button[data-capitulo]");
      if (!target) return;
      const capitulo = Number(target.dataset.capitulo || 0);
      if (!capitulo) return;
      loadDetalle(capitulo).catch((err) =>
        Swal.fire("Error", err.message, "error"),
      );
    });
  }

  function initDefaults() {
    const now = new Date();
    if (fAnio) fAnio.value = String(now.getFullYear());
    buildPeriodoOptions();
    if (fPeriodo) fPeriodo.value = "ANUAL";
    buildSegmentoOptions("ANUAL");
  }

  initDefaults();
  bindEvents();
  loadAreas()
    .then(() => loadResumen())
    .catch((e) => Swal.fire("Error", e.message, "error"));
})();
