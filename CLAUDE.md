# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Control Presupuestal** is a municipal budget management web system for the H. Ayuntamiento de Ecatepec de Morelos. It manages budget items (partidas), expenditures, transfers (reconducciones), and sufficiencies across municipal departments.

## Commands

All commands run from `server/`:

```bash
# Install dependencies
cd server && npm install

# Development (auto-reload)
cd server && npm run dev

# Production
cd server && npm start
```

No test framework is configured. The `server/utils/*.test.js` files contain manual/inline tests.

## Architecture

**Monorepo structure:**
- `server/` — Node.js/Express backend (API + static frontend serving)
- `server/public/` — Vanilla JS/HTML/CSS frontend (no build step)
- `server/routes/` — One file per feature domain
- `server/utils/` — Shared helpers, seeds, filters
- `server/sql/` — SQL migration scripts
- `sql/` — Additional SQL scripts

**Request flow:** Frontend (`public/`) calls `GET/POST /api/*` → `server.js` applies auth middleware → route handlers → PostgreSQL via `db.js`.

**Frontend:** Served as static files from Express. Each HTML page loads its own JS file from `public/js/`. Uses `fetch` for API calls. Session state in `localStorage` keys `cp_usuario` and `cp_app_data_v1`.

## Authentication & Roles

The system uses a **custom "fake" token** (not JWT despite the dependency):
- Format: `token-{userId}-{timestamp}`
- Expires after 10 minutes
- On each request, `authRequired` middleware queries the DB to get the user's current roles and status

**Role system** (stored in `usuario_rol` table):
- `GOD` — superadmin, full access
- `ADMIN` — admin, can manage most things
- `AREA` — regular user, read-only on catalogs

**Key middleware in `server.js`:**
- `authRequired` — validates token, attaches `req.user` with `{ id, id_dgeneral, id_dauxiliar, roles }`
- `requireGodOrAdmin` — blocks non-GOD/ADMIN
- `blockPartidasWrite` — blocks AREA users from modifying catalog entries (except `/monto`)

## API Routes

| Path | Router file |
|------|-------------|
| `/api/login` | `auth.routes.js` |
| `/api/admin/usuarios` | `admin-usuarios.routes.js` (GOD/ADMIN only) |
| `/api/admin/auditoria` | `admin-auditoria.routes.js` (GOD/ADMIN only) |
| `/api/suficiencias` | `suficiencias.routes.js` |
| `/api/comprometido` | `comprometido.routes.js` |
| `/api/devengado` | `devengado.routes.js` |
| `/api/catalogos/partidas` | `partidas.routes.js` |
| `/api/catalogos` | `catalogos.routes.js` |
| `/api/dashboard` | `dashboard_partidas.routes.js` |
| `/api/reconducciones` | `reconducciones.routes.js` |
| `/api/presupuesto-base-partidas` | `presupuesto_base_partidas.routes.js` (GOD/ADMIN) |

## Environment Variables

File: `server/.env`

```
DATABASE_URL=postgres://postgres:admin@localhost:5432/presupuesto_db
PGSSL=false
PORT=3000
SEED=true   # runs seedPartidasPermitidas() on startup
```

## Business Rules

- **Partidas mil (1xxx):** Only visible to DG L00 with DA 117 and DG E00. Other areas' catalogs, dashboards, and details filter out `1xxx` partidas.
- **IVA:** Does not apply to partidas mil in suficiencias; other partidas keep IVA.
- **Reconducciones:** Restricted to Monday–Thursday, with an exception for L00/117.
- **Unauthorized access attempts** are logged to the audit table.

## Code Conventions

- **ES Modules** (`"type": "module"` in package.json) — use `import`/`export`, never `require`
- **Strings:** double quotes; statements end with semicolons
- **Variables:** `camelCase`; constants: `UPPER_SNAKE_CASE`; DB columns: `snake_case`
- **Comments in Spanish** (institutional project); section headers use `// ===... SECTION NAME ...===`
- **Imports order:** external node modules → internal relative imports → config (dotenv)
- **SQL:** always use parameterized queries (`$1`, `$2`, …); never string concatenation
- **Error logging:** `console.error("[ROUTE][METHOD] Error:", e)`; respond with `{ error: "mensaje" }` — never expose raw DB error messages to client
- **Audit logging:** `logAuditEvent()` from `utils/helpers.js` is auto-called for all write methods via `res.on("finish")` in `authRequired`

## Startup Behavior

On start, `server.js`:
1. Runs pending SQL migration (`reconducciones`) if the table doesn't exist
2. If `SEED=true`, calls `seedPartidasPermitidas()` to populate allowed partidas per dependency/project/source
3. Starts Express on `PORT` (default 3000)
