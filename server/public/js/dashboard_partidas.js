/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Dashboard de Partidas
 *  Archivo: dashboard_partidas.js
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
  const fDauxiliar = document.getElementById("fDauxiliar");
  const fCapitulo = document.getElementById("fCapitulo");
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

  const theadCapitulos = document.getElementById("theadCapitulos");
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

  function setKpisFromRows(rows) {
    const totals = rows.reduce(
      (acc, row) => {
        acc.presupuesto += Number(row.presupuesto || 0);
        acc.suficiencia += Number(row.suficiencia || 0);
        acc.comprometido += Number(row.comprometido || 0);
        acc.devengado += Number(row.devengado || 0);
        acc.reconducciones += Number(row.reconducciones || 0);
        acc.saldo_disponible += Number(row.saldo_disponible || 0);
        return acc;
      },
      {
        presupuesto: 0,
        suficiencia: 0,
        comprometido: 0,
        devengado: 0,
        reconducciones: 0,
        saldo_disponible: 0,
      },
    );
    setKpis(totals);
  }

  function renderCapitulos(rows) {
    if (!tbodyCapitulos) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbodyCapitulos.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Sin resultados.</td></tr>';
      return;
    }

    // Sanitización anti-XSS: cap viene como número de capítulo (1..9), pero
    // las funciones money()/percent() devuelven strings que escapamos por
    // defensa en profundidad. row puede contener clave si la vista es PARTIDA.
    tbodyCapitulos.innerHTML = rows
      .map((row) => {
        const cap = row.capitulo ?? 0;
        return `
          <tr>
            <td class="fw-semibold">${escapeHtml(cap)}</td>
            <td class="text-end">${escapeHtml(money(row.presupuesto))}</td>
            <td class="text-end">${escapeHtml(money(row.suficiencia))}</td>
            <td class="text-end">${escapeHtml(money(row.comprometido))}</td>
            <td class="text-end">${escapeHtml(money(row.devengado))}</td>
            <td class="text-end">${escapeHtml(money(row.reconducciones))}</td>
            <td class="text-end">${escapeHtml(money(row.saldo_disponible))}</td>
            <td class="text-end">${escapeHtml(percent(row.porcentaje_ejercido))}</td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline-primary" data-capitulo="${escapeHtml(cap)}">
                Ver detalle
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDetalle(rows, target) {
    const tbody = target || tbodyDetalle;
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-3">Sin detalle.</td></tr>';
      return;
    }

    // Sanitización anti-XSS: row.clave y row.descripcion provienen del
    // catálogo de partidas (BD) y se inyectan directamente en innerHTML.
    tbody.innerHTML = rows
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.clave || "")}</td>
            <td>${escapeHtml(row.descripcion || "")}</td>
            <td class="text-end">${escapeHtml(money(row.presupuesto))}</td>
            <td class="text-end">${escapeHtml(money(row.suficiencia))}</td>
            <td class="text-end">${escapeHtml(money(row.comprometido))}</td>
            <td class="text-end">${escapeHtml(money(row.devengado))}</td>
            <td class="text-end">${escapeHtml(money(row.reconducciones))}</td>
            <td class="text-end">${escapeHtml(money(row.saldo_disponible))}</td>
            <td class="text-end">${escapeHtml(percent(row.porcentaje_ejercido))}</td>
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
    const areaValue = String(fArea?.value || "");
    const areaOption = fArea?.options?.[fArea?.selectedIndex] || null;
    const areaClave =
      areaValue.startsWith("clave:")
        ? areaValue.replace("clave:", "")
        : String(areaOption?.dataset?.clave || "");
    const areaId = areaValue.startsWith("clave:") ? "" : areaValue;
    const capitulo = normalizeCapitulo(fCapitulo?.value);

    return {
      periodo: fPeriodo?.value || "ANUAL",
      anio: fAnio?.value || new Date().getFullYear(),
      segmento: fSegmento?.value || "1",
      vista: fVista?.value || "CAPITULO",
      id_dgeneral: areaId,
      id_dauxiliar: String(fDauxiliar?.value || ""),
      dg_clave: areaClave,
      capitulo,
      partida: String(fPartida?.value || "").trim(),
    };
  }

  function normalizeCapitulo(value) {
    const clean = String(value || "").replace(/[^\d]/g, "");
    if (!clean) return "";
    const num = Number(clean);
    if (!Number.isFinite(num)) return "";
    if (clean.length >= 4) return String(Math.floor(num / 1000) * 1000);
    return String(num);
  }

  function setTableHeader(view) {
    if (!theadCapitulos) return;
    if (view === "PARTIDA") {
      theadCapitulos.innerHTML = `
        <tr>
          <th>Partida</th>
          <th>Descripción</th>
          <th class="text-end">Presupuesto</th>
          <th class="text-end">Suficiencia</th>
          <th class="text-end">Comprometido</th>
          <th class="text-end">Devengado</th>
          <th class="text-end">Reconducciones</th>
          <th class="text-end">Saldo</th>
          <th class="text-end">% Ejercido</th>
        </tr>
      `;
      return;
    }
    theadCapitulos.innerHTML = `
      <tr>
        <th>Capítulo</th>
        <th class="text-end">Presupuesto</th>
        <th class="text-end">Suficiencia</th>
        <th class="text-end">Comprometido</th>
        <th class="text-end">Devengado</th>
        <th class="text-end">Reconducciones</th>
        <th class="text-end">Saldo</th>
        <th class="text-end">% Ejercido</th>
        <th class="text-center">Detalle</th>
      </tr>
    `;
  }

  async function loadAreas() {
    if (!fArea) return;
    const data = await fetchJson(`${API}/api/catalogos/dgeneral`);
    if (!data || !Array.isArray(data)) return;
    const byClave = new Map();
    data.forEach((row) => {
      const clave = String(row?.clave || "").trim();
      const desc = String(row?.dependencia || "").trim();
      const id = Number(row?.id);
      if (!clave || !id) return;
      if (!byClave.has(clave)) byClave.set(clave, []);
      byClave.get(clave).push({ id, clave, desc });
    });

    const claves = Array.from(byClave.keys()).sort((a, b) => a.localeCompare(b));
    const options = claves
      .map((clave) => {
        const rows = byClave.get(clave) || [];
        const group = [];
        if (rows.length > 1) {
          group.push(
            `<option value="clave:${clave}" data-clave="${clave}">${clave} - (Todas)</option>`,
          );
        }
        rows
          .sort((a, b) => a.desc.localeCompare(b.desc))
          .forEach((row) => {
            group.push(
              `<option value="${row.id}" data-clave="${row.clave}">${row.clave} - ${row.desc}</option>`,
            );
          });
        return group.join("");
      })
      .join("");
    fArea.insertAdjacentHTML("beforeend", options);
  }

  async function loadDauxiliares() {
    if (!fDauxiliar) return;
    const data = await fetchJson(`${API}/api/catalogos/dauxiliar`);
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
    fDauxiliar.insertAdjacentHTML("beforeend", options);
  }

  async function loadResumen() {
    const filters = getFilters();
    if (filters.vista === "PARTIDA") {
      if (!filters.capitulo) {
        await Swal.fire(
          "Falta capítulo",
          "Captura un capítulo para listar las partidas.",
          "warning",
        );
        return;
      }
      setTableHeader("PARTIDA");
      await loadPartidas(filters);
      return;
    }

    setTableHeader("CAPITULO");
    if (tbodyCapitulos) {
      tbodyCapitulos.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Cargando...</td></tr>';
    }
    const params = new URLSearchParams();
    params.set("periodo", filters.periodo);
    params.set("anio", filters.anio);
    params.set("segmento", filters.segmento);
    params.set("vista", filters.vista);
    if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
    if (filters.id_dauxiliar) params.set("id_dauxiliar", filters.id_dauxiliar);
    if (filters.dg_clave && !filters.id_dgeneral)
      params.set("dg_clave", filters.dg_clave);
    if (filters.capitulo) params.set("capitulo", filters.capitulo);
    if (filters.partida) params.set("partida", filters.partida);

    const data = await fetchJson(
      `${API}/api/dashboard/partidas-resumen?${params.toString()}`,
    );
    if (!data) return;
    setKpis(data.kpis || {});
    renderCapitulos(data.rows || []);
  }

  async function loadPartidas(filters) {
    if (tbodyCapitulos) {
      tbodyCapitulos.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Cargando...</td></tr>';
    }
    const params = new URLSearchParams();
    params.set("periodo", filters.periodo);
    params.set("anio", filters.anio);
    params.set("segmento", filters.segmento);
    params.set("capitulo", filters.capitulo);
    if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
    if (filters.id_dauxiliar) params.set("id_dauxiliar", filters.id_dauxiliar);
    if (filters.dg_clave && !filters.id_dgeneral)
      params.set("dg_clave", filters.dg_clave);
    if (filters.partida) params.set("partida", filters.partida);

    const data = await fetchJson(
      `${API}/api/dashboard/partidas-detalle?${params.toString()}`,
    );
    if (!data) return;
    renderDetalle(data.rows || [], tbodyCapitulos);
    setKpisFromRows(data.rows || []);
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
    if (filters.id_dauxiliar) params.set("id_dauxiliar", filters.id_dauxiliar);
    if (filters.dg_clave && !filters.id_dgeneral)
      params.set("dg_clave", filters.dg_clave);
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
      if (filters.id_dauxiliar) params.set("id_dauxiliar", filters.id_dauxiliar);
      if (filters.dg_clave && !filters.id_dgeneral)
        params.set("dg_clave", filters.dg_clave);
      if (filters.capitulo) params.set("capitulo", filters.capitulo);
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
  Promise.all([loadAreas(), loadDauxiliares()])
    .then(() => loadResumen())
    .catch((e) => Swal.fire("Error", e.message, "error"));
})();
