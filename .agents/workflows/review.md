---
description: Auditoría completa de calidad y seguridad antes de entregar o hacer commit
---
1. Revisa los cambios actuales (git diff) e identifica las capas afectadas.
2. Adopta el skill `quality-gate` y ejecútalo completo.
3. Si se tocó autenticación, archivos, pagos o datos personales, ejecuta también `security-review` a fondo.
4. Entrega el informe de calidad en el formato definido y espera mis instrucciones antes de corregir cambios grandes.
