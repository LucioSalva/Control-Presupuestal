(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const btnCancelar = document.getElementById("btn-cancelar");
  const btnConfirmarCancelar = document.getElementById("btnConfirmarCancelar");
  const btnConfirmarGuardar = document.getElementById("btnConfirmarGuardar");
  const detalleBody = document.getElementById("detalleBody");
  const alertaCancelado = document.getElementById("alertaCancelado");

  let modalCancelar = null;
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
        localStorage.getItem("cp_usuario") || sessionStorage.getItem("cp_usuario");
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

  // ✅ fetchJson con mensaje claro en 404
  async function fetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!r.ok) {
      if (r.status === 404) {
        throw new Error(`Ruta de API no encontrada: ${url}`);
      }
      const msg = data?.error || data?.message || `HTTP ${r.status} en ${url}`;
      throw new Error(msg);
    }
    return data;
  }

  function getQueryId() {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("id");
    return id ? String(id).trim() : "";
  }

  // ✅ Resolver robusto de id_comprometido:
  // 1) URL ?id=
  // 2) currentPayload.id_comprometido
  // 3) localStorage cp_last_comprometido (id / payload.id_comprometido)
  function resolveIdComprometido() {
    const fromUrl = Number(getQueryId() || 0);
    if (fromUrl > 0) return fromUrl;

    const fromPayload = Number(currentPayload?.id_comprometido || 0);
    if (fromPayload > 0) return fromPayload;

    try {
      const raw = localStorage.getItem("cp_last_comprometido");
      if (!raw) return 0;
      const obj = JSON.parse(raw);

      const a = Number(obj?.id || 0);
      if (a > 0) return a;

      const b = Number(obj?.payload?.id_comprometido || 0);
      if (b > 0) return b;

      const c = Number(obj?.payload?.id || 0);
      if (c > 0) return c;

      return 0;
    } catch {
      return 0;
    }
  }

  // ✅ Catálogo fuentes (id -> "clave - fuente")
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

  function verificarVigencia(fechaBase, estatus) {
    const st = String(estatus || "").toUpperCase();
    if (st === "CANCELADO" || st === "CANCELADO_VIGENCIA") {
      mostrarAlertaCancelado();
      deshabilitarFormulario();
      return false;
    }

    const f = new Date(fechaBase);
    const hoy = new Date();
    if (f.getMonth() !== hoy.getMonth() || f.getFullYear() !== hoy.getFullYear()) {
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
        r?.importe_comprometido ?? r?.importe_original ?? r?.importe
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
      `
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
    "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
    "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
    "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
  ];

  const decenas = [
    "", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA",
    "SESENTA", "SETENTA", "OCHENTA", "NOVENTA",
  ];

  const centenas = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS",
    "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
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

      payload.id_comprometido = Number(payload.id_comprometido || payload.id || id);

      localStorage.setItem(
        "cp_last_comprometido",
        JSON.stringify({
          id: String(payload.id_comprometido),
          payload,
          loaded_from: "api",
          loaded_at: new Date().toISOString(),
        })
      );

      return payload;
    }

    // fallback localStorage
    const raw = localStorage.getItem("cp_last_comprometido");
    if (!raw) throw new Error("No hay datos. Abre devengado.html?id=ID");

    const obj = JSON.parse(raw);
    const payload = obj?.payload || obj;
    if (!payload) throw new Error("No se encontró payload válido en cp_last_comprometido.");

    payload.id_comprometido = Number(payload.id_comprometido || obj?.id || 0);
    return payload;
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
        (payload?.folio_devengado ? String(payload.folio_devengado).padStart(6, "0") : "NUEVO")
    );

    setVal(
      "no_comprometido",
      payload?.no_comprometido ||
        payload?.folio_oficial_comprometido ||
        (payload?.folio_comprometido ? String(payload.folio_comprometido).padStart(6, "0") : "")
    );

    setVal("dependencia", payload?.dependencia || "");
    setVal("dependencia_aux", payload?.dependencia_aux || "");

    const fecha = formatFecha(
      payload?.fecha_devengado || payload?.fecha || new Date().toISOString().split("T")[0]
    );
    setVal("fecha", fecha);

    setVal("clave_programatica", payload?.clave_programatica || "");

    // FUENTE
    const idFuente = payload?.id_fuente != null ? String(payload.id_fuente) : "";
    setReadonlyVal("id_fuente", idFuente);

    let fuenteLabel = String(payload?.fuente_text || payload?.fuente || "").trim();
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
      (payload?.iva && payload?.subtotal ? safeNumber(payload.iva) / safeNumber(payload.subtotal) : 0.16);

    const det = Array.isArray(payload?.detalle) ? payload.detalle : [];
    const detNorm = det.map((d) => ({
      ...d,
      importe_comprometido: safeNumber(d?.importe_comprometido ?? d?.importe_original ?? d?.importe),
      importe: safeNumber(d?.importe ?? d?.importe_devengado ?? d?.importe_comprometido ?? d?.importe_original ?? 0),
    }));

    renderDetalle(detNorm);

    setVal("meta", payload?.meta || "");
    recalcularTotales();

    verificarVigencia(payload?.fecha_comprometido || payload?.fecha, payload?.estatus);

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
        importe_comprometido: safeNumber(original?.importe_comprometido ?? original?.importe_original ?? original?.importe),
      });
    });

    const montoDevengado = safeNumber(getVal("total"));
    const montoLiberado = montoComprometido - montoDevengado;
    const idComp = resolveIdComprometido();

    return {
      id_suficiencia: Number(currentPayload?.id_suficiencia || currentPayload?.id || 0) || null,
      id_comprometido: idComp > 0 ? idComp : null,
      fecha_devengado: getVal("fecha"),

      monto_comprometido: montoComprometido,
      monto_devengado: montoDevengado,
      monto_liberado: montoLiberado > 0 ? montoLiberado : 0,

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
      throw new Error("El monto a devengar no puede ser mayor al comprometido.");
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
        })
      );
    } catch {}

    return data;
  }

  // ⚠️ OJO: tu backend NO tiene cancelar en devengado.routes.js
  async function cancelarDocumento() {
    const id = getQueryId();
    if (!id) throw new Error("No se puede cancelar: ID no encontrado");

    // Si en tu server no existe esta ruta, dará 404.
    const data = await fetchJson(`${API}/api/devengado/${id}/cancelar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ motivo: "Cancelación manual por usuario" }),
    });

    return data;
  }

  async function generarPDF() {
    alert("Conecta aquí tu generador real de PDF (pdf-lib) para Devengado.");
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents() {
    modalCancelar = new bootstrap.Modal(document.getElementById("modalCancelar"));
    modalGuardar = new bootstrap.Modal(document.getElementById("modalGuardar"));

    btnGuardar?.addEventListener("click", (e) => {
      e.preventDefault();

      const montoDevengado = safeNumber(getVal("total"));
      const montoLiberado = montoComprometido - montoDevengado;

      if (montoDevengado > montoComprometido) {
        alert("El monto a devengar no puede ser mayor al monto comprometido.");
        return;
      }

      const infoLiberacion = document.getElementById("infoLiberacion");
      const montoLiberarSpan = document.getElementById("montoLiberar");

      if (infoLiberacion && montoLiberarSpan) {
        if (montoLiberado > 0) {
          infoLiberacion.style.display = "block";
          montoLiberarSpan.textContent = formatMoney(montoLiberado);
        } else {
          infoLiberacion.style.display = "none";
        }
      }

      modalGuardar.show();
    });

    btnConfirmarGuardar?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnConfirmarGuardar.disabled = true;

        const data = await guardarDevengado();
        modalGuardar.hide();

        if (data?.no_devengado) setVal("no_devengado", data.no_devengado);
        else if (data?.folio_num) setVal("no_devengado", String(data.folio_num).padStart(6, "0"));

        alert("Devengado guardado correctamente.");
      } catch (err) {
        console.error("[DEVENGADO] guardar:", err);
        alert(err?.message || "Error al guardar");
      } finally {
        btnConfirmarGuardar.disabled = false;
      }
    });

    btnCancelar?.addEventListener("click", (e) => {
      e.preventDefault();
      modalCancelar.show();
    });

    btnConfirmarCancelar?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnConfirmarCancelar.disabled = true;
        await cancelarDocumento();
        modalCancelar.hide();
        mostrarAlertaCancelado();
        deshabilitarFormulario();
        alert("Documento cancelado.");
      } catch (err) {
        console.error("[DEVENGADO] cancelar:", err);
        alert(err?.message || "Error al cancelar (revisa si existe la ruta /cancelar en el backend).");
      } finally {
        btnConfirmarCancelar.disabled = false;
      }
    });

    btnDescargarPdf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await generarPDF();
      } catch (err) {
        alert(err?.message || "Error generando PDF");
      }
    });

    btnRecargar?.addEventListener("click", async () => {
      try {
        const payload = await loadData();
        await renderPayload(payload);
      } catch (err) {
        alert(err?.message || "No se pudo recargar");
      }
    });

    document.querySelector('[name="monto_devengado"]')?.addEventListener("change", (e) => {
      const monto = safeNumber(e.target.value);
      if (monto > montoComprometido) {
        e.target.value = montoComprometido.toFixed(2);
        e.target.classList.add("monto-error");
      } else {
        e.target.classList.remove("monto-error");
      }
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    try {
      const payload = await loadData();
      await renderPayload(payload);
    } catch (err) {
      console.error("[DEVENGADO]", err);
      alert(err?.message || "No se pudieron cargar datos");
    }
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
