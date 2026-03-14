/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Utilidades Globales
 *  Archivo: script.js
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
// =====================================================
//  CONFIGURACIÓN Y UTILIDADES BÁSICAS
// =====================================================

// Formato de dinero
function money(v) {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return Number(v).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  });
}

const MES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const LS_KEY = "cp_app_data_v1";

function getCurrentUserRoleFlags() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) return { esAdmin: false };
    const user = JSON.parse(raw);
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const rolesNorm = roles.map((r) => String(r).trim().toUpperCase());
    return {
      esAdmin: rolesNorm.includes("ADMIN"),
    };
  } catch (e) {
    console.warn("No se pudo leer cp_usuario", e);
    return { esAdmin: false };
  }
}

const { esAdmin } = getCurrentUserRoleFlags();

const PROJECT_KEYS_KEY = "cp_current_project_keys";
const API = window.API_URL;

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const STATE = {
  presupuesto: [],
  gastos: [],
  recon: [],
  partitdasCatalog: new Set(),
  chart: null,
  highlightPartida: null,
  highlightNeedsScroll: false,
  missingRows: [],
  projectKeys: null,
};

// ================== USUARIO ACTUAL (desde localStorage) ==================
let CURRENT_USER = null;
let CURRENT_ROLES = [];
let CURRENT_ROLES_NORM = [];
let CURRENT_DG_CLAVE = ""; // ejemplo: "L00" de dgeneral

function loadCurrentUserFromLS() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) return;

    const user = JSON.parse(raw);
    CURRENT_USER = user || null;

    const roles = Array.isArray(user.roles) ? user.roles : [];
    CURRENT_ROLES = roles;
    CURRENT_ROLES_NORM = roles
      .filter((r) => r != null)
      .map((r) => String(r).trim().toUpperCase());

    CURRENT_DG_CLAVE = String(user.dgeneral_clave || "")
      .trim()
      .toUpperCase();

    console.log("[USER] ", CURRENT_USER);
    console.log("[USER] roles:", CURRENT_ROLES_NORM);
    console.log("[USER] dgeneral_clave:", CURRENT_DG_CLAVE);
  } catch (e) {
    console.warn("[USER] No se pudo leer cp_usuario:", e);
  }
}

function isAreaUser() {
  return CURRENT_ROLES_NORM.includes("AREA");
}

// 👉 cargar usuario inmediatamente para que todo lo demás lo use
loadCurrentUserFromLS();

// Escapar HTML
function escapeHtml(s) {
  return String(s).replace(
    /[&<>\"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// Spinner global
const showSpinner = (v) => {
  const el = document.getElementById("spinner");
  if (el) el.style.display = v ? "block" : "none";
};

// SweetAlert2 genérico
function banner(msg, type = "info") {
  const iconMap = {
    info: "info",
    success: "success",
    warning: "warning",
    danger: "error",
  };
  const titleMap = {
    info: "Información",
    success: "Éxito",
    warning: "Advertencia",
    danger: "Error",
  };
  const timerSettings = {
    info: 10000,
    success: 8000,
    warning: 15000,
    danger: 20000,
  };

  Swal.fire({
    icon: iconMap[type] || "info",
    title: titleMap[type] || "Información",
    html: msg,
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: timerSettings[type] || 10000,
    timerProgressBar: true,
    background: "#1a1a1a",
    color: "#ffffff",
    customClass: { popup: "sweetalert-toast" },
  });
}

function showNegativeBalanceAlert(partidasNegativas) {
  if (!Array.isArray(partidasNegativas) || partidasNegativas.length === 0)
    return;

  const partidasList = partidasNegativas
    .map(
      (p) => `• <strong>${escapeHtml(p.partida)}</strong>: ${money(p.saldo)}`
    )
    .join("<br>");

  Swal.fire({
    icon: "warning",
    title: "¡Atención! Números Negativos",
    html: `Las siguientes partidas tienen saldo negativo:<br><br>${partidasList}`,
    confirmButtonText: "Entendido",
    background: "#1a1a1a",
    color: "#ffffff",
    customClass: { popup: "sweetalert-negative-alert" },
  });
}

// =====================================================
//  HELPERS DE API
// =====================================================

async function apiGet(path) {
  const r = await fetch(API_URL + path);
  if (!r.ok) throw new Error("GET " + path + " " + r.status);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || "POST " + path);
  return data;
}

async function apiDelete(path) {
  const r = await fetch(API_URL + path, { method: "DELETE" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "DELETE " + path);
  return d;
}

// =====================================================
//  NORMALIZADOR DE RECONDUCCIONES
// =====================================================

function mergeReconPairs(reconsRaw) {
  if (!Array.isArray(reconsRaw) || !reconsRaw.length) return [];

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const toDayISO = (v) => {
    if (!v) return "";
    const d = v instanceof Date ? v : new Date(v);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const toCents = (n) => Math.round(Number(n || 0) * 100);

  const items = reconsRaw.map((r) => {
    const fecha = r?.fecha ? new Date(r.fecha) : null;
    const monto = Number(r?.monto || 0);
    const origen = r?.origen || r?.partida_origen || "";
    const destino = r?.destino || r?.partida_destino || "";
    return {
      concepto: String(r?.concepto || "").trim(),
      conceptoKey: norm(r?.concepto || ""),
      fecha,
      fechaKey: toDayISO(fecha),
      cents: toCents(monto),
      origen,
      destino,
    };
  });

  const groups = new Map();
  for (const it of items) {
    const k = `${it.conceptoKey}|${it.fechaKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const merged = [];
  const TOL = 1; // 1 centavo

  for (const [, arr] of groups) {
    let debits = arr
      .filter((x) => x.cents < 0)
      .map((x) => ({
        concepto: x.concepto,
        fecha: x.fecha,
        origen: x.origen || x.destino || "",
        cents: Math.abs(x.cents),
      }));
    let credits = arr
      .filter((x) => x.cents > 0)
      .map((x) => ({
        concepto: x.concepto,
        fecha: x.fecha,
        destino: x.destino || x.origen || "",
        cents: x.cents,
      }));

    debits.sort((a, b) => b.cents - a.cents);
    credits.sort((a, b) => b.cents - a.cents);

    while (debits.length && credits.length) {
      let d = debits[0];

      let idx = credits.findIndex((c) => Math.abs(c.cents - d.cents) <= TOL);
      if (idx === -1) {
        let best = 0;
        let bestDiff = Math.abs(credits[0].cents - d.cents);
        for (let i = 1; i < credits.length; i++) {
          const diff = Math.abs(credits[i].cents - d.cents);
          if (diff < bestDiff) {
            best = i;
            bestDiff = diff;
          }
        }
        idx = best;
      }

      const c = credits[idx];
      const used = Math.min(d.cents, c.cents);

      merged.push({
        concepto: d.concepto || c.concepto || "",
        origen: d.origen || "",
        destino: c.destino || "",
        monto: used / 100,
        fecha: d.fecha || c.fecha || null,
        _incompleta: false,
      });

      d.cents -= used;
      c.cents -= used;
      if (d.cents <= 0 + TOL) debits.shift();
      if (c.cents <= 0 + TOL) credits.splice(idx, 1);
    }

    // movimientos incompletos viejos
    debits.forEach((d) => {
      if (d.cents > 0) {
        merged.push({
          concepto: d.concepto || "",
          origen: d.origen || "",
          destino: "",
          monto: d.cents / 100,
          fecha: d.fecha || null,
          _incompleta: true,
        });
      }
    });
    credits.forEach((c) => {
      if (c.cents > 0) {
        merged.push({
          concepto: c.concepto || "",
          origen: "",
          destino: c.destino || "",
          monto: c.cents / 100,
          fecha: c.fecha || null,
          _incompleta: true,
        });
      }
    });
  }

  return merged;
}

// =====================================================
//  CARGA DESDE BACKEND
// =====================================================

// Verificar partida duplicada por mes
async function checkDuplicatePartida(partida, monto, mes, project) {
  if (!partida || !mes || !project) return false;
  try {
    const qs = `?project=${encodeURIComponent(
      project
    )}&mes=${encodeURIComponent(mes)}`;
    const detalles = await apiGet("/api/detalles" + qs);
    return detalles.some(
      (d) =>
        normalizeKey(d.partida) === normalizeKey(partida) &&
        Math.abs(Number(d.presupuesto) - monto) < 0.01
    );
  } catch (error) {
    console.warn("Error al verificar duplicados:", error);
    return false;
  }
}

// Cargar presupuesto + gastos + reconducciones
async function loadFromAPI() {
  const project = (document.getElementById("proj-code")?.value || "").trim();
  if (!project) {
    STATE.presupuesto = [];
    STATE.gastos = [];
    STATE.recon = [];
    STATE.highlightPartida = null;
    STATE.highlightNeedsScroll = false;
    return;
  }

  const qs = "?project=" + encodeURIComponent(project);
  const detalles = await apiGet("/api/detalles" + qs);

  STATE.presupuesto = detalles.map((d) => ({
    partida: d.partida,
    presupuesto: Number(d.presupuesto || 0),
    saldo: Number(d.saldo_disponible || 0),
    gastado: Number(d.total_gastado || 0),
    recon: Number(d.total_reconducido || 0),
    fechaRegistro: d.fecha_registro ? new Date(d.fecha_registro) : null,
    fechaGasto: d.fecha_cuando_se_gasto
      ? new Date(d.fecha_cuando_se_gasto)
      : null,
    fechaRecon: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null,
  }));

  STATE.gastos = detalles
    .filter((d) => Number(d.total_gastado) > 0)
    .map((d) => ({
      fecha: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
      descripcion: d.en_que_se_gasto || "(sin descripción)",
      partida: d.partida,
      monto: Number(d.total_gastado || 0),
    }));

  try {
    const reconducciones = await apiGet("/api/reconducciones" + qs);
    const raw = reconducciones.map((r) => ({
      concepto: r.concepto || "",
      origen: r.origen || "",
      destino: r.destino || "",
      monto: Number(r.monto || 0),
      fecha: r.fecha ? new Date(r.fecha) : null,
    }));
    STATE.recon = mergeReconPairs(raw);
  } catch (e) {
    console.warn("No se pudieron cargar reconducciones:", e.message);
    const raw = detalles
      .filter((d) => d.fecha_reconduccion || Number(d.total_reconducido))
      .map((d) => ({
        concepto: d.motivo_reconduccion || "",
        origen: d.partida_origen || "",
        destino: d.partida || "",
        monto: Number(d.total_reconducido || 0),
        fecha: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null,
      }));
    STATE.recon = mergeReconPairs(raw);
  }
}

// =====================================================
//  RENDER PRINCIPAL
// =====================================================

function getFiltros() {
  return {
    partida: (document.getElementById("f-partida")?.value || "").trim(),
    busca: (document.getElementById("f-buscar")?.value || "")
      .trim()
      .toLowerCase(),
  };
}

function groupGastadoPorPartida(gastos, filtros) {
  const out = {};
  gastos.forEach((g) => {
    if (
      filtros.busca &&
      !String(g.descripcion || "")
        .toLowerCase()
        .includes(filtros.busca)
    )
      return;
    if (!g.partida) return;
    out[g.partida] = (out[g.partida] || 0) + (g.monto || 0);
  });
  return out;
}

function renderMissing(rows) {
  const tbody = document.querySelector("#tabla-missing tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const d = r.fecha
      ? `${String(r.fecha.getUTCDate()).padStart(2, "0")}/${
          MES[r.fecha.getUTCMonth()]
        }/${r.fecha.getUTCFullYear()}`
      : "—";
    const tr = document.createElement("tr");
    tr.dataset.partida = r.partida;
    tr.innerHTML = `<td>${d}</td><td>${escapeHtml(
      r.descripcion || ""
    )}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function showPartidaDetails(partidaTerm) {
  const key = normalizeKey(partidaTerm);
  if (!key) return false;
  const row = STATE.presupuesto.find((p) => normalizeKey(p.partida) === key);
  if (!row) return false;
  const gastado = typeof row.gastado === "number" ? row.gastado : 0;
  const saldo =
    typeof row.saldo === "number" ? row.saldo : row.presupuesto - gastado;
  const html = `
    <div class="d-flex flex-column gap-1 small">
      <div><strong>Partida ${escapeHtml(row.partida)}</strong></div>
      <div>Presupuesto: <strong>${money(row.presupuesto)}</strong></div>
      <div>Gastado: <strong>${money(gastado)}</strong></div>
      <div>Saldo: <strong class="${saldo < 0 ? "text-danger" : ""}">${money(
        saldo
      )}</strong></div>
      <div>Reconducción: <strong>${money(row.recon)}</strong></div>
    </div>
  `;
  banner(html, "info");
  return true;
}


/* ===== Gráfica ===== */

function buildChartData(group) {
  const ds = (label, data) => ({
    label,
    data,
    borderWidth: 1,
    backgroundColor: undefined,
  });

  if (group === "global") {
    const totalPres = STATE.presupuesto.reduce(
      (a, b) => a + (b.presupuesto || 0),
      0
    );
    const totalGast = STATE.presupuesto.reduce(
      (a, b) => a + (b.gastado || 0),
      0
    );
    const totalSaldo = STATE.presupuesto.reduce(
      (a, b) => a + (typeof b.saldo === "number" ? b.saldo : 0),
      0
    );
    const totalRecon = STATE.presupuesto.reduce(
      (a, b) => a + (b.recon || 0),
      0
    );
    const labels = ["Total"];
    return {
      labels,
      datasets: [
        ds("Presupuesto", [totalPres]),
        ds("Gastado", [totalGast]),
        ds("Saldo", [totalSaldo]),
        ds("Reconducido", [totalRecon]),
      ],
    };
  }

  if (group === "partida") {
    const labels = STATE.presupuesto.map((p) => p.partida);
    const pres = STATE.presupuesto.map((p) => p.presupuesto || 0);
    const gast = STATE.presupuesto.map((p) => p.gastado || 0);
    const sald = STATE.presupuesto.map((p) =>
      typeof p.saldo === "number" ? p.saldo : 0
    );
    const reco = STATE.presupuesto.map((p) => p.recon || 0);
    return {
      labels,
      datasets: [
        ds("Presupuesto", pres),
        ds("Gastado", gast),
        ds("Saldo", sald),
        ds("Reconducido", reco),
      ],
    };
  }

  const byMonth = {
    pres: new Array(12).fill(0),
    gast: new Array(12).fill(0),
    reco: new Array(12).fill(0),
  };
  STATE.presupuesto.forEach((p) => {
    if (p.fechaGasto instanceof Date)
      byMonth.gast[p.fechaGasto.getUTCMonth()] += p.gastado || 0;
    if (p.fechaRecon instanceof Date)
      byMonth.reco[p.fechaRecon.getUTCMonth()] += p.recon || 0;
  });
  const totalPres = STATE.presupuesto.reduce(
    (a, b) => a + (b.presupuesto || 0),
    0
  );
  byMonth.pres = byMonth.pres.map(() => totalPres);

  return {
    labels: MES,
    datasets: [
      ds("Presupuesto (anual)", byMonth.pres),
      ds("Gastado", byMonth.gast),
      ds("Reconducido", byMonth.reco),
    ],
  };
}

function renderChart() {
  const group = document.getElementById("chart-group")?.value || "mes";
  const stacked = !!document.getElementById("chart-stacked")?.checked;
  const { labels, datasets } = buildChartData(group);
  const ctx = document.getElementById("chart-mensual");
  if (!ctx) return;
  if (STATE.chart) STATE.chart.destroy();

  STATE.chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: {
        x: {
          stacked,
          ticks: { color: "#ffffff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        y: {
          stacked,
          beginAtZero: true,
          ticks: { color: "#ffffff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#ffffff" } },
        title: { color: "#ffffff" },
      },
    },
  });
}

// Render general
function renderAll() {
  STATE.partitdasCatalog = new Set(STATE.presupuesto.map((p) => p.partida));
  const filtros = getFiltros();
  const porPartida = groupGastadoPorPartida(STATE.gastos, filtros);

  const tbody = document.querySelector("#tabla-presupuesto tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let sumPres = 0,
    sumGast = 0,
    sumSaldo = 0;

  const presFiltrado = STATE.presupuesto.filter(
    (p) => !filtros.partida || p.partida.includes(filtros.partida)
  );

  const partidasNegativas = [];
  presFiltrado.forEach((p) => {
    const gastado = porPartida[p.partida] || 0;
    const saldo =
      typeof p.saldo === "number" ? p.saldo : p.presupuesto - gastado;
    sumPres += p.presupuesto;
    sumGast += gastado;
    sumSaldo += saldo;
    if (saldo < 0) partidasNegativas.push({ partida: p.partida, saldo });

    const tr = document.createElement("tr");
    tr.dataset.partida = p.partida;
    if (saldo < 0) tr.classList.add("table-danger");
    if (
      STATE.highlightPartida &&
      normalizeKey(p.partida) === STATE.highlightPartida
    )
      tr.classList.add("search-hit");
    tr.innerHTML = `
      <td class="fw-semibold">${escapeHtml(p.partida)}</td>
      <td class="text-end">${money(p.presupuesto)}</td>
      <td class="text-end">${money(gastado)}</td>
      <td class="text-end ${saldo < 0 ? "text-danger fw-bold" : ""}">${money(
        saldo
      )}</td>
    `;
    tbody.appendChild(tr);
  });

  if (partidasNegativas.length > 0) {
    setTimeout(() => {
      showNegativeBalanceAlert(partidasNegativas);
    }, 600);
  }

  if (STATE.highlightNeedsScroll) {
    const targetRow = tbody.querySelector("tr.search-hit");
    if (targetRow)
      targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    STATE.highlightNeedsScroll = false;
  }

  const trTot = document.createElement("tr");
  trTot.innerHTML = `
    <td class="fw-bold">TOTAL</td>
    <td class="text-end fw-bold">${money(sumPres)}</td>
    <td class="text-end fw-bold">${money(sumGast)}</td>
    <td class="text-end fw-bold ${sumSaldo < 0 ? "text-danger" : ""}">${money(
      sumSaldo
    )}</td>`;
  tbody.appendChild(trTot);

  const presupuestoTotal = STATE.presupuesto.reduce(
    (a, b) => a + (b.presupuesto || 0),
    0
  );
  const gastadoTotal = STATE.gastos.reduce((a, b) => a + (b.monto || 0), 0);
  const saldoTotal = STATE.presupuesto.reduce(
    (a, b) =>
      a +
      (typeof b.saldo === "number"
        ? b.saldo
        : b.presupuesto - (porPartida[b.partida] || 0)),
    0
  );
  const porc =
    presupuestoTotal > 0 ? (gastadoTotal / presupuestoTotal) * 100 : 0;

  document.getElementById("kpi-presupuesto").textContent =
    money(presupuestoTotal);
  document.getElementById("kpi-gastado").textContent = money(gastadoTotal);
  document.getElementById("kpi-saldo").textContent = money(saldoTotal);
  document.getElementById("kpi-porc").textContent = porc.toFixed(2) + "%";

  const missing = STATE.gastos.filter(
    (g) => !g.partida || !STATE.partitdasCatalog.has(g.partida)
  );
  STATE.missingRows = missing;
  const missingCount = document.getElementById("missing-count");
  if (missingCount) missingCount.textContent = missing.length;
  const missingAlert = document.getElementById("missing-alert");
  if (missingAlert)
    missingAlert.style.display = missing.length ? "block" : "none";

  renderMissing(missing);
  saveLS();
}

// =====================================================
//  PERSISTENCIA LOCAL
// =====================================================

function saveLS() {
  const data = {
    presupuesto: STATE.presupuesto,
    gastos: STATE.gastos.map((g) => ({
      ...g,
      fecha: g.fecha ? g.fecha.toISOString() : null,
    })),
    recon: STATE.recon.map((r) => ({
      ...r,
      fecha: r.fecha ? r.fecha.toISOString() : null,
    })),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// =====================================================
//  FORMULARIOS PRINCIPALES
// =====================================================

document
  .getElementById("form-partida")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const clave = document.getElementById("p-partida").value.trim();
    const presupuesto = parseFloat(document.getElementById("p-monto").value);
    const mes = document.getElementById("p-mes").value;
    // 1) intenta tomarlo del input (si existe)
let project = (document.getElementById("proj-code")?.value || "").trim();

// 2) si está vacío, lo toma del localStorage (llaves del proyecto)
if (!project) {
  const keys =
    STATE.projectKeys ||
    (() => {
      try {
        return JSON.parse(localStorage.getItem(PROJECT_KEYS_KEY) || "{}");
      } catch {
        return {};
      }
    })();

  project = String(keys.id_proyecto || keys.idProyecto || "").trim();
}

// 3) si aún no hay project, entonces sí avisa pero ya con mensaje correcto
if (!project) {
  return banner(
    "No hay proyecto seleccionado aún. Primero crea/elige el proyecto desde <strong>Suficiencia</strong>.",
    "warning"
  );
}
    if (!clave || isNaN(presupuesto) || !mes)
      return banner("Captura partida, presupuesto y mes válidos", "warning");

    try {
      const esDuplicado = await checkDuplicatePartida(
        clave,
        presupuesto,
        mes,
        project
      );
      if (esDuplicado) {
        const mesNombre = new Date(mes + "-01").toLocaleDateString("es-MX", {
          year: "numeric",
          month: "long",
        });
        const result = await Swal.fire({
          title: "¿Partida duplicada?",
          html: `En <strong>${mesNombre}</strong> ya existe la partida <strong>"${escapeHtml(
            clave
          )}"</strong> con el monto <strong>${money(
            presupuesto
          )}</strong>. ¿Deseas guardarla de todos modos?`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Sí, guardar",
          cancelButtonText: "No, cancelar",
          background: "#1a1a1a",
          color: "#ffffff",
        });
        if (!result.isConfirmed) {
          banner("Partida no guardada", "info");
          return;
        }
      }

      // 🔑 NUEVO: recuperar las llaves del proyecto
      const keys =
        STATE.projectKeys ||
        (() => {
          try {
            return JSON.parse(localStorage.getItem(PROJECT_KEYS_KEY) || "{}");
          } catch {
            return {};
          }
        })();

      if (
  !Number.isInteger(keys.id_dgeneral) ||
  !Number.isInteger(keys.id_dauxiliar) ||
  !Number.isInteger(keys.id_fuente)
) {
  banner(
    "Primero genera/guarda la <strong>Suficiencia</strong> del proyecto para que se carguen las claves (DG/DA/Fuente) y después captura partidas aquí.",
    "danger"
  );
  return;
}

      const payload = {
        project,
        partida: clave,
        presupuesto,
        mes,
        id_dgeneral: keys.id_dgeneral,
        id_dauxiliar: keys.id_dauxiliar,
        id_fuente: keys.id_fuente,
      };

      await apiPost("/api/detalles", payload);
      await loadFromAPI();
      renderAll();
      banner("Partida guardada", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// Formulario: registrar gasto
document
  .getElementById("form-gasto")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fecha = document.getElementById("g-fecha").value || null;
    const descripcion = document.getElementById("g-desc").value.trim();
    const partida = document.getElementById("g-partida").value.trim();
    const monto = parseFloat(document.getElementById("g-monto").value);
    const project = (document.getElementById("proj-code")?.value || "").trim();

    if (!project)
      return banner("Captura el ID de proyecto antes de registrar", "warning");
    if (!partida || !descripcion || isNaN(monto) || monto <= 0)
      return banner("Completa partida, descripción y monto válido", "warning");

    try {
      await apiPost("/api/gastos", {
        project,
        partida,
        fecha,
        descripcion,
        monto,
      });
      await loadFromAPI();
      renderAll();
      banner("Gasto acumulado", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// Formulario: reconducción
document
  .getElementById("form-recon")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const concepto = document.getElementById("r-concepto").value.trim();
    const origen = document.getElementById("r-origen").value.trim();
    const destino = document.getElementById("r-destino").value.trim();
    const monto = parseFloat(document.getElementById("r-monto").value);
    const fecha =
      document.getElementById("r-fecha").value ||
      new Date().toISOString().slice(0, 10);
    const project = (document.getElementById("proj-code")?.value || "").trim();

    if (!project)
      return banner("Captura el ID de proyecto antes de registrar", "warning");
    if (!origen || !destino || isNaN(monto) || monto <= 0)
      return banner("Completa origen, destino y monto válido", "warning");

    try {
      const r = await apiPost("/api/reconducir", {
        project,
        origen,
        destino,
        monto,
        concepto,
        fecha,
      });
      if (r.origenNegativo)
        banner(
          `La partida ${escapeHtml(origen)} quedó en negativo (saldo: ${money(
            r.saldos.origen
          )})`,
          "danger"
        );
      await loadFromAPI();
      renderAll();
      banner("Reconducción aplicada", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// =====================================================
//  BUSCADOR NAVBAR / FILTROS / RESET
// =====================================================

// Buscar proyecto/partida desde la barra
const navSearchForm = document.getElementById("nav-search");
if (navSearchForm) {
  navSearchForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("proj-code");
    const rawValue = (input?.value || "").trim();
    if (!rawValue) {
      input?.focus();
      return;
    }

    // 🔒 Si es usuario AREA, solo puede buscar proyectos de su propia DG
    if (isAreaUser() && CURRENT_DG_CLAVE) {
      const codeUpper = rawValue.toUpperCase();
      if (!codeUpper.startsWith(CURRENT_DG_CLAVE)) {
        banner(
          `Solo puedes consultar proyectos cuya clave inicie con <strong>${CURRENT_DG_CLAVE}</strong>.`,
          "warning"
        );
        return;
      }
    }

    localStorage.setItem("cp_current_project", rawValue);

    showSpinner(true);
    try {
      await loadFromAPI();

      const key = normalizeKey(rawValue);
      const foundPartida = STATE.presupuesto.some(
        (p) => normalizeKey(p.partida) === key
      );
      STATE.highlightPartida = foundPartida ? key : null;
      STATE.highlightNeedsScroll = foundPartida;
      renderAll();

      if (!STATE.presupuesto.length) {
        banner(
          `No se encontraron registros para <strong>${escapeHtml(
            rawValue
          )}</strong>.`,
          "warning"
        );
        return;
      }
      if (foundPartida) {
        showPartidaDetails(rawValue);
        return;
      }

      const totalPresupuesto = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.presupuesto || 0),
        0
      );
      const totalGastado = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.gastado || 0),
        0
      );
      const totalSaldo = STATE.presupuesto.reduce(
        (acc, row) =>
          acc +
          (typeof row.saldo === "number"
            ? row.saldo
            : row.presupuesto - (row.gastado || 0)),
        0
      );
      const totalRecon = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.recon || 0),
        0
      );
      const resumen = `
        <div class="d-flex flex-column gap-1 small">
          <div><strong>ID ${escapeHtml(rawValue)}</strong></div>
          <div>Partidas registradas: <strong>${
            STATE.presupuesto.length
          }</strong></div>
          <div>Presupuesto total: <strong>${money(
            totalPresupuesto
          )}</strong></div>
          <div>Gastado: <strong>${money(totalGastado)}</strong></div>
          <div>Saldo: <strong class="${
            totalSaldo < 0 ? "text-danger" : ""
          }">${money(totalSaldo)}</strong></div>
          <div>Reconducción: <strong>${money(totalRecon)}</strong></div>
        </div>
      `;
      banner(resumen, "info");
    } catch (err) {
      banner(
        `No se pudo recuperar la información (${escapeHtml(err.message)})`,
        "danger"
      );
    } finally {
      showSpinner(false);
    }
  });
}

// Filtros tabla
document.getElementById("btn-aplicar")?.addEventListener("click", renderAll);
document.getElementById("btn-limpiar")?.addEventListener("click", () => {
  const fp = document.getElementById("f-partida");
  const fb = document.getElementById("f-buscar");
  if (fp) fp.value = "";
  if (fb) fb.value = "";
  renderAll();
});

// Reset solo UI
function clearUIOnly() {
  STATE.presupuesto = [];
  STATE.gastos = [];
  STATE.recon = [];
  STATE.highlightPartida = null;
  STATE.highlightNeedsScroll = false;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
  renderAll();
}

document.getElementById("btn-reset")?.addEventListener("click", async () => {
  const result = await Swal.fire({
    title: "¿Limpiar vista?",
    text: "¿Limpiar la vista para capturar un nuevo ID de proyecto? (No se borrará nada de la base de datos)",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, limpiar",
    cancelButtonText: "Cancelar",
    background: "#1a1a1a",
    color: "#ffffff",
  });

  if (result.isConfirmed) {
    const codeInput = document.getElementById("proj-code");
    if (codeInput) codeInput.value = "";
    clearUIOnly();
    banner(
      "Vista limpia. Escribe un nuevo ID de proyecto y comienza a capturar.",
      "warning"
    );
  }
});

// =====================================================
//  INICIALIZACIÓN (DOMContentLoaded)
// =====================================================

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const qProject = params.get("project");
  const input = document.getElementById("proj-code");

  // ✅ Nunca usar proyecto guardado en localStorage
  // Solo usar el que venga en la URL (si es que viene)
  if (qProject && input) {
    input.value = qProject;
    localStorage.setItem("cp_current_project", qProject);
  } else if (input) {
    input.value = "";
    localStorage.removeItem("cp_current_project");
  }

  const today = new Date().toISOString().split("T")[0];
  const gFecha = document.getElementById("g-fecha");
  const rFecha = document.getElementById("r-fecha");
  const pMes = document.getElementById("p-mes");
  if (gFecha) gFecha.value = today;
  if (rFecha) rFecha.value = today;
  if (pMes) pMes.value = today.slice(0, 7);

  try {
    const savedKeys = localStorage.getItem(PROJECT_KEYS_KEY);
    if (savedKeys) {
      STATE.projectKeys = JSON.parse(savedKeys);
    }
  } catch {}

  try {
    if (qProject && (input?.value || "").trim()) {
      await loadFromAPI();
      banner("Datos Cargados.", "info");
    } else {
      STATE.presupuesto = [];
      STATE.gastos = [];
      STATE.recon = [];
    }
  } catch (e) {
    banner(
      "No se pudo conectar al backend. Revisa que el servidor esté corriendo.",
      "danger"
    );
  }

  renderAll();
});

// Cambio manual del ID proyecto en el input
document.getElementById("proj-code")?.addEventListener("change", async () => {
  const project = (document.getElementById("proj-code")?.value || "").trim();
  if (!project) {
    STATE.presupuesto = [];
    STATE.gastos = [];
    STATE.recon = [];
    renderAll();
    return;
  }
  await loadFromAPI();
  renderAll();
});

// Listeners de la gráfica
document.getElementById("chart-group")?.addEventListener("change", renderChart);
document
  .getElementById("chart-stacked")
  ?.addEventListener("change", renderChart);
