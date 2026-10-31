# Principios del proyecto (siempre activos)

## Stack
- Backend: Python (FastAPI o Django; ver el skill `backend-python`)
- Frontend: React + TypeScript
- Base de datos: PostgreSQL (salvo que el proyecto indique otra)

## Cómo trabajar
- Responde siempre en español. Código, nombres y commits en inglés.
- Antes de escribir código en una tarea no trivial: resume tu plan en 3-6 líneas y espera confirmación si hay decisiones de arquitectura.
- Cambios pequeños y verificables. No mezcles refactors con features.
- Nunca inventes librerías, endpoints ni columnas: revisa el código existente primero.
- Si algo es ambiguo, pregunta (máximo 3 preguntas) en vez de asumir.

## Reglas no negociables
- Nunca hardcodear secretos, tokens, contraseñas ni URLs de producción. Usar variables de entorno y `.env.example`.
- Nunca desactivar validaciones, CORS, auth o checks de TLS "para que funcione".
- Todo input externo se valida (Pydantic / serializers en backend, Zod o equivalente en frontend).
- Todo cambio de esquema pasa por migración versionada.
- Sin `print`/`console.log` de datos sensibles.

## Definición de terminado
Una tarea NO está terminada hasta que:
1. Hay tests para el comportamiento nuevo o corregido.
2. Linter, formateo y type-check pasan.
3. No hay secretos ni TODOs críticos en el diff.
4. Se actualizó README/docs si cambió algo que otro desarrollador debe saber.
5. Se ejecutó el skill `quality-gate` y se reportó el resultado.

