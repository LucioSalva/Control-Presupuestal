/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Reconducciones Presupuestales
 *  Archivo: reconducciones.js
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
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const MONTHS = {
    ENERO: "01",
    FEBRERO: "02",
    MARZO: "03",
    ABRIL: "04",
    MAYO: "05",
    JUNIO: "06",
    JULIO: "07",
    AGOSTO: "08",
    SEPTIEMBRE: "09",
    OCTUBRE: "10",
    NOVIEMBRE: "11",
    DICIEMBRE: "12",
  };

  const state = {
    reconId: null,
    status: "BORRADOR",
    flags: {
      origenInsuficiente: false,
    },
    catalogos: {
      dgeneral: [],
      dauxiliar: [],
      programas: [],
      proyectos: [],
      fuentes: [],
      partidas: [],
    },
    maps: {
      partidasByClave: new Map(),
      partidasById: new Map(),
      proyectosById: new Map(),
    },
    saldos: {
      ORIGEN: new Map(),
      DESTINO: new Map(),
    },
    recientes: [],
  };

  const getToken = () =>
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    "";

  let reconSession = "";
  const setReconSession = (value) => {
    reconSession = String(value || "").trim();
  };
  const hasReconSession = () => !!reconSession;

  const authHeaders = () => {
    const t = getToken();
    return {
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(reconSession ? { "x-recon-session": reconSession } : {}),
    };
  };

  let CURRENT_USER = null;
  let CURRENT_ROLES_NORM = [];
  let CURRENT_DGENERAL_ID = null;
  let CURRENT_DAUXILIAR_ID = null;
  let CURRENT_DGENERAL_CLAVE = null;
  let CURRENT_DAUXILIAR_CLAVE = null;

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
      CURRENT_DGENERAL_ID = Number(CURRENT_USER.id_dgeneral || 0) || null;
      CURRENT_DAUXILIAR_ID = Number(CURRENT_USER.id_dauxiliar || 0) || null;
      CURRENT_DGENERAL_CLAVE = String(CURRENT_USER.dgeneral_clave || "").trim().toUpperCase() || null;
      CURRENT_DAUXILIAR_CLAVE = String(CURRENT_USER.dauxiliar_clave || "").trim().toUpperCase() || null;
    } catch {
      window.location.href = "login.html";
    }
  }

  function isGodUser() {
    return CURRENT_ROLES_NORM.includes("GOD");
  }

  function isAdminUser() {
    return CURRENT_ROLES_NORM.includes("ADMIN");
  }

  // Migración 2026-03-24: isL00117User se mantiene para compatibilidad de lógica de workflow
  function isL00117User() {
    return CURRENT_DGENERAL_CLAVE === "L00" && CURRENT_DAUXILIAR_CLAVE === "117";
  }

  // Migración 2026-03-24: canBypassOperationalLocks reemplaza a isL00117User en acceso de día/clave
  function canBypassOperationalLocks() {
    return isGodUser() || isAdminUser();
  }

  function canSeeAllAreas() {
    // Migración 2026-03-24: ADMIN y GOD pueden ver todas las áreas (rol-based)
    return isGodUser() || isAdminUser();
  }

  function isAllowedReconDay() {
    const day = new Date().getDay();
    return day >= 1 && day <= 4;
  }

  function isReconAccessAllowed() {
    // Migración 2026-03-24: ADMIN y GOD pueden operar cualquier día
    return canBypassOperationalLocks() || isAllowedReconDay();
  }

  const el = {
    filtroEstatus: document.getElementById("filtro-estatus"),
    tablaBody: document.getElementById("tabla-recon-body"),
    rcId: document.getElementById("rc-id"),
    rcStatus: document.getElementById("rc-status"),
    rcOficio: document.getElementById("rc-oficio"),
    rcFecha: document.getElementById("rc-fecha"),
    rcTipo: document.getElementById("rc-tipo"),
    rcEjercicio: document.getElementById("rc-ejercicio"),
    rcMes: document.getElementById("rc-mes"),
    rcJustificacion: document.getElementById("rc-justificacion"),
    totalOrigen: document.getElementById("total-origen"),
    totalDestino: document.getElementById("total-destino"),
    totalDiff: document.getElementById("total-diff"),
    alertaSaldoOrigen: document.getElementById("origen-alerta-saldo"),
    btnGuardar: document.getElementById("btn-guardar"),
    btnEnviar: document.getElementById("btn-enviar"),
    btnAplicar: document.getElementById("btn-aplicar"),
    btnCancelar: document.getElementById("btn-cancelar"),
  };
  const hasRecientes = !!(el.filtroEstatus && el.tablaBody);

  const modalBuscarRecon = new bootstrap.Modal(document.getElementById("modalBuscarRecon"));

  const sideEls = {
    ORIGEN: {
      prefix: "origen",
      dgeneral: document.getElementById("origen-dgeneral"),
      dauxiliar: document.getElementById("origen-dauxiliar"),
      programa: document.getElementById("origen-programa"),
      fuente: document.getElementById("origen-fuente"),
      proyecto: document.getElementById("origen-proyecto"),
      clave: document.getElementById("origen-clave"),
      denominacion: document.getElementById("origen-denominacion"),
      objetivo: document.getElementById("origen-objetivo"),
      autorizado: document.getElementById("origen-autorizado"),
      porEjercer: document.getElementById("origen-por-ejercer"),
      monto: document.getElementById("origen-monto"),
      autorizadoMod: document.getElementById("origen-autorizado-modificado"),
      recursosBody: document.getElementById("recursos-origen-body"),
      metasBody: document.getElementById("metas-origen-body"),
      btnAddRecurso: document.getElementById("btn-add-origen"),
      btnDelRecurso: document.getElementById("btn-del-origen"),
      btnAddMeta: document.getElementById("btn-add-meta-origen"),
      btnDelMeta: document.getElementById("btn-del-meta-origen"),
    },
    DESTINO: {
      prefix: "destino",
      dgeneral: document.getElementById("destino-dgeneral"),
      dauxiliar: document.getElementById("destino-dauxiliar"),
      programa: document.getElementById("destino-programa"),
      fuente: document.getElementById("destino-fuente"),
      proyecto: document.getElementById("destino-proyecto"),
      clave: document.getElementById("destino-clave"),
      denominacion: document.getElementById("destino-denominacion"),
      objetivo: document.getElementById("destino-objetivo"),
      autorizado: document.getElementById("destino-autorizado"),
      porEjercer: document.getElementById("destino-por-ejercer"),
      monto: document.getElementById("destino-monto"),
      autorizadoMod: document.getElementById("destino-autorizado-modificado"),
      recursosBody: document.getElementById("recursos-destino-body"),
      metasBody: document.getElementById("metas-destino-body"),
      btnAddRecurso: document.getElementById("btn-add-destino"),
      btnDelRecurso: document.getElementById("btn-del-destino"),
      btnAddMeta: document.getElementById("btn-add-meta-destino"),
      btnDelMeta: document.getElementById("btn-del-meta-destino"),
    },
  };

  const hasSwal = () => typeof window !== "undefined" && !!window.Swal;

  const uiAlert = (message, icon = "info", title = "Aviso") => {
    const msg = String(message ?? "");
    if (!hasSwal()) {
      alert(`${title}: ${msg}`);
      return Promise.resolve();
    }
    return window.Swal.fire({
      icon,
      title,
      text: msg,
      confirmButtonText: "Aceptar",
      confirmButtonColor: "#BC955C",
    });
  };

  const uiConfirm = (message, title = "Confirmar") => {
    if (!hasSwal()) return Promise.resolve(confirm(`${title}: ${message}`));
    return window.Swal.fire({
      title,
      text: message,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, continuar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#BC955C",
    }).then((r) => r.isConfirmed);
  };

  const uiSuccess = (m, t = "Listo") => uiAlert(m, "success", t);
  const uiError = (m, t = "Error") => uiAlert(m, "error", t);
  const uiWarn = (m, t = "Atención") => uiAlert(m, "warning", t);

  function disableReconUI() {
    const controls = Array.from(
      document.querySelectorAll("input, select, textarea, button")
    );
    controls.forEach((c) => {
      c.disabled = true;
    });
  }

  async function fetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!r.ok) {
      const msg =
        data?.db?.message ||
        data?.db ||
        data?.error ||
        data?.message ||
        `HTTP ${r.status} en ${url}`;
      throw new Error(msg);
    }
    return data;
  }

  async function validarClaveAcceso(clave) {
    try {
      const payload = { clave: String(clave || "").trim().toUpperCase() };
      const data = await fetchJson(`${API}/api/reconducciones/clave/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const tokenValue = String(data?.token || "").trim();
      if (!data?.ok || !tokenValue) return false;
      setReconSession(tokenValue);
      return true;
    } catch {
      return false;
    }
  }

  async function solicitarClaveAcceso() {
    if (!hasSwal()) {
      const input = prompt("Clave de acceso para Reconducciones");
      if (!input) return false;
      const clave = String(input).trim().toUpperCase();
      const ok = await validarClaveAcceso(clave);
      return ok;
    }
    const result = await window.Swal.fire({
      title: "Clave de acceso",
      text: "Captura la clave de 6 caracteres",
      input: "text",
      inputAttributes: {
        autocapitalize: "characters",
        maxlength: 6,
      },
      inputPlaceholder: "Ej. AB12CD",
      showCancelButton: true,
      confirmButtonText: "Validar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#BC955C",
      preConfirm: (value) => {
        const v = String(value || "").trim().toUpperCase();
        if (!v) {
          window.Swal.showValidationMessage("Escribe la clave");
          return null;
        }
        if (v.length !== 6) {
          window.Swal.showValidationMessage("La clave debe tener 6 caracteres");
          return null;
        }
        return v;
      },
    });
    if (!result.isConfirmed) return false;
    const clave = String(result.value || "").trim().toUpperCase();
    const ok = await validarClaveAcceso(clave);
    if (ok) return true;
    await uiError("Clave inválida");
    return false;
  }

  async function ensureReconAccess() {
    if (!isReconAccessAllowed()) {
      await uiWarn(
        "Reconducciones está habilitado de lunes a jueves. Los roles ADMIN y GOD son la excepción."
      );
      disableReconUI();
      return false;
    }
    // Migración 2026-03-24: ADMIN y GOD no requieren clave de acceso
    if (canBypassOperationalLocks()) return true;
    if (hasReconSession()) return true;
    let ok = false;
    for (let i = 0; i < 3; i += 1) {
      ok = await solicitarClaveAcceso();
      if (ok) return true;
      const again = await uiConfirm("¿Quieres intentar con otra clave?");
      if (!again) break;
    }
    disableReconUI();
    return false;
  }

  let qrTimer = null;

  function canRenderQrRecon() {
    const id = Number(state.reconId || 0);
    return id > 0;
  }

  function buildQrPayloadRecon() {
    const id = state.reconId != null ? String(state.reconId) : "";
    const folio = getOficioValue();
    const fecha = String(el.rcFecha.value || "").trim();
    const tipo = String(el.rcTipo.value || "").trim();
    const ejercicio = String(el.rcEjercicio.value || "").trim();
    const mes = String(el.rcMes.value || "").trim();
    const totalOrigen = String(el.totalOrigen?.textContent || "").trim();
    const totalDestino = String(el.totalDestino?.textContent || "").trim();
    if (!id && !folio && !fecha && !tipo && !ejercicio && !mes) return "";
    return JSON.stringify({
      tipo: "RCP",
      id,
      folio,
      fecha,
      tipo_movimiento: tipo,
      ejercicio,
      mes,
      total_origen: totalOrigen,
      total_destino: totalDestino,
    });
  }

  async function renderQrRecon() {
    const container = document.getElementById("qr-recon");
    if (!container) return;
    if (!canRenderQrRecon()) {
      container.innerHTML = `<div class="cp-qr-empty">Sin QR</div>`;
      return;
    }
    const text = buildQrPayloadRecon();
    if (!text || !window.QRCode?.toDataURL) {
      container.innerHTML = `<div class="cp-qr-empty">Sin QR</div>`;
      return;
    }
    try {
      const dataUrl = await window.QRCode.toDataURL(text, {
        width: 120,
        margin: 1,
      });
      const img = new Image();
      img.src = dataUrl;
      img.alt = "QR";
      container.innerHTML = "";
      container.appendChild(img);
    } catch {
      container.innerHTML = `<div class="cp-qr-empty">Sin QR</div>`;
    }
  }

  function scheduleQrRender() {
    if (qrTimer) clearTimeout(qrTimer);
    qrTimer = setTimeout(() => {
      renderQrRecon();
    }, 120);
  }

  const num = (v) => {
    const raw = String(v ?? "").trim();
    if (raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  const numOrNull = (v) => {
    const raw = String(v ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const formatCurrency = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "$0.00";
    return n.toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
    });
  };

  const formatDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const year = dt.getFullYear();
    return `${day}/${month}/${year}`;
  };

  function setStatusBadge(estatus) {
    const e = String(estatus || "").toUpperCase() || "BORRADOR";
    state.status = e;
    el.rcStatus.textContent = e;
    el.rcStatus.classList.remove(
      "bg-secondary",
      "bg-info",
      "bg-primary",
      "bg-success",
      "bg-danger"
    );
    if (e === "ENVIADO") el.rcStatus.classList.add("bg-info");
    else if (e === "AUTORIZADO") el.rcStatus.classList.add("bg-primary");
    else if (e === "APLICADO") el.rcStatus.classList.add("bg-success");
    else if (e === "CANCELADO") el.rcStatus.classList.add("bg-danger");
    else el.rcStatus.classList.add("bg-secondary");
    updateActionButtons();
  }

  function setReconId(id) {
    state.reconId = id || null;
    el.rcId.textContent = id ? String(id) : "—";
  }

  function getOficioValue() {
    if (!el.rcOficio) return "";
    const raw =
      "value" in el.rcOficio
        ? String(el.rcOficio.value || "")
        : String(el.rcOficio.textContent || "");
    const trimmed = raw.trim();
    return trimmed === "—" || trimmed === "Se asignará al guardar" ? "" : trimmed;
  }

  function setOficioValue(value) {
    if (!el.rcOficio) return;
    const text = String(value || "").trim();
    if ("value" in el.rcOficio) {
      el.rcOficio.value = text;
      return;
    }
    el.rcOficio.textContent = text || "Se asignará al guardar";
  }

  function buildMesPagoDate() {
    const ejercicio = Number(el.rcEjercicio.value);
    const mes = String(el.rcMes.value || "").toUpperCase();
    if (!Number.isFinite(ejercicio) || !MONTHS[mes]) return null;
    return `${ejercicio}-${MONTHS[mes]}-01`;
  }

  function buildSelectOptions(items, getLabel) {
    const opts = ['<option value="">Seleccione...</option>'];
    items.forEach((it) => {
      const value = String(it.id ?? it.clave ?? "");
      const label = getLabel(it);
      opts.push(`<option value="${value}">${label}</option>`);
    });
    return opts.join("");
  }

  function setSelectValue(select, value) {
    if (!select) return;
    select.value = value ?? "";
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

  function clearTable(body) {
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function updateRowIndices(body) {
    const rows = body.querySelectorAll("tr");
    rows.forEach((row, idx) => {
      const cell = row.querySelector(".rc-row-index");
      if (cell) cell.textContent = String(idx + 1);
    });
  }

  function getPartidaInfoByClave(clave) {
    const key = String(clave || "").trim();
    return state.maps.partidasByClave.get(key) || null;
  }

  function getSaldoInfo(side, clave) {
    const key = String(clave || "").trim();
    return state.saldos[side].get(key) || null;
  }

  function fillPartidaSelect(select, selectedClave) {
    const opts = ['<option value="">Seleccione...</option>'];
    state.catalogos.partidas.forEach((p) => {
      const clave = String(p.clave || "").trim();
      const desc = String(p.descripcion || p.partida || "");
      opts.push(`<option value="${clave}" data-desc="${desc}">${clave} - ${desc}</option>`);
    });
    select.innerHTML = opts.join("");
    if (selectedClave) {
      select.value = selectedClave;
    }
  }

  function updateResourceRow(row, side) {
    const select = row.querySelector(".rc-partida-select");
    const desc = row.querySelector(".rc-partida-desc");
    const saldo = row.querySelector(".rc-partida-saldo");
    const clave = select?.value || "";
    const info = getSaldoInfo(side, clave);
    const base = getPartidaInfoByClave(clave);
    const descValue = info?.descripcion || base?.descripcion || "";
    if (desc) desc.value = descValue;
    if (saldo) saldo.value = Number(info?.saldo || 0).toFixed(2);
    row.dataset.partidaId = info?.id ? String(info.id) : row.dataset.partidaId || "";
  }

  function addResourceRow(side, data = {}) {
    const body = sideEls[side].recursosBody;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="rc-row-index text-center"></td>
      <td>
        <select class="form-select form-select-sm rc-partida-select"></select>
      </td>
      <td>
        <input type="text" class="form-control form-control-sm rc-partida-desc" readonly>
      </td>
      <td>
        <input type="number" class="form-control form-control-sm rc-partida-saldo text-end" readonly>
      </td>
      <td>
        <input type="number" step="0.01" class="form-control form-control-sm rc-partida-monto text-end">
      </td>
    `;
    const select = row.querySelector(".rc-partida-select");
    fillPartidaSelect(select, data.clave);
    if (data.partidaId) row.dataset.partidaId = String(data.partidaId);
    if (data.monto != null) {
      row.querySelector(".rc-partida-monto").value = Number(data.monto).toFixed(2);
    }
    if (data.descripcion) {
      row.querySelector(".rc-partida-desc").value = data.descripcion;
    }
    if (data.saldo != null) {
      row.querySelector(".rc-partida-saldo").value = Number(data.saldo).toFixed(2);
    }
    select.addEventListener("change", async () => {
      const option = select.selectedOptions[0];
      if (option && option.dataset.desc) {
        row.querySelector(".rc-partida-desc").value = option.dataset.desc;
      }
      await updateSaldos(side);
      updateResourceRow(row, side);
      updateTotals();
    });
    row.querySelector(".rc-partida-monto").addEventListener("input", updateTotals);
    body.appendChild(row);
    updateResourceRow(row, side);
    updateRowIndices(body);
  }

  function removeResourceRow(side) {
    const body = sideEls[side].recursosBody;
    if (body.lastElementChild) {
      body.removeChild(body.lastElementChild);
      updateRowIndices(body);
      updateTotals();
    }
  }

  function addMetaRow(side, data = {}) {
    const body = sideEls[side].metasBody;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="text" class="form-control form-control-sm rc-meta-codigo"></td>
      <td><input type="text" class="form-control form-control-sm rc-meta-desc"></td>
      <td><input type="text" class="form-control form-control-sm rc-meta-unidad"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-inicial text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-avance text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-modificada text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-t1 text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-t2 text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-t3 text-end"></td>
      <td><input type="number" step="0.01" class="form-control form-control-sm rc-meta-t4 text-end"></td>
    `;
    body.appendChild(row);
    if (data.codigo) row.querySelector(".rc-meta-codigo").value = data.codigo;
    if (data.descripcion) row.querySelector(".rc-meta-desc").value = data.descripcion;
    if (data.unidad_medida) row.querySelector(".rc-meta-unidad").value = data.unidad_medida;
    if (data.inicial != null) row.querySelector(".rc-meta-inicial").value = data.inicial;
    if (data.avance != null) row.querySelector(".rc-meta-avance").value = data.avance;
    if (data.modificada != null) row.querySelector(".rc-meta-modificada").value = data.modificada;
    if (data.t1 != null) row.querySelector(".rc-meta-t1").value = data.t1;
    if (data.t2 != null) row.querySelector(".rc-meta-t2").value = data.t2;
    if (data.t3 != null) row.querySelector(".rc-meta-t3").value = data.t3;
    if (data.t4 != null) row.querySelector(".rc-meta-t4").value = data.t4;
  }

  function removeMetaRow(side) {
    const body = sideEls[side].metasBody;
    if (body.lastElementChild) body.removeChild(body.lastElementChild);
  }

  function updateAutorizadoMod(side) {
    const s = sideEls[side];
    const autorizado = num(s.autorizado.value);
    const monto = num(s.monto.value);
    const mod = side === "ORIGEN" ? autorizado - monto : autorizado + monto;
    s.autorizadoMod.value = mod.toFixed(2);
  }

  function updateTotals() {
    const totalOrigen = sumRows("ORIGEN");
    const totalDestino = sumRows("DESTINO");
    el.totalOrigen.textContent = formatCurrency(totalOrigen);
    el.totalDestino.textContent = formatCurrency(totalDestino);
    el.totalDiff.textContent = formatCurrency(totalDestino - totalOrigen);
    updateAutorizadoMod("ORIGEN");
    updateAutorizadoMod("DESTINO");
    updateSaldoWarnings();
    updateActionButtons();
  }

  function sumRows(side) {
    const body = sideEls[side].recursosBody;
    const rows = body.querySelectorAll("tr");
    let total = 0;
    rows.forEach((row) => {
      const val = num(row.querySelector(".rc-partida-monto")?.value);
      total += val;
    });
    return total;
  }

  function getSideFilters(side) {
    const s = sideEls[side];
    return {
      id_dgeneral: numOrNull(s.dgeneral.value),
      id_dauxiliar: numOrNull(s.dauxiliar.value),
      id_fuente: numOrNull(s.fuente.value),
      id_proyecto: numOrNull(s.proyecto.value),
      mes: el.rcMes.value || null,
      mes_pago_date: buildMesPagoDate(),
    };
  }

  async function updateSaldos(side) {
    const s = sideEls[side];
    const f = getSideFilters(side);
    if (!f.id_dgeneral || !f.id_dauxiliar) {
      state.saldos[side] = new Map();
      s.porEjercer.value = "0.00";
      updateRowsSaldo(side);
      updateSaldoWarnings();
      return;
    }
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (v != null && v !== "") params.append(k, String(v));
    });
    try {
      const data = await fetchJson(`${API}/api/reconducciones/saldos?${params.toString()}`, {
        headers: authHeaders(),
      });
      const map = new Map();
      let total = 0;
      data.forEach((row) => {
        const clave = String(row.clave || "").trim();
        const saldo = Number(row.saldo_disponible || 0);
        map.set(clave, {
          id: row.id_partida,
          saldo,
          descripcion: row.descripcion || "",
        });
        total += saldo;
      });
      state.saldos[side] = map;
      s.porEjercer.value = total.toFixed(2);
      updateRowsSaldo(side);
      updateSaldoWarnings();
    } catch (err) {
      s.porEjercer.value = "0.00";
      updateSaldoWarnings();
    }
  }

  function updateRowsSaldo(side) {
    const body = sideEls[side].recursosBody;
    const rows = body.querySelectorAll("tr");
    rows.forEach((row) => updateResourceRow(row, side));
  }

  function collectLado(side) {
    const s = sideEls[side];
    return {
      lado: side,
      id_dgeneral: numOrNull(s.dgeneral.value),
      id_dauxiliar: numOrNull(s.dauxiliar.value),
      id_programa: numOrNull(s.programa.value),
      objetivo: s.objetivo.value?.trim() || null,
      id_fuente: numOrNull(s.fuente.value),
      id_proyecto: numOrNull(s.proyecto.value),
      clave_proyecto: s.clave.value?.trim() || null,
      denominacion: s.denominacion.value?.trim() || null,
    };
  }

  function collectRecursos(side) {
    const body = sideEls[side].recursosBody;
    const rows = Array.from(body.querySelectorAll("tr"));
    const recursos = [];
    rows.forEach((row) => {
      const clave = row.querySelector(".rc-partida-select")?.value || "";
      const monto = num(row.querySelector(".rc-partida-monto")?.value);
      const desc = row.querySelector(".rc-partida-desc")?.value || "";
      const saldo = numOrNull(row.querySelector(".rc-partida-saldo")?.value);
      const idPartida =
        numOrNull(row.dataset.partidaId) ||
        numOrNull(getSaldoInfo(side, clave)?.id) ||
        null;
      if (!clave && monto <= 0) return;
      if (monto < 0) return;
      recursos.push({
        lado: side,
        id_partida: idPartida,
        concepto_partida: desc || null,
        autorizado: null,
        por_ejercer: saldo,
        monto_movimiento: monto,
        autorizado_modificado: null,
      });
    });
    return recursos;
  }

  function collectMetas(side) {
    const body = sideEls[side].metasBody;
    const rows = Array.from(body.querySelectorAll("tr"));
    const metas = [];
    rows.forEach((row) => {
      const codigo = row.querySelector(".rc-meta-codigo")?.value || "";
      const descripcion = row.querySelector(".rc-meta-desc")?.value || "";
      const unidad = row.querySelector(".rc-meta-unidad")?.value || "";
      const inicial = numOrNull(row.querySelector(".rc-meta-inicial")?.value);
      const avance = numOrNull(row.querySelector(".rc-meta-avance")?.value);
      const modificada = numOrNull(row.querySelector(".rc-meta-modificada")?.value);
      const t1 = numOrNull(row.querySelector(".rc-meta-t1")?.value);
      const t2 = numOrNull(row.querySelector(".rc-meta-t2")?.value);
      const t3 = numOrNull(row.querySelector(".rc-meta-t3")?.value);
      const t4 = numOrNull(row.querySelector(".rc-meta-t4")?.value);
      const anyFilled =
        codigo ||
        descripcion ||
        unidad ||
        [inicial, avance, modificada, t1, t2, t3, t4].some((v) => v != null);
      if (!anyFilled) return;
      metas.push({
        lado: side,
        codigo: codigo || null,
        descripcion: descripcion || null,
        unidad_medida: unidad || null,
        inicial,
        avance,
        modificada,
        t1,
        t2,
        t3,
        t4,
      });
    });
    return metas;
  }

  function updateSaldoWarnings() {
    const body = sideEls.ORIGEN.recursosBody;
    const rows = body.querySelectorAll("tr");
    let hasInsuf = false;
    rows.forEach((row) => {
      const monto = num(row.querySelector(".rc-partida-monto")?.value);
      const saldo = num(row.querySelector(".rc-partida-saldo")?.value);
      // Marca renglones con saldo insuficiente en ORIGEN
      const invalid = monto > 0 && monto > saldo;
      row.classList.toggle("rc-row-invalid", invalid);
      hasInsuf = hasInsuf || invalid;
    });
    state.flags.origenInsuficiente = hasInsuf;
    if (el.alertaSaldoOrigen) {
      el.alertaSaldoOrigen.classList.toggle("d-none", !hasInsuf);
    }
  }

  function updateActionButtons() {
    const tipo = String(el.rcTipo.value || "").toUpperCase();
    const diff = num(el.totalDiff.textContent.replace(/[^0-9.-]/g, ""));
    const requiereCuadre = tipo === "TRASPASO" || tipo === "RECONDUCCION";
    const puedeAplicar = state.status === "ENVIADO" || state.status === "AUTORIZADO";
    // Si requiere cuadre, la diferencia debe ser cero para aplicar
    const bloqueaPorDiff = requiereCuadre && Math.abs(diff) > 0.01;
    const justOk = String(el.rcJustificacion.value || "").trim().length > 0;
    const totalMov = sumRows("ORIGEN") + sumRows("DESTINO");
    const bloqueaSaldo = state.flags.origenInsuficiente;
    el.btnAplicar.disabled = !puedeAplicar || bloqueaPorDiff || bloqueaSaldo || !justOk;
    el.btnEnviar.disabled = state.status !== "BORRADOR" || !justOk || totalMov <= 0;
    el.btnCancelar.disabled = state.status === "APLICADO";
  }

  function validateHeader() {
    const fecha = el.rcFecha.value;
    const tipo = el.rcTipo.value;
    if (!fecha || !tipo) {
      uiWarn("Captura fecha y tipo de movimiento");
      return false;
    }
    const ejercicio = numOrNull(el.rcEjercicio.value);
    if (ejercicio && (ejercicio < 2000 || ejercicio > 2100)) {
      uiWarn("Ejercicio inválido");
      return false;
    }
    return true;
  }

  function validateRecursos() {
    const recursos = [...collectRecursos("ORIGEN"), ...collectRecursos("DESTINO")];
    const montoGlobal = num(sideEls.ORIGEN.monto.value) + num(sideEls.DESTINO.monto.value);
    if (recursos.length === 0 && montoGlobal <= 0) {
      uiWarn("Captura al menos un renglón de recursos o un monto global");
      return false;
    }
    const invalid = recursos.find((r) => !r.id_partida && r.monto_movimiento > 0);
    if (invalid) {
      uiWarn("Selecciona partida válida para todos los renglones con monto");
      return false;
    }
    return true;
  }

  function validateSaldos() {
    const rows = collectRecursos("ORIGEN");
    const insuficientes = rows.filter((r) => Number(r.monto_movimiento || 0) > Number(r.por_ejercer || 0));
    if (insuficientes.length > 0) {
      uiWarn("Hay partidas ORIGEN con saldo insuficiente");
      return false;
    }
    return true;
  }

  function validateJustificacion(actionLabel) {
    const just = String(el.rcJustificacion.value || "").trim();
    if (!just) {
      uiWarn(`Captura la justificación para ${actionLabel}`);
      return false;
    }
    return true;
  }

  function validateTotales() {
    const tipo = String(el.rcTipo.value || "").toUpperCase();
    if (tipo !== "TRASPASO" && tipo !== "RECONDUCCION") return true;
    const totalOrigen = sumRows("ORIGEN");
    const totalDestino = sumRows("DESTINO");
    if (Math.abs(totalOrigen - totalDestino) > 0.01) {
      uiWarn("Total ORIGEN debe igualar Total DESTINO");
      return false;
    }
    return true;
  }

  function toArray(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }

  function findCatalogRow(list, idValue, claveValue) {
    const byId = list.find((x) => String(x.id) === String(idValue));
    if (byId) return byId;
    if (!claveValue) return null;
    return list.find(
      (x) => String(x.clave || "").trim().toUpperCase() === String(claveValue).trim().toUpperCase()
    );
  }

  async function loadCatalogos() {
    const headers = authHeaders();
    const [dg, da, programas, proyectos, fuentes, partidas] = await Promise.all([
      fetchJson(`${API}/api/catalogos/dgeneral`, { headers }),
      fetchJson(`${API}/api/catalogos/dauxiliar`, { headers }),
      fetchJson(`${API}/api/catalogos/programas`, { headers }),
      fetchJson(`${API}/api/catalogos/proyectos`, { headers }),
      fetchJson(`${API}/api/catalogos/fuentes`, { headers }),
      fetchJson(`${API}/api/catalogos/partidas`, { headers }),
    ]);
    state.catalogos.dgeneral = toArray(dg);
    state.catalogos.dauxiliar = toArray(da);
    state.catalogos.programas = toArray(programas);
    state.catalogos.proyectos = toArray(proyectos);
    state.catalogos.fuentes = toArray(fuentes);
    state.catalogos.partidas = toArray(partidas);

    state.maps.partidasByClave.clear();
    state.catalogos.partidas.forEach((p) => {
      const clave = String(p.clave || "").trim();
      state.maps.partidasByClave.set(clave, {
        descripcion: p.descripcion || p.partida || "",
      });
    });
    state.maps.proyectosById.clear();
    state.catalogos.proyectos.forEach((p) => {
      state.maps.proyectosById.set(Number(p.id), p);
    });

    const dgOpts = buildSelectOptions(state.catalogos.dgeneral, (x) => `${x.clave} - ${x.dependencia}`);
    const daOpts = buildSelectOptions(state.catalogos.dauxiliar, (x) => `${x.clave} - ${x.dependencia}`);
    const progOpts = buildSelectOptions(state.catalogos.programas, (x) => `${x.clave} - ${x.descripcion}`);
    const fuenteOpts = buildSelectOptions(state.catalogos.fuentes, (x) => `${x.clave} - ${x.fuente}`);
    const proyectoOpts = buildSelectOptions(state.catalogos.proyectos, (x) => `${x.clave} - ${x.descripcion}`);

    ["ORIGEN", "DESTINO"].forEach((side) => {
      const s = sideEls[side];
      s.dgeneral.innerHTML = dgOpts;
      s.dauxiliar.innerHTML = daOpts;
      s.programa.innerHTML = progOpts;
      s.fuente.innerHTML = fuenteOpts;
      s.proyecto.innerHTML = proyectoOpts;
    });

    if (!canSeeAllAreas()) {
      const dgRow = findCatalogRow(state.catalogos.dgeneral, CURRENT_DGENERAL_ID, CURRENT_DGENERAL_CLAVE);
      const daRow = findCatalogRow(state.catalogos.dauxiliar, CURRENT_DAUXILIAR_ID, CURRENT_DAUXILIAR_CLAVE);
      ["ORIGEN", "DESTINO"].forEach((side) => {
        const s = sideEls[side];
        setSelectToSingleOption(
          s.dgeneral,
          dgRow ? String(dgRow.id) : "",
          dgRow ? `${dgRow.clave} - ${dgRow.dependencia}` : "—"
        );
        setSelectToSingleOption(
          s.dauxiliar,
          daRow ? String(daRow.id) : "",
          daRow ? `${daRow.clave} - ${daRow.dependencia}` : "—"
        );
      });
    }
  }

  async function loadSaldosGlobal() {
    try {
      const data = await fetchJson(`${API}/api/reconducciones/saldos`, {
        headers: authHeaders(),
      });
      state.maps.partidasById.clear();
      data.forEach((row) => {
        if (row.id_partida) {
          state.maps.partidasById.set(Number(row.id_partida), {
            clave: String(row.clave || "").trim(),
            descripcion: row.descripcion || "",
          });
        }
      });
    } catch {}
  }

  async function loadRecientes() {
    if (!hasRecientes) return;
    try {
      const data = await fetchJson(`${API}/api/reconducciones`, { headers: authHeaders() });
      state.recientes = Array.isArray(data) ? data : [];
      renderRecientes();
    } catch (err) {
      uiError(err.message || "Error cargando reconducciones");
    }
  }

  function renderRecientes() {
    if (!hasRecientes) return;
    const estatus = String(el.filtroEstatus.value || "TODOS").toUpperCase();
    const rows = state.recientes.filter((r) => estatus === "TODOS" || String(r.estatus || "").toUpperCase() === estatus);
    el.tablaBody.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${r.id}</td>
          <td>${r.oficio || "—"}</td>
          <td>${formatDate(r.fecha_elaboracion)}</td>
          <td>${r.tipo_movimiento || "—"}</td>
          <td><span class="badge bg-light text-dark">${r.estatus || "—"}</span></td>
          <td class="text-end">${formatCurrency(r.origen_total || 0)}</td>
          <td class="text-end">${formatCurrency(r.destino_total || 0)}</td>
          <td class="text-end">${formatCurrency(r.diferencia || 0)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary rc-btn-edit" data-id="${r.id}">Ver/Editar</button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  function resetForm() {
    setReconId(null);
    setStatusBadge("BORRADOR");
    setOficioValue("");
    el.rcFecha.value = "";
    el.rcTipo.value = "";
    el.rcEjercicio.value = "";
    el.rcMes.value = "";
    el.rcJustificacion.value = "";
    ["ORIGEN", "DESTINO"].forEach((side) => {
      const s = sideEls[side];
      if (!canSeeAllAreas()) {
        setSelectValue(s.dgeneral, CURRENT_DGENERAL_ID || "");
        setSelectValue(s.dauxiliar, CURRENT_DAUXILIAR_ID || "");
      } else {
        setSelectValue(s.dgeneral, "");
        setSelectValue(s.dauxiliar, "");
      }
      setSelectValue(s.programa, "");
      setSelectValue(s.fuente, "");
      setSelectValue(s.proyecto, "");
      s.clave.value = "";
      s.denominacion.value = "";
      s.objetivo.value = "";
      s.autorizado.value = "";
      s.porEjercer.value = "0.00";
      s.monto.value = "";
      s.autorizadoMod.value = "";
      clearTable(s.recursosBody);
      clearTable(s.metasBody);
      addResourceRow(side);
      addMetaRow(side);
    });
    ["firma-enlace-label", "firma-enlace-nombre", "firma-area-label", "firma-area-nombre", "firma-direccion-nombre"].forEach((id) => {
      const inp = document.getElementById(id);
      if (inp && !inp.disabled) inp.value = "";
    });
    updateTotals();
    scheduleQrRender();
    cargarInfoOficio(null);
  }

  async function loadRecon(id) {
    try {
      const data = await fetchJson(`${API}/api/reconducciones/${id}`, {
        headers: authHeaders(),
      });
      resetForm();
      setReconId(data?.cabecera?.id);
      setStatusBadge(data?.cabecera?.estatus || "BORRADOR");
      setOficioValue(data?.cabecera?.oficio || "");
      el.rcFecha.value = data?.cabecera?.fecha_elaboracion ? String(data.cabecera.fecha_elaboracion).slice(0, 10) : "";
      el.rcTipo.value = data?.cabecera?.tipo_movimiento || "";
      el.rcEjercicio.value = data?.cabecera?.ejercicio || "";
      if (data?.cabecera?.mes_pago_date) {
        const dt = new Date(data.cabecera.mes_pago_date);
        const mesKey = Object.keys(MONTHS).find((m) => MONTHS[m] === String(dt.getMonth() + 1).padStart(2, "0"));
        if (mesKey) el.rcMes.value = mesKey;
      }
      el.rcJustificacion.value = data?.cabecera?.justificacion || "";

      // Cargar firmantes
      if (document.getElementById("firma-enlace-label"))
        document.getElementById("firma-enlace-label").value = data?.cabecera?.firma_enlace_label || "";
      if (document.getElementById("firma-enlace-nombre"))
        document.getElementById("firma-enlace-nombre").value = data?.cabecera?.firma_enlace_nombre || "";
      if (document.getElementById("firma-area-label"))
        document.getElementById("firma-area-label").value = data?.cabecera?.firma_area_label || "";
      if (document.getElementById("firma-area-nombre"))
        document.getElementById("firma-area-nombre").value = data?.cabecera?.firma_area_nombre || "";
      if (document.getElementById("firma-direccion-nombre"))
        document.getElementById("firma-direccion-nombre").value = data?.cabecera?.firma_direccion_nombre || "";

      ["ORIGEN", "DESTINO"].forEach((side) => {
        const s = sideEls[side];
        const lado = (data?.lados || []).find((l) => String(l.lado).toUpperCase() === side);
        if (lado) {
          setSelectValue(s.dgeneral, lado.id_dgeneral || "");
          setSelectValue(s.dauxiliar, lado.id_dauxiliar || "");
          setSelectValue(s.programa, lado.id_programa || "");
          setSelectValue(s.fuente, lado.id_fuente || "");
          setSelectValue(s.proyecto, lado.id_proyecto || "");
          s.clave.value = lado.clave_proyecto || "";
          s.denominacion.value = lado.denominacion || "";
          s.objetivo.value = lado.objetivo || "";
        }
      });

      await Promise.all([updateSaldos("ORIGEN"), updateSaldos("DESTINO")]);

      ["ORIGEN", "DESTINO"].forEach((side) => {
        const s = sideEls[side];
        clearTable(s.recursosBody);
        const recursos = (data?.recursos || []).filter((r) => String(r.lado).toUpperCase() === side);
        if (recursos.length === 0) addResourceRow(side);
        recursos.forEach((r) => {
          const partida = state.maps.partidasById.get(Number(r.id_partida));
          const clave = partida?.clave || "";
          addResourceRow(side, {
            clave,
            partidaId: r.id_partida,
            monto: r.monto_movimiento,
            descripcion: r.concepto_partida || partida?.descripcion || "",
          });
        });
        clearTable(s.metasBody);
        const metas = (data?.metas || []).filter((m) => String(m.lado).toUpperCase() === side);
        if (metas.length === 0) addMetaRow(side);
        metas.forEach((m) => addMetaRow(side, m));
      });
      updateTotals();
      scheduleQrRender();
      cargarInfoOficio(state.reconId);
    } catch (err) {
      uiError(err.message || "Error cargando reconducción");
    }
  }

  // Búsqueda de reconducciones en el modal
  async function ejecutarBusquedaRecon() {
    const folio = (document.getElementById("buscar-recon-folio")?.value || "").trim();
    const estatus = (document.getElementById("buscar-recon-estatus")?.value || "").trim();
    const tipo = (document.getElementById("buscar-recon-tipo")?.value || "").trim();

    const loading = document.getElementById("buscar-recon-loading");
    const sinResultados = document.getElementById("buscar-recon-sin-resultados");
    const tbody = document.getElementById("buscar-recon-tbody");

    loading?.classList.remove("d-none");
    sinResultados?.classList.add("d-none");
    if (tbody) tbody.innerHTML = "";

    try {
      // Usa el endpoint existente GET /api/reconducciones que ya devuelve el listado
      const data = await fetchJson(`${API}/api/reconducciones`, { headers: authHeaders() });
      let rows = Array.isArray(data) ? data : [];

      // Filtrar localmente
      if (folio) rows = rows.filter((r) => String(r.oficio || r.id || "").toLowerCase().includes(folio.toLowerCase()));
      if (estatus) rows = rows.filter((r) => String(r.estatus || "").toUpperCase() === estatus);
      if (tipo) rows = rows.filter((r) => String(r.tipo_movimiento || "").toUpperCase() === tipo);

      if (!rows.length) {
        sinResultados?.classList.remove("d-none");
        return;
      }

      if (tbody) {
        tbody.innerHTML = rows.map((r) => `
          <tr>
            <td class="text-muted small">${r.id}</td>
            <td class="fw-semibold">${r.oficio || "—"}</td>
            <td>${formatDate(r.fecha_elaboracion)}</td>
            <td><span class="badge bg-light text-dark border">${r.tipo_movimiento || "—"}</span></td>
            <td><span class="badge ${
              r.estatus === "APLICADO" ? "bg-success" :
              r.estatus === "ENVIADO" ? "bg-primary" :
              r.estatus === "AUTORIZADO" ? "bg-info text-dark" :
              r.estatus === "CANCELADO" ? "bg-danger" : "bg-secondary"
            }">${r.estatus || "—"}</span></td>
            <td class="text-end">${formatCurrency(r.origen_total || 0)}</td>
            <td class="text-end">${formatCurrency(r.destino_total || 0)}</td>
            <td>
              <button class="btn btn-sm btn-outline-primary rc-btn-abrir-modal" data-id="${r.id}">
                <i class="bi bi-folder2-open me-1"></i>Abrir
              </button>
            </td>
          </tr>
        `).join("");
      }
    } catch (err) {
      uiError(err.message || "Error buscando reconducciones");
    } finally {
      loading?.classList.add("d-none");
    }
  }

  // Captura firmas vía Swal si faltan campos obligatorios
  async function ensureFirmasRecon() {
    const enlaceLabel = (document.getElementById("firma-enlace-label")?.value || "").trim();
    const enlaceNombre = (document.getElementById("firma-enlace-nombre")?.value || "").trim();
    const areaLabel = (document.getElementById("firma-area-label")?.value || "").trim();
    const areaNombre = (document.getElementById("firma-area-nombre")?.value || "").trim();
    const direccionNombre = (document.getElementById("firma-direccion-nombre")?.value || "").trim();

    // Si ya están todos los campos obligatorios, no pedir nada
    if (enlaceNombre && areaNombre && direccionNombre) {
      return { enlace_label: enlaceLabel, enlace_nombre: enlaceNombre, area_label: areaLabel, area_nombre: areaNombre, direccion_nombre: direccionNombre };
    }

    // Mostrar Swal para capturar los que faltan
    const html = `
      <div class="text-start">
        <p class="mb-2 text-muted small">Captura los datos de solicitante y firmantes para el dictamen:</p>
        <div class="row g-2">
          <div class="col-8">
            <label class="form-label small">Coordinación Administrativa (ENLACE SOLICITANTE)</label>
            <input type="text" class="form-control form-control-sm" id="swal_enlace_label" value="${enlaceLabel}" placeholder="Ej. COORDINACIÓN ADMINISTRATIVA">
          </div>
          <div class="col-4">
            <label class="form-label small">Firmante Enlace *</label>
            <input type="text" class="form-control form-control-sm" id="swal_enlace_nombre" value="${enlaceNombre}" placeholder="Nombre del firmante">
          </div>
        </div>
        <div class="row g-2 mt-2">
          <div class="col-8">
            <label class="form-label small">ÁREA SOLICITANTE</label>
            <input type="text" class="form-control form-control-sm" id="swal_area_label" value="${areaLabel}" placeholder="Ej. SUBDIRECCIÓN DE TECNOLOGÍAS...">
          </div>
          <div class="col-4">
            <label class="form-label small">Firmante Área *</label>
            <input type="text" class="form-control form-control-sm" id="swal_area_nombre" value="${areaNombre}" placeholder="Nombre del firmante">
          </div>
        </div>
        <div class="row g-2 mt-2">
          <div class="col-8">
            <label class="form-label small">Dirección Solicitante</label>
            <input type="text" class="form-control form-control-sm" disabled value="Se toma de NOMBRE DE LA DEPENDENCIA GENERAL">
          </div>
          <div class="col-4">
            <label class="form-label small">Firmante Dirección *</label>
            <input type="text" class="form-control form-control-sm" id="swal_direccion_nombre" value="${direccionNombre}" placeholder="Nombre del firmante">
          </div>
        </div>
      </div>`;

    const result = await Swal.fire({
      title: "Datos de Solicitante y Firmantes",
      html,
      width: 800,
      focusConfirm: false,
      confirmButtonText: "Guardar",
      showCancelButton: true,
      cancelButtonText: "Omitir",
      preConfirm: () => {
        const eNombre = (document.getElementById("swal_enlace_nombre")?.value || "").trim();
        const aNombre = (document.getElementById("swal_area_nombre")?.value || "").trim();
        const dNombre = (document.getElementById("swal_direccion_nombre")?.value || "").trim();
        if (!eNombre || !aNombre || !dNombre) {
          Swal.showValidationMessage("Los firmantes son obligatorios (Enlace, Área y Dirección)");
          return false;
        }
        return true;
      },
    });

    if (result.isConfirmed) {
      const vals = {
        enlace_label: (document.getElementById("swal_enlace_label")?.value || "").trim(),
        enlace_nombre: (document.getElementById("swal_enlace_nombre")?.value || "").trim(),
        area_label: (document.getElementById("swal_area_label")?.value || "").trim(),
        area_nombre: (document.getElementById("swal_area_nombre")?.value || "").trim(),
        direccion_nombre: (document.getElementById("swal_direccion_nombre")?.value || "").trim(),
      };
      // Llenar campos del formulario
      if (document.getElementById("firma-enlace-label")) document.getElementById("firma-enlace-label").value = vals.enlace_label;
      if (document.getElementById("firma-enlace-nombre")) document.getElementById("firma-enlace-nombre").value = vals.enlace_nombre;
      if (document.getElementById("firma-area-label")) document.getElementById("firma-area-label").value = vals.area_label;
      if (document.getElementById("firma-area-nombre")) document.getElementById("firma-area-nombre").value = vals.area_nombre;
      if (document.getElementById("firma-direccion-nombre")) document.getElementById("firma-direccion-nombre").value = vals.direccion_nombre;
      return vals;
    }

    // Si cancela, retorna los valores actuales (aunque estén vacíos)
    return { enlace_label: enlaceLabel, enlace_nombre: enlaceNombre, area_label: areaLabel, area_nombre: areaNombre, direccion_nombre: direccionNombre };
  }

  async function guardarRecon() {
    if (!validateHeader()) return;
    const oficioActual = state.reconId ? getOficioValue() : "";
    const firmas = await ensureFirmasRecon();
    const payload = {
      oficio: oficioActual ? oficioActual : null,
      fecha_elaboracion: el.rcFecha.value || null,
      tipo_movimiento: el.rcTipo.value || null,
      justificacion: el.rcJustificacion.value || null,
      ejercicio: numOrNull(el.rcEjercicio.value),
      mes_pago_date: buildMesPagoDate(),
      firma_enlace_label: firmas.enlace_label || null,
      firma_enlace_nombre: firmas.enlace_nombre || null,
      firma_area_label: firmas.area_label || null,
      firma_area_nombre: firmas.area_nombre || null,
      firma_direccion_nombre: firmas.direccion_nombre || null,
      lados: [collectLado("ORIGEN"), collectLado("DESTINO")],
      recursos: [...collectRecursos("ORIGEN"), ...collectRecursos("DESTINO")],
      metas: [...collectMetas("ORIGEN"), ...collectMetas("DESTINO")],
    };
    try {
      let resp = null;
      if (state.reconId) {
        resp = await fetchJson(`${API}/api/reconducciones/${state.reconId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
      } else {
        resp = await fetchJson(`${API}/api/reconducciones`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        setReconId(resp?.cabecera?.id);
        setStatusBadge(resp?.cabecera?.estatus || "BORRADOR");
        if (resp?.cabecera?.oficio) setOficioValue(resp.cabecera.oficio);
        cargarInfoOficio(resp?.cabecera?.id);
      }
      await loadRecientes();
      scheduleQrRender();
      uiSuccess("Reconducción guardada");
    } catch (err) {
      uiError(err.message || "Error guardando reconducción");
    }
  }

  async function enviarRecon() {
    if (!state.reconId) {
      uiWarn("Primero guarda el borrador");
      return;
    }
    if (!validateRecursos()) return;
    if (!validateJustificacion("enviar")) return;
    try {
      const resp = await fetchJson(`${API}/api/reconducciones/${state.reconId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      setStatusBadge(resp?.cabecera?.estatus || "ENVIADO");
      await loadRecientes();
      uiSuccess("Reconducción enviada");
    } catch (err) {
      uiError(err.message || "Error enviando reconducción");
    }
  }

  async function aplicarRecon() {
    if (!state.reconId) {
      uiWarn("Primero guarda el borrador");
      return;
    }
    if (!validateRecursos()) return;
    if (!validateTotales()) return;
    if (!validateSaldos()) return;
    if (!validateJustificacion("aplicar")) return;
    const ok = await uiConfirm("Se aplicará la reconducción y se generará el ledger");
    if (!ok) return;
    try {
      const resp = await fetchJson(`${API}/api/reconducciones/${state.reconId}/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ejercicio: numOrNull(el.rcEjercicio.value),
          mes_pago_date: buildMesPagoDate(),
        }),
      });
      setStatusBadge(resp?.cabecera?.estatus || "APLICADO");
      await loadRecientes();
      uiSuccess("Reconducción aplicada");
    } catch (err) {
      uiError(err.message || "Error aplicando reconducción");
    }
  }

  async function cancelarRecon() {
    if (!state.reconId) {
      uiWarn("Selecciona una reconducción");
      return;
    }
    let motivo = "";
    if (hasSwal()) {
      const r = await window.Swal.fire({
        title: "Cancelar reconducción",
        input: "text",
        inputLabel: "Motivo de cancelación",
        inputPlaceholder: "Motivo...",
        showCancelButton: true,
        confirmButtonText: "Cancelar",
        cancelButtonText: "Salir",
        confirmButtonColor: "#BC955C",
      });
      if (!r.isConfirmed) return;
      motivo = r.value || "";
    } else {
      const r = prompt("Motivo de cancelación");
      if (r === null) return;
      motivo = r || "";
    }
    try {
      const resp = await fetchJson(`${API}/api/reconducciones/${state.reconId}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ cancel_reason: motivo }),
      });
      setStatusBadge(resp?.cabecera?.estatus || "CANCELADO");
      await loadRecientes();
      uiSuccess("Reconducción cancelada");
    } catch (err) {
      uiError(err.message || "Error cancelando reconducción");
    }
  }

  function attachSideEvents(side) {
    const s = sideEls[side];
    const handleProyecto = () => {
      const id = Number(s.proyecto.value);
      const info = state.maps.proyectosById.get(id);
      if (info) {
        if (!s.clave.value) s.clave.value = info.clave || "";
        if (!s.denominacion.value) s.denominacion.value = info.descripcion || "";
      }
      updateSaldos(side);
    };
    [s.dgeneral, s.dauxiliar, s.fuente].forEach((sel) => {
      sel.addEventListener("change", () => updateSaldos(side));
    });
    s.proyecto.addEventListener("change", handleProyecto);
    s.autorizado.addEventListener("input", () => updateAutorizadoMod(side));
    s.monto.addEventListener("input", () => updateAutorizadoMod(side));
    s.btnAddRecurso.addEventListener("click", () => addResourceRow(side));
    s.btnDelRecurso.addEventListener("click", () => removeResourceRow(side));
    s.btnAddMeta.addEventListener("click", () => addMetaRow(side));
    s.btnDelMeta.addEventListener("click", () => removeMetaRow(side));
  }

  function bindEvents() {
    if (hasRecientes) {
      el.filtroEstatus.addEventListener("change", renderRecientes);
      el.tablaBody.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".rc-btn-edit");
        if (btn) loadRecon(btn.dataset.id);
      });
    }
    el.rcEjercicio.addEventListener("change", () => {
      updateSaldos("ORIGEN");
      updateSaldos("DESTINO");
    });
    el.rcMes.addEventListener("change", () => {
      updateSaldos("ORIGEN");
      updateSaldos("DESTINO");
    });
    el.rcTipo.addEventListener("change", updateActionButtons);
    el.rcJustificacion.addEventListener("input", updateActionButtons);
    el.btnGuardar.addEventListener("click", guardarRecon);
    el.btnEnviar.addEventListener("click", enviarRecon);
    el.btnAplicar.addEventListener("click", aplicarRecon);
    el.btnCancelar.addEventListener("click", cancelarRecon);
    attachSideEvents("ORIGEN");
    attachSideEvents("DESTINO");

    // Modal buscar reconducción
    document.getElementById("btn-buscar-recon")?.addEventListener("click", () => {
      modalBuscarRecon.show();
      ejecutarBusquedaRecon();
    });
    document.getElementById("btn-ejecutar-busqueda-recon")?.addEventListener("click", ejecutarBusquedaRecon);
    document.getElementById("buscar-recon-folio")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ejecutarBusquedaRecon();
    });
    // Click en botón "Abrir" dentro del modal
    document.getElementById("buscar-recon-tbody")?.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".rc-btn-abrir-modal");
      if (!btn) return;
      const id = btn.dataset.id;
      modalBuscarRecon.hide();
      await loadRecon(id);
    });
  }

  // =====================================================
  //  OFICIO PDF — Subida y descarga del oficio escaneado
  // =====================================================

  async function cargarInfoOficio(idReconduccion) {
    const card = document.getElementById("card-oficio-pdf");
    if (!idReconduccion) {
      card.classList.add("d-none");
      return;
    }
    card.classList.remove("d-none");
    try {
      const res = await fetch(`${API}/api/reconducciones/${idReconduccion}/oficio`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      actualizarUIOficio(data);
    } catch (e) {
      console.error("[OFICIO] Error cargando info:", e);
    }
  }

  function actualizarUIOficio(oficio) {
    const badge = document.getElementById("oficio-status-badge");
    const existente = document.getElementById("oficio-existente");
    const uploadArea = document.getElementById("oficio-upload-area");

    if (oficio && oficio.id) {
      badge.textContent = "Con oficio";
      badge.className = "badge bg-success";
      existente.classList.remove("d-none");
      uploadArea.classList.add("d-none");
      document.getElementById("oficio-nombre-archivo").textContent = oficio.nombre_archivo;
      const fecha = oficio.fecha_subida
        ? new Date(oficio.fecha_subida).toLocaleString("es-MX")
        : "—";
      document.getElementById("oficio-fecha-subida").textContent = `Subido: ${fecha}`;
    } else {
      badge.textContent = "Sin oficio";
      badge.className = "badge bg-secondary";
      existente.classList.add("d-none");
      uploadArea.classList.remove("d-none");
      document.getElementById("oficio-file-input").value = "";
      document.getElementById("btn-subir-oficio").disabled = true;
    }
  }

  async function subirOficio() {
    const idRc = state.reconId;
    if (!idRc) {
      uiWarn("Primero guarda la reconducción antes de subir el oficio.");
      return;
    }
    const fileInput = document.getElementById("oficio-file-input");
    const file = fileInput.files[0];
    if (!file) return;

    const progress = document.getElementById("oficio-upload-progress");
    const btn = document.getElementById("btn-subir-oficio");
    progress.classList.remove("d-none");
    btn.disabled = true;

    try {
      const formData = new FormData();
      formData.append("oficio", file);

      const res = await fetch(`${API}/api/reconducciones/${idRc}/oficio`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al subir el oficio");

      Swal.fire({ icon: "success", title: "PDF subido", text: "El oficio se guardó correctamente.", timer: 2000, showConfirmButton: false });
      actualizarUIOficio(data);
    } catch (e) {
      uiError(e.message || "Error al subir el oficio");
    } finally {
      progress.classList.add("d-none");
      btn.disabled = false;
    }
  }

  function bindOficioEvents() {
    document.getElementById("oficio-file-input").addEventListener("change", function () {
      document.getElementById("btn-subir-oficio").disabled = !this.files.length;
    });

    document.getElementById("btn-subir-oficio").addEventListener("click", subirOficio);

    document.getElementById("btn-descargar-oficio").addEventListener("click", () => {
      const idRc = state.reconId;
      if (!idRc) return;
      const token = getToken();
      const url = `${API}/api/reconducciones/${idRc}/oficio/descargar${token ? "?token=" + encodeURIComponent(token) : ""}`;
      window.open(url, "_blank");
    });

    document.getElementById("btn-reemplazar-oficio").addEventListener("click", () => {
      document.getElementById("oficio-existente").classList.add("d-none");
      document.getElementById("oficio-upload-area").classList.remove("d-none");
      document.getElementById("oficio-file-input").value = "";
      document.getElementById("btn-subir-oficio").disabled = true;
    });
  }

  async function init() {
    try {
      loadCurrentUser();
      const allow = await ensureReconAccess();
      if (!allow) return;
      await loadCatalogos();
      await loadSaldosGlobal();
      resetForm();
      bindEvents();
      bindOficioEvents();
      await loadRecientes();
      const params = new URLSearchParams(window.location.search);
      const id = Number(params.get("id"));
      if (Number.isFinite(id) && id > 0) await loadRecon(id);
    } catch (err) {
      uiError(err.message || "Error inicializando reconducciones");
    }
  }

  init();
})();
