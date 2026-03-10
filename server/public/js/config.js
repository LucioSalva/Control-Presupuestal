(() => {
  if (window.API_URL) return;

  const host = String(window.location.hostname || "").trim().toLowerCase();
  const port = String(window.location.port || "").trim();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const isFrontendDevPort = isLocal && port && port !== "3000";

  window.API_URL = isFrontendDevPort ? "http://localhost:3000" : window.location.origin;
})();
