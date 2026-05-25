# Aviso de cierre de sesión obligatorio — Control Presupuestal

**Para:** Direcciones y áreas usuarias del sistema Control Presupuestal
**De:** Coordinación del sistema — Departamento de Presupuesto, Tesorería Municipal
**Fecha del cambio:** _(definir antes del despliegue)_
**Ventana sugerida:** fuera de horario operativo (p. ej. 19:00 hrs en adelante)

---

## ¿Qué va a pasar?

El sistema de **Control Presupuestal** será actualizado con un endurecimiento de seguridad. Como parte del cambio, **todas las sesiones activas quedarán cerradas automáticamente** en el momento del despliegue. Los usuarios deberán **volver a iniciar sesión** la próxima vez que entren.

## ¿Por qué?

Antes de este cambio, el sistema usaba un formato de credencial de sesión propio. Una auditoría interna recomendó migrar a **JWT firmado (HS256)** con verificación de emisor, audiencia y expiración. Esto:

- Impide que un atacante construya tokens válidos sin la clave del servidor.
- Hace que los tokens caduquen efectivamente a los 10 minutos y exijan login.
- Rechaza tokens con algoritmo `none` y los del formato anterior.

Las credenciales **emitidas antes del despliegue ya no serán aceptadas** — de ahí el cierre de sesión obligatorio.

## ¿Qué debe hacer cada usuario?

1. Cuando entre al sistema verá la pantalla de **inicio de sesión**.
2. Ingresar usuario y contraseña habituales. **No cambian.**
3. Continuar trabajando con normalidad.

Si tiene formularios sin guardar al momento del despliegue, **se perderán al recargar**. Por eso se recomienda cerrar el navegador antes del horario anunciado y guardar cualquier captura en curso.

## ¿Cambia algo más para el usuario?

No para el usuario regular. Internamente:

- Los archivos PDF subidos a reconducciones ahora se renombran con un identificador único (no se conserva el nombre original).
- Las descargas de oficios siguen funcionando igual.
- La sesión sigue durando 10 minutos sin actividad — no cambia.

## ¿Qué pasa si alguien estaba trabajando?

- Si tiene un formulario sin enviar al momento del despliegue: **al recargar verá la pantalla de login**.
- Tras iniciar sesión de nuevo, deberá **volver a capturar** ese formulario si no lo había guardado.
- Todas las suficiencias / comprometidos / devengados / reconducciones **ya guardados antes del despliegue siguen ahí**, sin cambios.

## Contacto

- Mesa de soporte: _(definir teléfono / extensión)_
- Correo: _(definir)_
- Responsable técnico de la actualización: _(definir)_

---

### Lista de verificación pre-despliegue (uso interno del equipo técnico)

- [ ] Aviso enviado a Direcciones y áreas usuarias con **mínimo 24 horas** de anticipación.
- [ ] Aviso publicado al iniciar sesión (banner / pantalla intermedia) durante la última hora previa.
- [ ] Backup completo de la BD ejecutado y verificado.
- [ ] Migración `2026_05_21_fn_saldo_fix.sql` aplicada en réplica y validada con `2026_05_25_validar_saldos_pre_deploy.sql`.
- [ ] Despliegue ejecutado en ventana acordada.
- [ ] Healthcheck `GET /api/health` responde **200** con `database.status = "ok"`.
- [ ] Smoke test (`ops/smoke_test_staging.ps1`) ejecutado en verde.
- [ ] Mesa de soporte avisada por si suben tickets de "no me deja entrar" (es normal — pedir limpiar cookies y reintentar).
