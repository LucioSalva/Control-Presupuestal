// public/js/comprometido.js
(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const detalleBody = document.getElementById("detalleBody");

  const tipoDocumento = window.location.pathname.includes("devengado") ? "DV" : "CP";

  // ---------------------------
  // AUTH
  // ---------------------------
  const getToken = () =>
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    "";

  const authHeaders = () => {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const $byName = (name) => document.querySelector(`[name="${name}"]`);

  const setVal = (name, value) => {
    const el = $byName(name);
    if (!el) return;
    el.value = value ?? "";
  };

  const setReadonlyVal = (name, value) => {
    const el = $byName(name);
    if (!el) return;
    el.value = value ?? "";
    el.readOnly = true;
  };

  function setTextById(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value ?? "";
  }

  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
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

  function getQueryId() {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("id");
    return id ? String(id).trim() : "";
  }

  function formatFecha(fecha) {
    const s = String(fecha || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes("T")) return s.split("T")[0];
    return s;
  }

  function formatFolio(raw) {
    const str = String(raw ?? "").trim();
    if (!str) return "";
    // Si viene estilo ECA-01-SP-0004, cambia SP por CP/DV dependiendo pantalla
    if (str.includes("-")) {
      return str.replace(/-(SP|CP|DV)-/, `-${tipoDocumento}-`);
    }
    if (/^\d+$/.test(str)) return str.padStart(6, "0");
    return str;
  }

  // ---------------------------
// SweetAlert2 helpers (reemplazo de alert())
// ---------------------------
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

function uiConfirm({ title = "Confirmar", html = "", confirmText = "Sí", cancelText = "Cancelar" } = {}) {
  if (!hasSwal()) return Promise.resolve(confirm(`¿${title}?`));

  return window.Swal.fire({
    icon: "question",
    title,
    html,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonColor: "#BC955C",
    cancelButtonColor: "#6c757d",
  }).then((r) => !!r.isConfirmed);
}

  // ---------------------------
  // Catálogos (para mostrar texto bonito)
  // ---------------------------
  let proyectosById = {}; // { [id]: "0108050103 E - Innovación gubernamental..." }
  let fuentesById = {};   // { [id]: "110101 - INGRESOS PROPIOS..." }

  async function loadCatalogos() {
    // Ojo: tus endpoints ya existen porque en suficiencia los usas:
    // /api/catalogos/proyectos
    // /api/catalogos/fuentes
    const [proys, fuents] = await Promise.all([
      fetchJson(`${API}/api/catalogos/proyectos`, { headers: { ...authHeaders() } }),
      fetchJson(`${API}/api/catalogos/fuentes`,   { headers: { ...authHeaders() } }),
    ]);

    proyectosById = {};
    (Array.isArray(proys) ? proys : []).forEach((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;

      const clave = String(p.clave ?? "").trim();
      const conac = String(p.conac ?? "").trim();
      const desc  = String(p.descripcion ?? "").trim();

      const claveConac = conac ? `${clave} ${conac}` : clave;
      const label = `${claveConac} - ${desc}`.trim();
      proyectosById[id] = label;
    });

    fuentesById = {};
    (Array.isArray(fuents) ? fuents : []).forEach((f) => {
      const id = Number(f.id);
      if (!Number.isFinite(id)) return;

      const clave = String(f.clave ?? "").trim();
      const fuente = String(f.fuente ?? f.descripcion ?? "").trim();
      const label = `${clave} - ${fuente}`.trim();
      fuentesById[id] = label;
    });
  }

  function getProyectoLabel(idProyecto) {
    const id = Number(idProyecto);
    return Number.isFinite(id) ? (proyectosById[id] || "") : "";
  }

  function getFuenteLabel(idFuente) {
    const id = Number(idFuente);
    return Number.isFinite(id) ? (fuentesById[id] || "") : "";
  }

  // ---------------------------
  // Render DETALLE
  // ---------------------------
  function renderDetalle(detalle = []) {
    if (!detalleBody) return;
    detalleBody.innerHTML = "";

    const rows = Array.isArray(detalle) ? detalle : [];
    if (!rows.length) {
      detalleBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center small text-muted">Sin detalle cargado</td>
        </tr>
      `;
      return;
    }

    rows.forEach((r, idx) => {
      const i = idx + 1;
      const importe = safeNumber(r?.importe).toFixed(2);

      detalleBody.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td style="width: 5%;">
            <input class="form-control form-control-sm as-text td-text input-no-click text-center"
              readonly value="${i}">
          </td>
          <td style="width: 12%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.clave ?? "").trim()}">
          </td>
          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.concepto_partida ?? "").trim()}">
          </td>
          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.justificacion ?? "").trim()}">
          </td>
          <td style="width: 33%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.descripcion ?? "").trim()}">
          </td>
          <td style="width: 10%;">
            <input class="form-control form-control-sm as-text td-text input-no-click text-end"
              readonly value="${importe}">
          </td>
        </tr>
        `
      );
    });
  }

  // ---------------------------
  // Impuestos (solo lectura)
  // ---------------------------
  function setImpuestoTipo(tipo) {
    const t = String(tipo || "NONE").toUpperCase();
    const radios = document.querySelectorAll(`input[name="impuesto_tipo"]`);
    radios.forEach((r) => {
      r.checked = String(r.value).toUpperCase() === t;
      r.disabled = true;
    });

    const isr = $byName("isr_tasa");
    const ieps = $byName("ieps_tasa");
    if (isr) isr.readOnly = true;
    if (ieps) ieps.readOnly = true;
  }

  // ---------------------------
  // Normaliza payload
  // ---------------------------
  function normalizePayload(p) {
    const payload = p || {};
    return {
      id: payload.id ?? null,

      // folios
      no_suficiencia: payload.no_suficiencia ?? payload.folio_suficiencia ?? "",
      no_comprometido: payload.no_comprometido ?? "",

      fecha: formatFecha(payload.fecha),
      dependencia: payload.dependencia ?? "",
      dependencia_aux: payload.dependencia_aux ?? payload.departamento ?? "",

      id_dgeneral: payload.id_dgeneral ?? null,
      id_dauxiliar: payload.id_dauxiliar ?? null,

      id_proyecto: payload.id_proyecto ?? null,
      id_fuente: payload.id_fuente ?? null,

      clave_programatica: payload.clave_programatica ?? "",
      mes_pago: payload.mes_pago ?? "",

      meta: payload.meta ?? payload.justificacion_general ?? "",

      subtotal: safeNumber(payload.subtotal),
      iva: safeNumber(payload.iva),
      isr: safeNumber(payload.isr),
      ieps: safeNumber(payload.ieps),
      total: safeNumber(payload.total),
      cantidad_pago: safeNumber(payload.cantidad_pago ?? payload.total),

      cantidad_con_letra: payload.cantidad_con_letra ?? "",
      impuesto_tipo: payload.impuesto_tipo ?? "NONE",
      isr_tasa: payload.isr_tasa ?? "",
      ieps_tasa: payload.ieps_tasa ?? "",

      detalle: Array.isArray(payload.detalle) ? payload.detalle : [],

      // para link a devengado
      id_comprometido: payload.id_comprometido ?? null,
    };
  }

  // ---------------------------
  // Cargar data (API o LocalStorage)
  // ---------------------------
  async function loadData() {
    const id = getQueryId();

    if (id) {
      try {
        const data = await fetchJson(`${API}/api/comprometido/por-suficiencia/${id}`, {
          headers: { ...authHeaders() },
        });

        const payload = data && data.data ? data.data : data;

        // cache para fallback
        localStorage.setItem(
          "cp_last_suficiencia",
          JSON.stringify({
            id,
            payload,
            loaded_from: "api",
            loaded_at: new Date().toISOString(),
          })
        );

        return payload;
      } catch (e) {
        console.warn("[COMPROMETIDO] API falló, usando LocalStorage:", e.message);
      }
    }

    const raw = localStorage.getItem("cp_last_suficiencia");
    if (!raw) {
      throw new Error("No hay datos. Primero guarda una Suficiencia o abre comprometido.html?id=XXX");
    }

    const obj = JSON.parse(raw);
    if (!obj || !obj.payload) throw new Error("cp_last_suficiencia no contiene payload válido.");

    return obj.payload;
  }

  // ---------------------------
  // Render principal (sin selects, todo readonly)
  // ---------------------------
  function renderPayload(rawPayload) {
    const payload = normalizePayload(rawPayload);

    // folio comprometido (si aún no existe, queda vacío)
    setReadonlyVal("no_comprometido", payload.no_comprometido || "");

    // cabecera
    setReadonlyVal("fecha", payload.fecha);
    setReadonlyVal("dependencia", payload.dependencia);
    setReadonlyVal("dependencia_aux", payload.dependencia_aux);

    // ids ocultos (si los tienes en HTML)
    setVal("id_proyecto", payload.id_proyecto ?? "");
    setVal("id_fuente", payload.id_fuente ?? "");

    // ✅ Mostrar texto bonito en inputs readonly
    // (Asegúrate de tener estos inputs en HTML: name="proyecto_text" y name="fuente_text")
    const proyLabel = getProyectoLabel(payload.id_proyecto);
    const fuenteLabel = getFuenteLabel(payload.id_fuente);

    setReadonlyVal("proyecto_text", proyLabel || "");
    setReadonlyVal("fuente_text", fuenteLabel || "");

    // clave programática + descripción
    setTextById("claveProgramaticaClave", payload.clave_programatica || "");
    // si quieres que debajo aparezca la descripción del proyecto como en suficiencia:
    setTextById("claveProgramaticaTexto", proyLabel ? proyLabel.split(" - ").slice(1).join(" - ") : "—");

    setReadonlyVal("mes_pago", payload.mes_pago || "");
    setReadonlyVal("cantidad_pago", safeNumber(payload.cantidad_pago).toFixed(2));

    setReadonlyVal("meta", payload.meta || "");
    setReadonlyVal("subtotal", safeNumber(payload.subtotal).toFixed(2));
    setReadonlyVal("iva", safeNumber(payload.iva).toFixed(2));
    setReadonlyVal("isr", safeNumber(payload.isr).toFixed(2));
    setReadonlyVal("ieps", safeNumber(payload.ieps).toFixed(2));
    setReadonlyVal("total", safeNumber(payload.total).toFixed(2));
    setReadonlyVal("cantidad_con_letra", payload.cantidad_con_letra || "");

    setImpuestoTipo(payload.impuesto_tipo);
    setReadonlyVal("isr_tasa", payload.isr_tasa ?? "");
    setReadonlyVal("ieps_tasa", payload.ieps_tasa ?? "");

    renderDetalle(payload.detalle);

    return payload;
  }

  // ---------------------------
  // PDF (placeholder)
  // ---------------------------
  async function generarPDF(_payload) {
  await uiWarn("Aquí conecta tu generador real de PDF (pdf-lib).", "PDF");
}

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents(state) {
    btnDescargarPdf?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await generarPDF(state.payload);
  } catch (err) {
    console.error("[COMPROMETIDO][PDF]", err);
    await uiError(err?.message || "Error generando PDF", "PDF");
  }
});

btnRecargar?.addEventListener("click", async () => {
  try {
    const raw = await loadData();
    state.payload = renderPayload(raw);
    await uiSuccess("Datos recargados correctamente.", "Recargar");
  } catch (err) {
    await uiError(err?.message || "No se pudo recargar", "Recargar");
  }
});

const btnGuardar = document.getElementById("btn-guardar");
btnGuardar?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    const ok = await uiConfirm({
      title: "Guardar Comprometido",
      html: `
        <div style="font-size:13px; text-align:left;">
          ¿Deseas guardar el <b>Comprometido</b> con la información actual?
        </div>
      `,
      confirmText: "Sí, guardar",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    if (!state.payload?.id) {
      await uiWarn("No hay ID de suficiencia para guardar.");
      return;
    }

    const body = { id_suficiencia: state.payload.id, ...state.payload };

    const r = await fetchJson(`${API}/api/comprometido`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (r?.id) state.payload.id_comprometido = Number(r.id);

    if (r?.no_comprometido) {
      state.payload.no_comprometido = r.no_comprometido;
      setReadonlyVal("no_comprometido", r.no_comprometido);
    }

    localStorage.setItem(
      "cp_last_comprometido",
      JSON.stringify({
        id: String(r.id),
        payload: state.payload,
        loaded_from: "comprometido",
        loaded_at: new Date().toISOString(),
      })
    );

    await uiSuccess(`Comprometido guardado: ${r.no_comprometido}`, "Guardado");
  } catch (err) {
    console.error("[COMPROMETIDO] save error:", err);
    await uiError(err?.message || "Error al guardar comprometido");
  }
});


    // Ir a Devengado
    const btnVerDevengado = document.getElementById("btn-ver-devengado");
    btnVerDevengado?.addEventListener("click", async (e) => {
      e.preventDefault();

      let idRef = Number(state.payload?.id_comprometido || 0);

      if (!idRef) {
        try {
          const last = JSON.parse(localStorage.getItem("cp_last_comprometido"));
          idRef = Number(last?.id || 0);
        } catch {}
      }

      if (!idRef || idRef <= 0) {
        await uiWarn("Primero guarda el Comprometido para generar Devengado.");
        return;
      }

      localStorage.setItem(
        "cp_last_comprometido",
        JSON.stringify({
          id: String(idRef),
          payload: state.payload,
          loaded_from: "comprometido",
          loaded_at: new Date().toISOString(),
        })
      );

      window.location.href = `devengado.html?id=${encodeURIComponent(String(idRef))}`;
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
  const state = { payload: null };

  if (hasSwal()) {
    Swal.fire({
      title: "Cargando...",
      text: "Preparando comprometido",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
  }

  try {
    await loadCatalogos();
    const raw = await loadData();
    state.payload = renderPayload(raw);
  } catch (err) {
    console.error("[COMPROMETIDO]", err);
    await uiError(err?.message || "No se pudieron cargar datos");
  } finally {
    if (hasSwal()) Swal.close();
  }

  bindEvents(state);
}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
