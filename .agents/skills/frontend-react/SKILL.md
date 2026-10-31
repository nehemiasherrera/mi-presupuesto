---
name: frontend-react
description: Guía y revisa el código frontend de la aplicación (HTML5, CSS moderno, Vanilla JavaScript): componentes, estado, formularios, sanitización XSS, accesibilidad WCAG, rendimiento y testing. Úsalo al crear o modificar pantallas, modales, gráficos o estilos.
---

# Frontend Web (HTML + CSS + JavaScript)

## Objetivo
Interfaces rápidas, modernas, accesibles y seguras, sin dependencias innecesarias.

## Estructura y seguridad en el cliente
- **Sanitización obligatoria**: todo texto dinámico insertado en HTML debe pasar por `esc()`. Todo color dinámico insertado en `style` o atributos debe pasar por `safeColor()` (formato `#rrggbb`).
- **Cabeceras de seguridad**: mantener `Content-Security-Policy` (CSP) en `index.html` restringiendo orígenes de scripts, estilos y conexiones.

## Formularios y validación
- Validar entradas numéricas (montos mayores o iguales a 0, límites lógicos) tanto en los atributos HTML (`min`, `max`, `step`, `required`) como en el guardado de `Store`.
- Soportar acción rápida **Deshacer (`withUndo`)** ante cualquier borrado.

## Estados de UI obligatorios
- Cubrir siempre estados: **vacío (`empty()`), conectado/sincronizado, guardando, sin conexión (offline) y error**.

## Accesibilidad (WCAG AA)
- HTML semántico (`button`, `nav`, `main`, `header`, `label`).
- Elementos interactivos que no sean `<button>` deben tener `role="button"`, `tabindex="0"` y responder a las teclas `Enter` y `Espacio`.
- Todo input (incluidos los de barra rápida y filtros) debe tener `<label>` o `aria-label`.

## Rendimiento
- Paginar listados largos de gastos (mostrar bloques de 50 con botón **"Ver más"**) para mantener fluidez en móviles.
- Gráficos SVG limpios y ligeros en `js/charts.js`.

## Antes de entregar
- [ ] `node --check js/app.js` y `node --check js/charts.js` pasan
- [ ] Suite de pruebas automáticas (`node tests/audit.test.js`) pasa al 100%
- [ ] Revisión de accesibilidad por teclado y sanitización XSS
