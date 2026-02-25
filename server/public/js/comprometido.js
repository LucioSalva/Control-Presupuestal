// public/js/comprometido.js
(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const detalleBody = document.getElementById("detalleBody");

  const tipoDocumento = window.location.pathname.includes("devengado")
    ? "DV"
    : "CP";

  function updateDownloadLock(state) {
    try {
      const idRef = Number(state?.payload?.id_comprometido || 0);
      if (btnDescargarPdf)
        btnDescargarPdf.disabled = !(Number.isFinite(idRef) && idRef > 0);
    } catch {}
  }
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
    if (str.includes("-")) {
      return str.replace(/-(SP|CP|DV)-/, `-${tipoDocumento}-`);
    }
    if (/^\d+$/.test(str)) return str.padStart(6, "0");
    return str;
  }

  function normalizeSufFolio(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";

    const m = raw.match(/ECA-(\d{4})-(\d{2})-SP-(\d{1,6})/i);
    if (m) {
      const year = m[1];
      const month = m[2];
      const num = String(m[3]).padStart(4, "0");
      return `ECA-${year}-${month}-SP-${num}`;
    }

    // Compatibilidad con formato viejo: ECA-02-SP-0001 (sin anio)
    const m2 = raw.match(/ECA-(\d{2})-SP-(\d{1,6})/i);
    if (m2) {
      const year = String(new Date().getFullYear());
      const month = m2[1];
      const num = String(m2[2]).padStart(4, "0");
      return `ECA-${year}-${month}-SP-${num}`;
    }

    if (/^\d{1,6}$/.test(raw)) {
      const year = String(new Date().getFullYear());
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const num = raw.padStart(4, "0");
      return `ECA-${year}-${month}-SP-${num}`;
    }

    const onlyDigits = raw.replace(/\D/g, "");
    if (onlyDigits && onlyDigits.length <= 6) {
      const year = String(new Date().getFullYear());
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const num = onlyDigits.padStart(4, "0");
      return `ECA-${year}-${month}-SP-${num}`;
    }

    return raw;
  }

  async function buscarSuficienciaPorFolio(folioInput) {
    const numero = normalizeSufFolio(folioInput);
    if (!numero) {
      await uiWarn(
        "Escribe el folio de la Suficiencia (ej. ECA-2026-02-SP-0001 o solo 0001).",
      );
      return null;
    }

    const url = `${API}/api/suficiencias/buscar?numero=${encodeURIComponent(numero)}`;
    const res = await fetchJson(url, { headers: { ...authHeaders() } });
    const rows = res?.data || [];

    if (!rows.length) {
      await uiWarn("No encontrada (o no corresponde a tu área).");
      return null;
    }

    if (rows.length === 1) return Number(rows[0].id);

    // múltiples -> elegir
    if (!hasSwal()) {
      await uiWarn("Hay varias coincidencias, activa SweetAlert2 para elegir.");
      return null;
    }

    const listHtml = `
    <div class="list-group text-start">
      ${rows
        .map((r) => {
          const folio = r.no_suficiencia || "—";
          const fecha = r.fecha ? String(r.fecha).split("T")[0] : "";
          return `
          <button type="button" class="list-group-item list-group-item-action" data-id="${r.id}">
            <div class="fw-semibold">${folio}</div>
            <small class="text-muted">${fecha}</small>
          </button>`;
        })
        .join("")}
    </div>
  `;

    const pick = await new Promise((resolve) => {
      Swal.fire({
        title: "Selecciona una Suficiencia",
        html: listHtml,
        icon: "info",
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: "Cancelar",
        didOpen: () => {
          const c = Swal.getHtmlContainer();
          c?.querySelectorAll("button[data-id]")?.forEach((btn) => {
            btn.addEventListener("click", () => {
              const id = Number(btn.dataset.id);
              Swal.close();
              resolve(id);
            });
          });
        },
      }).then(() => resolve(null));
    });

    return pick;
  }

  async function cargarSuficienciaEnComprometido(id) {
    const data = await fetchJson(`${API}/api/suficiencias/${id}`, {
      headers: { ...authHeaders() },
    });

    if (!data?.id) {
      await uiError("No se pudo cargar la suficiencia.");
      return null;
    }

    localStorage.setItem(
      "cp_last_suficiencia",
      JSON.stringify({
        id: String(data.id),
        payload: data,
        loaded_from: "buscar",
        loaded_at: new Date().toISOString(),
      }),
    );

    return data;
  }

  function isFullFolio(raw) {
    const s = String(raw || "").trim().toUpperCase();
    return /^ECA-\d{4}-\d{2}-(SP|CP)-\d{4}$/i.test(s);
  }

  async function buscarPorFolioGeneral(folioInput) {
    const folio = String(folioInput || "").trim().toUpperCase();
    if (!isFullFolio(folio)) {
      await uiWarn(
        "Escribe el folio completo: ECA-YYYY-MM-SP-#### o ECA-YYYY-MM-CP-####",
        "Buscar",
      );
      return { kind: null, value: null };
    }
    if (/-SP-/.test(folio)) {
      const url = `${API}/api/suficiencias/buscar?numero=${encodeURIComponent(folio)}`;
      const res = await fetchJson(url, { headers: { ...authHeaders() } });
      const rows = res?.data || [];
      if (!rows.length) {
        await uiWarn("Suficiencia no encontrada.", "Buscar");
        return { kind: null, value: null };
      }
      if (rows.length === 1) return { kind: "SP", value: Number(rows[0].id) };
      if (!hasSwal()) {
        await uiWarn("Varias coincidencias. Activa SweetAlert2.", "Buscar");
        return { kind: null, value: null };
      }
      const listHtml = `
        <div class="list-group text-start">
          ${rows
            .map((r) => {
              const folio = r.no_suficiencia || "—";
              const fecha = r.fecha ? String(r.fecha).split("T")[0] : "";
              return `
                <button type="button" class="list-group-item list-group-item-action" data-id="${r.id}">
                  <div class="fw-semibold">${folio}</div>
                  <small class="text-muted">${fecha}</small>
                </button>`;
            })
            .join("")}
        </div>`;
      const pick = await new Promise((resolve) => {
        Swal.fire({
          title: "Selecciona una Suficiencia",
          html: listHtml,
          icon: "info",
          showConfirmButton: false,
          showCancelButton: true,
          cancelButtonText: "Cancelar",
          didOpen: () => {
            const c = Swal.getHtmlContainer();
            c?.querySelectorAll("button[data-id]")?.forEach((btn) => {
              btn.addEventListener("click", () => {
                const id = Number(btn.dataset.id);
                Swal.close();
                resolve(id);
              });
            });
          },
        }).then(() => resolve(null));
      });
      return pick ? { kind: "SP", value: Number(pick) } : { kind: null, value: null };
    } else {
      const data = await fetchJson(
        `${API}/api/comprometido/buscar?no=${encodeURIComponent(folio)}`,
        { headers: { ...authHeaders() } },
      );
      const payload = data || null;
      if (!payload?.id) {
        await uiWarn("Comprometido no encontrado.", "Buscar");
        return { kind: null, value: null };
      }
      payload.id_comprometido = Number(payload.id);
      payload.no_comprometido = payload.no_comprometido || folio;
      payload.id = Number(payload.id_suficiencia || payload.id);
      return { kind: "CP", value: payload };
    }
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

  function uiConfirm({
    title = "Confirmar",
    html = "",
    confirmText = "Sí",
    cancelText = "Cancelar",
  } = {}) {
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
  let fuentesById = {}; // { [id]: "110101 - INGRESOS PROPIOS..." }

  async function loadCatalogos() {
    // Ojo: tus endpoints ya existen porque en suficiencia los usas:
    // /api/catalogos/proyectos
    // /api/catalogos/fuentes
    const [proys, fuents] = await Promise.all([
      fetchJson(`${API}/api/catalogos/proyectos`, {
        headers: { ...authHeaders() },
      }),
      fetchJson(`${API}/api/catalogos/fuentes`, {
        headers: { ...authHeaders() },
      }),
    ]);

    proyectosById = {};
    (Array.isArray(proys) ? proys : []).forEach((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;

      const clave = String(p.clave ?? "").trim();
      const conac = String(p.conac ?? "").trim();
      const desc = String(p.descripcion ?? "").trim();

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
    return Number.isFinite(id) ? proyectosById[id] || "" : "";
  }

  function getFuenteLabel(idFuente) {
    const id = Number(idFuente);
    return Number.isFinite(id) ? fuentesById[id] || "" : "";
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
        `,
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
        const data = await fetchJson(
          `${API}/api/comprometido/por-suficiencia/${id}`,
          {
            headers: { ...authHeaders() },
          },
        );

        const payload = data && data.data ? data.data : data;

        // cache para fallback
        localStorage.setItem(
          "cp_last_suficiencia",
          JSON.stringify({
            id,
            payload,
            loaded_from: "api",
            loaded_at: new Date().toISOString(),
          }),
        );

        return payload;
      } catch (e) {
        console.warn("[COMPROMETIDO] API falló:", e.message);
      }
    }

    return null; // página en blanco hasta que se busque una suficiencia
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
    setTextById(
      "claveProgramaticaTexto",
      proyLabel ? proyLabel.split(" - ").slice(1).join(" - ") : "—",
    );

    setReadonlyVal("mes_pago", payload.mes_pago || "");
    setReadonlyVal(
      "cantidad_pago",
      safeNumber(payload.cantidad_pago).toFixed(2),
    );

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

  // Limpia la UI al entrar sin datos
  function clearUI() {
    try {
      setReadonlyVal("no_comprometido", "");
      setReadonlyVal("fecha", "");
      setReadonlyVal("dependencia", "");
      setReadonlyVal("dependencia_aux", "");
      setVal("id_proyecto", "");
      setVal("id_fuente", "");
      setReadonlyVal("proyecto_text", "");
      setReadonlyVal("fuente_text", "");
      setTextById("claveProgramaticaClave", "");
      setTextById("claveProgramaticaTexto", "—");
      setReadonlyVal("mes_pago", "");
      setReadonlyVal("cantidad_pago", "0.00");
      setReadonlyVal("meta", "");
      setReadonlyVal("subtotal", "0.00");
      setReadonlyVal("iva", "0.00");
      setReadonlyVal("isr", "0.00");
      setReadonlyVal("ieps", "0.00");
      setReadonlyVal("total", "0.00");
      setReadonlyVal("cantidad_con_letra", "");
      setImpuestoTipo("NONE");
      setReadonlyVal("isr_tasa", "");
      setReadonlyVal("ieps_tasa", "");
      renderDetalle([]);
    } catch {}
  }

  async function applyIEPSPensionesPermissions() {
    try {
      const r = await fetchJson(`${API}/api/suficiencias/perm-ieps-pensiones`, {
        headers: { ...authHeaders() },
      });
      const allowed = !!r?.allowed;
      if (allowed) return;
      const iepsInput = document.querySelector('[name="ieps"]');
      const iepsRow = iepsInput?.closest("tr");
      if (iepsRow) iepsRow.classList.add("d-none");
      const iepsTasa = document.querySelector('[name="ieps_tasa"]');
      const iepsRadio = document.querySelector('input[name="impuesto_tipo"][value="IEPS"]');
      const iepsRadioWrap = iepsRadio?.closest("div");
      if (iepsTasa) {
        iepsTasa.value = "";
        iepsTasa.disabled = true;
      }
      if (iepsRadioWrap) iepsRadioWrap.classList.add("d-none");
    } catch (e) {
      console.warn("[COMP] permisos IEPS/Pensiones:", e?.message || e);
    }
  }

  // ---------------------------
  // PDF COMPROMETIDO (pdf-lib)
  // ---------------------------
  const COMP_PDF_TEMPLATE_URL = "/PDF/comprometido.pdf";

  async function fetchPdfTemplateBytesComp() {
    const r = await fetch(COMP_PDF_TEMPLATE_URL);
    if (!r.ok) throw new Error(`No se pudo cargar la plantilla PDF: ${COMP_PDF_TEMPLATE_URL}`);
    return await r.arrayBuffer();
  }

  async function generarPDF(rawPayload) {
    if (!window.PDFLib?.PDFDocument) {
      throw new Error("Falta pdf-lib. Revisa que el script de pdf-lib cargue antes.");
    }

    const payload = normalizePayload(rawPayload || {});

    const templateBytes = await fetchPdfTemplateBytesComp();
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const setTextSafe = (fieldName, value, size, align) => {
      try {
        const f = form.getTextField(fieldName);
        if (size != null) f.setFontSize(size);
        if (align != null && window.PDFLib?.TextAlignment) f.setAlignment(align);
        f.setText(String(value ?? ""));
      } catch {}
    };
    const setTextMulti = (fieldNames, value, size, align) => {
      for (const nm of fieldNames || []) {
        try {
          const f = form.getTextField(nm);
          if (size != null) f.setFontSize(size);
          if (align != null && window.PDFLib?.TextAlignment) f.setAlignment(align);
          f.setText(String(value ?? ""));
          return;
        } catch {}
      }
    };
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
            if (align != null && window.PDFLib?.TextAlignment) f.setAlignment(align);
            f.setText(String(value ?? ""));
            wrote++;
          }
        }
        if (wrote > 0) return true;
      } catch {}
      return false;
    };

    const normalizeCell = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    const sizeHeader = 9;
    const sizeSmall = 7;
    const sizeTiny = 6;
    const sizeDG = 12;

    // Fuente para apariencias
    try {
      const font =
        (PDFLib?.StandardFonts &&
          (await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica))) ||
        undefined;
      form.updateFieldAppearances(font);
    } catch {}

    // Dependencia general
    const depGeneralName = normalizeCell(payload.dependencia || "");
    setTextByPattern(["dependencia", "general"], depGeneralName, sizeDG, PDFLib?.TextAlignment?.Center) ||
      setTextMulti(
        [
          "NOMBRE DE LA DEPENDENCIA GENERAL:",
          "NOMBRE DE LA DEPENDENCIA GENERAL",
          "NOMBRE DE LA DEPENDENCIA GENERAL#4",
          "NOMBRE DE LA DEPENDENCIA GENERAL#3",
          "NOMBRE DE LA DEPENDENCIA GENERAL#2",
          "NOMBRE DE LA DEPENDENCIA GENERAL#1",
        ],
        depGeneralName,
        sizeDG,
        PDFLib?.TextAlignment?.Center,
      );

    // Clave programática y nombre
    setTextByPattern(
      ["clave", "programática"],
      normalizeCell(payload.clave_programatica || ""),
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );
    const proyLabel = getProyectoLabel(payload.id_proyecto) || "";
    const claveProgDesc = proyLabel ? proyLabel.split(" - ").slice(1).join(" - ").trim() : "";
    setTextByPattern(
      ["nombre", "clave", "programática"],
      claveProgDesc,
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );

    // Fuente de financiamiento
    const fuenteLabel = getFuenteLabel(payload.id_fuente) || "";
    let fuenteClave = "";
    let fuenteDesc = fuenteLabel;
    if (fuenteLabel.includes(" - ")) {
      const [c, ...rest] = fuenteLabel.split(" - ");
      fuenteClave = String(c || "").trim();
      fuenteDesc = rest.join(" - ").trim();
    }
    setTextByPattern(["fuente", "financiamiento"], fuenteClave, sizeSmall, PDFLib?.TextAlignment?.Center);
    setTextByPattern(["nombre", "f.f"], fuenteDesc, sizeSmall, PDFLib?.TextAlignment?.Center);

    // Fecha
    try {
      const iso = payload.fecha;
      const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-") : ["", "", ""];
      setTextByPattern(["fechadia"], d, sizeSmall);
      setTextByPattern(["fechames"], m, sizeSmall);
      setTextByPattern(["fechayear"], y, sizeSmall);
    } catch {}

    // Encabezados de solicitante y firmantes
    const roles = await (async () => {
      if (!window.Swal) return {};
      const html = `
        <div class="text-start">
          <p class="mb-2">Captura encabezados y firmantes (Comprometido):</p>
          <div class="row g-2">
            <div class="col-8">
              <label class="form-label small">Coordinación Administrativa (ENLACE SOLICITANTE)</label>
              <input type="text" class="form-control form-control-sm" id="roles_enlace_label" placeholder="Ej. COORDINACIÓN ADMINISTRATIVA">
            </div>
            <div class="col-4">
              <label class="form-label small">Firmante Enlace</label>
              <input type="text" class="form-control form-control-sm" id="roles_enlace_firma" placeholder="Nombre del firmante">
            </div>
          </div>
          <div class="row g-2 mt-2">
            <div class="col-8">
              <label class="form-label small">ÁREA SOLICITANTE</label>
              <input type="text" class="form-control form-control-sm" id="roles_area_label" placeholder="Ej. SUBDIRECCIÓN DE TECNOLOGÍAS...">
            </div>
            <div class="col-4">
              <label class="form-label small">Firmante Área</label>
              <input type="text" class="form-control form-control-sm" id="roles_area_firma" placeholder="Nombre del firmante">
            </div>
          </div>
          <div class="row g-2 mt-2">
            <div class="col-8">
              <label class="form-label small">Dirección Solicitante</label>
              <input type="text" class="form-control form-control-sm" disabled value="Se toma de NOMBRE DE LA DEPENDENCIA GENERAL">
            </div>
            <div class="col-4">
              <label class="form-label small">Firmante Dirección</label>
              <input type="text" class="form-control form-control-sm" id="roles_direccion_firma" placeholder="Nombre del firmante">
            </div>
          </div>
        </div>`;
      const res = await Swal.fire({
        title: "Datos del Solicitante (Comprometido)",
        html,
        focusConfirm: false,
        width: 800,
        confirmButtonText: "Usar",
        showCancelButton: true,
      });
      if (!res.isConfirmed) throw new Error("Cancelado por el usuario.");
      return {
        enlace_label: String(document.getElementById("roles_enlace_label")?.value || "").trim(),
        enlace_firma: String(document.getElementById("roles_enlace_firma")?.value || "").trim(),
        area_label: String(document.getElementById("roles_area_label")?.value || "").trim(),
        area_firma: String(document.getElementById("roles_area_firma")?.value || "").trim(),
        direccion_firma: String(document.getElementById("roles_direccion_firma")?.value || "").trim(),
      };
    })();

    const collectCategoryFields = () => {
      const cats = { enlace: [], area: [], direccion: [] };
      try {
        const fields = form.getFields();
        for (const f of fields) {
          const nm = String(f.getName() || "");
          const lower = nm.toLowerCase();
          if (lower.includes("coordinación") && lower.includes("administrativa") && lower.includes("área") && lower.includes("solicitante")) {
            cats.enlace.push(nm);
          } else if (lower.includes("área") && lower.includes("solicitante") && !lower.includes("coordinación") && !lower.includes("administrativa")) {
            cats.area.push(nm);
          } else if (lower.includes("dirección") && lower.includes("solicitante")) {
            cats.direccion.push(nm);
          }
        }
      } catch {}
      return cats;
    };

    try {
      const cats = collectCategoryFields();
      if (roles.enlace_label) cats.enlace.forEach((nm) => setTextSafe(nm, roles.enlace_label, sizeSmall, PDFLib?.TextAlignment?.Center));
      if (roles.area_label) cats.area.forEach((nm) => setTextSafe(nm, roles.area_label, sizeSmall, PDFLib?.TextAlignment?.Center));
      cats.direccion.forEach((nm) => setTextSafe(nm, depGeneralName, sizeSmall, PDFLib?.TextAlignment?.Center));
    } catch {}

    const findFirmasByName = () => {
      const out = { firma1: [], firma2: [], firma3: [] };
      try {
        const fields = form.getFields();
        for (const f of fields) {
          const nm = String(f.getName() || "");
          const lower = nm.toLowerCase();
          if (lower.includes("firma1")) out.firma1.push(nm);
          else if (lower.includes("firma2")) out.firma2.push(nm);
          else if (lower.includes("firma3")) out.firma3.push(nm);
        }
      } catch {}
      return out;
    };

    try {
      const m = findFirmasByName();
      m.firma1.forEach((nm) => roles.enlace_firma && setTextSafe(nm, roles.enlace_firma, sizeSmall, PDFLib?.TextAlignment?.Center));
      m.firma2.forEach((nm) => roles.area_firma && setTextSafe(nm, roles.area_firma, sizeSmall, PDFLib?.TextAlignment?.Center));
      m.firma3.forEach((nm) => roles.direccion_firma && setTextSafe(nm, roles.direccion_firma, sizeSmall, PDFLib?.TextAlignment?.Center));
    } catch {}

    // Detalle de partidas (tabla)
    const MAX_ROWS = 20;
    const detalleRows = Array.isArray(payload.detalle) ? payload.detalle.slice(0, MAX_ROWS) : [];
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
    const linesNo = padLines(detalleRows.map((r, i) => String(r?.renglon ?? i + 1)), MAX_ROWS);
    const linesClave = padLines(detalleRows.map((r) => cut(String(r?.clave || ""), 12)), MAX_ROWS);
    const linesConcepto = padLines(detalleRows.map((r) => cut(String(r?.concepto_partida || ""), 44)), MAX_ROWS);
    const linesJust = padLines(detalleRows.map((r) => cut(String(r?.justificacion || ""), 52)), MAX_ROWS);
    const linesDesc = padLines(detalleRows.map((r) => cut(String(r?.descripcion || ""), 52)), MAX_ROWS);
    const linesImp = padLines(detalleRows.map((r) => safeNumber(r?.importe).toFixed(2)), MAX_ROWS);

    setTextSafe("No", linesNo.join("\n"), sizeSmall);
    setTextSafe("CLAVE", linesClave.join("\n"), sizeSmall);
    setTextSafe("CONCEPTO DE PARTIDA", linesConcepto.join("\n"), sizeSmall);
    setTextSafe("JUSTIFICACIÓN", linesJust.join("\n"), sizeSmall);
    setTextSafe("DESCRIPCIÓN", linesDesc.join("\n"), sizeSmall);
    setTextSafe("IMPORTE", linesImp.join("\n"), sizeSmall);

    // Totales y meta
    setTextSafe("subtotal", safeNumber(payload.subtotal).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("IVA", safeNumber(payload.iva).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("ISR", safeNumber(payload.isr).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("IEPS", safeNumber(payload.ieps).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("PENSION", safeNumber(payload.pension_total).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("total", safeNumber(payload.total).toFixed(2), sizeSmall, PDFLib?.TextAlignment?.Right);
    setTextSafe("CANTIDAD CON LETRA:", payload.cantidad_con_letra || "", sizeTiny);
    setTextSafe("Meta", payload.meta || "", sizeSmall);

    try {
      form.flatten();
    } catch (e) {
      console.warn("[COMP][PDF] flatten falló:", e?.message || e);
    }

    const outBytes = await pdfDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const folioRaw = String(payload.no_comprometido || "").trim();
    const folio =
      (folioRaw &&
        (folioRaw.match(/^ECA-\d{4}-\d{2}-CP-\d{4}$/)
          ? folioRaw
          : (() => {
              const m = folioRaw.match(/^ECA-(\d{4})-(\d{2})-CP-(\d{1,6})$/i);
              if (m) {
                return `ECA-${m[1]}-${m[2]}-CP-${String(m[3]).padStart(4, "0")}`;
              }
              const onlyDigits = folioRaw.replace(/\D/g, "");
              if (onlyDigits) {
                const f = String(payload.fecha || "");
                const year =
                  f && /^\d{4}-\d{2}-\d{2}$/.test(f)
                    ? f.slice(0, 4)
                    : String(new Date().getFullYear());
                const month =
                  f && /^\d{4}-\d{2}-\d{2}$/.test(f)
                    ? f.slice(5, 7)
                    : String(new Date().getMonth() + 1).padStart(2, "0");
                const num = onlyDigits.padStart(4, "0");
                return `ECA-${year}-${month}-CP-${num}`;
              }
              return "COMPROMETIDO";
            })())) ||
      "COMPROMETIDO";
    a.download = `${folio}.pdf`;
    try {
      setTextByPattern(["no", "comprometido"], String(payload.no_comprometido || ""), sizeSmall, PDFLib?.TextAlignment?.Center);
    } catch {}
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents(state) {
    const btnBuscarSuf = document.getElementById("btnBuscarSuf");
    const txtNumeroSuf =
      document.getElementById("txtFolioSuf") ||
      document.getElementById("txtNumeroSuf");

    if (btnDescargarPdf) btnDescargarPdf.type = "button";
    updateDownloadLock(state);

    btnBuscarSuf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await buscarPorFolioGeneral(txtNumeroSuf?.value || "");
        if (!res?.kind) return;
        if (res.kind === "SP") {
          const raw = await cargarSuficienciaEnComprometido(res.value);
          if (!raw) return;
          state.payload = renderPayload(raw);
          updateDownloadLock(state);
          await uiSuccess("Suficiencia cargada correctamente.", "Buscar");
        } else if (res.kind === "CP") {
          state.payload = renderPayload(res.value);
          updateDownloadLock(state);
          await uiSuccess("Comprometido cargado correctamente.", "Buscar");
        }
      } catch (err) {
        console.error("[COMPROMETIDO] buscar suf error:", err);
        await uiError(err?.message || "Error en la búsqueda", "Buscar");
      }
    });

    txtNumeroSuf?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnBuscarSuf?.click();
      }
    });

    btnDescargarPdf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        let idRef = Number(state?.payload?.id_comprometido || 0);
        if (!(Number.isFinite(idRef) && idRef > 0)) {
          await uiWarn("Primero guarda el Comprometido para poder descargar el PDF.", "PDF");
          return;
        }
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
        updateDownloadLock(state);
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
          }),
        );

        await uiSuccess(
          `Comprometido guardado: ${r.no_comprometido}`,
          "Guardado",
        );
        updateDownloadLock(state);
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
        }),
      );

      window.location.href = `devengado.html?id=${encodeURIComponent(String(idRef))}`;
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    const state = { payload: null };

    const hasInitial = !!getQueryId();

if (hasSwal() && hasInitial) {
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

      if (!raw) {
        clearUI();
        state.payload = null;
      } else {
        state.payload = renderPayload(raw);
      }
      await applyIEPSPensionesPermissions();
    } catch (err) {
      console.error("[COMPROMETIDO]", err);
      await uiError(err?.message || "No se pudieron cargar datos");
    } finally {
      if (hasSwal() && hasInitial) Swal.close();
    }

    bindEvents(state);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
