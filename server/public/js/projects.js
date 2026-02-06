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
const STATE = { projects: [], filtered: [] };

// ================== USUARIO / ROLES ==================
let CURRENT_USER = null;
let CURRENT_ROLES_NORM = [];
let CURRENT_DGENERAL_CLAVE = null; // <-- IMPORTANTE

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

// ================== RENDER KPIs ==================
function renderKPIs() {
  const totalProjects = STATE.filtered.length;
  const totalPresupuesto = STATE.filtered.reduce((acc, p) => acc + Number(p.presupuesto_total || 0), 0);
  const totalGastado = STATE.filtered.reduce((acc, p) => acc + Number(p.gastado_total || 0), 0);
  const totalSaldo = STATE.filtered.reduce((acc, p) => acc + Number(p.saldo_total || 0), 0);

  document.getElementById("kpi-projects").textContent = totalProjects || "0";
  document.getElementById("kpi-presupuesto").textContent = money(totalPresupuesto);
  document.getElementById("kpi-gastado").textContent = money(totalGastado);
  document.getElementById("kpi-saldo").textContent = money(totalSaldo);
}

// ================== RENDER TABLA ==================
function renderTable() {
  const tbody = document.getElementById("tbody-projects");
  tbody.innerHTML = "";

  if (!STATE.filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-secondary">
          No se encontraron proyectos con el filtro aplicado.
        </td>
      </tr>
    `;
    document.getElementById("summary-label").textContent = "0 proyectos encontrados.";
    renderKPIs();
    return;
  }

  STATE.filtered.forEach((p) => {
    const saldo = Number(p.saldo_total || 0);
    const badgeClass = saldo < 0 ? "badge-saldo-negativo" : "badge-saldo-positivo";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="badge text-bg-dark pill-project">${p.project}</span></td>
      <td class="text-end">${Number(p.partidas || 0)}</td>
      <td class="text-end">${money(p.presupuesto_total)}</td>
      <td class="text-end">${money(p.gastado_total)}</td>
      <td class="text-end"><span class="badge ${badgeClass}">${money(saldo)}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-info btn-open" data-project="${p.project}">
          <i class="bi bi-box-arrow-in-right"></i> Ver detalle
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("summary-label").textContent =
    `${STATE.filtered.length} proyecto(s) mostrados.`;

  renderKPIs();

  tbody.querySelectorAll(".btn-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const proj = btn.getAttribute("data-project");
      if (!proj) return;
      localStorage.setItem("cp_current_project", proj);
      window.location.href = `index.html?project=${encodeURIComponent(proj)}`;
    });
  });
}

// ================== FILTRO ==================
function applyFilter() {
  const term = (document.getElementById("search-project").value || "").trim().toLowerCase();
  STATE.filtered = !term
    ? [...STATE.projects]
    : STATE.projects.filter((p) => String(p.project || "").toLowerCase().includes(term));
  renderTable();
}

// ================== CARGA PROYECTOS ==================
async function loadProjects() {
  try {
    const data = await apiGet("/api/projects");
    let projects = Array.isArray(data) ? data : [];

    console.log("[PROJECTS] API /api/projects total:", projects.length);

    // ✅ FILTRO AREA POR CLAVE GENERAL (prefijo de project)
    // Ejemplos: A00..., E02..., L00...
    if (isAreaUser()) {
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

    STATE.projects = projects;
    STATE.filtered = [...STATE.projects];
    renderTable();
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
  await loadProjects();

  const input = document.getElementById("search-project");
  const btnClear = document.getElementById("btn-clear");

  input.addEventListener("input", applyFilter);
  btnClear.addEventListener("click", () => {
    input.value = "";
    applyFilter();
  });
});
