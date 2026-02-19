(() => {
  const MAX_ROWS = 20;
  const START_ROWS = 3;
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const DEBUG_PDF_FIELDS = true;
  const SUF_PDF_TEMPLATE_URL = "/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf";

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnSi = document.getElementById("btn-si-seguro");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");

  const DG_DA_PROYECTOS_FILTERS = window.DG_DA_PROYECTOS_FILTERS || {};
  const DG_DA_FUENTES_FILTERS = window.DG_DA_FUENTES_FILTERS || {};

  const btnAddRow = document.getElementById("btn-add-row");
  const btnRemoveRow = document.getElementById("btn-remove-row");
  const detalleBody = document.getElementById("detalleBody");

  const modalEl = document.getElementById("modalConfirm");
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

  // ---------------------------
  // BUSCADOR
  // ---------------------------
  const btnAbrirBuscarSuf = document.getElementById("btnAbrirBuscarSuf");
  const modalBuscarEl = document.getElementById("modalBuscarSuf");
  const modalBuscar = modalBuscarEl ? new bootstrap.Modal(modalBuscarEl) : null;
  const txtNumeroSuf = document.getElementById("txtNumeroSuf");
  const btnBuscarNumero = document.getElementById("btnBuscarNumero");

  let lastSavedId = null;

  let dgeneralInfo = null;
  let dauxiliarInfo = null;
  let proyectosById = {};
  let partidasRows = [];
  let partidasMap = {};
  let fuentesMap = {};

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

  function getLoggedUser() {
    try {
      return JSON.parse(localStorage.getItem("cp_usuario") || "null");
    } catch {
      return null;
    }
  }

  // ---------------------------
  // Helpers DOM
  // ---------------------------
  const get = (name) => document.querySelector(`[name="${name}"]`)?.value ?? "";

  const setVal = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? "";
  };

  const setReadonly = (name, ro = true) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.readOnly = !!ro;
  };

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

  // ---------------------------
  // SweetAlert2 helpers
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

  const uiSuccess = (m, t = "Listo") => uiAlert(m, "success", t);
  const uiError = (m, t = "Error") => uiAlert(m, "error", t);
  const uiWarn = (m, t = "Atención") => uiAlert(m, "warning", t);

  // ---------------------------
  // Folio buscador helpers
  // ---------------------------
  function normalizeFolioInput(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";

    const m = raw.match(/ECA-(\d{4})-(\d{2})-SP-(\d{1,6})/i);
    if (m) {
      const year = m[1];
      const month = m[2];
      const num = String(m[3]).padStart(4, "0");
      return `ECA-${year}-${month}-SP-${num}`;
    }

    if (/^\d{1,6}$/.test(raw)) {
      const num = raw.padStart(4, "0");
      const f = get("fecha");
      let year, month;

      if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
        year = f.slice(0, 4);
        month = f.slice(5, 7);
      } else {
        const d = new Date();
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, "0");
      }
      return `ECA-${year}-${month}-SP-${num}`;
    }

    const onlyDigits = raw.replace(/\D/g, "");
    if (onlyDigits && onlyDigits.length <= 6) {
      const num = onlyDigits.padStart(4, "0");
      const f = get("fecha");
      let year, month;

      if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
        year = f.slice(0, 4);
        month = f.slice(5, 7);
      } else {
        const d = new Date();
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, "0");
      }
      return `ECA-${year}-${month}-SP-${num}`;
    }

    return "";
  }

  async function buscarPorNumero(numero) {
    const raw = String(numero || "").trim();
    if (!raw) return;

    const folio = normalizeFolioInput(raw);
    if (!folio) {
      await uiWarn("Escribe el folio como ECA-2026-01-SP-0001 o solo 0001.");
      return;
    }

    const url = `${API}/api/suficiencias/buscar?numero=${encodeURIComponent(
      folio,
    )}`;
    const json = await fetchJson(url, { headers: { ...authHeaders() } });
    renderResultadosBusqueda(json?.data || []);
  }

  async function renderResultadosBusqueda(rows) {
    if (!rows || !rows.length) {
      await uiWarn("No encontrada (o no corresponde a tu área).");
      return;
    }

    if (rows.length === 1) {
      cargarSuficienciaEnFormulario(rows[0].id);
      return;
    }

    if (!hasSwal()) {
      await uiWarn(
        "Falta SweetAlert2 para mostrar lista de resultados. (Swal no existe).",
      );
      return;
    }

    const listHtml = `
      <div class="list-group text-start">
        ${rows
          .map((r) => {
            const folio = r.no_suficiencia || "—";
            const fecha = r.fecha ? String(r.fecha).split("T")[0] : "";
            return `
              <button type="button"
                class="list-group-item list-group-item-action"
                data-id="${r.id}">
                <div class="fw-semibold">${folio}</div>
                <small class="text-muted">${fecha}</small>
              </button>
            `;
          })
          .join("")}
      </div>
    `;

    await Swal.fire({
      title: "Selecciona una Suficiencia",
      html: listHtml,
      icon: "info",
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: "Cancelar",
      cancelButtonColor: "#6c757d",
      didOpen: () => {
        const container = Swal.getHtmlContainer();
        if (!container) return;

        container.querySelectorAll("button[data-id]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = Number(btn.dataset.id);
            Swal.close();
            cargarSuficienciaEnFormulario(id);
          });
        });
      },
    });
  }

  // ---------------------------
  // Fecha automática (hoy) + readonly
  // ---------------------------
  function setFechaHoy() {
    const el = document.querySelector('[name="fecha"]');
    if (!el) return;
    el.readOnly = true;
    if (el.value) return;

    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, "0");
    const dd = String(hoy.getDate()).padStart(2, "0");
    el.value = `${yyyy}-${mm}-${dd}`;
  }

  // ---------------------------
  // Cantidad pago: SOLO lectura
  // ---------------------------
  function lockCantidadPago() {
    const cantEl = document.querySelector('[name="cantidad_pago"]');
    if (!cantEl) return;

    cantEl.readOnly = true;
    cantEl.tabIndex = -1;
    cantEl.style.pointerEvents = "none";
    cantEl.style.userSelect = "none";
    cantEl.classList.add(
      "as-text",
      "td-text",
      "text-strong",
      "text-end",
      "input-no-click",
    );
  }

  // ---------------------------
  // Folio UI
  // ---------------------------
  function initFolioUI() {
    setVal("no_suficiencia", "");
    const el = document.querySelector('[name="no_suficiencia"]');
    if (el) {
      el.readOnly = true;
      el.placeholder = "Se asignará al guardar";
    }
  }

  // ---------------------------
  // Catálogo de partidas (permitidas por área)
  // ---------------------------
  async function loadPartidasCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/partidas-permitidas`, {
      headers: { ...authHeaders() },
    });

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    partidasRows = rows.filter((r) => r && r.clave);

    partidasMap = {};
    for (const r of partidasRows) {
      const clave = String(r.clave || "").trim();
      const desc = String(r.partida ?? r.descripcion ?? "").trim();
      if (clave) partidasMap[clave] = desc;
    }
  }

  // ---------------------------
  // UI partidas select
  // ---------------------------
  function buildPartidasOptionsHtml(selectedClave = "") {
    const cur = String(selectedClave || "").trim();
    const opts = partidasRows
      .map((r) => {
        const c = String(r.clave || "").trim();
        const d = String(r.partida || "").trim();
        const sel = c === cur ? "selected" : "";
        return `<option value="${c}" ${sel}>${c} - ${d}</option>`;
      })
      .join("");

    return `<option value="">-- Selecciona --</option>${opts}`;
  }

  function refreshPartidaSelects() {
    const selects = document.querySelectorAll(
      'select.sp-clave[name^="r"][name$="_clave"]',
    );
    selects.forEach((sel) => {
      const current = sel.value;
      sel.innerHTML = buildPartidasOptionsHtml(current);
    });
  }

  // ---------------------------
  // Renglones dinámicos
  // ---------------------------
  function rowCount() {
    return detalleBody ? detalleBody.querySelectorAll("tr").length : 0;
  }

  function rowTemplate(i) {
    return `
      <tr data-row="${i}">
        <td style="width: 5%;">
          <input type="text" class="form-control form-control-sm cp-readonly text-center" value="${i}" readonly>
        </td>

        <td style="width: 12%;">
          <select class="form-select form-select-sm sp-clave" name="r${i}_clave">
            ${buildPartidasOptionsHtml("")}
          </select>
        </td>

        <td style="width: 20%;">
          <input type="text"
            class="form-control form-control-sm cp-readonly"
            name="r${i}_concepto"
            placeholder="Nombre de la Partida"
            readonly>
        </td>

        <td style="width: 20%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_justificacion" placeholder="Justificación">
        </td>

        <td style="width: 33%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_descripcion" placeholder="Descripción">
        </td>

        <td style="width: 10%;">
          <input type="text"
            class="form-control form-control-sm text-end sp-importe"
            name="r${i}_importe"
            value="$ 0.00"
            inputmode="decimal"
            autocomplete="off">
        </td>
      </tr>
    `;
  }

  function addRow() {
    if (!detalleBody) return;

    const next = rowCount() + 1;
    if (next > MAX_ROWS) {
      uiWarn(`Máximo ${MAX_ROWS} renglones.`);
      return;
    }

    detalleBody.insertAdjacentHTML("beforeend", rowTemplate(next));
    attachMoneyInputs(detalleBody);
    refreshTotales();
  }

  function renumberRows() {
    const rows = detalleBody
      ? Array.from(detalleBody.querySelectorAll("tr"))
      : [];
    rows.forEach((tr, idx) => {
      const i = idx + 1;
      tr.setAttribute("data-row", String(i));

      const noInput = tr.querySelector("td:first-child input");
      if (noInput) noInput.value = String(i);

      const clave = tr.querySelector(".sp-clave");
      const concepto = tr.querySelector(`[name^="r"][name$="_concepto"]`);
      const just = tr.querySelector(`[name^="r"][name$="_justificacion"]`);
      const desc = tr.querySelector(`[name^="r"][name$="_descripcion"]`);
      const imp = tr.querySelector(".sp-importe");

      if (clave) clave.name = `r${i}_clave`;
      if (concepto) concepto.name = `r${i}_concepto`;
      if (just) just.name = `r${i}_justificacion`;
      if (desc) desc.name = `r${i}_descripcion`;
      if (imp) imp.name = `r${i}_importe`;
    });
  }

  function removeRow() {
    if (!detalleBody) return;

    const n = rowCount();
    if (n <= START_ROWS) {
      uiWarn(`Debes dejar mínimo ${START_ROWS} filas.`);
      return;
    }

    detalleBody.lastElementChild?.remove();
    renumberRows();
    refreshTotales();
  }

  function initRows() {
    if (!detalleBody) return;
    detalleBody.innerHTML = "";
    for (let i = 0; i < START_ROWS; i++) addRow();
  }

  // ---------------------------
  // Totales + letras
  // ---------------------------
  function buildDetalle() {
    const rows = [];
    const n = rowCount();

    for (let i = 1; i <= n; i++) {
      rows.push({
        renglon: i,
        clave: get(`r${i}_clave`),
        concepto_partida: get(`r${i}_concepto`),
        justificacion: get(`r${i}_justificacion`),
        descripcion: get(`r${i}_descripcion`),
        importe: moneyParse(get(`r${i}_importe`)),
      });
    }
    return rows;
  }

  function calcSubtotal(detalle) {
    return (detalle || []).reduce((acc, r) => acc + safeNumber(r?.importe), 0);
  }

  // ✅ detecta check por name O id
  function isCheckedAny(selector) {
    return !!document.querySelector(selector)?.checked;
  }

  function useIVA() {
    return isCheckedAny('[name="imp_iva"], #imp_iva');
  }
  function useISR() {
    return isCheckedAny('[name="imp_isr"], #imp_isr');
  }
  function useIEPS() {
    return isCheckedAny('[name="imp_ieps"], #imp_ieps');
  }
  function usePension() {
    return isCheckedAny('[name="imp_pension"], #imp_pension');
  }

  function clampPercent(val) {
    const raw = String(val ?? "").replace(",", ".");
    const clean = raw.replace(/[^0-9.]/g, "");
    let n = Number(clean);

    if (!Number.isFinite(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function getRateValue(selectors, debugLabel) {
    const el = document.querySelector(selectors);
    if (!el) {
      console.warn(`[SP] Falta input de tasa: ${debugLabel} (${selectors})`);
      return 0;
    }
    return clampPercent(el.value || 0) / 100;
  }

  function getIsrRate() {
    return getRateValue('[name="isr_tasa"], #isr_tasa', "ISR");
  }

  function getIepsRate() {
    return getRateValue('[name="ieps_tasa"], #ieps_tasa', "IEPS");
  }

  function getPensionPercents() {
    const inputs = Array.from(
      document.querySelectorAll('[name^="pension"][name$="_tasa"]'),
    ).slice(0, 5);

    return inputs
      .map((el, idx) => {
        const v = clampPercent(el.value);
        return { k: idx + 1, percent: v, rate: v / 100 };
      })
      .filter((p) => p.percent > 0);
  }

  function getImpuestoTipo() {
    const iva = useIVA();
    const isr = useISR();
    const ieps = useIEPS();
    if (!iva && !isr && !ieps) return "NONE";
    if (iva && !isr && !ieps) return "IVA";
    if (!iva && isr && !ieps) return "ISR";
    if (!iva && !isr && ieps) return "IEPS";
    return "MIXTO";
  }

  function refreshTotales() {
    const detalle = buildDetalle();
    const subtotal = calcSubtotal(detalle);

    let iva = 0;
    let isr = 0;
    let ieps = 0;

    if (useIVA()) iva = subtotal * 0.16;
    if (useISR()) isr = subtotal * getIsrRate();
    if (useIEPS()) ieps = subtotal * getIepsRate();

    let pension_total = 0;
    const pensiones = usePension() ? getPensionPercents() : [];
    for (const p of pensiones) pension_total += subtotal * (p.rate || 0);

    const total = subtotal + iva + isr + ieps - pension_total;

    setVal("subtotal", moneyFormat(subtotal));
    setVal("iva", moneyFormat(iva));
    setVal("isr", moneyFormat(isr));
    setVal("ieps", moneyFormat(ieps));
    setVal("pension_total", moneyFormat(pension_total));
    setVal("total", moneyFormat(total));
    setVal("cantidad_pago", moneyFormat(total));
    setVal("cantidad_con_letra", numeroALetrasMX(total));
    formatMoneyFields();
  }

  async function askPercentSwal(title, defaultValue = 10) {
    if (!hasSwal()) {
      const v = prompt(`${title} (0 a 100)`, String(defaultValue));
      return clampPercent(v);
    }

    const { value } = await Swal.fire({
      title,
      input: "text",
      inputValue: String(defaultValue),
      inputPlaceholder: "Ej. 10",
      showCancelButton: true,
      confirmButtonText: "Aceptar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#BC955C",
      inputValidator: (val) => {
        const n = clampPercent(val);
        if (!Number.isFinite(n) || n <= 0)
          return "Escribe un porcentaje válido (1 a 100).";
        return null;
      },
    });

    if (value == null) return null;
    return clampPercent(value);
  }

  function setRateValue(selectors, percent) {
    const el = document.querySelector(selectors);
    if (!el) return;
    el.value = String(percent);
  }

  document.addEventListener("change", (e) => {
    if (!e.target || !e.target.classList.contains("sp-clave")) return;

    const name = e.target.getAttribute("name");
    const match = name?.match(/^r(\d+)_clave$/);
    if (!match) return;

    const i = match[1];
    const clave = String(e.target.value || "").trim();
    const concepto = partidasMap[clave] || "";

    setVal(`r${i}_concepto`, concepto);

    e.target.classList.toggle("is-valid", !!concepto);
    e.target.classList.toggle("is-invalid", !concepto);

    refreshTotales();
  });

  document.addEventListener("input", (e) => {
    if (e.target && e.target.classList.contains("sp-importe")) {
      refreshTotales();
    }
  });

  // ---------------------------
  // Número a letras (MXN)
  // ---------------------------
  function numeroALetrasMX(monto) {
    const n = safeNumber(monto);
    const entero = Math.floor(n);
    const centavos = Math.round((n - entero) * 100);
    const letras = numeroALetras(entero);
    const cent = String(centavos).padStart(2, "0");
    return `${letras} PESOS ${cent}/100 M.N.`;
  }

  function numeroALetras(num) {
    if (num === 0) return "CERO";
    if (num < 0) return "MENOS " + numeroALetras(Math.abs(num));

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
    ];
    const decenas10 = [
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
      if (n === 0) return "";
      if (n === 100) return "CIEN";

      let out = "";
      const c = Math.floor(n / 100);
      const du = n % 100;
      const d = Math.floor(du / 10);
      const u = du % 10;

      if (c) out += centenas[c] + " ";
      if (du >= 10 && du <= 19) return (out + decenas10[du - 10]).trim();
      if (d === 2 && u !== 0)
        return (out + ("VEINTI" + unidades[u].toLowerCase()))
          .toUpperCase()
          .trim();

      if (d) {
        out += decenas[d];
        if (u) out += " Y " + unidades[u];
        return out.trim();
      }

      if (u) out += unidades[u];
      return out.trim();
    }

    function miles(n) {
      if (n < 1000) return seccion(n);
      const m = Math.floor(n / 1000);
      const r = n % 1000;
      let out = m === 1 ? "MIL" : seccion(m) + " MIL";
      if (r) out += " " + seccion(r);
      return out.trim();
    }

    function millones(n) {
      if (n < 1_000_000) return miles(n);
      const m = Math.floor(n / 1_000_000);
      const r = n % 1_000_000;
      let out = m === 1 ? "UN MILLÓN" : miles(m) + " MILLONES";
      if (r) out += " " + miles(r);
      return out.trim();
    }

    return millones(num).trim().toUpperCase();
  }

  // ---------------------------
  // Dependencias desde usuario (dgeneral + dauxiliar)
  // ---------------------------
  async function loadDependenciasFromUser() {
    setReadonly("dependencia", true);
    setReadonly("dependencia_aux", true);

    const user = getLoggedUser();
    const idDg = user?.id_dgeneral != null ? Number(user.id_dgeneral) : null;
    const idDa = user?.id_dauxiliar != null ? Number(user.id_dauxiliar) : null;

    setVal("id_dgeneral", idDg ?? "");
    setVal("id_dauxiliar", idDa ?? "");

    const [dgCatalog, daCatalog] = await Promise.all([
      fetchJson(`${API}/api/catalogos/dgeneral`, {
        headers: { ...authHeaders() },
      }),
      fetchJson(`${API}/api/catalogos/dauxiliar`, {
        headers: { ...authHeaders() },
      }),
    ]);

    dgeneralInfo = (dgCatalog || []).find((x) => Number(x.id) === idDg) || null;
    dauxiliarInfo =
      (daCatalog || []).find((x) => Number(x.id) === idDa) || null;

    const depGenNombre =
      dgeneralInfo?.dependencia || user?.dgeneral_nombre || "";
    const depAuxNombre =
      dauxiliarInfo?.dependencia || user?.dauxiliar_nombre || "";

    setVal("dependencia", depGenNombre);
    setVal("dependencia_aux", depAuxNombre);

    const inputDireccionFirma = document.querySelector(
      '[name="firma_direccion_solicitante"]',
    );
    if (inputDireccionFirma) {
      const nombreDireccion =
        dgeneralInfo?.dependencia || dgeneralInfo?.nombre || "";
      inputDireccionFirma.value = nombreDireccion;
    }

    updateClaveProgramatica();
    if (Object.keys(proyectosById || {}).length) applyProyectoFilters();
  }

  // ---------------------------
  // Proyectos desde catálogo
  // ---------------------------
  async function loadProyectosCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/proyectos`, {
      headers: { ...authHeaders() },
    });

    proyectosById = {};
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.rows)
        ? data.rows
        : [];

    const parseClaveConac = (claveRaw, conacRaw) => {
      let clave = String(claveRaw ?? "").trim();
      let conac = String(conacRaw ?? "").trim();

      const parts = clave.split(/\s+/).filter(Boolean);
      if (!conac && parts.length >= 2) {
        const last = parts[parts.length - 1];
        if (/^[A-Z]$/i.test(last)) {
          conac = last.toUpperCase();
          clave = parts.slice(0, -1).join("").trim();
        }
      }

      clave = String(claveRaw ?? "")
        .trim()
        .toUpperCase();
      conac = String(conac || "")
        .trim()
        .toUpperCase();
      return { clave, conac };
    };

    items.forEach((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;

      const parsed = parseClaveConac(p.clave, p.conac);

      proyectosById[id] = {
        id,
        clave: parsed.clave,
        conac: parsed.conac,
        descripcion: String(p.descripcion ?? "").trim(),
      };
    });
  }

  // ---------------------------
  // Fuentes
  // ---------------------------
  function setOptions(selectName, items, getValue, getLabel) {
    const sel = document.querySelector(`[name="${selectName}"]`);
    if (!sel) return;

    sel.innerHTML = `<option value="">-- Selecciona --</option>`;
    for (const it of items || []) {
      const opt = document.createElement("option");
      opt.value = String(getValue(it) ?? "");
      opt.textContent = String(getLabel(it) ?? "");
      sel.appendChild(opt);
    }
  }

  async function loadFuentesCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/fuentes`, {
      headers: { ...authHeaders() },
    });

    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.rows)
        ? data.rows
        : [];

    fuentesMap = {};
    rows.forEach((x) => {
      const id = String(x.id ?? "").trim();
      if (!id) return;

      const clave = String(x.clave ?? "").trim();
      const fuente = String(x.fuente ?? "").trim();
      fuentesMap[id] = { clave, fuente };
    });

    setOptions(
      "fuente",
      rows,
      (x) => x.id,
      (x) =>
        `${String(x.clave ?? "").trim()} - ${String(x.fuente ?? "").trim()}`,
    );

    window.fuentesMap = window.fuentesMap || {};
    window.fuentesMap = {};
    (data || []).forEach((x) => {
      const id = String(x.id ?? "").trim();
      if (!id) return;
      window.fuentesMap[id] = {
        clave: String(x.clave ?? "").trim(),
        fuente: String(x.fuente ?? "").trim(),
      };
    });
  }

  function bindFuenteToHidden() {
    const sel = document.querySelector('[name="fuente"]');
    if (!sel) return;
    sel.addEventListener("change", () => setVal("id_fuente", sel.value || ""));
    setVal("id_fuente", sel.value || "");
  }

  // ---------------------------
  // Clave programática
  // ---------------------------
  function updateClaveProgramatica() {
    const idProyecto = Number(get("id_proyecto") || 0);
    const p = proyectosById[idProyecto];

    const dg = dgeneralInfo?.clave ? String(dgeneralInfo.clave).trim() : "";
    const da = dauxiliarInfo?.clave ? String(dauxiliarInfo.clave).trim() : "";

    const projClave = p ? String(p.clave || "").trim() : "";
    const projConac = p ? String(p.conac || "").trim() : "";
    const projClaveConac = projConac ? `${projClave} ${projConac}` : projClave;

    const claveProg = [dg, da, projClaveConac].filter(Boolean).join(" ");
    setVal("clave_programatica", claveProg);

    const descEl = document.getElementById("claveProgDesc");
    if (descEl) descEl.textContent = p?.descripcion || "—";
  }

  function syncMetaFromProyecto() {
    const idProyecto = Number(get("id_proyecto") || 0);
    const p = proyectosById[idProyecto];
    const metaText = p?.descripcion ? String(p.descripcion).trim() : "";
    setVal("meta", metaText);

    const selMeta = document.querySelector('[name="id_meta"]');
    if (selMeta) {
      selMeta.disabled = true;
      selMeta.value = "";
    }
  }

  // =====================================================
  // CANDADOS DG/DA -> PROYECTOS permitidos
  // =====================================================
  function _norm(v) {
    return String(v || "")
      .trim()
      .toUpperCase();
  }
  function _normNum(v) {
    return String(v || "").trim();
  }

  function getAllowedProyectoSet() {
    const dg = _norm(dgeneralInfo?.clave);
    const da = _normNum(dauxiliarInfo?.clave);
    if (!dg || !da) return null;

    const dgRules = DG_DA_PROYECTOS_FILTERS[dg];
    if (!dgRules) return new Set();

    return dgRules[da] || new Set();
  }

  function getAllowedFuenteSet() {
    const dg = _norm(
      document.querySelector('input[name="id_dgeneral"]')?.value,
    );
    const da = _norm(
      document.querySelector('input[name="id_dauxiliar"]')?.value,
    );

    const key = `${dg}|${da}`;
    const allowed = DG_DA_FUENTES_FILTERS[key];

    if (!allowed) return null;
    return new Set(allowed.map(String));
  }

  function applyProyectoFilters() {
    const sel = document.querySelector('[name="id_proyecto"]');
    if (!sel) return;

    const all = Object.values(proyectosById || {});
    if (!all.length) return;

    const allowed = getAllowedProyectoSet();

    const rows =
      allowed === null
        ? all
        : all.filter((p) => {
            let clave = String(p?.clave ?? "")
              .trim()
              .replace(/[^\d]/g, "");
            if (clave) clave = clave.padStart(10, "0");
            const conac = _norm(p?.conac);
            return allowed.has(`${clave}|${conac}`);
          });

    sel.innerHTML = `<option value="">-- Selecciona un proyecto --</option>`;

    if (!rows.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— Sin proyectos permitidos para tu DG/DA —";
      sel.appendChild(opt);
      sel.value = "";
      updateClaveProgramatica();
      syncMetaFromProyecto();
      return;
    }

    rows.forEach((p) => {
      const opt = document.createElement("option");
      const clave = String(p.clave || "").trim();
      const conac = String(p.conac || "").trim();
      const claveConac = conac ? `${clave} ${conac}` : clave;

      opt.value = String(p.id);
      opt.textContent = `${claveConac} - ${p.descripcion}`.trim();
      sel.appendChild(opt);
    });

    updateClaveProgramatica();
    syncMetaFromProyecto();
  }

  // ===========================
  // Cargar suficiencia al formulario
  // ===========================
  async function cargarSuficienciaEnFormulario(id) {
    const data = await fetchJson(`${API}/api/suficiencias/${id}`, {
      headers: { ...authHeaders() },
    });

    if (!data) {
      await uiError("No se pudo cargar la suficiencia.");
      return;
    }

    const user = getLoggedUser();
    const myDg = Number(user?.id_dgeneral);
    const myDa = Number(user?.id_dauxiliar);

    if (
      Number.isFinite(myDg) &&
      Number.isFinite(myDa) &&
      (Number(data.id_dgeneral) !== myDg || Number(data.id_dauxiliar) !== myDa)
    ) {
      await uiWarn("Esta suficiencia no corresponde a tu área (DG/DA).");
      return;
    }

    setVal("no_suficiencia", data.no_suficiencia || "");
    setVal("fecha", data.fecha ? String(data.fecha).split("T")[0] : "");
    setVal("dependencia", data.dependencia || "");
    setVal("dependencia_aux", data.departamento || data.dependencia_aux || "");
    setVal("mes_pago", data.mes_pago || "");
    setVal("clave_programatica", data.clave_programatica || "");

    if (!Object.keys(proyectosById || {}).length) await loadProyectosCatalog();
    applyProyectoFilters();

    const idProy = data.id_proyecto != null ? String(data.id_proyecto) : "";
    setVal("id_proyecto", idProy);

    updateClaveProgramatica();
    syncMetaFromProyecto();

    if (data.id_fuente != null) {
      setVal("fuente", String(data.id_fuente));
      setVal("id_fuente", String(data.id_fuente));
    }

    setVal("subtotal", moneyFormat(safeNumber(data.subtotal)));
    setVal("iva", moneyFormat(safeNumber(data.iva)));
    setVal("isr", moneyFormat(safeNumber(data.isr)));
    setVal("ieps", moneyFormat(safeNumber(data.ieps)));
    setVal("pension_total", moneyFormat(safeNumber(data.pension_total)));
    setVal("total", moneyFormat(safeNumber(data.total)));
    setVal("cantidad_pago", moneyFormat(safeNumber(data.total)));

    formatMoneyFields();
    setVal("cantidad_con_letra", data.cantidad_con_letra || "");

    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    if (detalleBody) {
      detalleBody.innerHTML = "";
      detalle.forEach((row, idx) => {
        const i = idx + 1;
        detalleBody.insertAdjacentHTML("beforeend", rowTemplate(i));

        const sel = document.querySelector(`[name="r${i}_clave"]`);
        const clave = String(row.clave || "").trim();
        if (sel) {
          sel.innerHTML = buildPartidasOptionsHtml(clave);
          if (clave && ![...sel.options].some((o) => o.value === clave)) {
            const opt = document.createElement("option");
            opt.value = clave;
            opt.textContent = `${clave} - (NO DISPONIBLE)`;
            sel.appendChild(opt);
          }
          sel.value = clave || "";
        }

        setVal(
          `r${i}_concepto`,
          partidasMap[clave] || row.concepto_partida || "",
        );
        setVal(`r${i}_justificacion`, row.justificacion || "");
        setVal(`r${i}_descripcion`, row.descripcion || "");
        setVal(`r${i}_importe`, moneyFormat(safeNumber(row.importe)));
      });

      if (!detalle.length) initRows();
    }

    attachMoneyInputs(detalleBody);
    refreshTotales();
    formatMoneyFields();

    lastSavedId = Number(data.id);

    localStorage.setItem("cp_last_suf_id", String(lastSavedId));
    sessionStorage.setItem("cp_last_suf_id", String(lastSavedId));

    const aComp = document.getElementById("linkComprometido");
    if (aComp) aComp.href = `comprometido.html?id=${lastSavedId}`;

    const aDev = document.getElementById("linkDevengado");
    if (aDev) aDev.href = `devengado.html?id=${lastSavedId}`;

    modalBuscar?.hide?.();
    await uiSuccess("Suficiencia cargada correctamente.");
  }

  // =====================================================================
  // Guardado (API)
  // =====================================================================
  function buildPayload() {
    const user = getLoggedUser();
    const id_usuario = user?.id != null ? Number(user.id) : null;

    const id_proyecto = get("id_proyecto") ? Number(get("id_proyecto")) : null;
    const id_fuente = get("fuente") ? Number(get("fuente")) : null;

    const fuenteText =
      document
        .querySelector('[name="fuente"]')
        ?.selectedOptions?.[0]?.textContent?.trim() || "";

    const meta = get("meta") || null;
    const departamento = get("dependencia_aux") || null;

    const subtotal = moneyParse(get("subtotal"));

    const p1 = clampPercent(get("pension1_tasa")) / 100;
    const p2 = clampPercent(get("pension2_tasa")) / 100;
    const p3 = clampPercent(get("pension3_tasa")) / 100;
    const p4 = clampPercent(get("pension4_tasa")) / 100;
    const p5 = clampPercent(get("pension5_tasa")) / 100;

    const pension1 = usePension() ? subtotal * p1 : 0;
    const pension2 = usePension() ? subtotal * p2 : 0;
    const pension3 = usePension() ? subtotal * p3 : 0;
    const pension4 = usePension() ? subtotal * p4 : 0;
    const pension5 = usePension() ? subtotal * p5 : 0;

    return {
      id_usuario,
      id_dgeneral: get("id_dgeneral") ? Number(get("id_dgeneral")) : null,
      id_dauxiliar: get("id_dauxiliar") ? Number(get("id_dauxiliar")) : null,
      id_proyecto,
      id_fuente,

      no_suficiencia: null,
      fecha: get("fecha") || null,
      dependencia: get("dependencia") || null,
      departamento,
      fuente: fuenteText,
      mes_pago: get("mes_pago") || null,
      clave_programatica: get("clave_programatica") || null,
      meta,

      impuesto_tipo: getImpuestoTipo(),
      isr_tasa: get("isr_tasa") || null,
      ieps_tasa: get("ieps_tasa") || null,

      subtotal: moneyParse(get("subtotal")),
      iva: moneyParse(get("iva")),
      isr: moneyParse(get("isr")),
      ieps: moneyParse(get("ieps")),
      total: moneyParse(get("total")),
      pension_total: moneyParse(get("pension_total")),
      cantidad_con_letra: get("cantidad_con_letra") || "",

      detalle: buildDetalle(),

      pension1_tasa: get("pension1_tasa") || null,
      pension2_tasa: get("pension2_tasa") || null,
      pension3_tasa: get("pension3_tasa") || null,
      pension4_tasa: get("pension4_tasa") || null,
      pension5_tasa: get("pension5_tasa") || null,

      pension1,
      pension2,
      pension3,
      pension4,
      pension5,
    };
  }

  async function save() {
    refreshTotales();
    const payloadBackend = buildPayload();

    if (!payloadBackend.id_usuario) {
      throw new Error(
        "No se detectó el usuario logueado (cp_usuario). Vuelve a iniciar sesión.",
      );
    }
    if (!payloadBackend.id_proyecto)
      throw new Error("Selecciona un PROYECTO antes de guardar.");
    if (!payloadBackend.id_fuente)
      throw new Error("Selecciona una FUENTE antes de guardar.");

    const saved = await fetchJson(`${API}/api/suficiencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payloadBackend),
    });

    if (!saved || !saved.id)
      throw new Error("El servidor no devolvió el ID del registro.");

    lastSavedId = Number(saved.id);

    localStorage.setItem("cp_last_suf_id", String(lastSavedId));
    sessionStorage.setItem("cp_last_suf_id", String(lastSavedId));

    const aComp = document.getElementById("linkComprometido");
    if (aComp) aComp.href = `comprometido.html?id=${lastSavedId}`;

    const aDev = document.getElementById("linkDevengado");
    if (aDev) aDev.href = `devengado.html?id=${lastSavedId}`;

    if (saved.no_suficiencia)
      setVal("no_suficiencia", String(saved.no_suficiencia));
    else if (saved.folio_num != null)
      setVal("no_suficiencia", String(saved.folio_num).padStart(6, "0"));

    await uiSuccess("Guardado correctamente.");
    return saved;
  }

  // =====================================================
  // EVENTOS DE IMPUESTOS / TASAS / PENSIONES
  // =====================================================
  function bindTaxEvents() {
    const listen = (sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.addEventListener("change", refreshTotales);
        el.addEventListener("input", refreshTotales);
      });
    };

    listen('[name="imp_iva"], #imp_iva');
    listen('[name="imp_isr"], #imp_isr');
    listen('[name="imp_ieps"], #imp_ieps');
    listen('[name="imp_pension"], #imp_pension');

    listen('[name="isr_tasa"], #isr_tasa');
    listen('[name="ieps_tasa"], #ieps_tasa');
    listen('[name^="pension"][name$="_tasa"]');
  }

  // ==============================
  //  MONEDA MXN
  // ==============================
  const MXN = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function moneyParse(str) {
    const clean = String(str ?? "").replace(/[^0-9.-]/g, "");
    const n = parseFloat(clean);
    return Number.isFinite(n) ? n : 0;
  }

  function moneyFormat(n) {
    const num = Number.isFinite(+n) ? +n : 0;
    return MXN.format(num);
  }

  function moneySanitizeTyping(str) {
    let s = String(str ?? "");
    s = s.replace(/[^\d.-]/g, "");
    s = s.replace(/(?!^)-/g, "");
    const parts = s.split(".");
    if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join("");
    if (s.includes(".")) {
      const [a, b] = s.split(".");
      s = a + "." + b.slice(0, 2);
    }
    return s;
  }

  function attachMoneyInputs(root = document) {
    root.querySelectorAll(".sp-importe").forEach((input) => {
      if (input.dataset.moneyReady === "1") return;
      input.dataset.moneyReady = "1";

      input.value = moneyFormat(moneyParse(input.value));

      input.addEventListener("focus", () => {
        const n = moneyParse(input.value);
        input.value = n ? String(n.toFixed(2)) : "";
        setTimeout(() => input.select(), 0);
      });

      input.addEventListener("input", () => {
        input.value = moneySanitizeTyping(input.value);
      });

      input.addEventListener("blur", () => {
        const n = moneyParse(input.value);
        input.value = moneyFormat(n);
        refreshTotales();
      });

      input.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text");
        input.value = moneySanitizeTyping(text);
      });
    });
  }

  function formatMoneyFields() {
    const names = [
      "subtotal",
      "iva",
      "isr",
      "ieps",
      "pension_total",
      "total",
      "cantidad_pago",
    ];
    names.forEach((nm) => {
      const el = document.querySelector(`[name="${nm}"]`);
      if (!el) return;
      el.value = moneyFormat(moneyParse(el.value));
    });
  }

  // ---------------------------
  // PDF SUFICIENCIA (pdf-lib)
  // ---------------------------
  async function fetchPdfTemplateBytesSuf() {
    const r = await fetch(SUF_PDF_TEMPLATE_URL);
    if (!r.ok) {
      throw new Error(
        `No se pudo cargar la plantilla PDF: ${SUF_PDF_TEMPLATE_URL}`,
      );
    }
    return await r.arrayBuffer();
  }

  async function debugListPdfFields() {
    const bytes = await fetchPdfTemplateBytesSuf();
    const pdfDoc = await PDFLib.PDFDocument.load(bytes);
    const form = pdfDoc.getForm();
    console.log(
      "[PDF] Campos:",
      form.getFields().map((f) => f.getName()),
    );
  }

  async function generarPDF() {
    refreshTotales();

    if (!window.PDFLib?.PDFDocument) {
      throw new Error(
        "Falta pdf-lib. Revisa que el script de pdf-lib cargue antes.",
      );
    }

    const payload = {
      fecha: get("fecha"),
      dependencia: get("dependencia"),
      fuente: get("fuente"),
      mes_pago: get("mes_pago"),
      subtotal: moneyParse(get("subtotal")),
      iva: moneyParse(get("iva")),
      isr: moneyParse(get("isr")),
      ieps: moneyParse(get("ieps")),
      pension_total: moneyParse(get("pension_total")),
      total: moneyParse(get("total")),
      cantidad_con_letra: get("cantidad_con_letra"),
      meta: get("meta"),
      clave_programatica: get("clave_programatica"),
      detalle: buildDetalle(),
      folio_num: get("no_suficiencia"),
    };

    const templateBytes = await fetchPdfTemplateBytesSuf();
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const setTextSafe = (fieldName, value, size, align) => {
      try {
        const f = form.getTextField(fieldName);
        if (size != null) f.setFontSize(size);
        if (align != null && window.PDFLib?.TextAlignment) {
          f.setAlignment(align);
        }
        f.setText(String(value ?? ""));
      } catch {}
    };

    const safeN = (x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : 0;
    };

    const normalizeCell = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    const cut = (v, max) => {
      const s = normalizeCell(v);
      if (!max || s.length <= max) return s;
      return s.slice(0, max);
    };
    const padLines = (arr, max) => {
      const out = arr.slice(0, max);
      while (out.length < max) out.push("");
      return out;
    };

    function splitFechaParts(iso) {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return { d: "", m: "", y: "" };
      const [y, m, d] = iso.split("-");
      return { d, m, y };
    }

    const sizeHeader = 9;
    const sizeSmall = 8;
    const sizeTiny = 7;

    // CABECERA
    const depGeneralName =
      String(dgeneralInfo?.dependencia || "").trim() ||
      String(get("dependencia") || "").trim() ||
      String(getLoggedUser()?.dgeneral_nombre || "").trim();
    setTextSafe(
      "NOMBRE DE LA DEPENDENCIA GENERAL:",
      depGeneralName,
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );
    setTextSafe(
      "CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
      payload.clave_programatica || "",
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );
    const claveProgDesc =
      String(document.getElementById("claveProgDesc")?.textContent || "")
        .trim() ||
      String(get("meta") || "").trim();
    setTextSafe(
      "NOMBRE CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
      claveProgDesc,
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );

    const fuenteSel = document.querySelector('[name="fuente"]');
    const fuenteText = fuenteSel?.selectedOptions?.[0]?.textContent || "";
    const fuenteId = String(get("fuente") || "").trim();
    const fuenteInfo = fuentesMap?.[fuenteId];
    let fuenteClave = String(fuenteInfo?.clave || "").trim();
    let fuenteDesc = String(fuenteInfo?.fuente || "").trim();
    if (!fuenteClave && fuenteText.includes(" - ")) {
      const [c, ...rest] = fuenteText.split(" - ");
      fuenteClave = String(c || "").trim();
      fuenteDesc = rest.join(" - ").trim();
    }

    setTextSafe(
      "FUENTE DE FINANCIAMIENTO",
      fuenteClave || "",
      sizeHeader,
      PDFLib?.TextAlignment?.Center,
    );
    setTextSafe(
      "NOMBRE F.F",
      fuenteDesc || fuenteText || "",
      sizeSmall,
      PDFLib?.TextAlignment?.Center,
    );

    const { d, m, y } = splitFechaParts(payload.fecha);
    setTextSafe("fechadia", d, sizeSmall);
    setTextSafe("fechames", m, sizeSmall);
    setTextSafe("fechayear", y, sizeSmall);

    // PROGRAMACIÓN DE PAGO
    const mesSel = String(payload.mes_pago || "")
      .trim()
      .toUpperCase();
    const totalTxt = safeN(payload.total).toFixed(2);
    const meses = [
      "ENERO",
      "FEBRERO",
      "MARZO",
      "ABRIL",
      "MAYO",
      "JUNIO",
      "JULIO",
      "AGOSTO",
      "SEPTIEMBRE",
      "OCTUBRE",
      "NOVIEMBRE",
      "DICIEMBRE",
    ];
    for (const mes of meses) {
      setTextSafe(
        `${mes}PROGRAMACIÓN DE PAGO`,
        mes === mesSel ? totalTxt : "",
        sizeTiny,
      );
    }

    // DETALLE
    const detalle = Array.isArray(payload.detalle) ? payload.detalle : [];
    const rows = detalle.slice(0, MAX_ROWS);
    const linesNo = padLines(
      rows.map((r, i) => String(r.renglon ?? i + 1)),
      MAX_ROWS,
    );
    const linesClave = padLines(
      rows.map((r) => cut(r.clave || "", 12)),
      MAX_ROWS,
    );
    const linesConcepto = padLines(
      rows.map((r) => cut(r.concepto_partida || "", 46)),
      MAX_ROWS,
    );
    const linesJust = padLines(
      rows.map((r) => cut(r.justificacion || "", 58)),
      MAX_ROWS,
    );
    const linesDesc = padLines(
      rows.map((r) => cut(r.descripcion || "", 58)),
      MAX_ROWS,
    );
    const linesImp = padLines(
      rows.map((r) => safeN(r.importe).toFixed(2)),
      MAX_ROWS,
    );

    setTextSafe("No", linesNo.join("\n"), sizeSmall);
    setTextSafe("CLAVE", linesClave.join("\n"), sizeSmall);
    setTextSafe(
      "CONCEPTO DE PARTIDA",
      linesConcepto.join("\n"),
      sizeSmall,
    );
    setTextSafe("JUSTIFICACIÓN", linesJust.join("\n"), sizeSmall);
    setTextSafe("DESCRIPCIÓN", linesDesc.join("\n"), sizeSmall);
    setTextSafe("IMPORTE", linesImp.join("\n"), sizeSmall);

    // TOTALES
    setTextSafe(
      "subtotal",
      safeN(payload.subtotal).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "IVA",
      safeN(payload.iva).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "ISR",
      safeN(payload.isr).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "IEPS",
      safeN(payload.ieps).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "PENSION",
      safeN(payload.pension_total).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "total",
      safeN(payload.total).toFixed(2),
      sizeSmall,
      PDFLib?.TextAlignment?.Right,
    );
    setTextSafe(
      "CANTIDAD CON LETRA:",
      payload.cantidad_con_letra || "",
      sizeTiny,
    );
    setTextSafe("Meta", payload.meta || "", sizeTiny);

    form.flatten();

    const outBytes = await pdfDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const folio =
      String(payload.folio_num || "")
        .replace(/\D/g, "")
        .padStart(6, "0") || "000000";
    const a = document.createElement("a");
    a.href = url;
    a.download = `SUFICIENCIA_${folio}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents() {
    btnAddRow?.addEventListener("click", addRow);
    btnRemoveRow?.addEventListener("click", removeRow);

    if (btnGuardar) btnGuardar.type = "button";
    if (btnSi) btnSi.type = "button";
    if (btnDescargarPdf) btnDescargarPdf.type = "button";

    btnAbrirBuscarSuf?.addEventListener("click", (e) => {
      e.preventDefault();
      modalBuscar?.show();
      setTimeout(() => txtNumeroSuf?.focus(), 250);
    });

    btnBuscarNumero?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await buscarPorNumero(txtNumeroSuf?.value || "");
      } catch (err) {
        console.error("[BUSCAR] error:", err);
        await uiError(err?.message || "Error al buscar");
      }
    });

    txtNumeroSuf?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnBuscarNumero?.click();
      }
    });

    btnGuardar?.addEventListener("click", (e) => {
      e.preventDefault();
      modal?.show();
    });

    btnSi?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnSi.disabled = true;
        await save();
        modal?.hide();
      } catch (err) {
        console.error("[SP] save error:", err);
        await uiError(err?.message || "Error al guardar");
      } finally {
        btnSi.disabled = false;
      }
    });

    btnDescargarPdf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await generarPDF();
      } catch (err) {
        console.error("[SP] PDF error:", err);
        await uiError(err?.message || "Error al generar PDF");
      }
    });

    document.addEventListener("change", async (e) => {
      const t = e.target;
      if (!t) return;

      if (t.matches('[name="imp_isr"], #imp_isr') && t.checked) {
        const tasaEl = document.querySelector('[name="isr_tasa"], #isr_tasa');
        const current = clampPercent(tasaEl?.value || 0);
        if (!current) {
          const pct = await askPercentSwal(
            "¿Qué porcentaje de ISR aplicarás?",
            10,
          );
          if (pct == null) {
            t.checked = false;
            refreshTotales();
            return;
          }
          setRateValue('[name="isr_tasa"], #isr_tasa', pct);
        }
        refreshTotales();
      }

      if (t.matches('[name="imp_ieps"], #imp_ieps') && t.checked) {
        const tasaEl = document.querySelector('[name="ieps_tasa"], #ieps_tasa');
        const current = clampPercent(tasaEl?.value || 0);
        if (!current) {
          const pct = await askPercentSwal(
            "¿Qué porcentaje de IEPS aplicarás?",
            8,
          );
          if (pct == null) {
            t.checked = false;
            refreshTotales();
            return;
          }
          setRateValue('[name="ieps_tasa"], #ieps_tasa', pct);
        }
        refreshTotales();
      }
    });

    document
      .querySelector('[name="id_proyecto"]')
      ?.addEventListener("change", () => {
        updateClaveProgramatica();
        syncMetaFromProyecto();
        refreshTotales();
      });

    bindTaxEvents();

    // ==============================
    //  PENSIÓN: habilitar botón + y crear inputs dinámicos
    // ==============================
    const chkPension = document.getElementById("imp_pension");
    const btnAddPension = document.getElementById("btnAddPension");
    const pensionList = document.getElementById("pensionList");

    function ensurePensionListVisible() {
      if (!pensionList) return;
      pensionList.classList.remove("d-none");
    }

    function countPensiones() {
      return document.querySelectorAll('[name^="pension"][name$="_tasa"]')
        .length;
    }

    function createPensionRow(k, value = "") {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2 mb-2";

      row.innerHTML = `
    <div class="text-muted" style="font-size:12px; width:110px;">Pensión ${k} (%)</div>
    <input type="number"
      class="form-control form-control-sm text-end"
      style="width:120px"
      name="pension${k}_tasa"
      id="pension${k}_tasa"
      placeholder="Ej. 10"
      min="0" max="100" step="0.01"
      value="${value}">
    <button type="button" class="btn btn-outline-danger btn-sm" data-remove-pension="${k}" title="Quitar">
      <i class="bi bi-trash"></i>
    </button>`;
      return row;
    }

    chkPension?.addEventListener("change", async () => {
      if (!btnAddPension || !pensionList) return;

      btnAddPension.disabled = !chkPension.checked;

      if (!chkPension.checked) {
        pensionList.replaceChildren();
        pensionList.classList.add("d-none");
        refreshTotales();
        return;
      }

      ensurePensionListVisible();

      if (countPensiones() === 0) {
        const pct = await askPercentSwal("Porcentaje de Pensión 1", 10);
        if (pct == null) {
          chkPension.checked = false;
          btnAddPension.disabled = true;
          pensionList.classList.add("d-none");
          refreshTotales();
          return;
        }
        pensionList.appendChild(createPensionRow(1, pct));
        refreshTotales();
      }
    });

    btnAddPension?.addEventListener("click", async () => {
      if (!chkPension?.checked) return;

      const c = countPensiones();
      if (c >= 5) {
        uiWarn("Máximo 5 pensiones.");
        return;
      }

      const k = c + 1;
      const pct = await askPercentSwal(`Porcentaje de Pensión ${k}`, 10);
      if (pct == null) return;

      ensurePensionListVisible();
      pensionList.appendChild(createPensionRow(k, pct));
      refreshTotales();
    });

    pensionList?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-pension]");
      if (!btn) return;

      btn.closest("div")?.remove();

      const rows = Array.from(pensionList.querySelectorAll("div"));
      rows.forEach((r, idx) => {
        const k = idx + 1;
        r.querySelector(".text-muted").textContent = `Pensión ${k} (%)`;
        const input = r.querySelector("input");
        if (input) {
          input.name = `pension${k}_tasa`;
          input.id = `pension${k}_tasa`;
        }
        r.querySelector("[data-remove-pension]")?.setAttribute(
          "data-remove-pension",
          String(k),
        );
      });

      if (countPensiones() === 0) {
        chkPension.checked = false;
        btnAddPension.disabled = true;
        pensionList.classList.add("d-none");
      }

      refreshTotales();
    });

    pensionList?.addEventListener("input", refreshTotales);

    // ==============================
    //  BOTONES INFO (SweetAlert2)
    // ==============================
    const btnInfoPension = document.getElementById("btnInfoPension");
    const btnInfoImpuestos = document.getElementById("infoImpuestos");

    btnInfoPension?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!hasSwal()) return alert("Info: Usa SweetAlert2 (Swal).");

      Swal.fire({
        icon: "info",
        title: "Pensión alimenticia",
        html: `
      <div style="text-align:left; font-size:13px;">
        <p class="mb-2">
          La <b>Pensión</b> se calcula como un porcentaje del <b>SUBTOTAL</b>.
        </p>
        <ul class="mb-2">
          <li>Puedes agregar hasta <b>5 pensiones</b>.</li>
          <li>Cada pensión es un % independiente (ej. 10%, 5%, etc.).</li>
          <li>El sistema suma todas las pensiones y las muestra en <b>PENSIÓN</b>.</li>
          <li>El <b>TOTAL</b> = SUBTOTAL + IVA + ISR + IEPS - PENSIÓN</li>
        </ul>
        <p class="mb-0 text-muted">
          Tip: Si no ves cambios, revisa que hayas capturado porcentajes mayores a 0.
        </p>
      </div>
    `,
        confirmButtonText: "Entendido",
        confirmButtonColor: "#BC955C",
      });
    });

    btnInfoImpuestos?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!hasSwal()) return alert("Info: Usa SweetAlert2 (Swal).");

      Swal.fire({
        icon: "info",
        title: "Impuestos (IVA / ISR / IEPS)",
        html: `
      <div style="text-align:left; font-size:13px;">
        <p class="mb-2"><b>IVA</b> se calcula al 16% del SUBTOTAL.</p>
        <p class="mb-2"><b>ISR</b> y <b>IEPS</b> se calculan usando la tasa que captures (ej. 10 y 8).</p>
        <hr class="my-2">
        <p class="mb-1"><b>Fórmula:</b></p>
        <p class="mb-0">
          TOTAL = SUBTOTAL + IVA + ISR + IEPS - PENSIÓN
        </p>
      </div>
    `,
        confirmButtonText: "Ok",
        confirmButtonColor: "#BC955C",
      });
    });
    const btnInfoDir = document.getElementById("infoDireccionSolicitante");

    btnInfoDir?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!hasSwal()) return;

      Swal.fire({
        icon: "info",
        title: "Dirección solicitante",
        text: "Este campo se autollenará con la Dependencia General (DG) del usuario.",
        confirmButtonText: "Ok",
        confirmButtonColor: "#BC955C",
      });
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    if (!detalleBody) {
      console.error("[SP] No existe #detalleBody. Revisa el id en el HTML.");
      return;
    }

    setFechaHoy();
    lockCantidadPago();
    initFolioUI();

    if (DEBUG_PDF_FIELDS) {
      try {
        await debugListPdfFields();
      } catch (e) {
        console.warn("[PDF] No pude listar campos:", e?.message || e);
      }
    }

    try {
      await loadPartidasCatalog();
    } catch (e) {
      console.warn("[SP] catálogo partidas:", e.message);
    }

    initRows();
    refreshPartidaSelects();
    attachMoneyInputs(detalleBody);
    bindEvents();

    try {
      await loadDependenciasFromUser();
    } catch (e) {
      console.warn("[SP] dependencias:", e.message);
    }

    await loadProyectosCatalog();
    try {
      applyProyectoFilters();
    } catch (e) {
      console.warn("[SP] applyProyectoFilters falló:", e?.message);
      const sel = document.querySelector('[name="id_proyecto"]');
      if (sel) {
        const all = Object.values(proyectosById || {});
        sel.innerHTML = `<option value="">-- Selecciona un proyecto --</option>`;
        all.forEach((p) => {
          const opt = document.createElement("option");
          const clave = String(p.clave || "").trim();
          const conac = String(p.conac || "").trim();
          opt.value = String(p.id);
          opt.textContent =
            `${conac ? `${clave} ${conac}` : clave} - ${p.descripcion}`.trim();
          sel.appendChild(opt);
        });
      }
    }

    try {
      await loadFuentesCatalog();
      bindFuenteToHidden();
    } catch (e) {
      console.warn("[SP] fuentes:", e.message);
    }

    refreshTotales();
    updateClaveProgramatica();
    syncMetaFromProyecto();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
