/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Presupuesto Base de Partidas
 *  Archivo: partidas_base.js
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

  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

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
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function parseResponse(res) {
    const text = await res.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    return { data, text };
  }

  async function handleAuthErrors(res) {
    if (res.status === 401) {
      await Swal.fire("Sesion expirada", "Vuelve a iniciar sesion.", "warning");
      window.location.href = "login.html";
      throw new Error("401");
    }

    if (res.status === 403) {
      await Swal.fire(
        "Acceso denegado",
        "Solo usuarios GOD o ADMIN pueden usar este modulo.",
        "warning",
      );
      window.location.href = "suficiencia_presupuestal.html";
      throw new Error("403");
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });

    await handleAuthErrors(response);

    const { data, text } = await parseResponse(response);

    if (!response.ok) {
      const message =
        (data && typeof data === "object" && data.error) ||
        (typeof data === "string" ? data : null) ||
        text ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (data == null || typeof data !== "object") {
      throw new Error("La API no devolvio JSON valido.");
    }

    return data;
  }

  function money(value) {
    const n = Number(value || 0);
    return n.toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fillSelect(selectId, rows, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const options = [`<option value="">${placeholder}</option>`];

    (rows || []).forEach((item) => {
      options.push(
        `<option value="${Number(item.id)}">${escapeHtml(item.clave)} - ${escapeHtml(
          item.dependencia || item.fuente || "",
        )}</option>`,
      );
    });

    select.innerHTML = options.join("");
  }

  function getFiltros() {
    const ejercicio = String(document.getElementById("fEjercicio")?.value || "").trim();
    const idDgeneral = String(document.getElementById("fDgeneral")?.value || "").trim();
    const idDauxiliar = String(document.getElementById("fDauxiliar")?.value || "").trim();
    const idFuente = String(document.getElementById("fFuente")?.value || "").trim();
    const partida = String(document.getElementById("fPartida")?.value || "").trim();

    const params = new URLSearchParams();

    if (ejercicio) params.set("ejercicio", ejercicio);
    if (idDgeneral) params.set("id_dgeneral", idDgeneral);
    if (idDauxiliar) params.set("id_dauxiliar", idDauxiliar);
    if (idFuente) params.set("id_fuente", idFuente);
    if (partida) params.set("partida", partida);

    return params;
  }

  function renderResumen(totalRows, totalMonto) {
    const txtResumen = document.getElementById("txtResumen");
    const txtTotal = document.getElementById("txtTotal");
    if (!txtResumen) return;
    txtResumen.textContent = `${totalRows} registro(s)`;
    if (txtTotal) {
      txtTotal.textContent = `Total: ${money(totalMonto)}`;
    }
  }

  function renderRows(rows) {
    const tbody = document.getElementById("tbodyResultados");
    if (!tbody) return;

    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="20" class="text-center text-muted py-4">Sin resultados.</td></tr>';
      renderResumen(0, 0);
      return;
    }

    const totalMonto = rows.reduce((acc, row) => acc + Number(row?.total || 0), 0);

    tbody.innerHTML = rows
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.dep_gral_clave || "")}</td>
            <td>${escapeHtml(row.dep_aux_clave || "")}</td>
            <td>${escapeHtml(row.proyecto_clave || "-")}</td>
            <td>${escapeHtml(row.fuente_clave || "")}</td>
            <td>${escapeHtml(row.partida_clave || "")}</td>
            <td>${escapeHtml(row.partida_descripcion || "")}</td>
            <td class="text-end">${money(row.ene)}</td>
            <td class="text-end">${money(row.feb)}</td>
            <td class="text-end">${money(row.mar)}</td>
            <td class="text-end">${money(row.abr)}</td>
            <td class="text-end">${money(row.may)}</td>
            <td class="text-end">${money(row.jun)}</td>
            <td class="text-end">${money(row.jul)}</td>
            <td class="text-end">${money(row.ago)}</td>
            <td class="text-end">${money(row.sep)}</td>
            <td class="text-end">${money(row.oct)}</td>
            <td class="text-end">${money(row.nov)}</td>
            <td class="text-end">${money(row.dic)}</td>
            <td class="text-end fw-semibold">${money(row.total)}</td>
            <td>${escapeHtml(row.ejercicio)}</td>
          </tr>
        `;
      })
      .join("");

    renderResumen(rows.length, totalMonto);
  }

  function renderErrors(errors) {
    const errorList = document.getElementById("errorList");
    const errorEmpty = document.getElementById("errorEmpty");

    if (!errorList || !errorEmpty) return;

    if (!Array.isArray(errors) || errors.length === 0) {
      errorList.classList.add("d-none");
      errorList.innerHTML = "";
      errorEmpty.classList.remove("d-none");
      return;
    }

    errorList.classList.remove("d-none");
    errorEmpty.classList.add("d-none");

    errorList.innerHTML = errors
      .map((err) => {
        return `
          <li class="list-group-item list-group-item-danger">
            <div class="fw-semibold">Fila ${escapeHtml(err.row)}: ${escapeHtml(err.message)}</div>
            <small class="text-muted">
              DEP_GRAL=${escapeHtml(err.dep_gral || "")},
              DEP_AUX=${escapeHtml(err.dep_aux || "")},
              FF=${escapeHtml(err.ff || "")},
              PARTIDA=${escapeHtml(err.partida || "")},
              PROY=${escapeHtml(err.proy || "")}
            </small>
          </li>
        `;
      })
      .join("");
  }

  async function cargarCatalogos() {
    const [dgeneral, dauxiliar, fuentes] = await Promise.all([
      fetchJson(`${API}/api/catalogos/dgeneral`, { headers: { ...authHeaders() } }),
      fetchJson(`${API}/api/catalogos/dauxiliar`, { headers: { ...authHeaders() } }),
      fetchJson(`${API}/api/catalogos/fuentes`, { headers: { ...authHeaders() } }),
    ]);

    fillSelect("fDgeneral", dgeneral, "Todas");
    fillSelect("fDauxiliar", dauxiliar, "Todas");
    fillSelect("fFuente", fuentes, "Todas");
  }

  async function cargarListado() {
    const params = getFiltros();
    const url = `${API}/api/presupuesto-base-partidas${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    const data = await fetchJson(url, { headers: { ...authHeaders() } });
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    renderRows(rows);
  }

  async function descargarPlantilla() {
    const response = await fetch(`${API}/api/presupuesto-base-partidas/template`, {
      method: "GET",
      headers: { ...authHeaders() },
    });

    await handleAuthErrors(response);

    if (!response.ok) {
      const { data, text } = await parseResponse(response);
      const message =
        (data && typeof data === "object" && data.error) ||
        (typeof data === "string" ? data : null) ||
        text ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla_presupuesto_base_partidas.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function subirExcel() {
    const input = document.getElementById("fileExcel");
    const file = input?.files?.[0];

    if (!file) {
      await Swal.fire("Archivo requerido", "Selecciona un archivo .xlsx", "warning");
      return;
    }

    if (!/\.xlsx$/i.test(file.name || "")) {
      await Swal.fire("Formato invalido", "Solo se permiten archivos .xlsx", "warning");
      return;
    }

    const form = new FormData();
    form.append("file", file);

    Swal.fire({
      title: "Procesando Excel",
      text: "Validando e insertando registros...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const response = await fetch(`${API}/api/presupuesto-base-partidas/upload-excel`, {
        method: "POST",
        headers: { ...authHeaders() },
        body: form,
      });

      await handleAuthErrors(response);

      const { data, text } = await parseResponse(response);

      if (!response.ok) {
        const message =
          (data && typeof data === "object" && data.error) ||
          (typeof data === "string" ? data : null) ||
          text ||
          `HTTP ${response.status}`;
        throw new Error(message);
      }

      const result = data && typeof data === "object" ? data : {};
      const errors = Array.isArray(result.errors) ? result.errors : [];

      renderErrors(errors);
      await cargarListado();
      Swal.close();

      await Swal.fire({
        icon: errors.length ? "warning" : "success",
        title: errors.length ? "Carga finalizada con incidencias" : "Carga finalizada",
        html: `
          <div class="text-start">
            <div><strong>Insertados:</strong> ${Number(result.inserted || 0)}</div>
            <div><strong>Actualizados:</strong> ${Number(result.updated || 0)}</div>
            <div><strong>Errores:</strong> ${errors.length}</div>
          </div>
        `,
      });
    } catch (error) {
      Swal.close();
      await Swal.fire("Error", error.message || "No fue posible subir el archivo", "error");
    }
  }

  async function limpiarBase() {
    await Swal.fire(
      "Advertencia",
      "Esta accion eliminara todos los registros de presupuesto base.",
      "warning",
    );

    const step1 = await Swal.fire({
      title: "Estas seguro?",
      text: "Si continuas no podras recuperar la informacion.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Estoy seguro",
      cancelButtonText: "No estoy seguro",
      reverseButtons: true,
    });

    if (!step1.isConfirmed) return;

    const step2 = await Swal.fire({
      title: "Confirmar borrado",
      text: "Se eliminara todo el presupuesto base.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Confirmar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
    });

    if (!step2.isConfirmed) return;

    await fetchJson(`${API}/api/presupuesto-base-partidas/limpiar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
    });

    await Swal.fire("Listo", "La tabla fue limpiada.", "success");
    await cargarListado();
  }

  function limpiarFiltros() {
    const ids = ["fEjercicio", "fDgeneral", "fDauxiliar", "fFuente", "fPartida"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) {
      window.location.href = "login.html";
      return;
    }

    document.getElementById("btnDescargarPlantilla")?.addEventListener("click", () => {
      descargarPlantilla().catch((error) => {
        Swal.fire("Error", error.message || "No se pudo descargar la plantilla", "error");
      });
    });

    document.getElementById("btnSubirExcel")?.addEventListener("click", () => {
      subirExcel();
    });

    document.getElementById("btnRecargar")?.addEventListener("click", () => {
      cargarListado().catch((error) => {
        Swal.fire("Error", error.message || "No se pudo recargar el listado", "error");
      });
    });

    document.getElementById("btnLimpiarBase")?.addEventListener("click", () => {
      limpiarBase().catch((error) => {
        Swal.fire("Error", error.message || "No se pudo limpiar la base", "error");
      });
    });

    document.getElementById("btnAplicarFiltros")?.addEventListener("click", () => {
      cargarListado().catch((error) => {
        Swal.fire("Error", error.message || "No se pudo aplicar filtros", "error");
      });
    });

    document.getElementById("btnLimpiarFiltros")?.addEventListener("click", () => {
      limpiarFiltros();
      cargarListado().catch((error) => {
        Swal.fire("Error", error.message || "No se pudo recargar listado", "error");
      });
    });

    try {
      await cargarCatalogos();
      await cargarListado();
      renderErrors([]);
    } catch (error) {
      console.error(error);
      Swal.fire("Error", error.message || "No se pudo inicializar la pantalla", "error");
    }
  });
})();
