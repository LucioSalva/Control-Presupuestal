// js/session-guard.js
(() => {
  const IDLE_MS = 10 * 60 * 1000; // 10 min
  const KEY_LAST = "cp_last_activity";

  function hasSession() {
    return !!localStorage.getItem("cp_usuario") && !!localStorage.getItem("cp_token");
  }

  function touch() {
    localStorage.setItem(KEY_LAST, String(Date.now()));
  }

  function logout(reason = "Sesión expirada por inactividad") {
    localStorage.removeItem("cp_usuario");
    localStorage.removeItem("cp_token");
    localStorage.removeItem("cp_login_time");
    localStorage.removeItem("cp_current_project");
    localStorage.removeItem(KEY_LAST);

    // puedes mostrar un mensaje si quieres:
    // alert(reason);
    window.location.replace("login.html");
  }

  if (!hasSession()) {
    window.location.replace("login.html");
    return;
  }

  // Inicializa actividad
  if (!localStorage.getItem(KEY_LAST)) touch();

  // Throttle para no escribir a cada pixel de mouse
  let lastWrite = 0;
  const throttledTouch = () => {
    const now = Date.now();
    if (now - lastWrite > 5000) { // cada 5s máximo
      lastWrite = now;
      touch();
    }
  };

  ["click", "mousemove", "keydown", "scroll", "touchstart"].forEach((ev) => {
    window.addEventListener(ev, throttledTouch, { passive: true });
  });

  // Checador cada 10s
  setInterval(() => {
    const last = Number(localStorage.getItem(KEY_LAST) || 0);
    if (!last) return;
    if (Date.now() - last > IDLE_MS) logout();
  }, 10000);
})();
