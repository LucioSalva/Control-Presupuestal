(() => {
  "use strict";

  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  function getToken() {
    return (
      localStorage.getItem("cp_token") ||
      sessionStorage.getItem("cp_token") ||
      localStorage.getItem("token") ||
      sessionStorage.getItem("token") ||
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

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (res.status === 401) {
      await Swal.fire("Sesión expirada", "Vuelve a iniciar sesión.", "warning");
      window.location.href = "login.html";
      throw new Error("401");
    }

    if (res.status === 403) {
      await Swal.fire(
        "Acceso denegado",
        "Solo DG L00 con DA 117 puede entrar a Partidas.",
        "warning",
      );
      window.location.href = "suficiencia_presupuestal.html";
      throw new Error("403");
    }

    if (!res.ok) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }

    return data;
  }

  function moneyFormatMX(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  return x.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  });
}

  function money2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0.00";
    return x.toFixed(2);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;

    if (!getToken()) {
      window.location.href = "login.html";
      return;
    }

    // DOM
    const userInfo = document.getElementById("userInfo");
    const dgda = document.getElementById("dgda");
    const btnLogout = document.getElementById("btnLogout");

    const btnReload = document.getElementById("btnReload");
    const btnGuardar = document.getElementById("btnGuardar");

    const q = document.getElementById("q");
    const btnClear = document.getElementById("btnClear");

    const pageSize = document.getElementById("pageSize");
    const page = document.getElementById("page");
    const btnPrev = document.getElementById("btnPrev");
    const btnNext = document.getElementById("btnNext");

    const countInfo = document.getElementById("countInfo");
    if (!countInfo) return;
    if (!page) return;

    // State
    let all = [];
    let filtered = [];
    let currentPage = 1;

    // cambios en memoria: { clave -> monto }
    const dirty = new Map();

    function render() {
      const ps = Number(pageSize?.value) || 20;
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / ps));

      if (currentPage > totalPages) currentPage = totalPages;

      const start = (currentPage - 1) * ps;
      const end = start + ps;
      const slice = filtered.slice(start, end);

      if (!slice.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-muted">Sin resultados.</td></tr>`;
      } else {
        tbody.innerHTML = slice
          .map((r) => {
            const clave = escapeHtml(r.clave);
            const desc = escapeHtml(r.partida || "");
            const monto = dirty.has(r.clave)
              ? dirty.get(r.clave)
              : Number(r.monto || 0);

            return `
            <tr data-clave="${clave}">
              <td><span class="badge text-bg-dark">${clave}</span></td>
              <td>${desc}</td>
              <td class="text-end">
  <input
    class="form-control text-end js-monto"
    type="number"
    step="0.01"
    min="0"
    value="${money2(monto)}"
    ${r.capturada ? "disabled" : ""}
  />
  <small class="text-muted">
    ${moneyFormatMX(monto)}
  </small>
</td>
              <td class="text-end">
                <button class="btn btn-outline-primary btn-sm js-save-row" title="Guardar fila">
                  <i class="bi bi-save"></i>
                </button>
                <button class="btn btn-outline-secondary btn-sm js-reset-row" title="Deshacer">
                  <i class="bi bi-arrow-counterclockwise"></i>
                </button>
              </td>
            </tr>
          `;
          })
          .join("");
      }
      

      page.value = String(currentPage);
      countInfo.textContent = `${total} registro(s) — Página ${currentPage} de ${totalPages} — Cambios: ${dirty.size}`;
    }

    function applyFilter() {
      const term = String(q?.value || "")
        .trim()
        .toLowerCase();
      filtered = !term
        ? [...all]
        : all.filter(
            (r) =>
              String(r.clave || "")
                .toLowerCase()
                .includes(term) ||
              String(r.partida || "")
                .toLowerCase()
                .includes(term),
          );

      currentPage = 1;
      render();
    }

    async function load() {
      tbody.innerHTML = `<tr><td colspan="4" class="text-muted">Cargando…</td></tr>`;

      const data = await fetchJson(`${API}/api/catalogos/partidas`, {
  headers: authHeaders(),
});

const rows = Array.isArray(data?.rows) ? data.rows : [];
all = rows;
filtered = [...all];
currentPage = 1;

// ✅ ahora sí pinta DG/DA desde el API
if (dgda) {
  dgda.textContent = `${data?.dg || "—"} / ${data?.da || "—"}`;
}

applyFilter();

console.log("[PARTIDAS][API]", data);
console.log("[PARTIDAS][ROWS LEN]", rows.length);
console.log("[PARTIDAS][DG/DA]", data?.dg, data?.da);

    }

    async function saveOne(clave, monto) {
      await fetchJson(`${API}/api/catalogos/partidas/monto`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ clave, monto }),
      });
    }

    async function saveAll() {
      if (dirty.size === 0) {
        Swal.fire("Sin cambios", "No hay montos por guardar.", "info");
        return;
      }

      const ok = await Swal.fire({
        title: "¿Guardar cambios?",
        text: `Se guardarán ${dirty.size} partida(s).`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Sí, guardar",
        cancelButtonText: "Cancelar",
      });

      if (!ok.isConfirmed) return;

      // Guardado secuencial (simple y estable)
      for (const [clave, monto] of dirty.entries()) {
        await saveOne(clave, monto);
      }

      dirty.clear();
      await Swal.fire("Listo", "Montos guardados.", "success");
      await load();
    }

    // Events
    btnLogout?.addEventListener("click", () => {
      localStorage.removeItem("cp_token");
      sessionStorage.removeItem("cp_token");
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      window.location.href = "login.html";
    });

    btnReload?.addEventListener("click", () =>
      load().catch((e) => Swal.fire("Error", e.message, "error")),
    );
    btnGuardar?.addEventListener("click", () =>
      saveAll().catch((e) => Swal.fire("Error", e.message, "error")),
    );

    q?.addEventListener("input", applyFilter);
    btnClear?.addEventListener("click", () => {
      q.value = "";
      applyFilter();
      q.focus();
    });

    pageSize?.addEventListener("change", () => {
      currentPage = 1;
      render();
    });
    btnPrev?.addEventListener("click", () => {
      currentPage = Math.max(1, currentPage - 1);
      render();
    });
    btnNext?.addEventListener("click", () => {
      const ps = Number(pageSize?.value) || 20;
      const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
      currentPage = Math.min(totalPages, currentPage + 1);
      render();
    });
    page?.addEventListener("change", () => {
      const ps = Number(pageSize?.value) || 20;
      const totalPages = Math.max(1, Math.ceil(filtered.length / ps));
      let v = Number(page.value);
      if (!Number.isFinite(v) || v < 1) v = 1;
      if (v > totalPages) v = totalPages;
      currentPage = v;
      render();
    });

    tbody?.addEventListener("input", (ev) => {
      const input = ev.target.closest(".js-monto");
      if (!input) return;
      const tr = input.closest("tr");
      const clave = tr?.getAttribute("data-clave");
      if (!clave) return;

      const v = Number(input.value);
      if (!Number.isFinite(v) || v < 0) return;

      dirty.set(clave, Number(v.toFixed(2)));
      countInfo.textContent = countInfo.textContent.replace(
        /Cambios:\s*\d+/,
        `Cambios: ${dirty.size}`,
      );
    });

    tbody?.addEventListener("click", async (ev) => {
      const tr = ev.target.closest("tr[data-clave]");
      if (!tr) return;
      const clave = tr.getAttribute("data-clave");

      if (ev.target.closest(".js-reset-row")) {
        dirty.delete(clave);
        // re-render para refrescar el value (vuelve al monto original)
        render();
        return;
      }

      if (ev.target.closest(".js-save-row")) {
        const input = tr.querySelector(".js-monto");
        const v = Number(input?.value);
        if (!Number.isFinite(v) || v < 0) {
          Swal.fire("Monto inválido", "Escribe un número válido.", "warning");
          return;
        }

        await saveOne(clave, Number(v.toFixed(2)));
        dirty.delete(clave);
        Swal.fire("Guardado", `Partida ${clave} actualizada.`, "success");
        await load();
      }
    });

    // Init
    load().catch((e) => {
      console.error(e);
      Swal.fire("Error", e.message || "No se pudo cargar.", "error");
    });
  });
})();


