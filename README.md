# Chismosito

Grabadora de reuniones para Windows 11 con transcripción **local** (whisper.cpp) y resumen automático con un LLM (OpenCode Zen compatible con OpenAI).

Captura el micrófono y el audio del sistema al mismo tiempo, separa quién habla (`Yo` / `Otros`), transcribe sin subir el audio a la nube y guarda una nota Markdown junto al archivo de audio.

---

## Requisitos

- Windows 11 x64.
- Node.js 22.12 o superior (probado con Node 24).
- npm o pnpm.
- Micrófono y un dispositivo de salida de audio activos.
- Una API key de OpenCode para el resumen (opcional: sin ella se guarda la transcripción).

No se necesita CMake, Visual Studio ni ffmpeg: los binarios de whisper.cpp para Windows ya están incluidos.

---

## Instalación (desarrollo)

Con npm:

```powershell
npm install
npm run dev
```

Con pnpm:

```powershell
pnpm install
pnpm dev
```

La primera instalación descarga el binario de Electron. Si el binario falta (por ejemplo, tras un `pnpm install` con scripts bloqueados), `pnpm dev` lo descarga automáticamente antes de arrancar.

Para generar el instalador:

```powershell
npm run build:win
# o
pnpm build:win
```

El instalador queda en `dist/`. No está firmado, así que Windows SmartScreen puede pedir confirmación.

---

## Configuración

### LLM

Copia `.env.example` a `.env` y completa:

```dotenv
OPENCODE_API_KEY=tu_api_key
LLM_BASE_URL=https://opencode.ai/inference
LLM_MODEL=deepseek-v4.1-flash
```

`https://opencode.ai/inference` es la raíz del gateway de OpenCode. La app la normaliza automáticamente a `https://opencode.ai/inference/openai/v1`, que es la ruta compatible con el SDK de OpenAI. También puedes escribir la ruta completa; se respeta tal cual.

Modelos sugeridos:

- `deepseek-v4.1-flash` — económico, buen equilibrio.
- `claude-haiku-5.5` — rápido.
- `claude-sonnet-5` — mejor calidad.

Si la API responde que el modelo no está disponible o que el acceso está desactivado, actívalo en **OpenCode Console → Models** y revisa los créditos del workspace. También puedes probar la conexión desde **Ajustes → Resumen con LLM → Probar conexión**.

El modelo se puede sobrescribir desde Ajustes sin editar el `.env`.

### Jev (sugerencia de carpetas)

Jev es el modelo System One de TypeSafe, disponible a través de OpenCode Console. No genera texto: recibe el resumen de la reunión y las carpetas existentes, y devuelve la carpeta que mejor encaja con una probabilidad.

```dotenv
JEV_MODEL=jev-1.13-free
JEV_BASE_URL=https://opencode.ai/inference/systemone/v1/systemone
```

- Usa la misma `OPENCODE_API_KEY`.
- `jev-1.13-free` es gratis por tiempo limitado; `jev-1.13` es de pago y muy económico.
- El modelo se puede cambiar desde **Ajustes → Resumen con LLM → Modelo de Jev**.
- **Probar Jev** valida la conexión sin procesar una nota.
- Si no hay carpetas, Jev no tiene nada que proponer. Créalas en **Ajustes → Carpetas**.

### Google Drive (opcional)

La app usa OAuth 2.0 con el permiso mínimo `drive.file` y crea su propia carpeta en Drive; no necesita una carpeta existente.

1. Entra a [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Crea un proyecto y habilita **Google Drive API**.
3. Configura la pantalla de consentimiento (tipo External). Si la app queda en modo *Testing*, agrega tu cuenta como test user.
4. Crea un cliente OAuth de tipo **Desktop app**.
5. Copia las credenciales al `.env`:

```dotenv
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_FOLDER_NAME=Chismosito
GOOGLE_DRIVE_AUTO_BACKUP=true
```

6. Abre **Ajustes → Google Drive → Conectar Google Drive**. Se abrirá el navegador y el token se guardará cifrado con DPAPI (`safeStorage`).

**Importante:** los proyectos OAuth en modo *Testing* emiten refresh tokens que caducan a los 7 días. Para uso diario, publica la app como *En producción* (aunque quede sin verificar). También puedes poner un `GOOGLE_REFRESH_TOKEN` ya emitido en el `.env`; en ese caso la app no abre el navegador.

El respaldo es unidireccional (local → Drive) y espeja la estructura de `MeetingNotes/` dentro de `Chismosito/`. El audio solo se sube si el respaldo está activo.

### Rutas y preferencias

```dotenv
MEETING_NOTES_DIR=C:\Users\tu_usuario\Documents\MeetingNotes
USER_NAME=TuNombre
WHISPER_DEVICE=auto      # auto | cpu | cuda
WHISPER_LANGUAGE=es      # es | auto | en | pt | fr | de | it | ja | zh
WHISPER_MODEL_PATH=      # opcional: ruta a un ggml-medium personalizado
```

- En desarrollo, el `.env` vive en la raíz del proyecto.
- En la app instalada, el `.env` vive en `%APPDATA%\chismosito\.env`. Puedes abrirlo desde Ajustes.
- Los cambios en `.env` se aplican al reiniciar Chismosito.
- `USER_NAME` se usa para asignarte acciones en el resumen.

---

## Primer uso

1. **Modelo de transcripción:** descarga el modelo `medium` cuantizado (q5_0, 539 MB) desde la tarjeta «Prepara Chismosito» o desde Ajustes. Se guarda en `%APPDATA%\chismosito\models`.
2. **Micrófono:** autoriza el acceso. Si Windows lo bloquea, abre Configuración › Privacidad y seguridad › Micrófono.
3. **Audio del sistema:** Windows 11 lo captura mediante loopback de Chromium; no necesitas instalar controladores. En algunas configuraciones Windows muestra un indicador de captura de pantalla.
4. **GPU opcional:** si tienes NVIDIA, descarga el pack CUDA desde Ajustes (~650 MB; ~1.4 GB en disco). En una RTX 4060, la transcripción es aproximadamente 5 veces más rápida que en CPU. Si el pack falla, la app usa CPU automáticamente.

---

## Uso

- **Grabar:** elige micrófono y/o audio del sistema y pulsa el botón. También puedes usar el atajo global (`Ctrl+Shift+R` por defecto) o el menú de la bandeja.
- **Detener:** al detener se guarda el WebM/Opus y comienza el procesamiento en segundo plano. Puedes seguir usando la app o cerrarla a la bandeja.
- **Procesamiento:** primero transcribe tu pista (`Yo`) y la del sistema (`Otros`) con whisper.cpp; luego fusiona los segmentos con timestamps y llama al LLM para el resumen, las decisiones y las acciones.
- **Nota:** se escribe en `MeetingNotes/YYYY-MM-DD-HH-MM.md`, con el audio `YYYY-MM-DD-HH-MM.webm` al lado.
- **Historial:** la biblioteca permite buscar por título, resumen, carpeta, etiqueta o **transcripción**, agrupa por fecha y muestra el estado de cada nota.
- **Carpetas y etiquetas:** «Editar» permite cambiar título, etiquetas y carpeta. Al mover una nota se mueve también su audio. Las notas sin carpeta quedan en la raíz de `MeetingNotes/`.
- **Gestionar carpetas:** en **Ajustes → Carpetas** puedes crear carpetas (incluidas subcarpetas con `/`), renombrarlas y eliminarlas. Al eliminar una carpeta, todas sus notas y audios se mueven a **Sin clasificar**. Las acciones de renombrar/eliminar se bloquean mientras hay una grabación o un procesamiento activo.
- **Sugerencia de carpeta:** al terminar de procesar una nota nueva sin carpeta, Jev propone una carpeta existente según el título, el resumen, las decisiones y las acciones. La sugerencia aparece como banner en la nota y como chip en Biblioteca/Home; puedes **Mover**, **Elegir otra** o **Descartar**. Nunca se mueve automáticamente.
- **Audio:** cada nota incluye un reproductor; al hacer clic en un timestamp de la transcripción salta a ese momento.
- **Preguntar por reunión:** la pestaña **Preguntar** de cada nota abre un chat sobre esa grabación. Las respuestas citan momentos `[HH:MM:SS]` y puedes hacer clic en la cita para saltar al audio.
- **Chat global:** la entrada **Preguntar** de la barra lateral busca en todas tus reuniones. Sirve para preguntas transversales como «¿qué tareas me asignaron esta semana?». Las respuestas muestran las reuniones consultadas.
- **Filtros del chat global:** limita por fecha (hoy, esta semana, este mes o un rango) y por carpeta. Los filtros se guardan con la conversación y se aplican antes de buscar.
- **Respaldo:** si Drive está conectado, puedes respaldar una nota desde su vista o todo desde Ajustes. El respaldo automático se activa al terminar el procesamiento. Los chats se respaldan en `Conversaciones/` si activas **Respaldar conversaciones**.
- **Regenerar resumen:** si el LLM falló, aparece un botón para reintentar sin volver a transcribir.
- **Bandeja:** cerrar la ventana la oculta; la grabación y el procesamiento continúan. «Salir» desde la bandeja pide confirmación si hay trabajo en curso.

### Formato de la nota

```markdown
---
title: "Planificación Q4"
date: "2026-11-14T15:30:00-06:00"
duration_seconds: 3720
language: "es"
audio: "2026-11-14-15-30.webm"
folder: "Producto"
suggested_folder: "Producto/Q4"
suggested_folder_confidence: 0.91
tags: ["q4", "planning"]
source: "chismosito"
llm: "deepseek-v4.1-flash"
status: "complete"
---

# Planificación Q4 — 14 de noviembre de 2026, 15:30

## Resumen

- … 5 viñetas …

## Decisiones

- **…** — contexto

## Acciones

| Acción | Responsable | Fecha límite |
| --- | --- | --- |
| … | Carlos | 2026-11-20 |

---

## Transcripción

[00:00:12] **Yo:** …
[00:00:31] **Otros:** …
```

`status` puede ser `processing`, `complete`, `summary_failed`, `transcription_failed` o `cancelled`.

---

## Datos y privacidad

- La transcripción ocurre **en tu equipo** con whisper.cpp. El audio no se envía a ningún lado durante la transcripción.
- Solo la transcripción se envía al proveedor del LLM para generar el resumen.
- El chat envía al proveedor únicamente la transcripción o los fragmentos relevantes de las notas que consultes, más el historial reciente de esa conversación.
- Jev recibe el título, el resumen, las decisiones, las acciones, los temas y los nombres/ejemplos de tus carpetas. No recibe el audio ni la transcripción completa.
- El historial de chats vive en `%APPDATA%\chismosito\chats\` (un JSON por conversación). No se escribe dentro de las notas.
- El audio, la nota y, si lo activas, los chats se suben a Google Drive.
- Las API keys viven en el `.env` y nunca se envían al renderer. El refresh token de Google se guarda cifrado con DPAPI.
- Logs locales: `%APPDATA%\chismosito\logs\app.log`.

---

## Estructura del proyecto

```
src/
  main/        proceso principal: audio, whisper, LLM, Jev, notas, chat, Drive, tray
  preload/     puente IPC tipado
  renderer/    React + Tailwind
  shared/      tipos y constantes compartidas
resources/
  whisper/     whisper-cli.exe + DLLs (CPU)
  tray/        iconos de bandeja
  icon.png
tests/         pruebas unitarias (Vitest)
```

---

## Pruebas

```powershell
npm test
npm run typecheck
```

Las pruebas cubren la normalización de la URL del LLM, la fusión/deduplicación de hablantes, el formato de las notas, la escritura de WAV, el parseo de resumen/acciones, la recuperación y filtros del chat, el almacén de conversaciones, la clasificación de carpetas con Jev y la gestión de carpetas.

---

## Limitaciones conocidas

- Solo Windows 11 x64. El loopback de audio del sistema de Electron no está disponible en macOS/Linux con esta implementación.
- No hay transcripción en vivo; se procesa al detener.
- Los hablantes se separan en `Yo` (micrófono) y `Otros` (sistema); no hay diarización entre varios participantes remotos.
- El loopback captura todo el audio de salida, no solo la reunión.
- No hay firma de código ni actualizaciones automáticas en esta versión.
- El respaldo de chats en Drive es unidireccional: no se restauran automáticamente.
- El chat usa búsqueda por palabras clave y un planificador del LLM; no hay embeddings ni índice vectorial.
- Jev solo puede sugerir carpetas que ya existan y nunca mueve la nota automáticamente. Si no hay carpetas, no hay sugerencia.
- Renombrar una carpeta solo cambia el último segmento; no la mueve a otro padre. Eliminar una carpeta mueve sus notas a Sin clasificar, nunca las borra.
- Con bocinas, el micrófono puede captar el audio del sistema. La app intenta eliminar la copia duplicada, pero se recomienda usar audífonos.
- Si cambias el dispositivo de salida a mitad de una reunión, puede ser necesario reiniciar la captura.

---

## Licencia

MIT. whisper.cpp se distribuye bajo licencia MIT; el modelo de Whisper también es MIT. Consulta los avisos en `resources/whisper/`.
