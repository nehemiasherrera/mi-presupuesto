---
name: quality-gate
description: Auditoría final antes de dar un trabajo por terminado o subir a producción. Coordina las revisiones de datos, cloud/Firebase, frontend y seguridad, ejecuta verificaciones de sintaxis y tests automáticos, y entrega un informe de calidad.
---

# Quality Gate

## Objetivo
Actuar como el revisor final: verificar que lo construido esté alineado, probado y listo antes de pasar a producción.

## Procedimiento
1. **Alcance**: listar los archivos modificados e identificar qué capas toca (`store.js`, `cloud.js`, `app.js`, `charts.js`, `styles.css`, `index.html`, `firestore.rules`).
2. **Revisión por capa**: aplicar el checklist de `database-design`, `backend-python` (Cloud/Firebase), `frontend-react` (Frontend Web) y `security-review`.
3. **Verificación automática**:
   - Sintaxis JS: `node --check js/firebase-config.js && node --check js/cloud.js && node --check js/store.js && node --check js/charts.js && node --check js/app.js`
   - Tests de integración y seguridad: `node tests/audit.test.js`
   - Privacidad Git: `git status -s` (confirmar que no haya archivos `.xlsx`, fotos ni respaldos personales).
4. **Informe**: entregar el resultado en el formato estándar.

## Formato del informe
```
## Informe de calidad
**Veredicto:** LISTO / LISTO CON AJUSTES / NO LISTO

### Verificaciones
- Sintaxis JS (node --check): OK/FALLA
- Suite de tests (audit.test.js): OK/FALLA (N pasaron, N fallaron)
- Auditoría de seguridad y privacidad Git: OK/FALLA

### Hallazgos y mejoras verificadas
| Prioridad | Capa | Verificación | Archivo | Estado |
```
