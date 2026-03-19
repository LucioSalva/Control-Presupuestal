# Selector dinámico de Metas (Suficiencia Presupuestal)

## Objetivo
En **Suficiencia Presupuestal**, el campo **META** se captura mediante un selector que muestra únicamente metas válidas según la jerarquía institucional:

- DG (Dirección General)
- DA (Dirección Administrativa)
- Proyecto (incluye clave + CONAC)

Esto evita que el operador capture metas de otra DG/DA/Proyecto y mejora la trazabilidad.

## Componentes
- UI: [suficiencia_presupuestal.html](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/public/suficiencia_presupuestal.html)
  - Select: `#metaSelect` (`name="id_meta"`)
  - Ayuda/estado: `#metaHelp`
  - Valor efectivo enviado a backend: `input[name="meta"]` (hidden)

- Lógica: [suficiencia_presupuestal.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/public/js/suficiencia_presupuestal.js)
  - Carga dinámica al cambiar proyecto
  - Manejo de estados: cargando / vacío / error
  - Validación de selección antes de guardar

- API (existente): [metas.routes.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/routes/metas.routes.js)
  - Endpoint: `GET /api/catalogos/metas`
  - Filtra por `dg_clave`, `da_clave`, `proy_clave`, `conac` (o `id_proyecto`)
  - Si el rol del usuario es `AREA`, DG/DA se forzan desde su usuario autenticado

## Flujo funcional
1. El usuario selecciona un **Proyecto**.
2. El frontend solicita metas al backend usando:
   - `id_proyecto`
   - `dg_clave` y `da_clave` (para reforzar el contexto; en rol AREA se ignoran y se fuerza DG/DA del usuario)
3. El selector se habilita cuando llega la lista:
   - Si hay metas: muestra opciones válidas.
   - Si no hay metas: bloquea el selector y muestra “Sin metas registradas”.
   - Si hay error: bloquea el selector y muestra mensaje de error.
4. Al seleccionar una meta:
   - Se copia el texto de meta al campo oculto `meta` (ese valor es el que se guarda en suficiencias).
5. Antes de guardar:
   - Si existe el selector (y hay metas), se exige selección válida.
   - Se rechaza cualquier ID fuera de la lista cargada (evita manipulación del DOM).

## Contratos del endpoint
`GET /api/catalogos/metas`

Parámetros soportados:
- Por claves:
  - `dg_clave` (ej. `L00`)
  - `da_clave` (ej. `117`)
  - `proy_clave` (10 dígitos)
  - `conac` (ej. `E`)
- O por proyecto:
  - `id_proyecto` (id numérico)
  - `dg_clave` / `da_clave` (requeridos en rol GOD/ADMIN; en AREA se fuerzan)

Respuesta:
- `{ ok: true, filtros: {...}, data: [...] }`

El frontend tolera respuesta como arreglo simple `[...]` o como objeto con `data`.

## Pruebas unitarias
Se incluye una prueba unitaria de filtrado jerárquico independiente de la BD:

- [metas-filter.test.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/utils/metas-filter.test.js)

Ejecución:
```bash
cd server
node utils/metas-filter.test.js
```

