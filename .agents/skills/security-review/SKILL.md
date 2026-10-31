---
name: security-review
description: Audita la seguridad de la aplicación de presupuesto según OWASP Top 10: autenticación Google/Firebase, reglas de Firestore, prevención de XSS, CSP, validación de respaldos JSON y protección de datos financieros sensibles.
---

# Revisión de Seguridad

## Objetivo
Encontrar y corregir vulnerabilidades antes de pasar a producción. Reportar hallazgos con severidad (Crítica / Alta / Media / Baja), ubicación exacta (`archivo:línea`) y arreglo aplicado.

## Checklist de auditoría

### Autenticación y Autorización
- Inicio de sesión con Google mediante Firebase Auth (`email_verified == true`).
- Verificación de permisos en el servidor mediante `firestore.rules` (nunca confiar solo en ocultar botones en el cliente).
- Revocación en vivo si un invitado es eliminado de `/household/access`.

### Prevención de XSS e Inyección
- Todo dato de usuario o respaldo (`name`, `desc`, `note`, `icon`, `bank`, `email`) escapado con `esc()`.
- Todo color (`color`, `accent`) validado con `safeColor()` antes de inyectarse en `style="..."`.
- Meta-cabecera `Content-Security-Policy` activa en `index.html`.

### Validación de Entrada y Archivos
- Respaldo `.json`: validar tamaño máximo (≤ 5 MB), tipo de archivo y normalizar todos los campos y números antes de aplicarlos.
- Reglas de Firestore: validar que `state` sea un `map` con las claves permitidas y acotar el tamaño de listas críticas.

### Secretos y Datos Sensibles
- `.gitignore` bloquea hojas de cálculo (`*.xlsx`, `*.csv`), respaldos con datos reales (`presupuesto-respaldo-*.json`) y capturas bancarias (`Prestamos/`).
- Ningún saldo personal real hardcodeado en el código fuente público.

## Formato del reporte
| Severidad | Hallazgo | Ubicación | Estado / Arreglo |
|---|---|---|---|

Terminar con veredicto: **APTO / APTO CON CORRECCIONES / NO APTO**.
