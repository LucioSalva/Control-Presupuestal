// js/projects.js

// ✅ Base de API (usa window.API_URL si existe; si no, localhost)
const API_BASE = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

// ================== TOKEN ==================
function getToken() {
  return (
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ================== FORMATO DINERO ==================
const money = (v) => {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return Number(v).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  });
};

// ================== BANNER ==================
function banner(msg, type = "info") {
  const iconMap = { info: "info", success: "success", warning: "warning", danger: "error" };
  const titleMap = { info: "Información", success: "Éxito", warning: "Advertencia", danger: "Error" };

  Swal.fire({
    icon: iconMap[type] || "info",
    title: titleMap[type] || "Información",
    html: msg,
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 6000,
    timerProgressBar: true,
    background: "#1a1a1a",
    color: "#ffffff",
  });
}

// ================== API GET (con token + JSON seguro) ==================
async function apiGet(path) {
  const r = await fetch(API_BASE + path, { headers: { ...authHeaders() } });
  const text = await r.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!r.ok) {
    const msg = data?.error || `GET ${path} → ${r.status}`;
    throw new Error(msg);
  }

  return data;
}

// ================== ESTADO ==================
const STATE = {
  projects: [],
  filtered: [],
  catalogs: { dg: [], da: [] },
  filters: { term: "", dg: "", da: "", anio: "" },
  detail: { current: null },
};

const normalizeText = (v) => String(v || "").trim();

const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const normalizeProjectDisplay = (value) => {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  const letters = raw.replace(/[^A-Z]/g, "");
  if (!digits) return raw;
  if (letters.length > 1) return raw;
  const padded = digits.padStart(10, "0");
  const conac = /^[0-9\s]+[A-Z]$/.test(raw) ? raw.slice(-1) : "";
  return conac ? `${padded} ${conac}` : padded;
};

const parseProjectKey = (project) => {
  const raw = normalizeText(project).toUpperCase();
  const clave = raw.replace(/[^0-9]/g, "");
  if (!clave) return null;
  const conacMatch = raw.match(/[A-Z]$/);
  const conac = conacMatch ? conacMatch[0] : "";
  return { clave, conac };
};

// ================== USUARIO / ROLES ==================
let CURRENT_USER = null;
let CURRENT_ROLES_NORM = [];
let CURRENT_DGENERAL_CLAVE = null; // <-- IMPORTANTE
let CURRENT_DAUXILIAR_CLAVE = null;
let CURRENT_DGENERAL_ID = null;
let CURRENT_DAUXILIAR_ID = null;

function loadCurrentUser() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) {
      window.location.href = "login.html";
      return;
    }

    CURRENT_USER = JSON.parse(raw);

    const roles = Array.isArray(CURRENT_USER.roles) ? CURRENT_USER.roles : [];
    CURRENT_ROLES_NORM = roles.map((r) => String(r || "").trim().toUpperCase());

    // ✅ Usaremos clave (A00 / E02 / L00) en vez de id numérico
    CURRENT_DGENERAL_CLAVE = String(CURRENT_USER.dgeneral_clave || "").trim().toUpperCase() || null;
    CURRENT_DAUXILIAR_CLAVE = String(CURRENT_USER.dauxiliar_clave || "").trim().toUpperCase() || null;
    CURRENT_DGENERAL_ID = Number(CURRENT_USER.id_dgeneral || 0) || null;
    CURRENT_DAUXILIAR_ID = Number(CURRENT_USER.id_dauxiliar || 0) || null;

    console.log("[PROJECTS] Usuario:", CURRENT_USER);
    console.log("[PROJECTS] Roles:", CURRENT_ROLES_NORM);
    console.log("[PROJECTS] dgeneral_clave (usuario):", CURRENT_DGENERAL_CLAVE);
  } catch (e) {
    console.error("[PROJECTS] Error leyendo cp_usuario:", e);
    window.location.href = "login.html";
  }
}

function isAreaUser() {
  return CURRENT_ROLES_NORM.includes("AREA");
}

function isAdminUser() {
  return CURRENT_ROLES_NORM.includes("ADMIN");
}

function isGodUser() {
  return CURRENT_ROLES_NORM.includes("GOD");
}

function isL00117User() {
  return CURRENT_DGENERAL_CLAVE === "L00" && CURRENT_DAUXILIAR_CLAVE === "117";
}

function canSeeAllAreas() {
  return isGodUser() || isAdminUser() || isL00117User();
}

// ================== RENDER KPIs ==================
function renderKPIs() {
  const totalProjects = STATE.filtered.length;
  const totalPresupuesto = STATE.filtered.reduce((acc, p) => acc + Number(p.presupuesto_total || 0), 0);
  const totalGastado = STATE.filtered.reduce((acc, p) => acc + Number(p.gastado_total || 0), 0);
  const totalReconducido = STATE.filtered.reduce((acc, p) => acc + Number(p.reconducido_total || 0), 0);
  const totalSaldo = STATE.filtered.reduce((acc, p) => acc + Number(p.saldo_total || 0), 0);
  const totalSobregiros = STATE.filtered.filter((p) => Number(p.saldo_total || 0) < 0).length;

  document.getElementById("kpi-projects").textContent = totalProjects || "0";
  document.getElementById("kpi-presupuesto").textContent = money(totalPresupuesto);
  document.getElementById("kpi-gastado").textContent = money(totalGastado);
  document.getElementById("kpi-saldo").textContent = money(totalSaldo);
  document.getElementById("kpi-reconducido").textContent = money(totalReconducido);
  document.getElementById("kpi-sobregiros").textContent = totalSobregiros || "0";
}

// ================== RENDER TABLA ==================
function renderTable() {
  const tbody = document.getElementById("tbody-projects");
  tbody.innerHTML = "";

  if (!STATE.filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4 text-secondary">
          No se encontraron proyectos con el filtro aplicado.
        </td>
      </tr>
    `;
    document.getElementById("summary-label").textContent = "0 proyectos encontrados.";
    return;
  }

  STATE.filtered.forEach((p) => {
    const saldo = Number(p.saldo_total || 0);
    const badgeClass = saldo < 0 ? "badge-saldo-negativo" : "badge-saldo-positivo";

    const tr = document.createElement("tr");
    if (saldo < 0) tr.classList.add("row-saldo-negativo");
    const projectLabel = p.project_display || p.project;
    tr.innerHTML = `
      <td><span class="badge text-bg-dark pill-project">${projectLabel}</span></td>
      <td class="text-end">${Number(p.partidas || 0)}</td>
      <td class="text-end">${money(p.presupuesto_total)}</td>
      <td class="text-end">${money(p.gastado_total)}</td>
      <td class="text-end">${money(p.reconducido_total)}</td>
      <td class="text-end"><span class="badge ${badgeClass}">${money(saldo)}</span></td>
      <td class="text-end">
        <div class="d-flex justify-content-end gap-2 flex-wrap">
          <button class="btn btn-sm btn-outline-primary btn-detail" data-project="${p.project}">
            <i class="bi bi-list-check"></i> Detalle
          </button>
          <button class="btn btn-sm btn-outline-info btn-open" data-project="${p.project}">
            <i class="bi bi-box-arrow-in-right"></i> Abrir
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("summary-label").textContent =
    `${STATE.filtered.length} proyecto(s) mostrados.`;

  tbody.querySelectorAll(".btn-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const proj = btn.getAttribute("data-project");
      if (!proj) return;
      localStorage.setItem("cp_current_project", proj);
      window.location.href = `index.html?project=${encodeURIComponent(proj)}`;
    });
  });

  tbody.querySelectorAll(".btn-detail").forEach((btn) => {
    btn.addEventListener("click", () => {
      const proj = btn.getAttribute("data-project");
      if (!proj) return;
      showProjectDetail(proj);
    });
  });
}

function renderAlerts() {
  const overdraftList = document.getElementById("overdraft-list");
  const overdraftSummary = document.getElementById("overdraft-summary");
  const topSpendList = document.getElementById("top-spend-list");

  const overdrafts = STATE.filtered
    .filter((p) => Number(p.saldo_total || 0) < 0)
    .sort((a, b) => Number(a.saldo_total || 0) - Number(b.saldo_total || 0));

  overdraftList.innerHTML = "";
  if (!overdrafts.length) {
    overdraftSummary.textContent = "Sin sobregiros en los filtros actuales.";
    overdraftList.innerHTML = `<li class="list-group-item text-secondary">Todo en orden.</li>`;
  } else {
    overdraftSummary.textContent = `${overdrafts.length} proyecto(s) en sobregiro.`;
    overdrafts.slice(0, 6).forEach((p) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = `
        <span>${p.project}</span>
        <span class="badge badge-saldo-negativo">${money(p.saldo_total)}</span>
      `;
      overdraftList.appendChild(li);
    });
  }

  const topSpend = [...STATE.filtered].sort(
    (a, b) => Number(b.gastado_total || 0) - Number(a.gastado_total || 0)
  );
  topSpendList.innerHTML = "";
  if (!topSpend.length) {
    topSpendList.innerHTML = `<li class="list-group-item text-secondary">Sin datos.</li>`;
  } else {
    topSpend.slice(0, 5).forEach((p, idx) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      const projectLabel = p.project_display || p.project;
      li.innerHTML = `
        <span>${idx + 1}. ${projectLabel}</span>
        <span class="fw-semibold">${money(p.gastado_total)}</span>
      `;
      topSpendList.appendChild(li);
    });
  }
}

function aggregateRows(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = normalizeText(r?.[key]);
    if (!k) return;
    const current = map.get(k) || {
      key: k,
      presupuesto: 0,
      gastado: 0,
      reconducido: 0,
      saldo: 0,
    };
    current.presupuesto += toNumber(r.presupuesto);
    current.gastado += toNumber(r.total_gastado);
    current.reconducido += toNumber(r.total_reconducido);
    current.saldo += toNumber(r.saldo_disponible);
    map.set(k, current);
  });
  return Array.from(map.values());
}

function renderDetailTable(targetId, rows) {
  const tbody = document.getElementById(targetId);
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-secondary py-3">Sin datos.</td>
      </tr>
    `;
    return;
  }

  const html = rows
    .map(
      (r) => `
        <tr>
          <td>${r.key}</td>
          <td class="text-end">${money(r.presupuesto)}</td>
          <td class="text-end">${money(r.gastado)}</td>
          <td class="text-end">${money(r.reconducido)}</td>
          <td class="text-end">${money(r.saldo)}</td>
        </tr>
      `
    )
    .join("");

  tbody.innerHTML = html;
}

function applyYearFilter(rows) {
  const year = toNumber(STATE.filters.anio);
  if (!year) return rows;
  return rows.filter((r) => {
    const mes = normalizeText(r.mes);
    if (mes && mes.startsWith(`${year}-`)) return true;
    const fecha = r.fecha_registro ? new Date(r.fecha_registro) : null;
    return fecha && Number.isFinite(fecha.getTime()) && fecha.getFullYear() === year;
  });
}

function getEnforcedAreaFilters() {
  if (canSeeAllAreas()) return null;
  const dg = CURRENT_DGENERAL_ID ? String(CURRENT_DGENERAL_ID) : "";
  const da = CURRENT_DAUXILIAR_ID ? String(CURRENT_DAUXILIAR_ID) : "";
  return { dg, da };
}

function setSelectToSingleOption(select, value, label) {
  if (!select) return;
  select.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = value || "";
  opt.textContent = label || "—";
  select.appendChild(opt);
  if (value) select.value = value;
  select.disabled = true;
}

async function loadProjectMetas(project) {
  const metasWrap = document.getElementById("detail-metas");
  metasWrap.innerHTML = "";

  const key = parseProjectKey(project?.project);
  const dgClave = normalizeText(project?.dgeneral_clave).toUpperCase();
  const daClave = normalizeText(project?.dauxiliar_clave).toUpperCase();

  if (!key || !key.conac || !dgClave || !daClave) {
    metasWrap.innerHTML = `<div class="col-12 text-secondary small">Sin metas disponibles para este proyecto.</div>`;
    return;
  }

  try {
    const path = `/api/catalogos/metas?dg_clave=${encodeURIComponent(
      dgClave
    )}&da_clave=${encodeURIComponent(daClave)}&proy_clave=${encodeURIComponent(
      key.clave
    )}&conac=${encodeURIComponent(key.conac)}`;
    const data = await apiGet(path);
    const metas = Array.isArray(data) ? data : [];

    if (!metas.length) {
      metasWrap.innerHTML = `<div class="col-12 text-secondary small">Sin metas registradas.</div>`;
      return;
    }

    metas.forEach((m) => {
      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-lg-4";
      col.innerHTML = `
        <div class="meta-card">
          <div class="meta-title">${normalizeText(m.meta) || "Meta"}</div>
          <div class="meta-sub text-secondary">${normalizeText(m.unidad_medida) || "Sin unidad"}</div>
        </div>
      `;
      metasWrap.appendChild(col);
    });
  } catch (e) {
    metasWrap.innerHTML = `<div class="col-12 text-danger small">No se pudieron cargar las metas.</div>`;
  }
}

async function showProjectDetail(projectId) {
  const project = STATE.projects.find((p) => String(p.project) === String(projectId));
  if (!project) return;

  STATE.detail.current = project;

  const card = document.getElementById("project-detail-card");
  const title = document.getElementById("detail-title");
  const subtitle = document.getElementById("detail-subtitle");

  const projectLabel = project.project_display || project.project;
  title.textContent = `Detalle de ${projectLabel}`;
  const dgTxt = project.dgeneral_clave ? `DG ${project.dgeneral_clave}` : "DG —";
  const daTxt = project.dauxiliar_clave ? `DA ${project.dauxiliar_clave}` : "DA —";
  subtitle.textContent = `${dgTxt} · ${daTxt}`;

  document.getElementById("detail-presupuesto").textContent = money(project.presupuesto_total);
  document.getElementById("detail-gastado").textContent = money(project.gastado_total);
  document.getElementById("detail-reconducido").textContent = money(project.reconducido_total);
  document.getElementById("detail-saldo").textContent = money(project.saldo_total);

  card.classList.remove("d-none");

  document.getElementById("btn-open-project").onclick = () => {
    localStorage.setItem("cp_current_project", project.project);
    window.location.href = `index.html?project=${encodeURIComponent(project.project)}`;
  };

  document.getElementById("detail-by-partida").innerHTML = `
    <tr>
      <td colspan="5" class="text-center text-secondary py-3">Cargando…</td>
    </tr>
  `;
  document.getElementById("detail-by-month").innerHTML = `
    <tr>
      <td colspan="5" class="text-center text-secondary py-3">Cargando…</td>
    </tr>
  `;

  try {
    const data = await apiGet(`/api/detalles?project=${encodeURIComponent(project.project)}`);
    const rows = Array.isArray(data) ? data : [];
    const filtered = applyYearFilter(rows);

    const totals = filtered.reduce(
      (acc, r) => {
        acc.presupuesto += toNumber(r.presupuesto);
        acc.gastado += toNumber(r.total_gastado);
        acc.reconducido += toNumber(r.total_reconducido);
        acc.saldo += toNumber(r.saldo_disponible);
        return acc;
      },
      { presupuesto: 0, gastado: 0, reconducido: 0, saldo: 0 }
    );

    if (filtered.length) {
      document.getElementById("detail-presupuesto").textContent = money(totals.presupuesto);
      document.getElementById("detail-gastado").textContent = money(totals.gastado);
      document.getElementById("detail-reconducido").textContent = money(totals.reconducido);
      document.getElementById("detail-saldo").textContent = money(totals.saldo);
    }

    const byPartida = aggregateRows(filtered, "partida").sort((a, b) =>
      a.key.localeCompare(b.key)
    );
    const byMonth = aggregateRows(filtered, "mes").sort((a, b) => a.key.localeCompare(b.key));

    renderDetailTable("detail-by-partida", byPartida);
    renderDetailTable("detail-by-month", byMonth);
  } catch (e) {
    renderDetailTable("detail-by-partida", []);
    renderDetailTable("detail-by-month", []);
  }

  loadProjectMetas(project);
}

async function loadCatalogs() {
  try {
    const [dgs, das] = await Promise.all([
      apiGet("/api/catalogos/dgeneral"),
      apiGet("/api/catalogos/dauxiliar"),
    ]);

    STATE.catalogs.dg = Array.isArray(dgs) ? dgs : [];
    STATE.catalogs.da = Array.isArray(das) ? das : [];

    const dgSelect = document.getElementById("filter-dg");
    const daSelect = document.getElementById("filter-da");

    dgSelect.innerHTML = `<option value="">Todos</option>`;
    daSelect.innerHTML = `<option value="">Todos</option>`;

    STATE.catalogs.dg.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${normalizeText(d.clave)} - ${normalizeText(d.dependencia)}`;
      dgSelect.appendChild(opt);
    });

    STATE.catalogs.da.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${normalizeText(d.clave)} - ${normalizeText(d.dependencia)}`;
      daSelect.appendChild(opt);
    });

    if (!canSeeAllAreas()) {
      const dgRow =
        STATE.catalogs.dg.find((d) => String(d.id) === String(CURRENT_DGENERAL_ID)) ||
        STATE.catalogs.dg.find(
          (d) => normalizeText(d.clave).toUpperCase() === CURRENT_DGENERAL_CLAVE
        );
      const daRow =
        STATE.catalogs.da.find((d) => String(d.id) === String(CURRENT_DAUXILIAR_ID)) ||
        STATE.catalogs.da.find(
          (d) => normalizeText(d.clave).toUpperCase() === CURRENT_DAUXILIAR_CLAVE
        );

      setSelectToSingleOption(
        dgSelect,
        dgRow ? String(dgRow.id) : "",
        dgRow ? `${normalizeText(dgRow.clave)} - ${normalizeText(dgRow.dependencia)}` : "—"
      );
      setSelectToSingleOption(
        daSelect,
        daRow ? String(daRow.id) : "",
        daRow ? `${normalizeText(daRow.clave)} - ${normalizeText(daRow.dependencia)}` : "—"
      );
    } else if (CURRENT_DGENERAL_CLAVE) {
      const found = STATE.catalogs.dg.find(
        (d) => normalizeText(d.clave).toUpperCase() === CURRENT_DGENERAL_CLAVE
      );
      if (found) dgSelect.value = String(found.id);
    }
  } catch (e) {
    console.error(e);
  }
}

function exportCSV() {
  if (!STATE.filtered.length) {
    banner("No hay proyectos para exportar con los filtros actuales.", "warning");
    return;
  }

  const headers = [
    "Proyecto",
    "DG",
    "DA",
    "Partidas",
    "Presupuesto",
    "Gastado",
    "Reconducido",
    "Saldo",
  ];

  const csvEscape = (value) => {
    const str = String(value ?? "");
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(",")];
  STATE.filtered.forEach((p) => {
    lines.push(
      [
        p.project_display || p.project,
        p.dgeneral_clave || "",
        p.dauxiliar_clave || "",
        Number(p.partidas || 0),
        Number(p.presupuesto_total || 0),
        Number(p.gastado_total || 0),
        Number(p.reconducido_total || 0),
        Number(p.saldo_total || 0),
      ]
        .map(csvEscape)
        .join(",")
    );
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `proyectos_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getFilterValues() {
  const term = normalizeText(document.getElementById("search-project").value).toLowerCase();
  const dg = normalizeText(document.getElementById("filter-dg").value);
  const da = normalizeText(document.getElementById("filter-da").value);
  const anio = normalizeText(document.getElementById("filter-year").value);
  return { term, dg, da, anio };
}

// ================== FILTRO ==================
function applyFilter() {
  const { term, dg, da, anio } = getFilterValues();
  const enforced = getEnforcedAreaFilters();
  const resolved = {
    term,
    dg: enforced?.dg || dg,
    da: enforced?.da || da,
    anio,
  };
  STATE.filters = resolved;

  let list = [...STATE.projects];

    if (resolved.term) {
      list = list.filter((p) => {
        const raw = String(p.project || "").toLowerCase();
        const display = String(p.project_display || "").toLowerCase();
        return raw.includes(term) || display.includes(term);
      });
  }
  if (resolved.dg) {
    list = list.filter((p) => String(p.id_dgeneral || "") === resolved.dg);
  }
  if (resolved.da) {
    list = list.filter((p) => String(p.id_dauxiliar || "") === resolved.da);
  }

  STATE.filtered = list;
  renderTable();
  renderKPIs();
  renderAlerts();
}

// ================== CARGA PROYECTOS ==================
async function loadProjects() {
  try {
    const params = new URLSearchParams();
    const enforced = getEnforcedAreaFilters();
    const { dg, da, anio } = STATE.filters;
    const dgParam = enforced?.dg || dg;
    const daParam = enforced?.da || da;
    if (dgParam) params.set("id_dgeneral", dgParam);
    if (daParam) params.set("id_dauxiliar", daParam);
    if (anio) params.set("anio", anio);

    const path = params.toString() ? `/api/projects?${params.toString()}` : "/api/projects";
    const data = await apiGet(path);
    let projects = Array.isArray(data) ? data : [];

    console.log("[PROJECTS] API /api/projects total:", projects.length);

    // ✅ FILTRO AREA POR CLAVE GENERAL (prefijo de project)
    // Ejemplos: A00..., E02..., L00...
    if (isAreaUser() && !canSeeAllAreas()) {
      const clave = (CURRENT_DGENERAL_CLAVE || "").trim().toUpperCase();

      if (!clave) {
        console.warn("[PROJECTS] AREA pero el usuario NO trae dgeneral_clave. Se mostrarán todos.");
      } else {
        const before = projects.length;

        projects = projects.filter((p) => {
          const proj = String(p?.project || "").trim().toUpperCase();
          const prefijo = proj.slice(0, 3); // <-- A00 / E02 / L00
          return prefijo === clave;
        });

        console.log("[PROJECTS] Filtro AREA por dgeneral_clave:", clave, "→", before, "=>", projects.length);
      }
    }

    STATE.projects = projects.map((p) => ({
      ...p,
      project_display: normalizeProjectDisplay(p.project),
    }));
    applyFilter();
  } catch (e) {
    console.error(e);
    banner(
      `No se pudieron cargar los proyectos. ${e.message || ""}<br>Verifica backend y token.`,
      "danger"
    );
  }
}

// ================== INICIO ==================
window.addEventListener("DOMContentLoaded", async () => {
  loadCurrentUser();
  await loadCatalogs();
  STATE.filters = getFilterValues();
  await loadProjects();

  const input = document.getElementById("search-project");
  const btnClear = document.getElementById("btn-clear");
  const btnApplyFilters = document.getElementById("btn-apply-filters");
  const btnClearFilters = document.getElementById("btn-clear-filters");
  const btnExport = document.getElementById("btn-export");
  const btnCloseDetail = document.getElementById("btn-close-detail");

  input.addEventListener("input", applyFilter);
  btnClear.addEventListener("click", () => {
    input.value = "";
    applyFilter();
  });

  btnApplyFilters.addEventListener("click", async () => {
    STATE.filters = getFilterValues();
    await loadProjects();
  });

  btnClearFilters.addEventListener("click", async () => {
    const enforced = getEnforcedAreaFilters();
    const dgSelect = document.getElementById("filter-dg");
    const daSelect = document.getElementById("filter-da");
    if (enforced?.dg) dgSelect.value = enforced.dg;
    else dgSelect.value = "";
    if (enforced?.da) daSelect.value = enforced.da;
    else daSelect.value = "";
    document.getElementById("filter-year").value = "";
    input.value = "";
    STATE.filters = getFilterValues();
    await loadProjects();
  });

  btnExport.addEventListener("click", exportCSV);

  btnCloseDetail.addEventListener("click", () => {
    document.getElementById("project-detail-card").classList.add("d-none");
  });
});
