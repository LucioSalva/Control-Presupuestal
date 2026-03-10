# Control de visibilidad de campos financieros (IEPS / PENSIÓN)

## Regla funcional
En el módulo **Suficiencia Presupuestal**, la visibilidad completa de campos financieros queda restringida a:

- Usuarios con **DG = L00** y **DA = 117**
- Usuarios con **DG = E00** (cualquier DA)

El resto de usuarios solo visualizan:

- SUBTOTAL
- IVA
- ISR
- TOTAL

Los conceptos **IEPS** y **PENSIÓN** se ocultan completamente en la interfaz.

## Backend (autorización en tiempo real)
La evaluación se hace por request usando el usuario autenticado (`authRequired`), leyendo sus `id_dgeneral` y `id_dauxiliar` y resolviendo sus claves en BD.

- Endpoint de permiso:
  - `GET /api/suficiencias/perm-ieps-pensiones`
  - Respuesta: `{ allowed: true|false }`

- Protección de datos:
  - En `POST /api/suficiencias` si `allowed=false`, el backend fuerza valores seguros y evita que el cliente “inyecte” IEPS/PENSIÓN.
  - En `GET /api/suficiencias/:id` si `allowed=false`, el backend enmascara IEPS/PENSIÓN en la respuesta.

Código:
- [suficiencias.routes.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/routes/suficiencias.routes.js)
- [financial-fields-perm.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/utils/financial-fields-perm.js)

## Frontend (ocultamiento UI)
En la carga inicial de Suficiencia se consulta el endpoint de permiso y, si `allowed=false`:

- Se deshabilitan y ocultan los controles de IEPS y PENSIÓN.
- Se ocultan las filas de totales correspondientes a IEPS y PENSIÓN.
- Se recalculan totales sin considerar IEPS/PENSIÓN.

Código:
- [suficiencia_presupuestal.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/public/js/suficiencia_presupuestal.js)

## Pruebas unitarias
Se incluye prueba unitaria de la regla (sin BD):
- [financial-fields-perm.test.js](file:///c:/Users/lucio/Desktop/creacionSoftware/Control-Presupuestal/server/utils/financial-fields-perm.test.js)

Ejecución:
```bash
cd server
node utils/financial-fields-perm.test.js
```

