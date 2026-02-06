(() => {
  // Base de API desde config.js (window.API_URL)
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  const LS_KEYS_TO_CLEAR = [
    "cp_app_data_v1",
    "cp_current_project",
    "cp_current_project_keys",
    "cp_partidas",
  ];

  // Helper: fetch JSON seguro (evita el "Unexpected token <")
  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status} (${res.statusText})`;
      throw new Error(msg);
    }

    if (data == null) {
      throw new Error("La API no regresó JSON válido.");
    }

    return data;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const errorBox = document.getElementById("loginError");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (errorBox) {
        errorBox.classList.add("d-none");
        errorBox.textContent = "";
      }

      const usuario = document.getElementById("usuario")?.value?.trim() || "";
      const password = document.getElementById("password")?.value || "";

      try {
        const data = await fetchJson(`${API}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuario, password }),
        });

        // Guardar token/usuario
        localStorage.setItem("cp_token", data.token);
        localStorage.setItem("cp_usuario", JSON.stringify(data.usuario));

        // compatibilidad con otros scripts
        localStorage.setItem("token", data.token);
        localStorage.setItem("authToken", data.token);

        // limpiar estado previo
        LS_KEYS_TO_CLEAR.forEach((k) => {
          try { localStorage.removeItem(k); } catch {}
        });

        // roles
        const roles = Array.isArray(data.usuario?.roles) ? data.usuario.roles : [];
        const rolesNorm = roles.map((r) => String(r).trim().toUpperCase());

        // ✅ Redirección FINAL (una sola)
        if (rolesNorm.includes("GOD")) {
          window.location.href = "admin-usuarios.html";
          return;
        }

        // ADMIN o AREA -> suficiencia
        window.location.href = "suficiencia_presupuestal.html";
        return;

      } catch (err) {
        console.error(err);
        if (errorBox) {
          errorBox.textContent = err.message || "Error al iniciar sesión";
          errorBox.classList.remove("d-none");
        }
      }
    });
  });
})();
