(() => {
  const MAX_ROWS = 20;
  const START_ROWS = 3;
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const SUF_PDF_TEMPLATE_URL = "/public/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf";
  const DEBUG_PDF_FIELDS = false;

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnSi = document.getElementById("btn-si-seguro");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnVerComprometido = document.getElementById("btn-ver-comprometido");
  const btnVerDevengado = document.getElementById("btn-ver-devengado");

  const btnExportXlsx = document.getElementById("btn-export-xlsx"); // si lo usas después

  const btnAddRow = document.getElementById("btn-add-row");
  const btnRemoveRow = document.getElementById("btn-remove-row");
  const detalleBody = document.getElementById("detalleBody");

  const modalEl = document.getElementById("modalConfirm");
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

  // ---------------------------
  // BUSCADOR (MODAL)
  // ---------------------------
  const btnAbrirBuscarSuf = document.getElementById("btnAbrirBuscarSuf");
  const modalBuscarEl = document.getElementById("modalBuscarSuf");
  const modalBuscar = modalBuscarEl ? new bootstrap.Modal(modalBuscarEl) : null;

  const txtNumeroSuf = document.getElementById("txtNumeroSuf");
  const btnBuscarNumero = document.getElementById("btnBuscarNumero");

  let lastSavedId = null;

  let dgeneralInfo = null; // {id, clave, dependencia}
  let dauxiliarInfo = null; // {id, clave, dependencia}
  let proyectosById = {}; // { [id]: {id, clave, conac, descripcion} }
  let partidasMap = {}; // { "5151": "..." }

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

  // helper: evita "Unexpected token <" y muestra errores DB
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

  function getLoggedUser() {
    try {
      return JSON.parse(localStorage.getItem("cp_usuario") || "null");
    } catch {
      return null;
    }
  }

  // ---------------------------
  // Helpers BUSCADOR
  // ---------------------------
  function normalizeFolioInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // ✅ Caso 1: ya viene completo ECA-YYYY-MM-SP-####
  const m = raw.match(/ECA-(\d{4})-(\d{2})-SP-(\d{1,6})/i);
  if (m) {
    const year = m[1];
    const month = m[2];
    const num = String(m[3]).padStart(4, "0");
    return `ECA-${year}-${month}-SP-${num}`;
  }

  // ✅ Caso 2: si solo escribe 0001 o 1
  if (/^\d{1,6}$/.test(raw)) {
    const num = raw.padStart(4, "0");

    // toma año/mes de la fecha del formulario si existe, si no de hoy
    const f = get("fecha"); // YYYY-MM-DD
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

  // ✅ Caso 3: si pega algo con números mezclados, extrae el consecutivo
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
      folio
    )}`;
    const json = await fetchJson(url, { headers: { ...authHeaders() } });
    renderResultadosBusqueda(json?.data || []);
  }

  async function buscarPorClaves(dep, prog) {
    const d = String(dep || "").trim();
    const p = String(prog || "").trim();
    const qs = new URLSearchParams({ dep: d, prog: p });
    const url = `${API}/api/suficiencias/buscar?${qs.toString()}`;
    const json = await fetchJson(url, { headers: { ...authHeaders() } });
    renderResultadosBusqueda(json?.data || []);
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

    setVal(
      "no_suficiencia",
      data.folio_oficial_suficiencia ||
        data.no_suficiencia ||
        String(data.folio_num || "").padStart(6, "0")
    );

    setVal("fecha", data.fecha ? String(data.fecha).split("T")[0] : "");
    setVal("dependencia", data.dependencia || "");
    setVal("dependencia_aux", data.departamento || data.dependencia_aux || "");
    setVal("mes_pago", data.mes_pago || "");
    setVal("clave_programatica", data.clave_programatica || "");

    if (!Object.keys(proyectosById || {}).length) {
      await loadProyectosCatalog();
    }
    applyProyectoFilters();

    const idProy = data.id_proyecto != null ? String(data.id_proyecto) : "";
    setVal("id_proyecto", idProy);

    const selProy = document.querySelector('[name="id_proyecto"]');
    if (
      selProy &&
      idProy &&
      !Array.from(selProy.options).some((o) => o.value === idProy)
    ) {
      await uiWarn(
        "El proyecto de esta suficiencia no está permitido por el candado actual (DG/DA)."
      );
      setVal("id_proyecto", "");
    }

    updateClaveProgramatica();
    syncMetaFromProyecto();

    // --- Fuente ---
    if (data.id_fuente != null) {
      setVal("fuente", String(data.id_fuente));
      setVal("id_fuente", String(data.id_fuente));
    }

    const chkIVA = document.querySelector('[name="imp_iva"]');
    const chkISR = document.querySelector('[name="imp_isr"]');
    const chkIEPS = document.querySelector('[name="imp_ieps"]');

    const isrInput = document.querySelector('[name="isr_tasa"]');
    const iepsInput = document.querySelector('[name="ieps_tasa"]');

    if (chkIVA) chkIVA.checked = safeNumber(data.iva) > 0;
    if (chkISR) chkISR.checked = safeNumber(data.isr) > 0;
    if (chkIEPS) chkIEPS.checked = safeNumber(data.ieps) > 0;

    if (isrInput)
      isrInput.value =
        data.isr_tasa != null
          ? String(data.isr_tasa)
          : chkISR?.checked
          ? "10"
          : "";
    if (iepsInput)
      iepsInput.value =
        data.ieps_tasa != null
          ? String(data.ieps_tasa)
          : chkIEPS?.checked
          ? "8"
          : "";

    setVal("subtotal", safeNumber(data.subtotal).toFixed(2));
    setVal("iva", safeNumber(data.iva).toFixed(2));
    setVal("isr", safeNumber(data.isr).toFixed(2));
    setVal("ieps", safeNumber(data.ieps).toFixed(2));
    setVal("total", safeNumber(data.total).toFixed(2));
    setVal("cantidad_pago", safeNumber(data.total).toFixed(2));
    setVal("cantidad_con_letra", data.cantidad_con_letra || "");

    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    if (detalleBody) {
      detalleBody.innerHTML = "";
      detalle.forEach((row, idx) => {
        const i = idx + 1;
        detalleBody.insertAdjacentHTML("beforeend", rowTemplate(i));
        setVal(`r${i}_clave`, row.clave || "");
        setVal(`r${i}_concepto`, row.concepto_partida || "");
        setVal(`r${i}_justificacion`, row.justificacion || "");
        setVal(`r${i}_descripcion`, row.descripcion || "");
        setVal(`r${i}_importe`, safeNumber(row.importe));
      });

      if (!detalle.length) initRows();
    }

    refreshTotales();

    // marca id cargado
    lastSavedId = Number(data.id);
    if (btnVerComprometido) {
      btnVerComprometido.disabled = false;
      btnVerComprometido.dataset.id = String(lastSavedId);
      btnVerComprometido.classList.remove("disabled");
    }
    if (btnVerDevengado) {
      btnVerDevengado.disabled = false;
      btnVerDevengado.dataset.id = String(lastSavedId);
      btnVerDevengado.classList.remove("disabled");
    }

    modalBuscar?.hide?.();

    await uiSuccess("Suficiencia cargada correctamente.");
  }

  // ===========================
  // RESULTADOS BUSCADOR
  // ===========================
  async function renderResultadosBusqueda(rows) {
    console.log("[BUSCAR] resultados:", rows);

    if (!rows || !rows.length) {
      await uiWarn("No encontrada (o no corresponde a tu área).");
      return;
    }

    if (rows.length === 1) {
      cargarSuficienciaEnFormulario(rows[0].id);
      return;
    }

    if (!hasSwal()) {
      await uiWarn("Falta SweetAlert2 para mostrar lista de resultados. (Swal no existe).");
      return;
    }

    const listHtml = `
      <div class="list-group text-start">
        ${rows
          .map((r) => {
            const folio =
              r.no_suficiencia ||
              (r.folio_num != null
                ? `ECA-2026-01-SP-${String(r.folio_num).padStart(4, "0")}`
                : "—");

            const fecha = r.fecha ? String(r.fecha).split("T")[0] : "";

            return `
              <button
                type="button"
                class="list-group-item list-group-item-action"
                data-id="${r.id}"
              >
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
  // Cantidad pago: SOLO lectura (se llena con TOTAL)
  // ---------------------------
  function lockCantidadPago() {
    const cantEl = document.querySelector('[name="cantidad_pago"]');
    if (!cantEl) return;

    cantEl.readOnly = true;
    cantEl.tabIndex = -1;
    cantEl.style.pointerEvents = "none";
    cantEl.style.userSelect = "none";

    cantEl.classList.add("as-text", "td-text", "text-strong", "text-end");
    cantEl.classList.add("input-no-click");
  }

  // ---------------------------
  // Folio (No. Suficiencia)
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
  // Catálogo de partidas (para el detalle)
  // ---------------------------
  async function loadPartidasCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/partidas`, {
      headers: { ...authHeaders() },
    });

    partidasMap = {};
    for (const row of data || []) {
      const clave = String(row.clave || "").trim();
      const desc = String(row.descripcion || "").trim();
      if (clave) partidasMap[clave] = desc;
    }
  }

  // =====================================================
  // ✅ CANDADOS DG/DA -> PROYECTOS permitidos
  // =====================================================
  const DG_DA_PROYECTOS_FILTERS = {
    A00: {
      100: new Set(["0103010101|P", "0103010103|E"]),
      101: new Set(["0105020609|M", "0105020508|P"]),
      122: new Set(["0108040101|E"]),
      155: new Set(["0108010101|E"]),
      172: new Set(["0206080502|S", "0301020301|E", "0301020302|S"]),
      169: new Set(["0202020101|S"]),
      137: new Set(["0108030103|F"]),
    },
    A01: { 103: new Set(["0108030103|F"]) },
    A02: { 102: new Set(["0102040102|E", "0102040103|E"]) },
    B01: { 110: new Set(["0202020102|M"]) },
    B02: { 110: new Set(["0202020102|M"]) },
    C01: { 110: new Set(["0202020102|M"]) },
    C02: { 110: new Set(["0202020102|M"]) },
    C03: { 110: new Set(["0202020102|M"]) },
    C04: { 110: new Set(["0202020102|M"]) },
    C05: { 110: new Set(["0202020102|M"]) },
    C06: { 110: new Set(["0202020102|M"]) },
    C07: { 110: new Set(["0202020102|M"]) },
    C08: { 110: new Set(["0202020102|M"]) },
    C09: { 110: new Set(["0202020102|M"]) },
    C10: { 110: new Set(["0202020102|M"]) },
    C11: { 110: new Set(["0202020102|M"]) },
    C12: { 110: new Set(["0202020102|M"]) },
    D00: {
      155: new Set(["0103090201|M"]),
      114: new Set(["0105020606|M"]),
      108: new Set(["0103090301|L"]),
      109: new Set(["0108010102|E"]),
    },
    E00: {
      120: new Set(["0105020105|E", "0105020601|P", "0105020602|M"]),
      121: new Set(["0105020603|M"]),
      114: new Set(["0105020606|M"]),
    },
    F00: {
      123: new Set([
        "0103080104|P",
        "0103080107|M",
        "0202010106|K",
        "0202050104|E",
        "0108010301|E",
      ]),
    },
    F01: {
      154: new Set([
        "0202010111|K",
        "0107010108|E",
        "0305010111|E",
        "0105020602|M",
      ]),
    },
    G00: {
      160: new Set([
        "0201040109|V",
        "0201050101|F",
        "0201050102|V",
        "0302020103|V",
        "0302020105|V",
      ]),
    },
    H00: {
      125: new Set(["0202010110|K", "0201010101|V"]),
      126: new Set(["0201010102|E"]),
      127: new Set(["0303050103|E", "0303050104|E"]),
      128: new Set(["0202060103|E"]),
      145: new Set(["0202060104|E"]),
      147: new Set(["0202060106|E"]),
    },
    I00: { 143: new Set(["0206080602|E", "0206080603|E", "0206080604|E"]) },
    I01: { 112: new Set(["0202020101|S", "0202020102|M"]) },
    I02: {
      129: new Set(["0201050201|E", "0201050202|E", "0201050203|E"]),
      153: new Set([
        "0203010108|E",
        "0203020115|S",
        "0206080502|S",
        "0206080503|E",
        "0206080504|E",
      ]),
    },
    J00: {
      102: new Set(["0102040102|E"]),
      111: new Set(["0204040102|E"]),
      112: new Set(["0108010101|E"]),
      144: new Set(["0103020104|E"]),
      151: new Set(["0206070101|P"]),
    },
    K00: {
      134: new Set(["0103040101|O"]),
      135: new Set(["0103040101|O"]),
      136: new Set(["0103040201|O"]),
      138: new Set(["0103040202|O", "0103040203|O", "0103040205|O"]),
      139: new Set(["0103040102|P"]),
    },
    L00: {
      115: new Set(["0105020201|E", "0105020209|E", "0402010103|C"]),
      116: new Set([
        "0105020511|O",
        "0401010104|D",
        "0401010105|D",
        "0402010104|O",
        "0404010101|H",
      ]),
      117: new Set(["0105020510|O"]),
      118: new Set(["0108010201|E"]),
      119: new Set(["0105020304|K", "0105020508|P"]),
      137: new Set(["0108050103|E"]),
      155: new Set(["0103050104|L"]),
    },
    M00: { 155: new Set(["0103050104|L"]), 112: new Set(["0108010101|E"]) },
    N00: {
      131: new Set(["0304020102|F"]),
      133: new Set(["0309030104|F"]),
      137: new Set(["0105020608|O"]),
      140: new Set(["0301020106|M", "0301020107|E"]),
      149: new Set(["0307010101|F"]),
    },
    O00: {
      141: new Set([
        "0205010110|S",
        "0205020105|S",
        "0205030105|S",
        "0205050101|S",
        "0205050102|S",
      ]),
      150: new Set(["0103030101|E", "0204020101|F"]),
    },
    Q00: {
      104: new Set([
        "0107010101|E",
        "0107010102|M",
        "0107010103|P",
        "0107010105|E",
        "0107040101|S",
      ]),
      158: new Set(["0107010108|E"]),
    },
    T00: {
      105: new Set([
        "0107020101|E",
        "0107020103|M",
        "0107020104|E",
        "0107020105|N",
        "0107020106|N",
      ]),
      106: new Set(["0107020102|N", "0302020105|V"]),
    },
    V00: {
      152: new Set([
        "0107010102|M",
        "0206080501|E",
        "0206080502|S",
        "0206080503|E",
        "0301020301|E",
      ]),
    },
    X00: {
      124: new Set([
        "0201030101|K",
        "0202010109|K",
        "0202010110|K",
        "0202010111|K",
        "0202010112|K",
        "0202010113|K",
        "0202010114|K",
        "0202030105|K",
      ]),
    },
  };

  function _norm(v) {
    return String(v || "").trim().toUpperCase();
  }
  function _normNum(v) {
    return String(v || "").trim();
  }

  function getAllowedProyectoSet() {
    const dg = _norm(dgeneralInfo?.clave);
    const da = _normNum(dauxiliarInfo?.clave);
    if (!dg || !da) return null;

    const dgRules = DG_DA_PROYECTOS_FILTERS[dg];
    if (!dgRules) return null;

    return dgRules[da] || new Set();
  }

  function applyProyectoFilters() {
    const sel = document.querySelector('[name="id_proyecto"]');
    if (!sel) return;

    const all = Object.values(proyectosById || {});
    if (!all.length) return;

    const allowed = getAllowedProyectoSet();
    const current = sel.value || "";

    const rows =
      allowed === null
        ? all
        : all.filter((p) => {
            let clave = String(p?.clave ?? "").trim().replace(/[^\d]/g, "");
            if (clave) clave = clave.padStart(10, "0");
            const conac = _norm(p?.conac);
            return allowed.has(`${clave}|${conac}`);
          });

    sel.innerHTML = `<option value="">-- Selecciona un proyecto --</option>`;

    rows.forEach((p) => {
      const opt = document.createElement("option");
      const clave = String(p.clave || "").trim();
      const conac = String(p.conac || "").trim();
      const claveConac = conac ? `${clave} ${conac}` : clave;

      opt.value = String(p.id);
      opt.textContent = `${claveConac} - ${p.descripcion}`.trim();
      sel.appendChild(opt);
    });

    if (current && rows.some((p) => String(p.id) === String(current))) {
      sel.value = current;
    } else {
      sel.value = "";
    }

    updateClaveProgramatica();
    syncMetaFromProyecto();
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
    dauxiliarInfo = (daCatalog || []).find((x) => Number(x.id) === idDa) || null;

    const depGenNombre = dgeneralInfo?.dependencia || user?.dgeneral_nombre || "";
    const depAuxNombre = dauxiliarInfo?.dependencia || user?.dauxiliar_nombre || "";

    setVal("dependencia", depGenNombre);
    setVal("dependencia_aux", depAuxNombre);

    updateClaveProgramatica();

    if (Object.keys(proyectosById || {}).length) applyProyectoFilters();

    // ✅ AUTOLLENAR FIRMA DIRECCIÓN SOLICITANTE DESDE DGENERAL
    const inputDireccionFirma = document.querySelector(
      '[name="firma_direccion_solicitante"]'
    );

    if (inputDireccionFirma) {
      const nombreDireccion = dgeneralInfo?.dependencia || dgeneralInfo?.nombre || "";
      inputDireccionFirma.value = nombreDireccion;
    }
  }

  // ---------------------------
  // Proyectos desde catálogo
  // ---------------------------
  async function loadProyectosCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/proyectos`, {
      headers: { ...authHeaders() },
    });

    proyectosById = {};
    const items = Array.isArray(data) ? data : [];

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

      clave = clave.replace(/[^\d]/g, "");
      if (clave) clave = clave.padStart(10, "0");
      conac = String(conac || "").trim().toUpperCase();

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

    setOptions(
      "fuente",
      data,
      (x) => x.id,
      (x) => `${String(x.clave ?? "").trim()} - ${String(x.fuente ?? "").trim()}`
    );
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

  // META: readonly y toma la DESCRIPCIÓN del proyecto (NO la clave)
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
          <input type="text" class="form-control form-control-sm ro text-center" value="${i}" readonly>
        </td>

        <td style="width: 12%;">
          <input type="text"
            class="form-control form-control-sm sp-clave"
            name="r${i}_clave"
            placeholder="5151"
            inputmode="numeric"
            maxlength="4">
        </td>

        <td style="width: 20%;">
          <input type="text"
            class="form-control form-control-sm ro"
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
          <input type="number" step="0.01" min="0"
            class="form-control form-control-sm text-end sp-importe"
            name="r${i}_importe" value="0">
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
    refreshTotales();
  }

  function renumberRows() {
    const rows = detalleBody ? Array.from(detalleBody.querySelectorAll("tr")) : [];
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
        importe: safeNumber(get(`r${i}_importe`)),
      });
    }
    return rows;
  }

  function calcSubtotal(detalle) {
    return (detalle || []).reduce((acc, r) => acc + safeNumber(r?.importe), 0);
  }

  function useIVA() {
    return !!document.querySelector('[name="imp_iva"]')?.checked;
  }
  function useISR() {
    return !!document.querySelector('[name="imp_isr"]')?.checked;
  }
  function useIEPS() {
    return !!document.querySelector('[name="imp_ieps"]')?.checked;
  }

  function usePension() {
    return !!document.querySelector('[name="imp_pension"]')?.checked;
  }

  function clampPercent(val) {
    let n = Number(val);
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  // Lee tasas de pensión que existan en el DOM (pension1_tasa..pension5_tasa)
  function getPensionPercents() {
    const out = [];
    for (let k = 1; k <= 5; k++) {
      const el = document.querySelector(`[name="pension${k}_tasa"]`);
      if (!el) continue;
      const v = clampPercent(el.value);
      out.push({ k, percent: v, rate: v / 100 });
    }
    return out;
  }

  function getIsrPercent() {
    const el = document.querySelector('[name="isr_tasa"]');
    let val = el ? Number(el.value) : 0;
    if (!Number.isFinite(val)) val = 0;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    return val;
  }

  function getIepsPercent() {
    const el = document.querySelector('[name="ieps_tasa"]');
    let val = el ? Number(el.value) : 0;
    if (!Number.isFinite(val)) val = 0;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    return val;
  }

  function getIsrRate() {
    return getIsrPercent() / 100;
  }

  function getIepsRate() {
    return getIepsPercent() / 100;
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

    // ✅ pensiones (RETENCIÓN => se RESTA)
    let pension_total = 0;
    const pensiones = usePension() ? getPensionPercents() : [];
    for (const p of pensiones) pension_total += subtotal * (p.rate || 0);

    const total = subtotal + iva + isr + ieps - pension_total;

    setVal("subtotal", subtotal.toFixed(2));
    setVal("iva", iva.toFixed(2));
    setVal("isr", isr.toFixed(2));
    setVal("ieps", ieps.toFixed(2));
    setVal("pension_total", pension_total.toFixed(2));
    setVal("total", total.toFixed(2));
    setVal("cantidad_pago", total.toFixed(2));
    setVal("cantidad_con_letra", numeroALetrasMX(total));
  }

  document.addEventListener("input", (e) => {
    if (e.target && e.target.classList.contains("sp-importe")) {
      refreshTotales();
      return;
    }

    if (e.target && e.target.classList.contains("sp-clave")) {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);

      const name = e.target.getAttribute("name");
      const match = name?.match(/^r(\d+)_clave$/);
      if (!match) return;

      const i = match[1];
      const clave = e.target.value;

      if (clave.length === 4) {
        const concepto = partidasMap[clave] || "";
        setVal(`r${i}_concepto`, concepto);

        e.target.classList.toggle("is-valid", !!concepto);
        e.target.classList.toggle("is-invalid", !concepto);
      } else {
        setVal(`r${i}_concepto`, "");
        e.target.classList.remove("is-valid", "is-invalid");
      }
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

    const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
    const decenas10 = [
      "DIEZ","ONCE","DOCE","TRECE","CATORCE","QUINCE","DIECISÉIS","DIECISIETE","DIECIOCHO","DIECINUEVE"
    ];
    const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

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
        return (out + ("VEINTI" + unidades[u].toLowerCase())).toUpperCase().trim();

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
  // Impuestos: eventos y reglas
  // ---------------------------
  function bindTaxEvents() {
    const chkIVA = document.querySelector('[name="imp_iva"]');
    const chkISR = document.querySelector('[name="imp_isr"]');
    const chkIEPS = document.querySelector('[name="imp_ieps"]');

    const isrInput = document.querySelector('[name="isr_tasa"]');
    const iepsInput = document.querySelector('[name="ieps_tasa"]');

    const sync = () => {
      if (isrInput) {
        isrInput.disabled = !chkISR?.checked;
        if (chkISR?.checked && !isrInput.value) isrInput.value = "10";
      }
      if (iepsInput) {
        iepsInput.disabled = !chkIEPS?.checked;
        if (chkIEPS?.checked && !iepsInput.value) iepsInput.value = "8";
      }
      refreshTotales();
    };

    chkIVA?.addEventListener("change", sync);
    chkISR?.addEventListener("change", sync);
    chkIEPS?.addEventListener("change", sync);

    isrInput?.addEventListener("input", refreshTotales);
    iepsInput?.addEventListener("input", refreshTotales);

    chkISR?.addEventListener("change", async () => {
      if (!chkISR.checked) return;

      const val = Number(isrInput?.value || 0);
      if (!val) isrInput.value = "10";

      await Swal.fire({
        icon: "question",
        title: "Confirmar ISR",
        html: `
          <div style="font-size:13px; text-align:left;">
            Estás por aplicar <b>ISR</b>.
            <br/>Porcentaje actual: <b>${isrInput.value}%</b>
            <br/><span class="text-muted">¿Es correcto? o lo puedes modificar</span>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Sí, aplicar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#BC955C",
        cancelButtonColor: "#6c757d",
      }).then((res) => {
        if (!res.isConfirmed) {
          chkISR.checked = false;
          isrInput.disabled = true;
          refreshTotales();
        }
      });
    });

    chkIEPS?.addEventListener("change", async () => {
      if (!chkIEPS.checked) return;

      const val = Number(iepsInput?.value || 0);
      if (!val) iepsInput.value = "8";

      await Swal.fire({
        icon: "question",
        title: "Confirmar IEPS",
        html: `
          <div style="font-size:13px; text-align:left;">
            Estás por aplicar <b>IEPS</b>.
            <br/>Porcentaje actual: <b>${iepsInput.value}%</b>
            <br/><span class="text-muted">¿Es correcto? o lo puedes modificar</span>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Sí, aplicar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#BC955C",
        cancelButtonColor: "#6c757d",
      }).then((res) => {
        if (!res.isConfirmed) {
          chkIEPS.checked = false;
          iepsInput.disabled = true;
          refreshTotales();
        }
      });
    });

    sync();
  }

  function pensionRowTemplate(k) {
    return `
      <div class="d-flex align-items-center gap-2 mt-2" data-pension-row="${k}">
        <span class="badge text-bg-secondary" style="min-width:52px;">P${k}</span>

        <input
          type="number"
          class="form-control form-control-sm text-end"
          name="pension${k}_tasa"
          style="width: 120px"
          placeholder="Ej. 15 %"
          min="0" max="100" step="0.01"
        />

        <button type="button" class="btn btn-outline-danger btn-sm btnRemovePension" title="Quitar">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;
  }

  function bindPensionEvents() {
    const chk = document.querySelector('[name="imp_pension"]');
    const list = document.getElementById("pensionList");
    const btnAdd = document.getElementById("btnAddPension");
    const btnInfo = document.getElementById("btnInfoPension");

    if (!chk || !list || !btnAdd) return;

    const countRows = () => list.querySelectorAll("[data-pension-row]").length;

    const syncPensionUI = () => {
      const on = chk.checked;

      btnAdd.disabled = !on;
      list.classList.toggle("d-none", !on);

      // Si apaga, limpia filas
      if (!on) {
        list.innerHTML = "";
        refreshTotales();
        return;
      }

      // Si prende y no hay filas, crea la primera
      if (countRows() === 0) {
        list.insertAdjacentHTML("beforeend", pensionRowTemplate(1));
      }

      // Deshabilita Add si ya son 5
      btnAdd.disabled = countRows() >= 5;

      // listeners de inputs
      list.querySelectorAll('input[name^="pension"][name$="_tasa"]').forEach((inp) => {
        inp.addEventListener("input", () => {
          inp.value = String(clampPercent(inp.value));
          refreshTotales();
        });
      });

      // listeners de remove
      list.querySelectorAll(".btnRemovePension").forEach((btn) => {
        btn.onclick = () => {
          btn.closest("[data-pension-row]")?.remove();
          btnAdd.disabled = countRows() >= 5;
          // si borró todas, deja una por default
          if (countRows() === 0) {
            list.insertAdjacentHTML("beforeend", pensionRowTemplate(1));
          }
          refreshTotales();
        };
      });

      refreshTotales();
    };

    btnAdd.addEventListener("click", async () => {
      if (!chk.checked) return;

      const n = countRows();
      if (n >= 5) {
        await uiWarn("Máximo 5 pensiones.");
        return;
      }

      const next = n + 1;
      list.insertAdjacentHTML("beforeend", pensionRowTemplate(next));

      // actualiza listeners
      syncPensionUI();
    });

    chk.addEventListener("change", async () => {
      if (chk.checked) {
        await Swal.fire({
          icon: "warning",
          title: "Confirmación",
          html: `
            <div style="font-size:13px; text-align:left;">
              La <b>pensión alimenticia</b> se maneja como <b>retención</b> (se descuenta del total).
              <br/>Puedes capturar hasta <b>5</b> pensiones independientes.
            </div>
          `,
          confirmButtonText: "Entendido",
          confirmButtonColor: "#BC955C",
        });
      }
      syncPensionUI();
    });

    btnInfo?.addEventListener("click", () => {
      Swal.fire({
        icon: "info",
        title: "Pensión alimenticia",
        html: `
          <div style="font-size:13px; text-align:left;">
            <p class="mb-2">Puedes capturar de <b>1 a 5</b> pensiones. Cada una lleva su porcentaje.</p>
            <p class="mb-2">Se calcula sobre el <b>subtotal</b> y se trata como <b>retención</b> (se descuenta).</p>
            <p class="mb-0 text-muted">Recomendación: verifica el porcentaje antes de guardar.</p>
          </div>
        `,
        confirmButtonText: "Ok",
        confirmButtonColor: "#BC955C",
      });
    });

    // inicial
    syncPensionUI();
  }

  // =====================================================================
  // Payload COMPLETO para pasar a comprometido
  // =====================================================================
  function buildSufPayloadFromForm(saved) {
    const getL = (name) => document.querySelector(`[name="${name}"]`)?.value ?? "";
    const getNum = (name) => {
      const x = Number(getL(name));
      return Number.isFinite(x) ? x : 0;
    };

    const detalle = Array.from(document.querySelectorAll("#detalleBody tr")).map((tr) => {
      const inputs = tr.querySelectorAll("input");

      const clave = inputs[1]?.value ?? "";
      const concepto_partida = inputs[2]?.value ?? "";
      const justificacion = inputs[3]?.value ?? "";
      const descripcion = inputs[4]?.value ?? "";
      const importe = Number(inputs[5]?.value ?? 0);

      return { clave, concepto_partida, justificacion, descripcion, importe };
    });

    return {
      id: saved?.id ?? saved?.id_suficiencia ?? null,
      folio_num: saved?.folio_num ?? saved?.no_suficiencia ?? saved?.folio ?? null,

      fecha: getL("fecha"),
      dependencia: getL("dependencia"),
      id_dgeneral: getL("id_dgeneral"),

      dependencia_aux: getL("dependencia_aux"),
      departamento: getL("dependencia_aux"),

      id_dauxiliar: getL("id_dauxiliar"),

      id_proyecto: getL("id_proyecto"),
      fuente: getL("fuente"),
      id_fuente: getL("id_fuente"),
      clave_programatica: getL("clave_programatica"),

      mes_pago: getL("mes_pago"),
      cantidad_pago: getNum("cantidad_pago"),

      meta: getL("meta"),

      subtotal: getNum("subtotal"),
      iva: getNum("iva"),
      isr: getNum("isr"),
      ieps: getNum("ieps"),
      total: getNum("total"),
      cantidad_con_letra: getL("cantidad_con_letra"),

      impuesto_tipo: getImpuestoTipo(),
      isr_tasa: getL("isr_tasa"),
      ieps_tasa: getL("ieps_tasa"),

      detalle,
    };
  }

  // ---------------------------
  // Guardado (API)
  // ---------------------------
  function buildPayload() {
    const user = getLoggedUser();
    const id_usuario = user?.id != null ? Number(user.id) : null;

    const id_proyecto = get("id_proyecto") ? Number(get("id_proyecto")) : null;
    const id_fuente = get("fuente") ? Number(get("fuente")) : null;

    const fuenteText =
      document.querySelector('[name="fuente"]')?.selectedOptions?.[0]?.textContent?.trim() || "";

    const meta = get("meta") || null;
    const departamento = get("dependencia_aux") || null;

    const subtotal = safeNumber(get("subtotal"));

    // ✅ Calcula pensiones (si aplica)
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
      subtotal: safeNumber(get("subtotal")),
      iva: safeNumber(get("iva")),
      isr: safeNumber(get("isr")),
      ieps: safeNumber(get("ieps")),
      total: safeNumber(get("total")),
      cantidad_con_letra: get("cantidad_con_letra") || "",

      detalle: buildDetalle(),

      // ✅ Pensiones (hasta 5)
      pension_total: safeNumber(get("pension_total")),

      pension1_tasa: get("pension1_tasa") || null,
      pension2_tasa: get("pension2_tasa") || null,
      pension3_tasa: get("pension3_tasa") || null,
      pension4_tasa: get("pension4_tasa") || null,
      pension5_tasa: get("pension5_tasa") || null,

      // ✅ Montos por pensión (se calculan con subtotal)
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
      throw new Error("No se detectó el usuario logueado (cp_usuario). Vuelve a iniciar sesión.");
    }
    if (!payloadBackend.id_proyecto) {
      throw new Error("Selecciona un PROYECTO antes de guardar.");
    }
    if (!payloadBackend.id_fuente) {
      throw new Error("Selecciona una FUENTE antes de guardar.");
    }

    const saved = await fetchJson(`${API}/api/suficiencias`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(payloadBackend),
    });

    if (!saved || !saved.id) {
      throw new Error("El servidor no devolvió el ID del registro.");
    }

    lastSavedId = Number(saved.id);

    if (saved.no_suficiencia) {
      setVal("no_suficiencia", String(saved.no_suficiencia));
    } else if (saved.folio_num != null) {
      setVal("no_suficiencia", String(saved.folio_num).padStart(6, "0"));
    }

    const payloadCompleto = buildSufPayloadFromForm(saved);

    localStorage.setItem(
      "cp_last_suficiencia",
      JSON.stringify({
        id: lastSavedId,
        payload: payloadCompleto,
        loaded_from: "save",
        loaded_at: new Date().toISOString(),
      })
    );

    if (btnVerComprometido) {
      btnVerComprometido.disabled = false;
      btnVerComprometido.dataset.id = String(lastSavedId);
      btnVerComprometido.classList.remove("disabled");
    }
    if (btnVerDevengado) {
      btnVerDevengado.disabled = false;
      btnVerDevengado.dataset.id = String(lastSavedId);
      btnVerDevengado.classList.remove("disabled");
    }

    await uiSuccess("Guardado correctamente.");
    return saved;
  }

  // ---------------------------
  // VER COMPROMETIDO / DEVENGADO
  // ---------------------------
  function readLastIdFromLocalStorage() {
    try {
      const raw = localStorage.getItem("cp_last_suficiencia");
      const obj = raw ? JSON.parse(raw) : null;
      return obj?.id ? Number(obj.id) : null;
    } catch {
      return null;
    }
  }

  function goComprometido(id) {
    if (!id) return;
    window.location.href = `comprometido.html?id=${encodeURIComponent(id)}`;
  }
  function goDevengado(id) {
    if (!id) return;
    window.location.href = `devengado.html?id=${encodeURIComponent(id)}`;
  }

  // ---------------------------
  // PDF SUFICIENCIA (pdf-lib)
  // ---------------------------
  async function fetchPdfTemplateBytesSuf() {
    const r = await fetch(SUF_PDF_TEMPLATE_URL);
    if (!r.ok) throw new Error(`No se pudo cargar la plantilla PDF: ${SUF_PDF_TEMPLATE_URL}`);
    return await r.arrayBuffer();
  }

  async function debugListPdfFields() {
    const bytes = await fetchPdfTemplateBytesSuf();
    const pdfDoc = await PDFLib.PDFDocument.load(bytes);
    const form = pdfDoc.getForm();
    console.log("[PDF] Campos:", form.getFields().map((f) => f.getName()));
  }

// ========================================
// PDF (DESDE CERO) — AMARRADO A TU FORM
// Pegar ANTES de: // ---------------------------
// Eventos
// ---------------------------
// ========================================

// Formato moneda: $1,234.56
function formatMoney(num) {
  const n = Number(num) || 0;
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Formato fecha: DD/MM/YYYY
function formatFechaPDF(iso) {
  if (!iso) return "";
  const dateStr = String(iso).split("T")[0]; // por si viene con hora
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}

async function generarPDF() {
  refreshTotales();

  if (!window.PDFLib?.PDFDocument) {
    throw new Error("Falta pdf-lib. Revisa que el script de pdf-lib cargue antes.");
  }

  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  // ✅ Documento (Carta horizontal)
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([792, 612]);
  const { width, height } = page.getSize();

  // Fuentes
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Colores
  const black = rgb(0, 0, 0);
  const grayBg = rgb(0.9, 0.9, 0.9);

  // Tamaños
  const fs = { title: 9, subtitle: 7, label: 7, normal: 7, small: 6, tiny: 5 };

  // Márgenes
  const margin = { left: 30, right: 30, top: 25 };
  const contentWidth = width - margin.left - margin.right;

  // ===========================
  // Datos desde tu FORM
  // ===========================
  const fuenteSelect = document.querySelector('[name="fuente"]');
  const fuenteText = fuenteSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  const fuenteValue = fuenteSelect?.value || "";

  // ✅ Tu folio real
  const folio = get("no_suficiencia") || "0000";

  const payload = {
    folio,
    fecha: get("fecha"),
    dependencia: get("dependencia"),
    dependencia_aux: get("dependencia_aux") || "",
    clave_programatica: get("clave_programatica"),
    fuente: fuenteText,
    fuente_id: fuenteValue,
    mes_pago: get("mes_pago"),
    meta: get("meta"),
    subtotal: safeNumber(get("subtotal")),
    iva: safeNumber(get("iva")),
    isr: safeNumber(get("isr")),
    ieps: safeNumber(get("ieps")),
    // ✅ Si manejas pensión total en form, lo dejamos (si no existe, safeNumber lo deja en 0)
    pension_total: safeNumber(get("pension_total")),
    total: safeNumber(get("total")),
    cantidad_con_letra: get("cantidad_con_letra"),
    detalle: buildDetalle(),
  };

  // ===========================
  // Layout helper
  // ===========================
  let y = height - margin.top;

  const drawCentered = (text, yPos, size, bold = false) => {
    const f = bold ? fontBold : fontRegular;
    const tw = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: margin.left + (contentWidth - tw) / 2, y: yPos, size, font: f, color: black });
  };

  const drawLabelLine = (label, value, xStart, yPos, labelW, valueW) => {
    page.drawText(label, { x: xStart, y: yPos, size: fs.label, font: fontBold, color: black });
    page.drawLine({
      start: { x: xStart + labelW, y: yPos - 2 },
      end: { x: xStart + labelW + valueW, y: yPos - 2 },
      thickness: 0.5,
      color: black,
    });
    page.drawText(String(value || ""), { x: xStart + labelW + 2, y: yPos, size: fs.normal, font: fontRegular, color: black });
  };

  // ===========================
  // ENCABEZADO
  // ===========================
  drawCentered("H. AYUNTAMIENTO CONSTITUCIONAL DE ECATEPEC DE MORELOS 2025-2027", y, fs.title, true); y -= 12;
  drawCentered("2025. BICENTENARIO DE LA VIDA MUNICIPAL DEL ESTADO DE MÉXICO", y, fs.subtitle, false); y -= 10;
  drawCentered("TESORERÍA MUNICIPAL", y, fs.subtitle, true); y -= 10;
  drawCentered("SUBDIRECCIÓN DE CONTROL Y REGISTRO PRESUPUESTAL", y, fs.subtitle, true); y -= 14;

  // Caja título
  const titleBox = "SOLICITUD DE SUFICIENCIA PRESUPUESTAL";
  const titleBoxW = fontBold.widthOfTextAtSize(titleBox, fs.subtitle) + 20;
  const titleBoxX = margin.left + (contentWidth - titleBoxW) / 2;

  page.drawRectangle({ x: titleBoxX, y: y - 12, width: titleBoxW, height: 14, borderColor: black, borderWidth: 0.5 });
  page.drawText(titleBox, { x: titleBoxX + 10, y: y - 9, size: fs.subtitle, font: fontBold, color: black });
  y -= 22;

  // ===========================
  // DATOS GENERALES
  // ===========================
  drawLabelLine("NOMBRE DE LA DEPENDENCIA GENERAL:", payload.dependencia, margin.left, y, 155, 280);
  drawLabelLine("FECHA DE ELABORACIÓN:", formatFechaPDF(payload.fecha), margin.left + 480, y, 105, 100);
  y -= 16;

  drawLabelLine("CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:", payload.clave_programatica, margin.left, y, 195, 520);
  y -= 16;

  // ✅ Aquí imprimimos ID de fuente y el texto, como tu formato
  drawLabelLine("FUENTE DE FINANCIAMIENTO:", payload.fuente_id, margin.left, y, 130, 585);
  y -= 16;

  drawLabelLine("NOMBRE F.F. :", payload.fuente, margin.left, y, 65, 650);
  y -= 20;

  // ===========================
  // PROGRAMACIÓN DE PAGO (12 meses)
  // ===========================
  const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
  const progLabelW = 75;
  const mesW = (contentWidth - progLabelW) / 12;
  const progH = 22;

  page.drawRectangle({ x: margin.left, y: y - progH, width: progLabelW, height: progH, borderColor: black, borderWidth: 0.5, color: grayBg });
  page.drawText("PROGRAMACIÓN DE", { x: margin.left + 3, y: y - 9, size: fs.tiny, font: fontBold, color: black });
  page.drawText("PAGO:", { x: margin.left + 3, y: y - 16, size: fs.tiny, font: fontBold, color: black });

  for (let i = 0; i < 12; i++) {
    const mx = margin.left + progLabelW + (i * mesW);
    page.drawRectangle({ x: mx, y: y - progH, width: mesW, height: progH, borderColor: black, borderWidth: 0.5 });

    const mesText = meses[i];
    const mesTW = fontBold.widthOfTextAtSize(mesText, fs.tiny);
    page.drawText(mesText, { x: mx + (mesW - mesTW) / 2, y: y - 9, size: fs.tiny, font: fontBold, color: black });

    if (payload.mes_pago && String(payload.mes_pago).trim().toUpperCase() === mesText) {
      const totalStr = formatMoney(payload.total);
      const totalTW = fontRegular.widthOfTextAtSize(totalStr, fs.tiny);
      page.drawText(totalStr, { x: mx + (mesW - totalTW) / 2, y: y - 18, size: fs.tiny, font: fontRegular, color: black });
    }
  }
  y -= progH + 5;

  // ===========================
  // TABLA DETALLE
  // ===========================
  const detalle = Array.isArray(payload.detalle) ? payload.detalle : [];
  const totalTableW = contentWidth;

  const colWidths = [
    Math.floor(totalTableW * 0.04),  // NO.
    Math.floor(totalTableW * 0.06),  // CLAVE
    Math.floor(totalTableW * 0.15),  // CONCEPTO
    Math.floor(totalTableW * 0.25),  // JUSTIFICACIÓN
    Math.floor(totalTableW * 0.35),  // DESCRIPCIÓN
    totalTableW - Math.floor(totalTableW * 0.04) - Math.floor(totalTableW * 0.06) - Math.floor(totalTableW * 0.15) - Math.floor(totalTableW * 0.25) - Math.floor(totalTableW * 0.35),
  ];
  const colHeaders = ["NO.", "CLAVE", "CONCEPTO DE PARTIDA", "JUSTIFICACIÓN", "DESCRIPCIÓN", "IMPORTE SOLICITADO"];
  const detRowH = 14;

  let xPos = margin.left;
  for (let i = 0; i < colHeaders.length; i++) {
    page.drawRectangle({ x: xPos, y: y - detRowH, width: colWidths[i], height: detRowH, borderColor: black, borderWidth: 0.5, color: grayBg });
    const hText = colHeaders[i];
    const hTW = fontBold.widthOfTextAtSize(hText, fs.tiny);
    page.drawText(hText, { x: xPos + (colWidths[i] - hTW) / 2, y: y - 10, size: fs.tiny, font: fontBold, color: black });
    xPos += colWidths[i];
  }
  y -= detRowH;

  const minRows = 8;
  const rowsToDraw = Math.max(detalle.length, minRows);

  for (let r = 0; r < rowsToDraw; r++) {
    const row = detalle[r] || {};
    xPos = margin.left;

    const values = [
      row.renglon || (detalle[r] ? r + 1 : ""),
      row.clave || "",
      row.concepto_partida || "",
      row.justificacion || "",
      row.descripcion || "",
      row.importe ? formatMoney(row.importe) : ""
    ];

    for (let c = 0; c < colWidths.length; c++) {
      page.drawRectangle({ x: xPos, y: y - detRowH, width: colWidths[c], height: detRowH, borderColor: black, borderWidth: 0.5 });

      let text = String(values[c] || "");
      const maxChars = Math.floor(colWidths[c] / 3.5);
      if (text.length > maxChars) text = text.substring(0, maxChars - 2) + "..";

      let textX = xPos + 2;
      if (c === 0 || c === 1) textX = xPos + (colWidths[c] - fontRegular.widthOfTextAtSize(text, fs.small)) / 2;
      if (c === 5) textX = xPos + colWidths[c] - fontRegular.widthOfTextAtSize(text, fs.small) - 3;

      page.drawText(text, { x: textX, y: y - 10, size: fs.small, font: fontRegular, color: black });
      xPos += colWidths[c];
    }

    y -= detRowH;
  }

  y -= 5;

  // ===========================
  // META + TOTALES
  // ===========================
  const metaLabelW = 35;
  const totalsW = 130;
  const metaValueW = contentWidth - metaLabelW - totalsW - 10;
  const totalsH = 50;

  page.drawRectangle({ x: margin.left, y: y - totalsH, width: metaLabelW, height: totalsH, borderColor: black, borderWidth: 0.5, color: grayBg });
  page.drawText("META:", { x: margin.left + 5, y: y - 28, size: fs.label, font: fontBold, color: black });

  page.drawRectangle({ x: margin.left + metaLabelW, y: y - totalsH, width: metaValueW, height: totalsH, borderColor: black, borderWidth: 0.5 });
  let metaText = payload.meta || "";
  if (metaText.length > 120) metaText = metaText.substring(0, 117) + "...";
  page.drawText(metaText, { x: margin.left + metaLabelW + 3, y: y - 28, size: fs.small, font: fontRegular, color: black });

  const totalsX = margin.left + metaLabelW + metaValueW + 10;
  const totalsLabelW = 55;
  const totalsValueW = totalsW - totalsLabelW;

  // ✅ Si usas IEPS/pensión, aquí los mostramos sin romper formato:
  const totals = [
    { label: "SUBTOTAL:", value: formatMoney(payload.subtotal) },
    { label: "IVA:", value: formatMoney(payload.iva) },
    { label: "ISR:", value: formatMoney(payload.isr) },
    { label: "TOTAL:", value: formatMoney(payload.total) },
  ];
  const totalRowH = totalsH / 4;

  for (let t = 0; t < totals.length; t++) {
    const ty = y - (t * totalRowH);

    page.drawRectangle({ x: totalsX, y: ty - totalRowH, width: totalsLabelW, height: totalRowH, borderColor: black, borderWidth: 0.5, color: grayBg });
    page.drawText(totals[t].label, { x: totalsX + 3, y: ty - 9, size: fs.small, font: fontBold, color: black });

    page.drawRectangle({ x: totalsX + totalsLabelW, y: ty - totalRowH, width: totalsValueW, height: totalRowH, borderColor: black, borderWidth: 0.5 });
    const valTW = fontBold.widthOfTextAtSize(totals[t].value, fs.small);
    page.drawText(totals[t].value, { x: totalsX + totalsLabelW + totalsValueW - valTW - 3, y: ty - 9, size: fs.small, font: fontBold, color: black });
  }

  y -= totalsH + 5;

  // ===========================
  // CANTIDAD CON LETRA
  // ===========================
  const cantLabelW = 85;
  page.drawRectangle({ x: margin.left, y: y - 14, width: cantLabelW, height: 14, borderColor: black, borderWidth: 0.5, color: grayBg });
  page.drawText("CANTIDAD CON LETRA:", { x: margin.left + 3, y: y - 10, size: fs.small, font: fontBold, color: black });

  page.drawRectangle({ x: margin.left + cantLabelW, y: y - 14, width: contentWidth - cantLabelW, height: 14, borderColor: black, borderWidth: 0.5 });
  const cantLetra = String(payload.cantidad_con_letra || "").toUpperCase();
  page.drawText(cantLetra, { x: margin.left + cantLabelW + 3, y: y - 10, size: fs.small, font: fontBold, color: black });

  y -= 20;

  // ===========================
  // LEYENDA LEGAL
  // ===========================
  const leyendas = [
    "La presente suficiencia presupuestal únicamente acredita la disponibilidad de recursos en la(s) clave(s) indicada(s), sin que ello implique autorización para realizar procesos de licitación, adjudicación, contratación, adquisición, pago o validación documental, los cuales son responsabilidad exclusiva del ÁREA SOLICITANTE.",
    "Esta autorización se emite con base en el techo presupuestal aprobado para la unidad administrativa correspondiente, siendo también responsabilidad del ÁREA SOLICITANTE la planeación, administración, verificación y comprobación del uso de los recursos.",
    "El ejercicio del gasto deberá apegarse a lo establecido en el Clasificador por Objeto del Gasto Estatal y Municipal, incluido en el Manual para la Planeación, Programación y Presupuesto de Egresos Municipal vigente, en los Lineamientos Generales para la Evaluación de Programas Presupuestarios Municipales, y en la normatividad municipal, estatal y complementaria aplicable.",
    "El recurso deberá ejercerse en el mismo mes de emisión de esta suficiencia; en caso contrario, perderá validez y deberá tramitarse nuevamente con fecha del mes en curso."
  ];

  for (const ley of leyendas) {
    const words = ley.split(" ");
    let line = "";
    const maxLineW = contentWidth - 10;

    for (const word of words) {
      const testLine = line + (line ? " " : "") + word;
      if (fontRegular.widthOfTextAtSize(testLine, fs.tiny) > maxLineW) {
        page.drawText(line, { x: margin.left + 2, y: y, size: fs.tiny, font: fontRegular, color: black });
        y -= 7;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, { x: margin.left + 2, y: y, size: fs.tiny, font: fontRegular, color: black });
      y -= 10;
    }
  }

  y -= 5;

  // ===========================
  // FIRMAS (si aún no las tienes en tu HTML, se verán con "-")
  // ===========================
  const firmaW = contentWidth / 3;
  const firmaHeaderH = 14;
  const firmaAreaH = 12;
  const firmaBodyH = 45;

  // Si luego agregas inputs/ids de firmas, aquí ya está listo:
  const firmasData = [
    { titulo: "COORDINACIÓN ADMINISTRATIVA DEL ÁREA SOLICITANTE", area: "-", nombre: "" },
    { titulo: "*ÁREA SOLICITANTE", area: "-", nombre: "" },
    { titulo: "DIRECCIÓN SOLICITANTE", area: "-", nombre: "" },
  ];

  for (let i = 0; i < 3; i++) {
    const fx = margin.left + (firmaW * i);
    const firma = firmasData[i];

    page.drawRectangle({ x: fx, y: y - firmaHeaderH, width: firmaW, height: firmaHeaderH, borderColor: black, borderWidth: 0.5, color: grayBg });
    const fTW = fontBold.widthOfTextAtSize(firma.titulo, fs.tiny);
    page.drawText(firma.titulo, { x: fx + (firmaW - fTW) / 2, y: y - 10, size: fs.tiny, font: fontBold, color: black });

    page.drawRectangle({ x: fx, y: y - firmaHeaderH - firmaAreaH, width: firmaW, height: firmaAreaH, borderColor: black, borderWidth: 0.5 });
    const areaText = String(firma.area || "-");
    const areaTW = fontBold.widthOfTextAtSize(areaText, fs.tiny);
    page.drawText(areaText, { x: fx + (firmaW - areaTW) / 2, y: y - firmaHeaderH - 9, size: fs.tiny, font: fontBold, color: black });

    page.drawRectangle({ x: fx, y: y - firmaHeaderH - firmaAreaH - firmaBodyH, width: firmaW, height: firmaBodyH, borderColor: black, borderWidth: 0.5 });

    if (firma.nombre) {
      const nombreText = String(firma.nombre).slice(0, 40);
      const nombreTW = fontBold.widthOfTextAtSize(nombreText, fs.tiny);
      page.drawText(nombreText, { x: fx + (firmaW - nombreTW) / 2, y: y - firmaHeaderH - firmaAreaH - firmaBodyH + 5, size: fs.tiny, font: fontBold, color: black });
    }
  }

  // ===========================
  // GUARDAR / DESCARGAR
  // ===========================
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const folioFileName = String(payload.folio || "0000").replace(/\//g, "-").replace(/\s+/g, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `SUFICIENCIA_${folioFileName}.pdf`;
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

    if (btnVerComprometido) btnVerComprometido.type = "button";
    if (btnVerDevengado) btnVerDevengado.type = "button";
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

    btnVerComprometido?.addEventListener("click", async (e) => {
      e.preventDefault();

      let id = btnVerComprometido.dataset.id ? Number(btnVerComprometido.dataset.id) : null;

      if (!id && lastSavedId) id = Number(lastSavedId);
      if (!id) id = readLastIdFromLocalStorage();

      if (!id) {
        await uiWarn("Primero guarda la Suficiencia para generar el Comprometido.");
        return;
      }

      goComprometido(id);
    });

    btnVerDevengado?.addEventListener("click", async (e) => {
      e.preventDefault();

      let id = btnVerDevengado.dataset.id ? Number(btnVerDevengado.dataset.id) : null;

      if (!id && lastSavedId) id = Number(lastSavedId);
      if (!id) id = readLastIdFromLocalStorage();

      if (!id) {
        await uiWarn("Primero guarda la Suficiencia para generar el Devengado.");
        return;
      }

      goDevengado(id);
    });

    document.querySelector('[name="id_proyecto"]')?.addEventListener("change", () => {
      updateClaveProgramatica();
      syncMetaFromProyecto();
      refreshTotales();
    });

    bindTaxEvents();
    bindPensionEvents();

    if (DEBUG_PDF_FIELDS) {
      debugListPdfFields().catch((err) => console.warn("[PDF debug] ", err.message));
    }

    // ℹ️ Info Dirección Solicitante
    document.getElementById("infoDireccionSolicitante")?.addEventListener("click", () => {
      Swal.fire({
        icon: "info",
        title: "Dirección solicitante",
        html: `
          <div style="font-size:13px; text-align:left;">
            <p class="mb-2">
              Este campo se llena automáticamente con la <b>Dirección General</b>.
            </p>
            <p class="mb-2">
              Está habilitado únicamente para:
            </p>
            <ul class="mb-2">
              <li>Quitar guiones bajos <code>_</code></li>
              <li>Agregar espacios para mejorar la lectura</li>
            </ul>
            <p class="mb-0 text-muted">
              No modifica la información oficial del sistema.
            </p>
          </div>
        `,
        confirmButtonText: "Entendido",
        confirmButtonColor: "#BC955C",
      });
    });

    // ℹ️ Info Impuestos
    document.getElementById("infoImpuestos")?.addEventListener("click", () => {
      if (!hasSwal()) {
        alert("Info: Verifica el porcentaje antes de marcar ISR/IEPS. IVA es 16% fijo.");
        return;
      }

      Swal.fire({
        icon: "info",
        title: "Impuestos",
        html: `
          <div style="font-size:13px; text-align:left;">
            <p class="mb-2">
              Antes de marcar un impuesto, <b>verifica el porcentaje</b> que te corresponde.
              El sistema calcula el total con base en el <b>subtotal</b>.
            </p>

            <div class="mb-2">
              <b>IVA</b> <span class="text-muted">(16% fijo)</span><br/>
              <span class="text-muted">Se aplica automáticamente al subtotal cuando lo marcas.</span>
            </div>

            <div class="mb-2">
              <b>ISR</b><br/>
              <span class="text-muted">
                Se aplica al subtotal con el porcentaje que captures en <b>ISR %</b>.
                Ejemplo: 10% = 0.10 × subtotal.
              </span>
            </div>

            <div class="mb-2">
              <b>IEPS</b><br/>
              <span class="text-muted">
                Se aplica al subtotal con el porcentaje que captures en <b>IEPS %</b>.
                Ejemplo: 8% = 0.08 × subtotal.
              </span>
            </div>

            <hr class="my-2"/>

            <div class="text-muted" style="font-size:12px;">
              <b>Recomendación:</b> confirma el porcentaje en tu soporte/documento antes de guardarlo.
              Si no aplica, déjalo desmarcado.
            </div>
          </div>
        `,
        confirmButtonText: "Entendido",
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

    initRows();
    bindEvents();

    try {
      await loadPartidasCatalog();
    } catch (e) {
      console.warn("[SP] catálogo partidas:", e.message);
    }

    try {
      await loadDependenciasFromUser();
    } catch (e) {
      console.warn("[SP] dependencias:", e.message);
    }

    try {
      await loadProyectosCatalog();
      applyProyectoFilters();
    } catch (e) {
      console.warn("[SP] proyectos:", e.message);
    }

    try {
      await loadFuentesCatalog();
      bindFuenteToHidden();
    } catch (e) {
      console.warn("[SP] fuentes:", e.message);
    }

    try {
      const lastId = readLastIdFromLocalStorage();
      if (btnVerComprometido && lastId) {
        btnVerComprometido.disabled = false;
        btnVerComprometido.dataset.id = String(lastId);
        btnVerComprometido.classList.remove("disabled");
      }
      if (btnVerDevengado && lastId) {
        btnVerDevengado.disabled = false;
        btnVerDevengado.dataset.id = String(lastId);
        btnVerDevengado.classList.remove("disabled");
      }
    } catch {}

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
