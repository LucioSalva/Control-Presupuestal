// js/user-info.js

document.addEventListener("DOMContentLoaded", () => {
  const userRaw = localStorage.getItem("cp_usuario");
  const token = localStorage.getItem("cp_token");

  if (!userRaw || !token) {
    window.location.replace("login.html");
    return;
  }

  let user = null;
  try {
    user = JSON.parse(userRaw);
  } catch {
    window.location.replace("login.html");
    return;
  }

  const info = document.getElementById("userInfo");
  const btnLogout = document.getElementById("btnLogout");

  const nombre = user?.nombre_completo || user?.usuario || "Usuario";

  if (!localStorage.getItem("cp_login_time")) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    localStorage.setItem("cp_login_time", `${hh}:${mm}`);
  }

  const loginTime = localStorage.getItem("cp_login_time") || "--:--";
  if (info) {
    info.textContent = `${nombre} - Ultimo Acceso: ${loginTime}`;
  }

  const partidasLinks = document.querySelectorAll('a[href="partidas_base.html"]');
  const setPartidasVisible = (visible) => {
    partidasLinks.forEach((link) => {
      const item = link.closest("li") || link;
      if (visible) item.classList.remove("d-none");
      else item.classList.add("d-none");
    });
  };
  setPartidasVisible(false);
  const expLinks = document.querySelectorAll('a[href="expedientes_entrega.html"]');
  const setExpVisible = (visible) => {
    expLinks.forEach((link) => {
      const item = link.closest("li") || link;
      if (visible) item.classList.remove("d-none");
      else item.classList.add("d-none");
    });
  };
  setExpVisible(false);

  async function resolveClaveFromCatalog(path, id) {
    if (!Number.isFinite(id) || id <= 0) return "";
    try {
      const res = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return "";
      const rows = await res.json();
      const found = Array.isArray(rows)
        ? rows.find((x) => Number(x?.id) === id)
        : null;
      return String(found?.clave || "").trim().toUpperCase();
    } catch {
      return "";
    }
  }

  (async () => {
    let dgClave = String(user?.dgeneral_clave || "").trim().toUpperCase();
    let daClave = String(user?.dauxiliar_clave || "").trim().toUpperCase();

    // Sesiones viejas pueden no traer *_clave en cp_usuario.
    if (!dgClave && Number.isFinite(Number(user?.id_dgeneral))) {
      dgClave = await resolveClaveFromCatalog(
        "/api/catalogos/dgeneral",
        Number(user.id_dgeneral),
      );
    }
    if (!daClave && Number.isFinite(Number(user?.id_dauxiliar))) {
      daClave = await resolveClaveFromCatalog(
        "/api/catalogos/dauxiliar",
        Number(user.id_dauxiliar),
      );
    }

    const roles = Array.isArray(user?.roles) ? user.roles : [];
    const rolesNorm = roles
      .filter((r) => r != null)
      .map((r) => String(r).trim().toUpperCase());
    const isGod = rolesNorm.includes("GOD");
    const canViewPartidas = isGod || (dgClave === "L00" && daClave === "117");
    setPartidasVisible(canViewPartidas);
    const canViewExp = isGod || (dgClave === "L00" && daClave === "117");
    setExpVisible(canViewExp);
  })();

  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      localStorage.removeItem("cp_usuario");
      localStorage.removeItem("cp_token");
      localStorage.removeItem("cp_login_time");
      localStorage.removeItem("cp_current_project");
      window.location.replace("login.html");
    });
  }
});
