---
name: database-design
description: Diseña y revisa el modelo de datos en Firestore y localStorage, reglas de seguridad, sincronización en tiempo real, migraciones de estado y precisión monetaria. Úsalo al crear o modificar colecciones, estructuras de estado o cálculos financieros.
---

# Diseño de datos (Firestore + Estado local)

## Objetivo
Esquemas consistentes, precisión financiera exacta, sincronización sin pérdida de datos entre dispositivos y reglas de seguridad estrictas en Firestore.

## Modelado y precisión financiera
- **Dinero exacto**: toda cantidad monetaria debe normalizarse con `money(n) = Math.round((Number(n) || 0) * 100) / 100` antes de guardarse o sumarse. Nunca guardar `NaN`, `Infinity` ni flotantes con residuos (`0.30000000000000004`).
- **Identificadores y trazabilidad**: todo registro en listas (`expenses`, `debts`, `loans`, `incomes`, `items`, `categories`, `methods`, `debtors`) debe tener un `id` único, y el estado debe llevar `version` y `updatedAt`.
- **Borrado sincronizado**: cuando se elimina un elemento en un dispositivo, debe registrarse su `id` en un historial compacto de eliminados (`deletedIds`) para que al hacer merge con otro dispositivo no reviva registros borrados.

## Sincronización y concurrencia (Nehemías y Susan)
- **Merge por colección e ID**: al recibir datos de Firestore (`onSnapshot`), combinar listas por `id` respetando `deletedIds` y `updatedAt` de cada registro en vez de pisar ciegamente toda la base si ambos editan al mismo tiempo.
- **Reintentos offline**: detectar caídas de red (`offline`/`online`) y reintentar el envío pendiente automáticamente al recuperar conexión.

## Migraciones y respaldos
- `Store.normalize()` debe garantizar compatibilidad hacia atrás con cualquier respaldo JSON anterior, rellenando campos nuevos con valores por defecto seguros.
- Validar estructura y tamaño máximo (≤ 5 MB) al importar archivos `.json`.

## Antes de entregar
- [ ] Operaciones monetarias pasan por `money()`
- [ ] `Store.normalize()` migra estados antiguos sin perder datos
- [ ] `firestore.rules` valida estructura y permisos por correo verificado
- [ ] Merge de concurrencia probado en tests automáticos
