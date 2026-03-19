# AGENTS.md - Control Presupuestal

## Descripción del Proyecto

Sistema web para la gestión, control y seguimiento del presupuesto municipal del H. Ayuntamiento de Ecatepec de Morelos. Backend Node.js/Express con base de datos PostgreSQL y frontend vanilla JavaScript/HTML/CSS.

## Comandos para Desarrolladores

### Instalación de Dependencias

```bash
# En el directorio server/
cd server
npm install
```

### Ejecución del Servidor

```bash
# Desarrollo (con auto-reload usando --watch)
cd server && npm run dev

# Producción
cd server && npm start
```

### Base de Datos

- PostgreSQL 12+ requerido
- Configurar variables en `server/.env`:
  ```
  DATABASE_URL=postgres://user:pass@host:port/db
  PORT=3000
  PGSSL=false
  SEED=true
  ```
- Los scripts SQL están en `sql/` y `server/sql/`

### Pruebas

No hay framework de testing configurado actualmente. Para agregar pruebas, considere:
- Vitest o Jest para pruebas unitarias
- Supertest para pruebas de API

## Convenciones de Código

### Estructura de Archivos

```
server/
├── server.js           # Punto de entrada principal
├── db.js               # Conexión a PostgreSQL
├── .env                # Variables de entorno (NO commitear)
├── routes/             # Rutas de API Express
├── utils/              # Utilidades helpers
├── sql/                # Scripts SQL y migraciones
└── public/             # Frontend estático (HTML/JS/CSS)
```

### Estilo JavaScript (ES Modules)

- Usar `import`/`export` (ES modules), NO `require`
- `"type": "module"` en package.json
- Comillas dobles para strings: `"texto"`
- Punto y coma al final de declaraciones
- Usar `const` por defecto, `let` solo cuando sea necesario

```javascript
// ✅ Correcto
import express from "express";
import { query } from "./db.js";

const router = express.Router();
const MAX_AGE_MS = 10 * 60 * 1000;

// ❌ Incorrecto
const router = require('express').Router();
const router = express.Router()
```

### Convenciones de Nombres

- **Variables y funciones**: camelCase
  ```javascript
  const userId = req.user.id;
  function getUserDGDA(req) { ... }
  ```
- **Constantes**: UPPER_SNAKE_CASE
  ```javascript
  const MAX_AGE_MS = 10 * 60 * 1000;
  const ALLOWED_ORIGINS = new Set([...]);
  ```
- **Archivos**: kebab-case
  ```
  auth.routes.js
  seed_partidas_permitidas.js
  ```
- **Tablas/Columnas BD**: snake_case (PostgreSQL estándar)

### Importaciones

1. Primero: imports externos (node modules)
2. Segundo: imports internos (relative paths)
3. Tercera: configuración (dotenv)

```javascript
// server/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import { query, getClient } from "../db.js";
```

### Tipos y Validación

- Usar coerción de tipos explícita cuando sea necesario
- Validar inputs con `Number()`, `String()`, `Boolean()`
- Verificar `Number.isFinite()` para números válidos

```javascript
const userId = Number(req.user?.id);
const monto = Number(req.body?.monto);

if (!Number.isFinite(userId) || userId <= 0) {
  return res.status(401).json({ error: "No autenticado" });
}
```

### Manejo de Errores

- Siempre usar try/catch en funciones async
- Loggear errores con `console.error("[ROUTE][METHOD] Error:", e)`
- Responder con JSON estructurado: `{ error: "mensaje" }`
- Usar códigos de estado HTTP apropiados

```javascript
// ✅ Correcto
router.get("/", async (req, res) => {
  try {
    const result = await query(sql, params);
    return res.json({ data: result.rows });
  } catch (e) {
    console.error("[PARTIDAS][GET] Error:", e);
    return res.status(500).json({ error: "Error al cargar partidas" });
  }
});

// ❌ Incorrecto - no exponga detalles de BD al cliente
catch (e) {
  return res.status(500).json({ error: e.message });
}
```

### Consultas SQL

- Usar parámetros preparados (previene SQL injection)
- Usar texto de query multilínea para legibilidad
- Usar `LIMIT 1` cuando solo se espera un resultado
- Usar alias claros para columnas

```javascript
const sql = `
  SELECT u.id,
         u.nombre_completo,
         dg.clave AS dgeneral_clave
  FROM usuarios u
  LEFT JOIN dgeneral dg ON dg.id = u.id_dgeneral
  WHERE u.id = $1
  LIMIT 1;
`;
const result = await query(sql, [userId]);
```

### Rutas Express

- Usar Router de Express para modularizar
- Middleware de autenticación en rutas protegidas
- Validar parámetros antes de procesar

```javascript
const router = express.Router();

router.get("/", authRequired, async (req, res) => { ... });
router.post("/", authRequired, requireGodOrAdmin, async (req, res) => { ... });
```

### Autenticación

- Token "fake" con formato: `token-{id}-{timestamp}`
- Verificar expiración (10 minutos)
- Extraer user ID y roles del token
- Adjuntar usuario a `req.user`

### Seguridad

- NUNCA commitear archivos `.env` o con credenciales
- Usar Helmet para headers de seguridad
- Rate limiting en endpoints sensibles (/login)
- CORS restrictivo por whitelist
- Sanitizar inputs de usuario
- Parameterized queries (NO string concatenation)

### Comentarios

- Español (proyecto institucional mexicano)
- Encabezados de sección:
  ```javascript
  // =====================================================
  //  NOMBRE DE SECCIÓN
  // =====================================================
  ```
- Comentos inline para explicar lógica compleja o decisiones no obvias

### Frontend (public/js/)

- Vanilla JavaScript (sin frameworks)
- Usar `fetch` para llamadas API
- Usar SweetAlert2 para modales
- Usar Chart.js para gráficos
- Usar SheetJS (xlsx) para exportaciones Excel
- LocalStorage para estado de sesión: `cp_usuario`, `cp_app_data_v1`

```javascript
const raw = localStorage.getItem("cp_usuario");
const user = JSON.parse(raw);
```

### Git y Versionado

- No commitear: `.env`, `node_modules/`, `*.log`, credenciales
- Commits descriptivos en español
- Ramas: `feature/`, `fix/`, `refactor/`

### Dependencias Principales

```json
{
  "express": "^4.22.1",
  "pg": "^8.18.0",
  "bcryptjs": "^3.0.3",
  "jsonwebtoken": "^9.0.3",
  "helmet": "^8.1.0",
  "cors": "^2.8.6",
  "dotenv": "^16.6.1",
  "xlsx": "^0.18.5",
  "pdf-lib": "^1.17.1"
}
```

### Puertos Comunes

- Backend API: 3000
- Frontend Live Server: 5502
- PostgreSQL: 5432 (o 5433 según configuración local)

### Recursos Adicionales

- [Express.js](https://expressjs.com/)
- [node-postgres](https://node-postgres.com/)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [Chart.js](https://www.chartjs.org/docs/)
- [SheetJS](https://sheetjs.com/docs/)
