// pdf-helpers.js — Helpers compartidos para generación de PDFs (pdf-lib)
// Expone window.PdfHelpers para uso en suficiencia_presupuestal.js, comprometido.js y devengado.js
(() => {
  "use strict";

  // === NÚMEROS SEGUROS ===
  // Fuente: suficiencia_presupuestal.js (safeNumber, línea 151) y
  //         comprometido.js (safeNumber, línea 100) y
  //         devengado.js (safeNumber, línea 114) — implementación idéntica en los tres.
  // safeN es el alias usado dentro de generarPDF() en suficiencia_presupuestal.js (línea 3290).
  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }
  const safeN = safeNumber; // alias

  // === NÚMERO A LETRAS ===
  // Fuente: suficiencia_presupuestal.js (líneas 1345–1444).
  // Esta versión es la más completa: soporta negativos, tiene manejo correcto
  // de decenas 10–19 y de veintiuno. La versión en devengado.js usa una
  // función interna convertirNumero() diferente; la de suficiencia es canónica.
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
      if (n < 1000000) return miles(n);
      const m = Math.floor(n / 1000000);
      const r = n % 1000000;
      let out = m === 1 ? "UN MILLÓN" : miles(m) + " MILLONES";
      if (r) out += " " + miles(r);
      return out.trim();
    }

    return millones(num).trim().toUpperCase();
  }

  // Fuente: suficiencia_presupuestal.js (líneas 1336–1343).
  // Formatea un monto como "CIENTO VEINTE PESOS 50/100 M.N."
  function numeroALetrasMX(monto) {
    const n = safeNumber(monto);
    const entero = Math.floor(n);
    const centavos = Math.round((n - entero) * 100);
    const letras = numeroALetras(entero);
    const cent = String(centavos).padStart(2, "0");
    return `${letras} PESOS ${cent}/100 M.N.`;
  }

  // === UTILIDADES DE CELDA ===
  // Fuente: comprometido.js (línea 897) y devengado.js (línea 1009) — idénticas.
  // En suficiencia_presupuestal.js aparece como const dentro de generarPDF() (línea 3295).
  function normalizeCell(v) {
    return String(v ?? "").replace(/\s+/g, " ").trim();
  }

  // Fuente: comprometido.js (líneas 1104–1108) y devengado.js (líneas 1263–1267) — idénticas.
  // En suficiencia_presupuestal.js aparece como const dentro de generarPDF() (líneas 3296–3300).
  function cut(v, max) {
    const s = normalizeCell(v);
    if (!max || s.length <= max) return s;
    return s.slice(0, max);
  }

  // Fuente: comprometido.js (líneas 1099–1103) y devengado.js (líneas 1258–1262) — idénticas.
  // En suficiencia_presupuestal.js aparece como const dentro de generarPDF() (líneas 3301–3304).
  function padLines(arr, max) {
    const out = arr.slice(0, max);
    while (out.length < max) out.push("");
    return out;
  }

  // === FACTORY DE HELPERS DE DIBUJO ===
  // Devuelve { ctr, lft, rgt } para uso con pdf-lib drawText.
  // Fuente: comprometido.js (líneas 1388–1416), devengado.js (líneas 1386–1410)
  // y suficiencia_presupuestal.js (líneas 3859–3883) — implementación idéntica en los tres.
  // Las tres funciones están definidas dentro de generarPDF() en cada módulo;
  // aquí se extraen a una factory que recibe la página y la fuente ya embebidas.
  function createDrawHelpers(page, font) {
    const BLACK = window.PDFLib ? window.PDFLib.rgb(0, 0, 0) : { r: 0, g: 0, b: 0 };

    // Centra texto dentro del rect [rx, rx+rw]; trunca si no cabe
    const ctr = (text, rx, rw, y, size) => {
      if (size === undefined) size = 9;
      let s = String(text ?? "").trim();
      if (!s) return;
      try {
        while (s.length > 1 && font.widthOfTextAtSize(s, size) > rw) s = s.slice(0, -1);
        const tw = font.widthOfTextAtSize(s, size);
        page.drawText(s, { x: rx + (rw - tw) / 2, y, size, font, color: BLACK });
      } catch {}
    };

    // Alinea a la izquierda dentro del rect; trunca si no cabe
    const lft = (text, rx, rw, y, size, margin) => {
      if (size === undefined) size = 9;
      if (margin === undefined) margin = 2;
      let s = String(text ?? "").trim();
      if (!s) return;
      try {
        while (s.length > 1 && font.widthOfTextAtSize(s, size) > rw - margin * 2) s = s.slice(0, -1);
        page.drawText(s, { x: rx + margin, y, size, font, color: BLACK });
      } catch {}
    };

    // Alinea a la derecha dentro del rect
    const rgt = (text, rx, rw, y, size, margin) => {
      if (size === undefined) size = 9;
      if (margin === undefined) margin = 2;
      const s = String(text ?? "").trim();
      if (!s) return;
      try {
        const tw = font.widthOfTextAtSize(s, size);
        page.drawText(s, { x: Math.max(rx + margin, rx + rw - tw - margin), y, size, font, color: BLACK });
      } catch {}
    };

    return { ctr, lft, rgt };
  }

  // === EXPONER GLOBALMENTE ===
  window.PdfHelpers = {
    safeNumber,
    safeN,
    numeroALetras,
    numeroALetrasMX,
    normalizeCell,
    cut,
    padLines,
    createDrawHelpers,
  };
})();
