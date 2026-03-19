/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Consola de Monitoreo
 *  Archivo: consola_god.js
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
  "use strict";

  const API = (
    window.API_URL ||
    ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port &&
    window.location.port !== "3000"
      ? "http://localhost:3000"
      : window.location.origin) ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const POLL_MS = 5000;
  const MAX_ROWS = 3000;
  const EXPORT_MAX = 10000;

  const el = {
    fTipo: document.getElementById("fTipo"),
    fUsuario: document.getElementById("fUsuario"),
    fDesde: document.getElementById("fDesde"),
    fHasta: document.getElementById("fHasta"),
    fBuscar: document.getElementById("fBuscar"),
    fAuto: document.getElementById("fAuto"),
    btnAplicar: document.getElementById("btnAplicar"),
    btnLimpiar: document.getElementById("btnLimpiar"),
    btnRefrescar: document.getElementById("btnRefrescar"),
    btnCargarMas: document.getElementById("btnCargarMas"),
    btnExportCsv: document.getElementById("btnExportCsv"),
    btnExportXlsx: document.getElementById("btnExportXlsx"),
    tbody: document.querySelector("#tablaLogs tbody"),
    badgeTotal: document.getElementById("badgeTotal"),
    lblRango: document.getElementById("lblRango"),
    lblEstado: document.getElementById("lblEstado"),
  };

  const state = {
    rows: [],
    maxId: null,
    nextBeforeId: null,
    lastFilterKey: "",
    timer: null,
    loading: false,
  };

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

  function getUser() {
    try {
      const raw = localStorage.getItem("cp_usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function rolesNorm() {
    const u = getUser();
    const roles = Array.isArray(u?.roles) ? u.roles : [];
    return roles.map((r) => String(r || "").trim().toUpperCase());
  }

  function guardGod() {
    const roles = rolesNorm();
    if (!roles.includes("GOD")) {
      window.location.replace("suficiencia_presupuestal.html");
      return false;
    }
    return true;
  }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function parseJson(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { data, text };
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: authHeaders() });
    const { data } = await parseJson(res);
    if (!res.ok) {
      if (res.status === 401) {
        window.location.replace("login.html");
        return null;
      }
      if (res.status === 403) {
        if (window.Swal) await Swal.fire("Acceso denegado", data?.error || "No autorizado", "error");
        window.location.replace("suficiencia_presupuestal.html");
        return null;
      }
      throw new Error(data?.error || "Error consultando auditoría");
    }
    return data;
  }

  function toIsoOrEmpty(dtLocalValue) {
    const s = String(dtLocalValue || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  }

  function filterKey() {
    const tipo = String(el.fTipo?.value || "").trim().toUpperCase();
    const actorId = String(el.fUsuario?.value || "").trim();
    const from = toIsoOrEmpty(el.fDesde?.value);
    const to = toIsoOrEmpty(el.fHasta?.value);
    const q = String(el.fBuscar?.value || "").trim();
    return JSON.stringify({ tipo, actorId, from, to, q });
  }

  function buildQuery(params = {}) {
    const u = new URL(`${API}/api/admin/auditoria/eventos`);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      const s = String(v).trim();
      if (!s) return;
      u.searchParams.set(k, s);
    });
    return u.toString();
  }

  function formatTs(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function areaText(r) {
    const dg = String(r?.dgeneral_clave || "").trim();
    const da = String(r?.dauxiliar_clave || "").trim();
    if (!dg && !da) return "—";
    if (dg && da) return `${dg} ${da}`;
    return dg || da;
  }

  function actorText(r) {
    const u = String(r?.actor_usuario || "").trim();
    const n = String(r?.actor_nombre || "").trim();
    if (u && n) return `${u} — ${n}`;
    return u || n || (r?.actor_id ? `#${r.actor_id}` : "—");
  }

  function entidadText(r) {
    const e = String(r?.entidad || "").trim();
    const id = String(r?.entidad_id || "").trim();
    if (!e && !id) return "—";
    if (e && id) return `${e} ${id}`;
    return e || id;
  }

  function detallesText(r) {
    if (r?.detalles == null) return "—";
    if (typeof r.detalles === "string") return r.detalles;
    try {
      return JSON.stringify(r.detalles);
    } catch {
      return String(r.detalles);
    }
  }

  function detallesObj(r) {
    if (r?.detalles == null) return null;
    if (typeof r.detalles === "object") return r.detalles;
    if (typeof r.detalles === "string") {
      try {
        const parsed = JSON.parse(r.detalles);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  function ipText(r) {
    const d = detallesObj(r);
    const ip = d?.ip == null ? "" : String(d.ip).trim();
    return ip || "—";
  }

  function authMethodText(r) {
    const d = detallesObj(r);
    const m = d?.auth_method == null ? "" : String(d.auth_method).trim().toUpperCase();
    return m || "—";
  }

  function rowHtml(r) {
    const ruta = String(r?.ruta || "").trim();
    const metodo = String(r?.metodo || "").trim().toUpperCase();
    const rutaFull = metodo ? `${metodo} ${ruta}` : ruta;
    const detalles = detallesText(r);

    return `
      <tr data-id="${Number(r.id)}">
        <td class="text-nowrap">${Number(r.id)}</td>
        <td class="text-nowrap">${escapeHtml(formatTs(r.created_at))}</td>
        <td class="text-nowrap"><span class="badge text-bg-secondary">${escapeHtml(r.tipo || "—")}</span></td>
        <td class="text-nowrap">${escapeHtml(actorText(r))}</td>
        <td class="text-nowrap">${escapeHtml(areaText(r))}</td>
        <td class="text-nowrap">${escapeHtml(r.estado || "—")}</td>
        <td class="text-nowrap">${escapeHtml(ipText(r))}</td>
        <td class="text-nowrap">${escapeHtml(authMethodText(r))}</td>
        <td class="text-nowrap">${escapeHtml(entidadText(r))}</td>
        <td class="text-nowrap">${escapeHtml(rutaFull || "—")}</td>
        <td class="cp-log-details" title="${escapeHtml(detalles)}">${escapeHtml(detalles || "—")}</td>
      </tr>
    `;
  }

  function setStatus(text) {
    if (el.lblEstado) el.lblEstado.textContent = text || "—";
  }

  function refreshCounters() {
    if (el.badgeTotal) el.badgeTotal.textContent = String(state.rows.length);
    if (el.lblRango) {
      const maxId = state.maxId;
      const minId = state.rows.length ? Number(state.rows[state.rows.length - 1]?.id || 0) : null;
      el.lblRango.textContent =
        maxId && minId ? `IDs ${maxId} → ${minId}` : (state.rows.length ? "—" : "Sin datos");
    }
  }

  function renderAll() {
    if (!el.tbody) return;
    const frag = document.createDocumentFragment();
    for (const r of state.rows) {
      const tmp = document.createElement("tbody");
      tmp.innerHTML = rowHtml(r);
      frag.appendChild(tmp.firstElementChild);
    }
    el.tbody.innerHTML = "";
    el.tbody.appendChild(frag);
    refreshCounters();
  }

  function prependRows(newRows) {
    if (!el.tbody) return;
    if (!newRows.length) return;
    const frag = document.createDocumentFragment();
    for (const r of newRows) {
      const tmp = document.createElement("tbody");
      tmp.innerHTML = rowHtml(r);
      frag.appendChild(tmp.firstElementChild);
    }
    el.tbody.prepend(frag);
    while (el.tbody.children.length > MAX_ROWS) {
      el.tbody.removeChild(el.tbody.lastElementChild);
    }
    refreshCounters();
  }

  function appendRows(oldRows) {
    if (!el.tbody) return;
    if (!oldRows.length) return;
    const frag = document.createDocumentFragment();
    for (const r of oldRows) {
      const tmp = document.createElement("tbody");
      tmp.innerHTML = rowHtml(r);
      frag.appendChild(tmp.firstElementChild);
    }
    el.tbody.appendChild(frag);
    while (el.tbody.children.length > MAX_ROWS) {
      el.tbody.removeChild(el.tbody.lastElementChild);
    }
    refreshCounters();
  }

  async function loadCatalogos() {
    const [tipos, usuarios] = await Promise.all([
      fetchJson(`${API}/api/admin/auditoria/tipos`),
      fetchJson(`${API}/api/admin/auditoria/usuarios`),
    ]);

    const tiposData = Array.isArray(tipos?.data) ? tipos.data : [];
    const usuariosData = Array.isArray(usuarios?.data) ? usuarios.data : [];

    if (el.fTipo) {
      const existing = new Set(
        tiposData.map((t) => String(t || "").trim().toUpperCase()).filter((x) => x),
      );

      const authCombo = "AUTH_LOGIN,AUTH_LOGOUT";
      const authTipos = ["AUTH_LOGIN", "AUTH_LOGOUT"];
      if (!existing.has("AUTH_LOGIN") || !existing.has("AUTH_LOGOUT")) {
        const optCombo = document.createElement("option");
        optCombo.value = authCombo;
        optCombo.textContent = "AUTH (LOGIN/LOGOUT)";
        el.fTipo.appendChild(optCombo);
      }
      authTipos.forEach((t) => {
        if (existing.has(t)) return;
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        el.fTipo.appendChild(opt);
      });

      tiposData.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = String(t || "").trim();
        opt.textContent = String(t || "").trim();
        el.fTipo.appendChild(opt);
      });
    }

    if (el.fUsuario) {
      usuariosData.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = String(u.id);
        opt.textContent = `${u.usuario} — ${u.nombre_completo || ""}`.trim();
        el.fUsuario.appendChild(opt);
      });
    }
  }

  function currentFilters() {
    return {
      tipo: String(el.fTipo?.value || "").trim(),
      actor_id: String(el.fUsuario?.value || "").trim(),
      from: toIsoOrEmpty(el.fDesde?.value),
      to: toIsoOrEmpty(el.fHasta?.value),
      q: String(el.fBuscar?.value || "").trim(),
    };
  }

  async function loadInitial() {
    if (state.loading) return;
    state.loading = true;
    try {
      setStatus("Cargando...");
      const filters = currentFilters();
      const url = buildQuery({ ...filters, limit: 200 });
      const data = await fetchJson(url);
      if (!data?.ok) return;

      const rows = Array.isArray(data.data) ? data.data : [];
      state.rows = rows.slice(0, MAX_ROWS);
      state.maxId = state.rows.length ? Number(state.rows[0]?.id || 0) : null;
      state.nextBeforeId = data?.meta?.next_before_id || null;
      state.lastFilterKey = filterKey();
      renderAll();
      setStatus(`Listo (${state.rows.length} registros)`);
    } finally {
      state.loading = false;
    }
  }

  async function pollNew() {
    if (state.loading) return;
    if (!el.fAuto?.checked) return;
    if (!state.maxId) return;
    if (filterKey() !== state.lastFilterKey) return;

    state.loading = true;
    try {
      const filters = currentFilters();
      const url = buildQuery({ ...filters, since_id: state.maxId, limit: 200 });
      const data = await fetchJson(url);
      if (!data?.ok) return;
      const newRowsAsc = Array.isArray(data.data) ? data.data : [];
      if (!newRowsAsc.length) return;
      const newRowsDesc = newRowsAsc.slice().reverse();

      state.rows = newRowsDesc.concat(state.rows);
      if (state.rows.length > MAX_ROWS) state.rows = state.rows.slice(0, MAX_ROWS);
      state.maxId = Number(state.rows[0]?.id || state.maxId);
      prependRows(newRowsDesc);
      setStatus(`Actualizado (${newRowsAsc.length} nuevos)`);
    } catch (e) {
      setStatus("Error actualizando");
      console.error("[CONSOLAGOD] poll error:", e);
    } finally {
      state.loading = false;
    }
  }

  async function loadMoreOld() {
    if (state.loading) return;
    if (!state.nextBeforeId) return;
    if (filterKey() !== state.lastFilterKey) return;

    state.loading = true;
    try {
      setStatus("Cargando anteriores...");
      const filters = currentFilters();
      const url = buildQuery({ ...filters, before_id: state.nextBeforeId, limit: 500 });
      const data = await fetchJson(url);
      if (!data?.ok) return;
      const rows = Array.isArray(data.data) ? data.data : [];
      if (!rows.length) {
        state.nextBeforeId = null;
        setStatus("No hay más registros");
        return;
      }
      state.nextBeforeId = data?.meta?.next_before_id || null;
      state.rows = state.rows.concat(rows);
      if (state.rows.length > MAX_ROWS) state.rows = state.rows.slice(0, MAX_ROWS);
      appendRows(rows);
      setStatus("Listo");
    } finally {
      state.loading = false;
    }
  }

  /**
   * BUG-010: Sanitiza valor para prevenir CSV Injection (fórmulas maliciosas en Excel/Sheets).
   * Prefija con apóstrofe si el valor empieza con =, +, -, @, TAB o CR.
   */
  function sanitizeCsvValue(val) {
    const s = String(val ?? "");
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  function toExportRows(rows) {
    return rows.map((r) => ({
      id: Number(r.id),
      timestamp: sanitizeCsvValue(formatTs(r.created_at)),
      tipo: sanitizeCsvValue(String(r.tipo || "")),
      usuario: sanitizeCsvValue(actorText(r)),
      area: sanitizeCsvValue(areaText(r)),
      estado: sanitizeCsvValue(String(r.estado || "")),
      ip: sanitizeCsvValue(ipText(r)),
      auth_method: sanitizeCsvValue(authMethodText(r)),
      entidad: sanitizeCsvValue(entidadText(r)),
      ruta: sanitizeCsvValue(`${String(r.metodo || "").toUpperCase()} ${String(r.ruta || "")}`.trim()),
      detalles: sanitizeCsvValue(detallesText(r)),
    }));
  }

  async function fetchAllForExport() {
    const filters = currentFilters();
    let beforeId = null;
    const out = [];

    for (let loops = 0; loops < 20; loops += 1) {
      const url = buildQuery({ ...filters, before_id: beforeId || "", limit: 1000 });
      const data = await fetchJson(url);
      if (!data?.ok) break;
      const rows = Array.isArray(data.data) ? data.data : [];
      if (!rows.length) break;
      out.push(...rows);
      if (out.length >= EXPORT_MAX) break;
      beforeId = data?.meta?.next_before_id || null;
      if (!beforeId) break;
    }

    return out.slice(0, EXPORT_MAX);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv(rows) {
    const data = toExportRows(rows);
    const headers = Object.keys(data[0] || {
      id: "",
      timestamp: "",
      tipo: "",
      usuario: "",
      area: "",
      estado: "",
      ip: "",
      auth_method: "",
      entidad: "",
      ruta: "",
      detalles: "",
    });

    const lines = [];
    lines.push(headers.join(","));
    for (const r of data) {
      const line = headers
        .map((h) => {
          const v = r[h] == null ? "" : String(r[h]);
          const safe = v.replace(/"/g, '""');
          return `"${safe}"`;
        })
        .join(",");
      lines.push(line);
    }

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `auditoria_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function exportXlsx(rows) {
    const data = toExportRows(rows);
    if (!window.XLSX) {
      exportCsv(rows);
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Auditoria");
    XLSX.writeFile(wb, `auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function doExport(kind) {
    try {
      setStatus("Preparando exportación...");
      const rows = await fetchAllForExport();
      if (!rows.length) {
        setStatus("Sin datos para exportar");
        return;
      }
      if (kind === "xlsx") exportXlsx(rows);
      else exportCsv(rows);
      setStatus(`Exportado (${rows.length} registros)`);
    } catch (e) {
      console.error("[CONSOLAGOD] export error:", e);
      setStatus("Error al exportar");
      if (window.Swal) await Swal.fire("Error", e.message || "No se pudo exportar", "error");
    }
  }

  function bindEvents() {
    el.btnAplicar?.addEventListener("click", () => loadInitial());
    el.btnRefrescar?.addEventListener("click", () => loadInitial());
    el.btnCargarMas?.addEventListener("click", () => loadMoreOld());

    el.btnLimpiar?.addEventListener("click", () => {
      if (el.fTipo) el.fTipo.value = "";
      if (el.fUsuario) el.fUsuario.value = "";
      if (el.fDesde) el.fDesde.value = "";
      if (el.fHasta) el.fHasta.value = "";
      if (el.fBuscar) el.fBuscar.value = "";
      loadInitial();
    });

    el.fBuscar?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadInitial();
      }
    });

    el.btnExportCsv?.addEventListener("click", () => doExport("csv"));
    el.btnExportXlsx?.addEventListener("click", () => doExport("xlsx"));
  }

  async function init() {
    if (!guardGod()) return;
    bindEvents();
    await loadCatalogos();
    await loadInitial();

    state.timer = setInterval(() => {
      pollNew();
    }, POLL_MS);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => {
      console.error("[CONSOLAGOD] init error:", e);
      setStatus("Error inicializando");
    });
  });
})();
