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
- `server/utils/` — Shared helpers, seeds, filters:
  - `helpers.js` — `logAuditEvent()`, `logUnauthorizedPartidasAccess()`, `computeSaldo()`, `isPartidaMilKey()`
  - `financial-fields-perm.js` — `canViewIepsPensionesByClaves()` and `sanitizeFinancialFieldsForLimitedView()` (IEPS/pension fields hidden for non-L00/117 and non-E00)
  - `metas-filter.js` — `filterMetasByHierarchy()` for filtering metas rows by DG/DA/project/CONAC
  - `seed_partidas_permitidas.js` — populates `partidas_permitidas` table on startup
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
- `authRequired` — validates token, attaches `req.user` with `{ id, id_dgeneral, id_dauxiliar, roles }`; auto-logs audit events for all write methods via `res.on("finish")`
- `requireGodOrAdmin` — blocks non-GOD/ADMIN
- `blockPartidasWrite` — blocks AREA users from modifying catalog entries (except `/monto`)
- `helmet` — security headers (CSP disabled in dev, enabled in production)
- `rateLimit` — 600 req/15 min global on `/api`; 20 req/10 min on `/api/login`
- Trace ID — each request gets `req.cpTraceId` (UUID) and `x-trace-id` response header

**Token passing:** Primary via `Authorization: Bearer token-{userId}-{ts}` header. For file downloads (`window.open`), also accepted as `?token=` query param.

## API Routes

| Path | Router file | Notes |
|------|-------------|-------|
| `/api/login` | `auth.routes.js` | No auth required |
| `/api/admin/usuarios` | `admin-usuarios.routes.js` | GOD/ADMIN only |
| `/api/admin/auditoria` | `admin-auditoria.routes.js` | GOD/ADMIN only |
| `/api/suficiencias` | `suficiencias.routes.js` | |
| `/api/comprometido` | `comprometido.routes.js` | |
| `/api/devengado` | `devengado.routes.js` | |
| `/api/expedientes-entrega` | `expedientes_entrega.routes.js` | |
| `/api/catalogos/partidas` | `partidas.routes.js` | AREA write blocked via `blockPartidasWrite` |
| `/api/catalogos/metas` | `metas.routes.js` | |
| `/api/catalogos` | `catalogos.routes.js` | |
| `/api/dashboard` | `dashboard_partidas.routes.js` | |
| `/api/reconducciones` | `reconducciones.routes.js` + `reconducciones_oficios.routes.js` | Both mounted on same path |
| `/api/presupuesto-base-partidas` | `presupuesto_base_partidas.routes.js` | GOD/ADMIN only |
| `/api/presupuesto` | `presupuesto.routes.js` | No auth required |
| `/api/health` | inline in `server.js` | No auth required |

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

On start, `server.js` runs the following migrations idempotently (each checks if already applied), then seeds:

1. `reconducciones` table (`2026_02_23_reconducciones.sql`)
2. `reconduccion_oficios` table (`2026_03_11_reconduccion_oficios.sql`)
3. `firma_enlace_label` column on `reconducciones` (`2026_03_11_reconducciones_firmas.sql`)
4. `firma_enlace_label` column on `suficiencias`/`comprometidos`/`devengados` (`2026_03_11_firmas_suf_comp_dev.sql`)
5. `fn_saldo_disponible_partida` DB function (`2026_03_11_fn_saldo_partida.sql`)
6. General normalization indexes (`2026_03_11_normalizacion_db.sql`)
7. If `SEED=true`, calls `seedPartidasPermitidas()` to populate allowed partidas per dependency/project/source
8. Starts Express on `PORT` (default 3000)
