(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const btnCancelar = document.getElementById("btn-cancelar");
  const btnConfirmarGuardar = document.getElementById("btnConfirmarGuardar");
  const detalleBody = document.getElementById("detalleBody");
  const alertaCancelado = document.getElementById("alertaCancelado");

  const txtNoComprometido = document.getElementById("txtNoComprometido");
  const btnBuscarComprometido = document.getElementById(
    "btnBuscarComprometido",
  );
  const btnNuevoDevengado = document.getElementById("btnNuevoDevengado");
  const tbodyParcialidades = document.getElementById("tbodyParcialidades");

  const lblTotalComprometido = document.getElementById("lblTotalComprometido");
  const lblDevAcum = document.getElementById("lblDevAcum");
  const lblSaldo = document.getElementById("lblSaldo");

  let modalGuardar = null;

  // Estado
  let currentPayload = null;
  let montoComprometido = 0;

  // Tasas
  let tasaIVA = 0.16;
  let tasaISR = 0;

  // ---------------------------
  // AUTH
  // ---------------------------
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

  function getUser() {
    try {
      // ✅ tu sistema usa cp_usuario
      const raw =
        localStorage.getItem("cp_usuario") ||
        sessionStorage.getItem("cp_usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  const setVal = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? "";
  };

  const getVal = (name) => {
    const el = document.querySelector(`[name="${name}"]`);
    return el ? el.value : "";
  };

  function setReadonlyVal(name, value) {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el) return;
    el.value = value ?? "";
    el.readOnly = true;
  }

  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }

  function formatFecha(fecha) {
    const s = String(fecha || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes("T")) return s.split("T")[0];
    return s;
  }

  function formatMoney(num) {
    const n = Number(num) || 0;
    return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function setText(idEl, text) {
    if (!idEl) return;
    idEl.textContent = text;
  }

  function renderResumen({
    total_comprometido = 0,
    devengado_acumulado = 0,
    saldo_restante = 0,
  } = {}) {
    setText(lblTotalComprometido, formatMoney(total_comprometido));
    setText(lblDevAcum, formatMoney(devengado_acumulado));
    setText(lblSaldo, formatMoney(saldo_restante));
  }

  function renderParcialidades(rows = []) {
    if (!tbodyParcialidades) return;
    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) {
      tbodyParcialidades.innerHTML = `<tr><td colspan="5" class="text-center small text-muted">Sin parcialidades</td></tr>`;
      return;
    }

    tbodyParcialidades.innerHTML = arr
      .map((r) => {
        const est = String(r.estatus || "ACTIVO").toUpperCase();
        const disabled = est === "CANCELADO" ? "disabled" : "";
        return `
        <tr>
          <td class="text-nowrap">${String(r.no_devengado || "").trim()}</td>
          <td>${formatFecha(r.fecha)}</td>
          <td class="text-end">${formatMoney(r.total)}</td>
          <td>${est}</td>
          <td>
            <button class="btn btn-outline-danger btn-sm btn-cancelar-dev" data-id="${r.id}" ${disabled}>
              <i class="bi bi-x-circle me-1"></i>Cancelar
            </button>
          </td>
        </tr>
      `;
      })
      .join("");

    // bind cancelar
    tbodyParcialidades.querySelectorAll(".btn-cancelar-dev").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idDev = Number(btn.dataset.id || 0);
        if (!idDev) return;

        try {
          const res = await fetchJson(
            `${API}/api/devengado/${idDev}/cancelar`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...authHeaders() },
            },
          );
          if (res?.ok) {
            await refrescarResumenYParcialidades();
            await uiSuccess("Devengado cancelado.");
          }
        } catch (e) {
          await uiError(e?.message || "Error al cancelar devengado");
        }
      });
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
  const msg = data?.error || data?.message || `HTTP ${r.status} en ${url}`;
  if (r.status === 404 && !data) {
    throw new Error(`Ruta de API no encontrada: ${url}`);
  }
  throw new Error(msg);
}

    return data;
  }

  let qrTimer = null;

  function buildQrPayloadDev() {
    const folio = String(getVal("no_devengado") || "").trim();
    const folioComp = String(getVal("no_comprometido") || "").trim();
    const fecha = String(getVal("fecha") || "").trim();
    const dependencia = String(getVal("dependencia") || "").trim();
    const dependenciaAux = String(getVal("dependencia_aux") || "").trim();
    const total = safeNumber(getVal("total"));
    const cantidad = String(getVal("cantidad_con_letra") || "").trim();
    if (!folio && !fecha && !dependencia && !dependenciaAux && !folioComp) return "";
    return JSON.stringify({
      tipo: "DV",
      folio,
      folio_comprometido: folioComp,
      fecha,
      dependencia,
      dependencia_aux: dependenciaAux,
      total,
      cantidad_con_letra: cantidad,
    });
  }

  async function renderQrDev() {
    const container = document.getElementById("qr-dev");
    if (!container) return;
    const text = buildQrPayloadDev();
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
      renderQrDev();
    }, 120);
  }

  function hasSwal() {
    return typeof window !== "undefined" && !!window.Swal;
  }
  function uiAlert(message, icon = "info", title = "Aviso") {
    const msg = String(message ?? "");
    if (!hasSwal()) return alert(`${title}: ${msg}`);
    return window.Swal.fire({
      icon,
      title,
      text: msg,
      confirmButtonText: "Aceptar",
      confirmButtonColor: "#BC955C",
    });
  }
  function uiSuccess(message, title = "Listo") {
    return uiAlert(message, "success", title);
  }
  function uiError(message, title = "Error") {
    return uiAlert(message, "error", title);
  }
  function uiWarn(message, title = "Atención") {
    return uiAlert(message, "warning", title);
  }

  function getQueryId() {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("id");
    return id ? String(id).trim() : "";
  }

  let currentIdComp = 0;

  function resolveIdComprometido() {
    return Number(currentIdComp || 0);
  }

  // Catálogo fuentes (id -> "clave - fuente")
  async function loadFuentesMap() {
    const r = await fetch(`${API}/api/catalogos/fuentes`, {
      headers: { ...authHeaders() },
    });
    if (!r.ok) return {};
    const data = await r.json();
    const map = {};
    (data || []).forEach((x) => {
      map[String(x.id)] =
        `${String(x.clave ?? "").trim()} - ${String(x.fuente ?? "").trim()}`.trim();
    });
    return map;
  }

  // Catálogo dauxiliar (id -> dependencia)
  async function loadDauxiliarMap() {
    const r = await fetch(`${API}/api/catalogos/dauxiliar`, {
      headers: { ...authHeaders() },
    });
    if (!r.ok) return {};
    const data = await r.json();
    const map = {};
    (data || []).forEach((x) => {
      map[String(x.id)] = String(x.dependencia ?? "").trim();
    });
    return map;
  }

  // ---------------------------
  // Vigencia / Cancelado
  // ---------------------------
  function mostrarAlertaCancelado() {
    alertaCancelado?.classList.add("show");
  }

  function deshabilitarFormulario() {
    document.querySelectorAll(".input-editable").forEach((el) => {
      el.disabled = true;
      el.classList.remove("input-editable");
    });
    if (btnGuardar) btnGuardar.style.display = "none";
    if (btnCancelar) btnCancelar.style.display = "none";
  }

  async function applyIEPSPensionesPermissions() {
    try {
      const r = await fetch(`${API}/api/suficiencias/perm-ieps-pensiones`, {
        headers: { ...authHeaders() },
      });
      if (!r.ok) return;
      const data = await r.json().catch(() => ({}));
      const allowed = !!data?.allowed;
      if (allowed) return;
      const iepsInput = document.querySelector('[name="ieps"]');
      const row = iepsInput?.closest("tr");
      if (row) row.classList.add("d-none");
    } catch (e) {
      console.warn("[DEV] permisos IEPS/Pensiones:", e?.message || e);
    }
  }

  function verificarVigencia(fechaBase, estatus) {
    const st = String(estatus || "").toUpperCase();
    if (st === "CANCELADO" || st === "CANCELADO_VIGENCIA") {
      mostrarAlertaCancelado();
      deshabilitarFormulario();
      return false;
    }

    const f = new Date(fechaBase);
    const hoy = new Date();
    if (
      f.getMonth() !== hoy.getMonth() ||
      f.getFullYear() !== hoy.getFullYear()
    ) {
      mostrarAlertaCancelado();
      deshabilitarFormulario();
      return false;
    }
    return true;
  }

  // ---------------------------
  // Detalle
  // ---------------------------
  function renderDetalle(detalle = []) {
    if (!detalleBody) return;
    detalleBody.innerHTML = "";

    const rows = Array.isArray(detalle) ? detalle : [];
    if (!rows.length) {
      detalleBody.innerHTML = `
        <tr><td colspan="6" class="text-center small text-muted">Sin detalle cargado</td></tr>
      `;
      return;
    }

    rows.forEach((r, idx) => {
      const i = idx + 1;
      const importe = safeNumber(r?.importe).toFixed(2);
      const importeOriginal = safeNumber(
        r?.importe_comprometido ?? r?.importe_original ?? r?.importe,
      ).toFixed(2);

      detalleBody.insertAdjacentHTML(
        "beforeend",
        `
        <tr data-row="${idx}">
          <td style="width: 5%;">
            <input class="form-control form-control-sm as-text td-text input-no-click text-center" readonly value="${i}">
          </td>
          <td style="width: 12%;">
            <input class="form-control form-control-sm as-text td-text input-no-click" readonly value="${String(r?.clave ?? "").trim()}">
          </td>
          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click" readonly value="${String(r?.concepto_partida ?? "").trim()}">
          </td>
          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click" readonly value="${String(r?.justificacion ?? "").trim()}">
          </td>
          <td style="width: 33%;">
            <input class="form-control form-control-sm as-text td-text input-no-click" readonly value="${String(r?.descripcion ?? "").trim()}">
          </td>
          <td style="width: 10%;">
            <input type="number" step="0.01" min="0" max="${importeOriginal}"
              class="form-control form-control-sm as-text td-text text-end input-editable importe-devengado"
              name="importe_${idx}"
              data-original="${importeOriginal}"
              value="${importe}">
          </td>
        </tr>
      `,
      );
    });

    document.querySelectorAll(".importe-devengado").forEach((input) => {
      input.addEventListener("input", validarImporte);
      input.addEventListener("change", recalcularTotales);
    });
  }

  function validarImporte(e) {
    const input = e.target;
    const max = safeNumber(input.dataset.original);
    const value = safeNumber(input.value);

    if (value > max) {
      input.classList.add("monto-error");
      input.value = max.toFixed(2);
    } else {
      input.classList.remove("monto-error");
    }
  }

  function numeroALetras(num) {
    const n = Number(num) || 0;
    const entero = Math.floor(n);
    const centavos = Math.round((n - entero) * 100);

    const letras = convertirNumero(entero).trim();
    const cents = String(centavos).padStart(2, "0");

    // plural/singular
    const pesoTxt = entero === 1 ? "PESO" : "PESOS";

    return `${letras} ${pesoTxt} ${cents}/100 M.N.`
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  function convertirNumero(n) {
    if (n === 0) return "CERO";

    const unidades = [
      "",
      "UNO",
      "DOS",
      "TRES",
      "CUATRO",
      "CINCO",
      "SEIS",
      "SIETE",
      "OCHO",
      "NUEVE",
      "DIEZ",
      "ONCE",
      "DOCE",
      "TRECE",
      "CATORCE",
      "QUINCE",
      "DIECISÉIS",
      "DIECISIETE",
      "DIECIOCHO",
      "DIECINUEVE",
      "VEINTE",
    ];

    const decenas = [
      "",
      "",
      "VEINTE",
      "TREINTA",
      "CUARENTA",
      "CINCUENTA",
      "SESENTA",
      "SETENTA",
      "OCHENTA",
      "NOVENTA",
    ];

    const centenas = [
      "",
      "CIENTO",
      "DOSCIENTOS",
      "TRESCIENTOS",
      "CUATROCIENTOS",
      "QUINIENTOS",
      "SEISCIENTOS",
      "SETECIENTOS",
      "OCHOCIENTOS",
      "NOVECIENTOS",
    ];

    function seccion(n) {
      let out = "";

      if (n === 100) return "CIEN";

      const c = Math.floor(n / 100);
      const d = Math.floor((n % 100) / 10);
      const u = n % 10;
      const du = n % 100;

      if (c) out += centenas[c] + " ";

      if (du <= 20) {
        out += unidades[du];
        return out.trim();
      }

      if (d === 2) {
        out += "VEINTI" + (u ? unidades[u].toLowerCase() : "");
        return out.trim();
      }

      out += decenas[d];
      if (u) out += " Y " + unidades[u];

      return out.trim();
    }

    function miles(n) {
      if (n < 1000) return seccion(n);

      const m = Math.floor(n / 1000);
      const r = n % 1000;

      let out = "";
      if (m === 1) out += "MIL";
      else out += seccion(m) + " MIL";

      if (r) out += " " + seccion(r);

      return out.trim();
    }

    function millones(n) {
      if (n < 1000000) return miles(n);

      const m = Math.floor(n / 1000000);
      const r = n % 1000000;

      let out = "";
      if (m === 1) out += "UN MILLÓN";
      else out += miles(m) + " MILLONES";

      if (r) out += " " + miles(r);

      return out.trim();
    }

    return millones(n)
      .replace(/\bUNO\b/g, "UN")
      .replace(/\bVEINTIUNO\b/g, "VEINTIUN");
  }

  function validarMontoTotal(total) {
    const inputMonto = document.querySelector('[name="monto_devengado"]');
    if (total > montoComprometido) {
      inputMonto?.classList.add("monto-error");
      return false;
    } else {
      inputMonto?.classList.remove("monto-error");
      return true;
    }
  }

  function recalcularTotales() {
    let subtotal = 0;

    document.querySelectorAll(".importe-devengado").forEach((input) => {
      subtotal += safeNumber(input.value);
    });

    const iva = subtotal * tasaIVA;
    const isr = subtotal * tasaISR;
    const total = subtotal + iva - isr;

    setVal("subtotal", subtotal.toFixed(2));
    setVal("iva", iva.toFixed(2));
    setVal("isr", isr.toFixed(2));
    setVal("total", total.toFixed(2));

    setVal("monto_devengado", total.toFixed(2));
    setVal("cantidad_con_letra", numeroALetras(total));

    validarMontoTotal(total);
  }

  // ---------------------------
  // Cargar data
  // ---------------------------
  async function loadData() {
    const id = getQueryId();

    // ✅ Si viene id en URL, ese id es del COMPROMETIDO
    if (id) {
      // ✅ PRIMERO plural: /api/comprometidos/:id
      let resp = null;
      try {
        resp = await fetchJson(`${API}/api/comprometido/${id}`, {
          headers: { ...authHeaders() },
        });
      } catch (e) {
        // fallback singular: /api/comprometido/:id
        resp = await fetchJson(`${API}/api/comprometido/${id}`, {
          headers: { ...authHeaders() },
        });
      }

      const payload = resp?.data || resp?.payload || resp;
      if (!payload) throw new Error("No se encontró payload del Comprometido.");

      payload.id_comprometido = Number(
        payload.id_comprometido || payload.id || id,
      );

      localStorage.setItem(
        "cp_last_comprometido",
        JSON.stringify({
          id: String(payload.id_comprometido),
          payload,
          loaded_from: "api",
          loaded_at: new Date().toISOString(),
        }),
      );

      return payload;
    }

    // fallback localStorage
    const raw = localStorage.getItem("cp_last_comprometido");
    if (!raw) throw new Error("No hay datos. Abre devengado.html?id=ID");

    const obj = JSON.parse(raw);
    const payload = obj?.payload || obj;
    if (!payload)
      throw new Error("No se encontró payload válido en cp_last_comprometido.");

    payload.id_comprometido = Number(payload.id_comprometido || obj?.id || 0);
    return payload;
  }

  async function buscarComprometidoPorFolio(noComprometido) {
    const no = String(noComprometido || "").trim();
    if (!no) throw new Error("Escribe el No. de Comprometido");

    const data = await fetchJson(
      `${API}/api/comprometido/buscar?no=${encodeURIComponent(no)}`,
      {
        headers: { ...authHeaders() },
      },
    );

    // Normaliza a tu payload esperado por renderPayload
    const payload = data; // ya viene con detalle
    payload.id_comprometido = Number(data.id);
    payload.no_comprometido = data.no_comprometido;

    // este id_suficiencia es real para el backend devengado
    payload.id_suficiencia = Number(data.id_suficiencia);

    return payload;
  }

  async function buscarDevengadoPorFolio(noDevengado) {
    const no = String(noDevengado || "").trim();
    if (!no) throw new Error("Escribe el No. de Devengado");

    const data = await fetchJson(
      `${API}/api/devengado/buscar?no=${encodeURIComponent(no)}`,
      {
        headers: { ...authHeaders() },
      },
    );

    const payload = data;
    payload.id_devengado = Number(data.id);
    payload.id_comprometido = Number(data.id_comprometido);
    payload.no_devengado = data.no_devengado;
    return payload;
  }

  async function refrescarResumenYParcialidades() {
    if (!currentIdComp) return;

    // 1) resumen
    const resumen = await fetchJson(
      `${API}/api/comprometido/${currentIdComp}/resumen`,
      {
        headers: { ...authHeaders() },
      },
    );
    if (resumen?.ok) {
      renderResumen(resumen);
      // habilita nuevo devengado si hay saldo
      const saldo = safeNumber(resumen.saldo_restante);
      if (btnNuevoDevengado) btnNuevoDevengado.disabled = !(saldo > 0);
    }

    // 2) parcialidades
    const lista = await fetchJson(
      `${API}/api/devengado/por-comprometido/${currentIdComp}`,
      {
        headers: { ...authHeaders() },
      },
    );
    renderParcialidades(lista?.rows || []);
  }

  function limpiarParaNuevoDevengado() {
    // Folio devengado vuelve a NUEVO
    setVal("no_devengado", "NUEVO");

    // Poner importes en 0
    document.querySelectorAll(".importe-devengado").forEach((inp) => {
      inp.value = "0.00";
      inp.classList.remove("monto-error");
    });

    // recalcula
    recalcularTotales();
    updateDownloadLock();
  }

  // ---------------------------
  // Firmas
  // ---------------------------
  function updateFirmasSection(payload) {
    const spanArea = document.getElementById("firmaAreaSolicitante");
    const spanDireccion = document.getElementById("firmaDireccionSolicitante");

    if (spanArea) spanArea.textContent = payload?.dependencia_aux || "-";
    if (spanDireccion) spanDireccion.textContent = payload?.dependencia || "-";

    setVal("firma_area_nombre", payload?.firmante_area || "");
    setVal("firma_direccion_nombre", payload?.firmante_direccion || "");
    setVal("firma_suficiencia_nombre", payload?.firmante_coordinacion || "");

    scheduleQrRender();
  }

  // ---------------------------
  // Render payload
  // ---------------------------
  async function renderPayload(payload) {
    currentPayload = payload;

    setVal(
      "no_devengado",
      payload?.no_devengado ||
        payload?.folio_oficial_devengado ||
        (payload?.folio_devengado
          ? String(payload.folio_devengado).padStart(6, "0")
          : "NUEVO"),
    );

    setVal(
      "no_comprometido",
      payload?.no_comprometido ||
        payload?.folio_oficial_comprometido ||
        (payload?.folio_comprometido
          ? String(payload.folio_comprometido).padStart(6, "0")
          : ""),
    );

    setVal("dependencia", payload?.dependencia || "");
    setVal("dependencia_aux", payload?.dependencia_aux || payload?.departamento || "");
    if (!getVal("dependencia_aux")) {
      const idDa = payload?.id_dauxiliar != null ? String(payload.id_dauxiliar) : "";
      if (idDa) {
        if (!window.__dauxMap) window.__dauxMap = await loadDauxiliarMap();
        const depAux = window.__dauxMap[idDa] || "";
        setVal("dependencia_aux", depAux);
      }
    }

    const fecha = formatFecha(
      payload?.fecha_devengado ||
        payload?.fecha ||
        new Date().toISOString().split("T")[0],
    );
    setVal("fecha", fecha);

    setVal("clave_programatica", payload?.clave_programatica || "");

    // FUENTE
    const idFuente =
      payload?.id_fuente != null ? String(payload.id_fuente) : "";
    setReadonlyVal("id_fuente", idFuente);

    let fuenteLabel = String(
      payload?.fuente_text || payload?.fuente || "",
    ).trim();
    if (!fuenteLabel && idFuente) {
      if (!window.__fuentesMap) window.__fuentesMap = await loadFuentesMap();
      fuenteLabel = window.__fuentesMap[idFuente] || "";
    }
    setReadonlyVal("fuente_text", fuenteLabel);

    setVal("mes_pago", payload?.mes_pago || "");

    montoComprometido = safeNumber(payload?.total);
    setVal("monto_comprometido", formatMoney(montoComprometido));
    setVal("cantidad_pago", safeNumber(payload?.total).toFixed(2));

    const isrTasaRaw = payload?.isr_tasa || payload?.isr_rate || 0;
    tasaISR = isrTasaRaw > 1 ? isrTasaRaw / 100 : isrTasaRaw;

    tasaIVA =
      payload?.iva_rate ||
      (payload?.iva && payload?.subtotal
        ? safeNumber(payload.iva) / safeNumber(payload.subtotal)
        : 0.16);

    const det = Array.isArray(payload?.detalle) ? payload.detalle : [];
    const detNorm = det.map((d) => ({
      ...d,
      importe_comprometido: safeNumber(
        d?.importe_comprometido ?? d?.importe_original ?? d?.importe,
      ),
      importe: safeNumber(
        d?.importe ??
          d?.importe_devengado ??
          d?.importe_comprometido ??
          d?.importe_original ??
          0,
      ),
    }));

    renderDetalle(detNorm);

    setVal("meta", payload?.meta || "");
    recalcularTotales();

    verificarVigencia(
      payload?.fecha_comprometido || payload?.fecha,
      payload?.estatus,
    );

    updateFirmasSection(payload);
  }

  // ---------------------------
  // Build payload para guardar
  // ---------------------------
  function buildSavePayload() {
    getUser(); // no se usa directo por backend

    const detalle = [];
    document.querySelectorAll("#detalleBody tr").forEach((tr, idx) => {
      const importeInput = tr.querySelector(`[name="importe_${idx}"]`);
      const original = currentPayload?.detalle?.[idx] || {};
      const renglon = original?.no || original?.renglon || idx + 1;

      detalle.push({
        ...original,
        no: renglon,
        renglon: renglon,
        importe: safeNumber(importeInput?.value),
        importe_comprometido: safeNumber(
          original?.importe_comprometido ??
            original?.importe_original ??
            original?.importe,
        ),
      });
    });

    const montoDevengado = safeNumber(getVal("total"));
    const saldo = montoComprometido - montoDevengado;
    const idComp = resolveIdComprometido();

    return {
      id_suficiencia:
        Number(currentPayload?.id_suficiencia || currentPayload?.id || 0) ||
        null,
      id_comprometido: idComp > 0 ? idComp : null,
      fecha_devengado: getVal("fecha"),

      monto_comprometido: montoComprometido,
      monto_devengado: montoDevengado,

      firmante_area: getVal("firma_area_nombre"),
      firmante_direccion: getVal("firma_direccion_nombre"),
      firmante_coordinacion: getVal("firma_suficiencia_nombre"),

      subtotal: safeNumber(getVal("subtotal")),
      iva: safeNumber(getVal("iva")),
      isr: safeNumber(getVal("isr")),
      isr_tasa: tasaISR * 100,
      total: safeNumber(getVal("total")),
      cantidad_con_letra: getVal("cantidad_con_letra"),

      detalle,
    };
  }

  async function guardarDevengado() {
    const payload = buildSavePayload();

    if (!payload.id_comprometido || payload.id_comprometido <= 0) {
      throw new Error("Falta id_comprometido válido");
    }
    if (!payload.id_suficiencia || payload.id_suficiencia <= 0) {
      throw new Error("Falta id_suficiencia válido");
    }
    if (payload.monto_devengado > payload.monto_comprometido) {
      throw new Error(
        "El monto a devengar no puede ser mayor al comprometido.",
      );
    }

    // ✅ tu backend: POST /api/devengado
    const data = await fetchJson(`${API}/api/devengado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });

    try {
      localStorage.setItem(
        "cp_last_devengado",
        JSON.stringify({
          id_comprometido: payload.id_comprometido,
          payload,
          result: data,
          saved_at: new Date().toISOString(),
        }),
      );
    } catch {}

    return data;
  }

  function updateDownloadLock() {
    const val = String(getVal("no_devengado") || "").trim().toUpperCase();
    if (btnDescargarPdf) btnDescargarPdf.disabled = !val || val === "NUEVO";
  }

  const DEV_PDF_TEMPLATE_URL = "/PDF/devengado.pdf";
  async function fetchPdfTemplateBytesDev() {
    const r = await fetch(DEV_PDF_TEMPLATE_URL);
    if (!r.ok) throw new Error(`No se pudo cargar la plantilla PDF: ${DEV_PDF_TEMPLATE_URL}`);
    return await r.arrayBuffer();
  }

  async function generarPDF() {
    if (!window.PDFLib?.PDFDocument) {
      throw new Error("Falta pdf-lib. Revisa que el script de pdf-lib cargue antes.");
    }
    const normalizeCell = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    const sizeDG = 20;
    const sizeClaveProg = 9;
    const sizeFuenteClave = 7;
    const sizeFuenteNombre = 7;
    const sizeFecha = 7;
    const sizeFirmas = 7;
    const sizeFolios = 7;
    const sizeDetalle = 7;
    const sizeTotales = 7;
    const sizeCantidadLetra = 6;
    const sizeMeta = 7;

    const tplBytes = await fetchPdfTemplateBytesDev();
    const pdfDoc = await PDFLib.PDFDocument.load(tplBytes);
    const form = pdfDoc.getForm();

    // Helpers de escritura
    const setTextByPattern = (includesArray, value, size, align) => {
      try {
        const fields = form.getFields();
        const lowerInc = (includesArray || []).map((s) => String(s || "").toLowerCase());
        let wrote = 0;
        for (const f of fields) {
          const nm = String(f.getName() || "");
          const nmLower = nm.toLowerCase();
          const ok = lowerInc.every((frag) => nmLower.includes(frag));
          if (ok) {
            if (size != null) f.setFontSize(size);
            if (align != null && window.PDFLib?.TextAlignment) {
              f.setAlignment(align);
            }
            f.setText(String(value ?? ""));
            wrote++;
          }
        }
        if (wrote > 0) return true;
      } catch {}
      return false;
    };
    const setTextSafe = (name, value, size, align) => {
      try {
        const f = form.getFieldMaybe
          ? form.getFieldMaybe(name)
          : (() => {
              try {
                return form.getField(name);
              } catch {
                return null;
              }
            })();
        if (!f) return setTextByPattern([name], value, size, align);
        if (size != null) f.setFontSize(size);
        if (align != null && window.PDFLib?.TextAlignment) {
          f.setAlignment(align);
        }
        f.setText(String(value ?? ""));
      } catch {
        setTextByPattern([name], value, size, align);
      }
    };

    // Fuente Helvetica para apariencias
    try {
      const font =
        (PDFLib?.StandardFonts &&
          (await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica))) ||
        undefined;
      for (const f of form.getFields()) {
        try {
          const ac = f.getAcroField();
          if (ac) {
            const da = ac.getDefaultAppearance?.();
            if (da && font) ac.defaultUpdateAppearances(font);
          }
        } catch {}
      }
    } catch {}

    // Recolectar datos desde la UI
    const payload = {
      no_devengado: getVal("no_devengado"),
      no_comprometido: getVal("no_comprometido"),
      fecha: getVal("fecha"),
      dependencia: getVal("dependencia"),
      dependencia_aux: getVal("dependencia_aux"),
      fuente_text: getVal("fuente_text"),
      clave_programatica: getVal("clave_programatica"),
      mes_pago: getVal("mes_pago"),
      meta: getVal("meta"),
      subtotal: safeNumber(getVal("subtotal")),
      iva: safeNumber(getVal("iva")),
      isr: safeNumber(getVal("isr")),
      total: safeNumber(getVal("total")),
      cantidad_con_letra: getVal("cantidad_con_letra"),
    };
    // detalle desde la tabla visible
    const detalle = [];
    document.querySelectorAll("#detalleBody tr").forEach((tr, idx) => {
      const original = currentPayload?.detalle?.[idx] || {};
      const renglon = original?.no || original?.renglon || idx + 1;
      const inpImporte = tr.querySelector(`[name="importe_${idx}"]`);
      detalle.push({
        renglon,
        clave: String(original?.clave || "").trim(),
        concepto_partida: String(original?.concepto_partida || "").trim(),
        justificacion: String(original?.justificacion || "").trim(),
        descripcion: String(original?.descripcion || "").trim(),
        importe: safeNumber(inpImporte?.value ?? original?.importe),
      });
    });

    // Dependencias
    setTextByPattern(
      ["nombre", "dependencia", "general"],
      normalizeCell(payload.dependencia || ""),
      sizeDG,
      PDFLib?.TextAlignment?.Center,
    );
    setTextByPattern(
      ["clave", "programática"],
      normalizeCell(payload.clave_programatica || ""),
      sizeClaveProg,
      PDFLib?.TextAlignment?.Center,
    );
    const fuenteLabel = String(payload.fuente_text || "").trim();
    let fuenteClave = "";
    let fuenteDesc = fuenteLabel;
    if (fuenteLabel.includes(" - ")) {
      const [c, ...rest] = fuenteLabel.split(" - ");
      fuenteClave = String(c || "").trim();
      fuenteDesc = rest.join(" - ").trim();
    }
    setTextByPattern(["fuente", "financiamiento"], fuenteClave, sizeFuenteClave, PDFLib?.TextAlignment?.Center);
    setTextByPattern(["nombre", "f.f"], fuenteDesc, sizeFuenteNombre, PDFLib?.TextAlignment?.Center);

    try {
      const iso = payload.fecha;
      const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-") : ["", "", ""];
      setTextByPattern(["fechadia"], d, sizeFecha);
      setTextByPattern(["fechames"], m, sizeFecha);
      setTextByPattern(["fechayear"], y, sizeFecha);
    } catch {}

    // Firmas — capturar como en Suficiencia/Comprometido
    const roles = await (async () => {
      const getRolesStore = () => {
        try {
          const raw = localStorage.getItem("cp_dev_firmas") || "{}";
          const obj = JSON.parse(raw);
          return {
            area_firma: "",
            direccion_firma: "",
            coordinacion_firma: "",
            ...(obj && typeof obj === "object" ? obj : {}),
          };
        } catch {
          return {
            area_firma: "",
            direccion_firma: "",
            coordinacion_firma: "",
          };
        }
      };
      const saveRolesStore = (map) => {
        try {
          localStorage.setItem("cp_dev_firmas", JSON.stringify(map || {}));
        } catch {}
      };
      const roles = getRolesStore();
      const fallback = {
        area_firma: getVal("firma_area_nombre"),
        direccion_firma: getVal("firma_direccion_nombre"),
        coordinacion_firma: getVal("firma_suficiencia_nombre"),
      };
      const missing = [
        "area_firma",
        "direccion_firma",
        "coordinacion_firma",
      ].filter((k) => !String(roles[k] || "").trim());
      if (!window.Swal || !missing.length) {
        return {
          area_firma: roles.area_firma || fallback.area_firma,
          direccion_firma: roles.direccion_firma || fallback.direccion_firma,
          coordinacion_firma: roles.coordinacion_firma || fallback.coordinacion_firma,
        };
      }
      const html = `
        <div class="text-start">
          <p class="mb-2">Captura firmantes (Devengado):</p>
          <div class="row g-2">
            <div class="col-8">
              <label class="form-label small">Coordinación Administrativa (ÁREA SOLICITANTE)</label>
              <input id="dlg_firma_area" class="form-control form-control-sm" value="${String(roles.area_firma || fallback.area_firma || "").replace(/"/g, "&quot;")}">
            </div>
            <div class="col-8">
              <label class="form-label small">Dirección de Área</label>
              <input id="dlg_firma_dir" class="form-control form-control-sm" value="${String(roles.direccion_firma || fallback.direccion_firma || "").replace(/"/g, "&quot;")}">
            </div>
            <div class="col-8">
              <label class="form-label small">Coordinación de Suficiencia Presupuestal</label>
              <input id="dlg_firma_suf" class="form-control form-control-sm" value="${String(roles.coordinacion_firma || fallback.coordinacion_firma || "").replace(/"/g, "&quot;")}">
            </div>
          </div>
        </div>
      `;
      const result = await window.Swal.fire({
        title: "Firmantes del Devengado",
        html,
        focusConfirm: false,
        confirmButtonText: "Usar firmantes",
        cancelButtonText: "Cancelar",
        showCancelButton: true,
        confirmButtonColor: "#198754",
      });
      if (!result.isConfirmed) {
        return {
          area_firma: roles.area_firma || fallback.area_firma,
          direccion_firma: roles.direccion_firma || fallback.direccion_firma,
          coordinacion_firma: roles.coordinacion_firma || fallback.coordinacion_firma,
        };
      }
      const c = window.Swal.getHtmlContainer();
      roles.area_firma =
        c?.querySelector("#dlg_firma_area")?.value || fallback.area_firma;
      roles.direccion_firma =
        c?.querySelector("#dlg_firma_dir")?.value || fallback.direccion_firma;
      roles.coordinacion_firma =
        c?.querySelector("#dlg_firma_suf")?.value || fallback.coordinacion_firma;
      saveRolesStore(roles);
      return roles;
    })();

    // Escribir firmantes en el PDF (patrones amplios)
    try {
      const center = PDFLib?.TextAlignment?.Center;
      roles.area_firma && setTextByPattern(["firm", "area"], roles.area_firma, sizeFirmas, center);
      roles.direccion_firma && setTextByPattern(["firm", "direc"], roles.direccion_firma, sizeFirmas, center);
      roles.coordinacion_firma && setTextByPattern(["firm", "coor"], roles.coordinacion_firma, sizeFirmas, center);
    } catch {}

    // Folios
    setTextByPattern(["no", "devengado"], String(payload.no_devengado || ""), sizeFolios, PDFLib?.TextAlignment?.Center);
    setTextByPattern(["no", "comprometido"], String(payload.no_comprometido || ""), sizeFolios, PDFLib?.TextAlignment?.Center);
    setTextByPattern(["ref", "comprometido"], String(payload.no_comprometido || ""), sizeFolios, PDFLib?.TextAlignment?.Center);

    // Detalle
    const MAX_ROWS = 20;
    const rows = Array.isArray(detalle) ? detalle.slice(0, MAX_ROWS) : [];
    const padLines = (arr, max) => {
      const out = arr.slice(0, max);
      while (out.length < max) out.push("");
      return out;
    };
    const cut = (v, max) => {
      const s = normalizeCell(v);
      if (!max || s.length <= max) return s;
      return s.slice(0, max);
    };
    const linesNo = padLines(rows.map((r, i) => String(r?.renglon ?? i + 1)), MAX_ROWS);
    const linesClave = padLines(rows.map((r) => cut(String(r?.clave || ""), 12)), MAX_ROWS);
    const linesConcepto = padLines(rows.map((r) => cut(String(r?.concepto_partida || ""), 44)), MAX_ROWS);
    const linesJust = padLines(rows.map((r) => cut(String(r?.justificacion || ""), 52)), MAX_ROWS);
    const linesDesc = padLines(rows.map((r) => cut(String(r?.descripcion || ""), 52)), MAX_ROWS);
    const linesImp = padLines(rows.map((r) => safeNumber(r?.importe).toFixed(2)), MAX_ROWS);

    setTextSafe("No", linesNo.join("\n"), sizeDetalle);
    setTextSafe("CLAVE", linesClave.join("\n"), sizeDetalle);
    setTextSafe("CONCEPTO DE PARTIDA", linesConcepto.join("\n"), sizeDetalle);
    setTextSafe("JUSTIFICACIÓN", linesJust.join("\n"), sizeDetalle);
    setTextSafe("DESCRIPCIÓN", linesDesc.join("\n"), sizeDetalle);
    setTextSafe("IMPORTE", linesImp.join("\n"), sizeDetalle);

    // Totales y meta
    setTextSafe("subtotal", safeNumber(payload.subtotal).toFixed(2), sizeTotales, PDFLib?.TextAlignment?.Right);
    setTextSafe("IVA", safeNumber(payload.iva).toFixed(2), sizeTotales, PDFLib?.TextAlignment?.Right);
    setTextSafe("ISR", safeNumber(payload.isr).toFixed(2), sizeTotales, PDFLib?.TextAlignment?.Right);
    setTextSafe("total", safeNumber(payload.total).toFixed(2), sizeTotales, PDFLib?.TextAlignment?.Right);
    setTextSafe("CANTIDAD CON LETRA:", payload.cantidad_con_letra || "", sizeCantidadLetra);
    setTextSafe("Meta", payload.meta || "", sizeMeta);

    try {
      const fields = form.getFields();
      const setSizeByName = (name, size) => {
        try {
          const f = form.getTextField(name);
          if (typeof f.setFontSize === "function") f.setFontSize(size);
        } catch {}
      };
      const setSizeByNames = (names, size) => {
        for (const nm of names || []) setSizeByName(nm, size);
      };
      const setSizeByPattern = (frags, size) => {
        const lowerFrags = (frags || []).map((s) => String(s || "").toLowerCase());
        for (const f of fields) {
          try {
            const nm = String(f.getName() || "");
            const nmLower = nm.toLowerCase();
            if (lowerFrags.every((frag) => nmLower.includes(frag))) {
              if (typeof f.setFontSize === "function") f.setFontSize(size);
            }
          } catch {}
        }
      };
      setSizeByPattern(["dependencia", "general"], sizeDG);
      setSizeByPattern(["clave", "programática"], sizeClaveProg);
      setSizeByPattern(["fuente", "financiamiento"], sizeFuenteClave);
      setSizeByPattern(["nombre", "f.f"], sizeFuenteNombre);
      setSizeByPattern(["fechadia"], sizeFecha);
      setSizeByPattern(["fechames"], sizeFecha);
      setSizeByPattern(["fechayear"], sizeFecha);
      setSizeByPattern(["firma"], sizeFirmas);
      setSizeByPattern(["no", "devengado"], sizeFolios);
      setSizeByPattern(["no", "comprometido"], sizeFolios);
      setSizeByPattern(["ref", "comprometido"], sizeFolios);
      setSizeByPattern(["subtotal"], sizeTotales);
      setSizeByPattern(["iva"], sizeTotales);
      setSizeByPattern(["isr"], sizeTotales);
      setSizeByPattern(["total"], sizeTotales);
      setSizeByPattern(["cantidad", "letra"], sizeCantidadLetra);
      setSizeByPattern(["meta"], sizeMeta);
      setSizeByNames(
        [
          "CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
          "CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA",
        ],
        sizeClaveProg,
      );
      setSizeByNames(["FUENTE DE FINANCIAMIENTO"], sizeFuenteClave);
      setSizeByNames(["NOMBRE F.F"], sizeFuenteNombre);
      setSizeByNames(["fechadia", "fechames", "fechayear"], sizeFecha);
      setSizeByNames(
        [
          "No",
          "CLAVE",
          "CONCEPTO DE PARTIDA",
          "JUSTIFICACIÓN",
          "DESCRIPCIÓN",
          "IMPORTE",
        ],
        sizeDetalle,
      );
      setSizeByNames(["subtotal", "IVA", "ISR", "total"], sizeTotales);
      setSizeByNames(["CANTIDAD CON LETRA:", "Meta"], sizeCantidadLetra);
      setSizeByNames(["Meta"], sizeMeta);
    } catch {}

    try {
      const font =
        (PDFLib?.StandardFonts &&
          (await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica))) ||
        undefined;
      form.updateFieldAppearances(font);
    } catch {}

    try {
      form.flatten();
    } catch (e) {
      console.warn("[DV][PDF] flatten falló:", e?.message || e);
    }

    try {
      const qrText = buildQrPayloadDev();
      if (qrText && window.QRCode?.toDataURL) {
        const dataUrl = await window.QRCode.toDataURL(qrText, {
          width: 330,
          margin: 1,
        });
        const bytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
        const img = await pdfDoc.embedPng(bytes);
        const page = pdfDoc.getPages()[0];
        const size = 110;
        const x = page.getWidth() - size - 135;
        const y = page.getHeight() - size - 240;
        page.drawImage(img, { x, y, width: size, height: size });
      }
    } catch {}

    const outBytes = await pdfDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fname = String(getVal("no_devengado") || "devengado").trim() || "devengado";
    a.download = `${fname}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents() {
    
    modalGuardar = new bootstrap.Modal(document.getElementById("modalGuardar"));

    btnGuardar?.addEventListener("click", (e) => {
      e.preventDefault();

      const montoDevengado = safeNumber(getVal("total"));
      const saldo = montoComprometido - montoDevengado;

      if (montoDevengado > montoComprometido) {
        uiWarn("El monto a devengar no puede ser mayor al monto comprometido.");
        return;
      }

      const infoLiberacion = document.getElementById("infoLiberacion");
      const montoLiberarSpan = document.getElementById("montoLiberar");

      if (infoLiberacion && montoLiberarSpan) {
        if (saldo > 0) {
          infoLiberacion.style.display = "block";
          montoLiberarSpan.textContent = formatMoney(saldo);
        } else {
          infoLiberacion.style.display = "none";
        }
      }

      modalGuardar.show();
    });

    document.addEventListener("input", scheduleQrRender);
    document.addEventListener("change", scheduleQrRender);

    btnConfirmarGuardar?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnConfirmarGuardar.disabled = true;

        const data = await guardarDevengado();
        modalGuardar.hide();

        if (data?.no_devengado) setVal("no_devengado", data.no_devengado);
        else if (data?.folio_num)
          setVal("no_devengado", String(data.folio_num).padStart(6, "0"));

        updateDownloadLock();
        scheduleQrRender();
        await uiSuccess("Devengado guardado correctamente.");
        await refrescarResumenYParcialidades();
      } catch (err) {
        console.error("[DEVENGADO] guardar:", err);
        await uiError(err?.message || "Error al guardar");
      } finally {
        btnConfirmarGuardar.disabled = false;
      }
    });

    btnDescargarPdf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const noDev = String(getVal("no_devengado") || "").trim().toUpperCase();
        if (!noDev || noDev === "NUEVO") {
          await uiWarn("Primero guarda el Devengado para poder descargar el PDF.", "PDF");
          return;
        }
        await generarPDF();
      } catch (err) {
        await uiError(err?.message || "Error generando PDF", "PDF");
      }
    });

    btnRecargar?.addEventListener("click", async () => {
      try {
        if (!currentIdComp)
          throw new Error("Primero busca un No. de Comprometido.");
        await refrescarResumenYParcialidades();
      } catch (err) {
        await uiError(err?.message || "No se pudo recargar");
      }
    });

    document
      .querySelector('[name="monto_devengado"]')
      ?.addEventListener("change", (e) => {
        const monto = safeNumber(e.target.value);
        if (monto > montoComprometido) {
          e.target.value = montoComprometido.toFixed(2);
          e.target.classList.add("monto-error");
        } else {
          e.target.classList.remove("monto-error");
        }
      });

    btnBuscarComprometido?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnBuscarComprometido.disabled = true;

        const folio = String(txtNoComprometido.value || "").trim().toUpperCase();
        if (!/^ECA-\d{4}-\d{2}-(CP|DV)-\d{4}$/.test(folio)) {
          await uiWarn("Escribe un folio completo: ECA-YYYY-MM-CP-#### o ECA-YYYY-MM-DV-####");
          return;
        }

        let payload = null;
        if (/-DV-/.test(folio)) {
          payload = await buscarDevengadoPorFolio(folio);
          currentIdComp = Number(payload.id_comprometido);
          setVal("no_devengado", payload.no_devengado || "");
        } else {
          payload = await buscarComprometidoPorFolio(folio);
          currentIdComp = Number(payload.id_comprometido);
          setVal("no_devengado", "NUEVO");
        }

        await renderPayload(payload);
        await refrescarResumenYParcialidades();
        updateDownloadLock();

        // guardamos último comprometido buscado
        localStorage.setItem(
          "cp_last_comprometido",
          JSON.stringify({
            id: String(currentIdComp),
            payload,
            loaded_from: /-DV-/.test(folio) ? "buscar_devengado" : "buscar_comprometido",
            loaded_at: new Date().toISOString(),
          }),
        );
      } catch (err) {
        await uiError(err?.message || "No se pudo buscar el comprometido");
      } finally {
        btnBuscarComprometido.disabled = false;
      }
    });

    btnNuevoDevengado?.addEventListener("click", (e) => {
      e.preventDefault();
      limpiarParaNuevoDevengado();
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    bindEvents();
    await applyIEPSPensionesPermissions();
    if (btnCancelar) btnCancelar.style.display = "none";
    if (btnDescargarPdf) btnDescargarPdf.type = "button";
    updateDownloadLock();
    renderResumen({
      total_comprometido: 0,
      devengado_acumulado: 0,
      saldo_restante: 0,
    });
    scheduleQrRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
