---
name: backend-python
description: Guía y revisa la capa de servicios en la nube (Firebase Auth, Cloud Firestore, reglas de seguridad y sincronización). Úsalo al modificar js/cloud.js, js/firebase-config.js o firestore.rules.
---

# Servicios Cloud y Seguridad en Firebase

## Objetivo
Mantener la capa de autenticación y base de datos en la nube (`js/cloud.js` y `firestore.rules`) segura, resiliente ante cortes de red y con separación clara de responsabilidades.

## Arquitectura
- **Separación de capas**: `js/store.js` gestiona el estado y reglas de negocio; `js/cloud.js` gestiona autenticación (Google OAuth), presencia, permisos y sincronización con Firestore; `js/app.js` gestiona la interfaz.
- **Configuración centralizada**: credenciales y correos propietarios únicamente en `js/firebase-config.js`.

## Reglas de Firestore (`firestore.rules`)
- **Autenticación obligatoria**: exigir siempre `request.auth != null && request.auth.token.email_verified == true`.
- **Autorización por lista blanca**: propietarios fijos (`isOwner()`) e invitados dinámicos en `/household/access` (`isAllowed()`). Solo los propietarios pueden modificar `/household/access`.
- **Validación de esquema**: validar en las reglas del servidor que `/household/main` reciba un objeto `state` tipo `map` con las colecciones esperadas y que `/household/access` tenga una lista `emails` acotada (máx. 25 correos).

## Resiliencia y manejo de errores
- Manejar modo local (`file://`) sin romper la aplicación.
- Detectar desconexiones (`window.addEventListener('offline' / 'online')`), informar en la UI y reintentar la sincronización al reconectar.
- Nunca exponer tokens ni datos sensibles en consola.

## Antes de entregar
- [ ] `node --check js/cloud.js` y `node --check js/firebase-config.js` pasan sin errores
- [ ] `firestore.rules` valida permisos y esquema de datos
- [ ] Manejo de errores de red y estado offline cubiertos
