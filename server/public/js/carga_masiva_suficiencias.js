/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Carga Masiva de Suficiencias (frontend)
 *  Archivo: carga_masiva_suficiencias.js
 *
 *  Funcionalidad:
 *    - Lee un archivo XLSX generado a partir de
 *      /plantillas/suficiencias_carga_masiva.xlsx
 *    - Valida formato y consistencia local (sin tocar BD).
 *    - Arma el payload { suficiencias: [...] } y lo envía a
 *      POST /api/suficiencias/lote en chunks de 20.
 *    - Las reglas de saldo, permisos IEPS/Pensión, partidas mil
 *      y FK las valida el servidor.
 *
 *  © 2025–2026 Humberto Salvador Ruiz Lucio.
 * ================================================================
 */
(() => {
  "use strict";

  // =====================================================
  //  CONFIG / HELPERS
  // =====================================================
  const API_BASE =
    (typeof window.API_BASE !== "undefined" && window.API_BASE) ||
    window.location.origin;
  const ENDPOINT_LOTE = `${API_BASE}/api/suficiencias/lote`;

  const MAX_POR_LOTE = 20;
  const MESES_VALIDOS = new Set([
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
  ]);

  const esc = (typeof window.escapeHtml === "function")
    ? window.escapeHtml
    : (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
      ));

  function authHeaders(json = true) {
    const t = localStorage.getItem("cp_token") || "";
    const h = { Authorization: `Bearer ${t}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  function formatoMoneda(n) {
    const v = Number(n || 0);
    return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }

  function showAlert(msg, kind = "info") {
    const el = document.getElementById("alertBox");
    if (!el) return;
    el.className = `alert alert-${kind}`;
    el.textContent = msg;
    el.classList.remove("d-none");
    if (kind === "success") {
      setTimeout(() => el.classList.add("d-none"), 5000);
    }
  }

  function toNumberOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function toNumber0(v) {
    const n = toNumberOrNull(v);
    return n == null ? 0 : n;
  }
  function toStr(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  // =====================================================
  //  GUARD: solo GOD o ADMIN pueden hacer carga masiva
  // =====================================================
  function guardAdminOrGod() {
    try {
      const raw = localStorage.getItem("cp_usuario");
      if (!raw) {
        window.location.replace("login.html");
        return false;
      }
      const u = JSON.parse(raw);
      const roles = Array.isArray(u.roles)
        ? u.roles.map((r) => String(r).toUpperCase())
        : [];
      const ok = roles.includes("GOD") || roles.includes("ADMIN");
      if (!ok) {
        console.warn("[CARGA-MASIVA-GUARD] Sin permiso, redirigiendo");
        window.location.replace("suficiencia_presupuestal.html");
        return false;
      }
      return true;
    } catch (e) {
      console.error("[CARGA-MASIVA-GUARD]", e);
      window.location.replace("login.html");
      return false;
    }
  }

  // =====================================================
  //  ESTADO DE LA PÁGINA
  // =====================================================
  const state = {
    cabeceras: [],   // filas de 01_Suficiencias normalizadas
    detalle: [],     // filas de 02_Detalle normalizadas
    errores: [],     // strings de error de validación local
    payload: [],     // arreglo final listo para enviar al backend
  };

  // =====================================================
  //  LECTURA DEL XLSX
  // =====================================================
  async function leerXlsx(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

    const wsSuf = wb.Sheets["01_Suficiencias"];
    const wsDet = wb.Sheets["02_Detalle"];

    if (!wsSuf || !wsDet) {
      throw new Error("El archivo debe contener las hojas '01_Suficiencias' y '02_Detalle'.");
    }

    // raw:false → fechas y números vienen como string formateado igual al display
    const cabeceras = XLSX.utils.sheet_to_json(wsSuf, { defval: "", raw: true });
    const detalle   = XLSX.utils.sheet_to_json(wsDet, { defval: "", raw: true });

    return { cabeceras, detalle };
  }

  // =====================================================
  //  NORMALIZACIÓN
  // =====================================================
  function normalizarCabecera(c, fila) {
    return {
      _fila: fila + 2,    // +2: fila 1 es header, las filas Excel comienzan en 1
      id_local: toStr(c.id_local).trim(),
      id_dgeneral: toNumberOrNull(c.id_dgeneral),
      id_dauxiliar: toNumberOrNull(c.id_dauxiliar),
      id_proyecto: toNumberOrNull(c.id_proyecto),
      id_fuente: toNumberOrNull(c.id_fuente),
      dependencia: toStr(c.dependencia),
      departamento: toStr(c.departamento),
      fuente: toStr(c.fuente),
      mes_pago: toStr(c.mes_pago).trim().toUpperCase(),
      fecha: toStr(c.fecha).trim() || null,
      clave_programatica: toStr(c.clave_programatica),
      meta: toStr(c.meta),
      impuesto_tipo: toStr(c.impuesto_tipo).trim().toUpperCase() || "NONE",
      isr_tasa: toNumberOrNull(c.isr_tasa),
      ieps_tasa: toNumberOrNull(c.ieps_tasa),
      subtotal: toNumber0(c.subtotal),
      iva: toNumber0(c.iva),
      isr: toNumber0(c.isr),
      ieps: toNumber0(c.ieps),
      pension_total: toNumber0(c.pension_total),
      pension1_tasa: toNumberOrNull(c.pension1_tasa),
      pension1: toNumber0(c.pension1),
      pension2_tasa: toNumberOrNull(c.pension2_tasa),
      pension2: toNumber0(c.pension2),
      pension3_tasa: toNumberOrNull(c.pension3_tasa),
      pension3: toNumber0(c.pension3),
      pension4_tasa: toNumberOrNull(c.pension4_tasa),
      pension4: toNumber0(c.pension4),
      pension5_tasa: toNumberOrNull(c.pension5_tasa),
      pension5: toNumber0(c.pension5),
      cantidad_con_letra: toStr(c.cantidad_con_letra),
      firma_enlace_label: toStr(c.firma_enlace_label),
      firma_enlace_nombre: toStr(c.firma_enlace_nombre),
      firma_area_label: toStr(c.firma_area_label),
      firma_area_nombre: toStr(c.firma_area_nombre),
      firma_direccion_nombre: toStr(c.firma_direccion_nombre),
    };
  }

  function normalizarRenglon(r, fila) {
    return {
      _fila: fila + 2,
      id_local: toStr(r.id_local).trim(),
      renglon: toNumberOrNull(r.renglon),
      clave: toStr(r.clave).trim(),
      concepto_partida: toStr(r.concepto_partida),
      justificacion: toStr(r.justificacion),
      descripcion: toStr(r.descripcion),
      importe: toNumber0(r.importe),
    };
  }

  // =====================================================
  //  VALIDACIÓN LOCAL
  // =====================================================
  function validar(cabeceras, detalle) {
    const errores = [];

    if (!cabeceras.length) {
      errores.push("La hoja '01_Suficiencias' no tiene filas (después del encabezado).");
    }
    if (cabeceras.length > MAX_POR_LOTE) {
      errores.push(`Máximo ${MAX_POR_LOTE} suficiencias por archivo. Tienes ${cabeceras.length}.`);
    }

    // id_local único en cabecera + campos obligatorios
    const idsLocales = new Set();
    for (const c of cabeceras) {
      if (!c.id_local) {
        errores.push(`Fila ${c._fila} (cabecera): id_local vacío.`);
      } else if (idsLocales.has(c.id_local)) {
        errores.push(`Fila ${c._fila} (cabecera): id_local '${c.id_local}' está duplicado.`);
      } else {
        idsLocales.add(c.id_local);
      }

      if (!Number.isInteger(c.id_dgeneral) || c.id_dgeneral <= 0)
        errores.push(`Fila ${c._fila}: id_dgeneral inválido (debe ser ID de cat_DG).`);
      if (!Number.isInteger(c.id_dauxiliar) || c.id_dauxiliar <= 0)
        errores.push(`Fila ${c._fila}: id_dauxiliar inválido (debe ser ID de cat_DA).`);
      if (!Number.isInteger(c.id_proyecto) || c.id_proyecto <= 0)
        errores.push(`Fila ${c._fila}: id_proyecto inválido (debe ser ID de cat_Proyecto).`);
      if (!Number.isInteger(c.id_fuente) || c.id_fuente <= 0)
        errores.push(`Fila ${c._fila}: id_fuente inválido (debe ser ID de cat_Fuente).`);

      if (!MESES_VALIDOS.has(c.mes_pago))
        errores.push(`Fila ${c._fila}: mes_pago '${c.mes_pago}' no es válido (usa hoja cat_Mes).`);

      if (c.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha))
        errores.push(`Fila ${c._fila}: fecha '${c.fecha}' no es YYYY-MM-DD.`);

      if (c.subtotal < 0)
        errores.push(`Fila ${c._fila}: subtotal no puede ser negativo.`);
    }

    // Detalle: cada id_local debe existir en cabeceras
    const renglonesPorId = new Map();
    for (const d of detalle) {
      if (!d.id_local) {
        errores.push(`Fila ${d._fila} (detalle): id_local vacío.`);
        continue;
      }
      if (!idsLocales.has(d.id_local)) {
        errores.push(`Fila ${d._fila} (detalle): id_local '${d.id_local}' no existe en cabeceras.`);
        continue;
      }
      if (!Number.isInteger(d.renglon) || d.renglon <= 0) {
        errores.push(`Fila ${d._fila} (detalle): renglon inválido (debe ser entero ≥ 1).`);
      }
      if (!d.clave) {
        errores.push(`Fila ${d._fila} (detalle): clave de partida vacía.`);
      }
      if (!(d.importe > 0)) {
        errores.push(`Fila ${d._fila} (detalle): importe debe ser > 0.`);
      }
      if (!renglonesPorId.has(d.id_local)) renglonesPorId.set(d.id_local, []);
      renglonesPorId.get(d.id_local).push(d);
    }

    // Cada cabecera debe tener ≥ 1 renglón y renglones consecutivos/únicos
    for (const c of cabeceras) {
      const renglones = renglonesPorId.get(c.id_local) || [];
      if (renglones.length === 0) {
        errores.push(`Cabecera id_local '${c.id_local}' no tiene renglones en hoja '02_Detalle'.`);
        continue;
      }
      const vistos = new Set();
      for (const r of renglones) {
        if (vistos.has(r.renglon)) {
          errores.push(`id_local '${c.id_local}': renglon ${r.renglon} duplicado.`);
        }
        vistos.add(r.renglon);
      }
    }

    return { errores, renglonesPorId };
  }

  // =====================================================
  //  CONSTRUCCIÓN DEL PAYLOAD PARA EL BACKEND
  // =====================================================
  function construirPayload(cabeceras, renglonesPorId) {
    return cabeceras.map((c) => {
      const det = (renglonesPorId.get(c.id_local) || [])
        .slice()
        .sort((a, b) => a.renglon - b.renglon)
        .map((d) => ({
          renglon: d.renglon,
          clave: d.clave,
          concepto_partida: d.concepto_partida,
          justificacion: d.justificacion,
          descripcion: d.descripcion,
          importe: d.importe,
        }));

      const out = { ...c, detalle: det };
      delete out._fila;
      delete out.id_local;
      return out;
    });
  }

  // =====================================================
  //  UI: dropzone y eventos
  // =====================================================
  function setupDropzone() {
    const dz = document.getElementById("dropzone");
    const input = document.getElementById("fileInput");
    if (!dz || !input) return;

    dz.addEventListener("click", () => input.click());
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("is-drag");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-drag");
      if (e.dataTransfer?.files?.length) {
        manejarArchivo(e.dataTransfer.files[0]);
      }
    });
    input.addEventListener("change", () => {
      if (input.files?.length) manejarArchivo(input.files[0]);
    });
  }

  async function manejarArchivo(file) {
    if (!/\.xlsx$/i.test(file.name)) {
      showAlert("Solo se acepta el formato .xlsx.", "danger");
      return;
    }

    document.getElementById("dropzoneTitle").textContent = `Archivo cargado: ${file.name}`;

    try {
      const { cabeceras: rawCab, detalle: rawDet } = await leerXlsx(file);

      const cabeceras = rawCab.map(normalizarCabecera);
      const detalle = rawDet.map(normalizarRenglon);

      const { errores, renglonesPorId } = validar(cabeceras, detalle);

      state.cabeceras = cabeceras;
      state.detalle = detalle;
      state.errores = errores;
      state.payload = errores.length === 0
        ? construirPayload(cabeceras, renglonesPorId)
        : [];

      renderResumen();
      renderPreview(renglonesPorId);
      document.getElementById("cardAccion").classList.remove("d-none");
      document.getElementById("btnSubir").disabled = errores.length > 0 || cabeceras.length === 0;
    } catch (err) {
      console.error("[CARGA-MASIVA] Lectura/validación:", err);
      showAlert(err.message || "No se pudo leer el archivo.", "danger");
    }
  }

  // =====================================================
  //  RENDER
  // =====================================================
  function renderResumen() {
    const cardErr = document.getElementById("cardErrores");
    document.getElementById("cardResumen").classList.remove("d-none");
    document.getElementById("sumCabeceras").textContent = String(state.cabeceras.length);
    document.getElementById("sumRenglones").textContent = String(state.detalle.length);

    const importeTotal = state.cabeceras.reduce((acc, c) => {
      // El servidor recalcula el total con computeTotal; aquí solo sumamos para previsualización.
      return acc + Number(c.subtotal || 0) + Number(c.iva || 0) + Number(c.isr || 0)
                 + Number(c.ieps || 0) + Number(c.pension_total || 0);
    }, 0);
    document.getElementById("sumImporteTotal").textContent = formatoMoneda(importeTotal);

    document.getElementById("sumErrores").textContent = String(state.errores.length);
    cardErr.classList.remove("warn", "err");
    if (state.errores.length > 0) cardErr.classList.add("err");

    const box = document.getElementById("boxErrores");
    const lista = document.getElementById("listaErrores");
    if (state.errores.length === 0) {
      box.classList.add("d-none");
      lista.innerHTML = "";
    } else {
      box.classList.remove("d-none");
      lista.innerHTML = state.errores
        .map((e) => `<div class="cp-err-row">${esc(e)}</div>`)
        .join("");
    }
  }

  function renderPreview(renglonesPorId) {
    const tb = document.getElementById("tbodyPreview");
    if (!tb) return;
    if (state.cabeceras.length === 0) {
      tb.innerHTML = "";
      document.getElementById("cardPreview").classList.add("d-none");
      return;
    }
    document.getElementById("cardPreview").classList.remove("d-none");

    const rows = [];
    for (const c of state.cabeceras) {
      const renglones = renglonesPorId.get(c.id_local) || [];
      const total = Number(c.subtotal || 0) + Number(c.iva || 0) + Number(c.isr || 0)
                  + Number(c.ieps || 0) + Number(c.pension_total || 0);
      rows.push(`
        <tr>
          <td><span class="cp-id-local">${esc(c.id_local)}</span></td>
          <td>${esc(c.mes_pago)}</td>
          <td><code>${esc(`DG:${c.id_dgeneral || "-"} / DA:${c.id_dauxiliar || "-"} / P:${c.id_proyecto || "-"} / F:${c.id_fuente || "-"}`)}</code></td>
          <td class="cp-num">${esc(formatoMoneda(c.subtotal))}</td>
          <td class="cp-num">${esc(formatoMoneda(c.iva))}</td>
          <td class="cp-num"><strong>${esc(formatoMoneda(total))}</strong></td>
          <td class="text-center">${renglones.length}</td>
        </tr>
      `);
      for (const r of renglones) {
        rows.push(`
          <tr class="cp-row-detalle">
            <td><i class="bi bi-arrow-return-right"></i> Renglón ${esc(String(r.renglon))}</td>
            <td colspan="2"><code>${esc(r.clave)}</code> ${esc(r.concepto_partida || "")}</td>
            <td class="cp-num" colspan="3">${esc(formatoMoneda(r.importe))}</td>
            <td></td>
          </tr>
        `);
      }
    }
    tb.innerHTML = rows.join("");
  }

  function renderResultados({ creadas, erroresChunks }) {
    const card = document.getElementById("cardResultados");
    const okBox = document.getElementById("boxResultadoOk");
    const errBox = document.getElementById("boxResultadoErr");
    const tb = document.getElementById("tbodyResultados");
    const wrapper = document.getElementById("wrapperFolios");

    card.classList.remove("d-none");

    if (creadas.length > 0) {
      okBox.classList.remove("d-none");
      okBox.innerHTML = `<i class="bi bi-check-circle"></i> Se crearon <strong>${creadas.length}</strong> suficiencia(s).`;
    } else {
      okBox.classList.add("d-none");
    }

    if (erroresChunks.length > 0) {
      errBox.classList.remove("d-none");
      errBox.innerHTML = `<i class="bi bi-x-octagon"></i> ${erroresChunks.length} chunk(s) fallaron:<br>` +
        erroresChunks.map((e) => `<div class="small mt-1">${esc(e)}</div>`).join("");
    } else {
      errBox.classList.add("d-none");
    }

    if (creadas.length > 0) {
      wrapper.classList.remove("d-none");
      tb.innerHTML = creadas.map((c, idx) => `
        <tr>
          <td><span class="cp-id-local">${esc(state.cabeceras[idx]?.id_local || "—")}</span></td>
          <td><code>${esc(c.no_suficiencia || "—")}</code></td>
          <td class="cp-num">${esc(formatoMoneda(c.total || 0))}</td>
          <td><span class="badge text-bg-success">Creada</span></td>
        </tr>
      `).join("");
    } else {
      wrapper.classList.add("d-none");
    }
  }

  // =====================================================
  //  ENVÍO AL BACKEND
  // =====================================================
  async function enviarLote() {
    if (state.payload.length === 0) return;

    const btn = document.getElementById("btnSubir");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Subiendo...`;

    const creadas = [];
    const erroresChunks = [];

    // El backend ya limita a 20 por lote, pero mandamos en chunks por si la
    // plantilla en el futuro acepta más (defensa en profundidad).
    const CHUNK = 20;
    for (let i = 0; i < state.payload.length; i += CHUNK) {
      const slice = state.payload.slice(i, i + CHUNK);
      try {
        const res = await fetch(ENDPOINT_LOTE, {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ suficiencias: slice }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          erroresChunks.push((data && data.error) || `HTTP ${res.status}`);
        } else if (Array.isArray(data?.creadas)) {
          creadas.push(...data.creadas);
        }
      } catch (err) {
        erroresChunks.push(err.message || "Error de red");
      }
    }

    btn.innerHTML = `<i class="bi bi-cloud-upload"></i> Subir lote`;
    btn.disabled = state.errores.length > 0;

    renderResultados({ creadas, erroresChunks });

    if (creadas.length > 0 && erroresChunks.length === 0) {
      showAlert(`Lote subido correctamente: ${creadas.length} suficiencia(s) creada(s).`, "success");
    } else if (creadas.length > 0 && erroresChunks.length > 0) {
      showAlert(`Subida parcial: ${creadas.length} creada(s), ${erroresChunks.length} chunk(s) con error.`, "warning");
    } else {
      showAlert(`No se creó ninguna suficiencia. Revisa los errores.`, "danger");
    }
  }

  // =====================================================
  //  BOOT
  // =====================================================
  document.addEventListener("DOMContentLoaded", () => {
    if (!guardAdminOrGod()) return;

    setupDropzone();

    const btnVolver = document.getElementById("btnVolver");
    if (btnVolver) {
      btnVolver.addEventListener("click", () => history.back());
    }

    const btnSubir = document.getElementById("btnSubir");
    if (btnSubir) btnSubir.addEventListener("click", enviarLote);

    console.log("[CARGA-MASIVA] Listo");
  });
})();
