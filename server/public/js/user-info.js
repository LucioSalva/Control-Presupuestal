// js/user-info.js

document.addEventListener("DOMContentLoaded", () => {

  const u = localStorage.getItem("cp_usuario");
  const t = localStorage.getItem("cp_token");
  if (!u || !t) {
    window.location.replace("login.html");
    return;
  }
  const info = document.getElementById("userInfo");
  const btnLogout = document.getElementById("btnLogout");

  if (!info) return;

  const raw = localStorage.getItem("cp_usuario");
  if (!raw) {
    info.textContent = "Sesión no iniciada";
    return;
  }

  const user = JSON.parse(raw);
  const nombre = user.nombre_completo || user.usuario || "Usuario";

  // Registrar hora de acceso si no existe
  if (!localStorage.getItem("cp_login_time")) {
    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, "0");
    const mm = String(ahora.getMinutes()).padStart(2, "0");
    localStorage.setItem("cp_login_time", `${hh}:${mm}`);
  }

  const horaAcceso = localStorage.getItem("cp_login_time");

  // Mostrar usuario + hora
  info.textContent = `${nombre} — Último Acceso: ${horaAcceso}`;

  // 🔥 BOTÓN PARA CERRAR SESIÓN
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      // Elimina toda la sesión
      localStorage.removeItem("cp_usuario");
      localStorage.removeItem("cp_token");
      localStorage.removeItem("cp_login_time");
      localStorage.removeItem("cp_current_project");

      // Previene volver con el botón "atrás"
      window.location.replace("login.html");
    });
  }
});
