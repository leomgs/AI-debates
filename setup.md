# Setup — AI Trend Debates

Qué necesitás tener resuelto para correr este backend en local. Complementa a `README.md` (todavía boilerplate default de NestJS, ver `tasks.md` sección 9) — este es el checklist real del proyecto.

## 1. Requisitos del sistema

- **Node.js 22.12+**. No es un capricho de versión: `@nestjs/config@12` se publica solo como ESM (sin build CJS), y Node lo resuelve en runtime real vía `require(esm)`, soportado recién desde esa versión (ver `tasks.md` sección 0). Con una versión menor el proceso no arranca.
- npm (viene con Node).

## 2. Instalación

```bash
npm install
npx prisma generate       # genera Prisma Client — no se versiona
npx prisma migrate deploy # aplica las migraciones a dev.db
npm run db:seed           # carga los 4 Agent debatientes + Judge (idempotente)
```

## 3. Variables de entorno (API keys)

Copiá `.env.example` a `.env` y completá lo de abajo. La validación vive en `src/shared/config/env.schema.ts`: si falta una **requerida**, el proceso no arranca (falla rápido a propósito, coding-rules.md §8) — no se descubre a mitad de un episodio con un error críptico del proveedor.

| Variable | ¿Requerida? | Para qué | Dónde conseguirla |
|---|---|---|---|
| `DATABASE_URL` | Sí | Conexión SQLite local | No hace falta nada externo — `file:./dev.db` ya viene seteado |
| `GOOGLE_API_KEY` | **Sí** | LLM para debatientes/Judge (`ModelProviderFactory`) y para la extracción de `EvidenceFact` en `ResearchModule` (hardcodeado a GOOGLE por ahora, ver `tasks.md` sección 1). Única key de LLM con acceso gratuito hoy | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier con rate limits generosos para desarrollo |
| `TAVILY_API_KEY` | **Sí** | Búsqueda web de `ResearchModule` (Feature 1) | [app.tavily.com](https://app.tavily.com) — free tier: 1000 créditos/mes, **sin tarjeta**. Con `search_depth: "basic"` (1 crédito/research) y el techo de 5 research por episodio (`max_search_queries_per_episode`), alcanza sobrado para uso de un solo usuario en local |
| `OPENAI_API_KEY` | No | Habilita OPENAI como `ModelProvider` para debatientes/Judge | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — de pago, sin free tier real |
| `ANTHROPIC_API_KEY` | No | Habilita ANTHROPIC como `ModelProvider` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) — de pago |
| `XAI_API_KEY` | No | Habilita XAI (Grok) como `ModelProvider` | [console.x.ai](https://console.x.ai) — de pago |
| `GOOGLE_TTS_API_KEY` | No | Pensada para `TtsModule` (todavía no existe, sección 5 de `tasks.md`) | **No hace falta gestionar nada todavía**: el paquete instalado (`google-tts-api` en `package.json`) es un wrapper no oficial sobre Google Translate TTS y no pide API key. Esta variable queda para si en el futuro se migra a `@google-cloud/text-to-speech` o ElevenLabs (sí piden key) |
| `PORT` | No (default `3000`) | Puerto HTTP del server Nest | — |

**Las que importan para arrancar ya mismo**: `GOOGLE_API_KEY` y `TAVILY_API_KEY`. Las de OPENAI/ANTHROPIC/XAI se pueden dejar vacías — el proceso arranca igual, y `ModelProviderFactory` recién tira error si algo intenta resolver ese provider puntual sin key.

Los tests (`npm run test`, `npm run test:e2e`) **no necesitan ninguna key real** — usan valores dummy (`test/jest-e2e.setup.ts` para el e2e; los `*.spec.ts` mockean el LLM/proveedor de búsqueda directo, nunca llaman a nada real).

## 4. Correr el proyecto

```bash
npm run start:dev   # dev con watch
npm run test        # unit
npm run test:e2e    # e2e (bootstrapea AppModule completo)
npx tsc --noEmit    # type-check sin emitir
```
