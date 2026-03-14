/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Gráficas del Dashboard
 *  Archivo: dashboard_partidas_grafica.js
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
  const fArea = document.getElementById("fArea");
  const fDauxiliar = document.getElementById("fDauxiliar");
  const fPartida = document.getElementById("fPartida");
  const fNivel = document.getElementById("fNivel");
  const fCapitulo = document.getElementById("fCapitulo");
  const fTipo = document.getElementById("fTipo");
  const fMetrica = document.getElementById("fMetrica");
  const lblSegmento = document.getElementById("lblSegmento");
  const btnAplicar = document.getElementById("btnAplicar");
  const btnActualizar = document.getElementById("btnActualizar");
  const chartFootnote = document.getElementById("chartFootnote");

  const chartCanvas = document.getElementById("chartPartidas");
  let chartInstance = null;

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

  function normalizePartida(value) {
    const clean = String(value || "").replace(/[^\d]/g, "");
    return clean || "";
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
    const partida = normalizePartida(fPartida?.value);
    return {
      periodo: fPeriodo?.value || "ANUAL",
      anio: fAnio?.value || new Date().getFullYear(),
      segmento: fSegmento?.value || "1",
      id_dgeneral: fArea?.value || "",
      id_dauxiliar: fDauxiliar?.value || "",
      partida,
      nivel: fNivel?.value || "CAPITULO",
      capitulo: normalizePartida(fCapitulo?.value),
      tipo: fTipo?.value || "bar",
      metrica: fMetrica?.value || "presupuesto",
    };
  }

  function resolveCapitulo(filters) {
    if (filters.capitulo) return filters.capitulo;
    if (filters.partida) {
      const num = Number(filters.partida);
      if (Number.isFinite(num)) {
        return String(Math.floor(num / 1000) * 1000);
      }
    }
    return "";
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

  function buildDataset(rows, metrica, nivel) {
    const labelMap = {
      presupuesto: "Presupuesto",
      suficiencia: "Suficiencia",
      comprometido: "Comprometido",
      devengado: "Devengado",
      saldo_disponible: "Saldo",
      porcentaje_ejercido: "% Ejercido",
    };
    const labels = rows.map((row) =>
      nivel === "CAPITULO" ? String(row.capitulo) : String(row.clave),
    );
    const values = rows.map((row) => Number(row[metrica] || 0));
    return { label: labelMap[metrica] || metrica, labels, values };
  }

  function buildColors(count) {
    const base = [
      "#7a1f2b",
      "#bc955c",
      "#2f3c4f",
      "#5a6b7b",
      "#d4a373",
      "#4c6a92",
      "#a26769",
      "#6a994e",
      "#457b9d",
      "#f4a261",
      "#e76f51",
      "#588157",
    ];
    const colors = [];
    for (let i = 0; i < count; i += 1) {
      colors.push(base[i % base.length]);
    }
    return colors;
  }

  function renderChart({ labels, values, label }, chartType, metrica) {
    if (!chartCanvas) return;
    if (chartInstance) chartInstance.destroy();
    const colors = buildColors(labels.length);

    chartInstance = new Chart(chartCanvas, {
      type: chartType,
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: chartType === "pie" ? "right" : "top",
            labels: { boxWidth: 14, boxHeight: 14 },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const v = context.raw ?? 0;
                if (metrica === "porcentaje_ejercido") return percent(v);
                return money(v);
              },
            },
          },
        },
        scales:
          chartType === "pie"
            ? {}
            : {
                y: {
                  ticks: {
                    callback(value) {
                      if (metrica === "porcentaje_ejercido")
                        return `${value}%`;
                      return money(value);
                    },
                  },
                },
              },
      },
    });
  }

  async function loadChart() {
    const filters = getFilters();
    const nivel = filters.nivel;
    const metrica = filters.metrica;
    const params = new URLSearchParams();
    params.set("periodo", filters.periodo);
    params.set("anio", filters.anio);
    params.set("segmento", filters.segmento);
    if (filters.id_dgeneral) params.set("id_dgeneral", filters.id_dgeneral);
    if (filters.id_dauxiliar) params.set("id_dauxiliar", filters.id_dauxiliar);
    if (filters.partida) params.set("partida", filters.partida);

    let rows = [];
    if (nivel === "CAPITULO") {
      const data = await fetchJson(
        `${API}/api/dashboard/partidas-resumen?${params.toString()}`,
      );
      if (!data) return;
      rows = Array.isArray(data.rows) ? data.rows : [];
      if (chartFootnote) {
        chartFootnote.textContent = `Filtrado por capítulos: ${rows.length} elemento(s)`;
      }
    } else {
      const capitulo = resolveCapitulo(filters);
      if (!capitulo) {
        await Swal.fire(
          "Falta capítulo",
          "Captura un capítulo o una partida para poder graficar por partida.",
          "warning",
        );
        return;
      }
      params.set("capitulo", capitulo);
      const data = await fetchJson(
        `${API}/api/dashboard/partidas-detalle?${params.toString()}`,
      );
      if (!data) return;
      rows = Array.isArray(data.rows) ? data.rows : [];
      if (chartFootnote) {
        chartFootnote.textContent = `Detalle del capítulo ${capitulo}: ${rows.length} partida(s)`;
      }
    }

    const dataset = buildDataset(rows, metrica, nivel);
    renderChart(dataset, filters.tipo, metrica);
  }

  function bindEvents() {
    fPeriodo?.addEventListener("change", () => {
      buildSegmentoOptions(fPeriodo.value);
    });
    btnAplicar?.addEventListener("click", () =>
      loadChart().catch((e) => Swal.fire("Error", e.message, "error")),
    );
    btnActualizar?.addEventListener("click", () =>
      loadChart().catch((e) => Swal.fire("Error", e.message, "error")),
    );
  }

  function applyQueryDefaults() {
    const params = new URLSearchParams(window.location.search);
    const periodo = params.get("periodo");
    const anio = params.get("anio");
    const segmento = params.get("segmento");
    const idDg = params.get("id_dgeneral");
    const idDa = params.get("id_dauxiliar");
    const partida = params.get("partida");
    const capitulo = params.get("capitulo");

    if (periodo) fPeriodo.value = periodo;
    if (anio) fAnio.value = anio;
    if (segmento) fSegmento.value = segmento;
    if (idDg) fArea.value = idDg;
    if (idDa) fDauxiliar.value = idDa;
    if (partida) fPartida.value = partida;
    if (capitulo) fCapitulo.value = capitulo;
  }

  function initDefaults() {
    const now = new Date();
    if (fAnio) fAnio.value = String(now.getFullYear());
    buildPeriodoOptions();
    if (fPeriodo) fPeriodo.value = "ANUAL";
    buildSegmentoOptions("ANUAL");
    if (fTipo) fTipo.value = "bar";
    if (fMetrica) fMetrica.value = "presupuesto";
  }

  initDefaults();
  bindEvents();
  Promise.all([loadAreas(), loadDauxiliares()])
    .then(() => {
      applyQueryDefaults();
      buildSegmentoOptions(fPeriodo.value);
      return loadChart();
    })
    .catch((e) => Swal.fire("Error", e.message, "error"));
})();
