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
| `OPENROUTER_API_KEY` | No | Habilita OPENROUTER como `ModelProvider` — da acceso a modelos `:free` reales (`ModelProviderFactory` sortea entre `nvidia/nemotron-3-super-120b-a12b:free` y `liquid/lfm-2.5-2.6b:free`, ambos validados a mano contra la API real, ver `decision-log.md` entrada 13) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) — free tier real, **sin tarjeta** |
| `GOOGLE_TTS_API_KEY` | No | Reservada para el proveedor Google de `TtsModule` (todavía no implementado, sección 5 de `tasks.md` — el proveedor Local sí lo está) | **No hace falta gestionar nada todavía**: el paquete `google-tts-api` es un wrapper no oficial sobre Google Translate TTS y no pide API key. Esta variable queda para si en el futuro se migra a `@google-cloud/text-to-speech` o ElevenLabs (sí piden key) |
| `TTS_PROVIDER` | No (default `LOCAL`) | Motor de TTS activo para todo el proceso — `LOCAL`\|`GOOGLE_TTS`\|`OPENROUTER` (`decision-log.md` entradas 19-20). Solo `LOCAL` está implementado hoy | — |
| `AUDIO_STORAGE_DIR` | No (default `./outputs/audios`) | Carpeta donde `LocalDiskStorageProvider` escribe el audio generado (AC 6.1). Gitignoreada — binarios regenerables, nunca se versionan | — |
| `PORT` | No (default `3000`) | Puerto HTTP del server Nest | — |
| `NODE_ENV` | No (default `development`) | `development`\|`test`\|`production`. En `production`: cookie de sesión `Secure`, Swagger (`/docs`) sin montar (spec 003, D20) y `AUDIO_SIGNING_SECRET` obligatorio distinto del default | — |
| `AUDIO_SIGNING_SECRET` | No en local (default de desarrollo); **sí en producción** | Firma HMAC de las URLs temporales de `/audio-files` (AC 6.1), su única protección (queda fuera del login, ADR 0001 punto 5). Con `NODE_ENV=production` el proceso no arranca si conserva el default | Cualquier string aleatorio largo (mismo comando que `SESSION_SECRET`) |
| `CURATOR_USERNAME` | **Sí** | Usuario del único curador (login del dashboard, ADR 0001) | Lo elegís vos |
| `CURATOR_PASSWORD_HASH` | **Sí** | Hash scrypt de la contraseña del curador. **Nunca** la contraseña en texto plano | `pnpm --filter api auth:hash-password` (ver §3.2) |
| `SESSION_SECRET` | **Sí** (mínimo 32 caracteres) | Secreto HMAC del token de sesión. Cambiarlo cierra todas las sesiones abiertas | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Las que importan para arrancar ya mismo**: `GOOGLE_API_KEY`, `TAVILY_API_KEY` y las tres de auth (`CURATOR_USERNAME`, `CURATOR_PASSWORD_HASH`, `SESSION_SECRET`, ver §3.2). Sin estas últimas el proceso no arranca, y tampoco `pnpm openapi:generate` ni los smoke scripts (todos bootstrapean `AppModule`, que valida el entorno completo). Las de OPENAI/ANTHROPIC/XAI/OPENROUTER se pueden dejar vacías — el proceso arranca igual, y `ModelProviderFactory` recién tira error si algo intenta resolver ese provider puntual sin key. Sumar `OPENROUTER_API_KEY` (gratis, sin tarjeta) es la forma más simple de que el Judge tenga un provider realmente distinto al de los debatientes (arquitectura §7.1) sin depender de una suscripción paga a OpenAI/Anthropic/XAI.

Los tests (`npm run test`, `npm run test:e2e`) **no necesitan ninguna key real ni la credencial del curador** — usan valores dummy (`test/jest-e2e.setup.ts` para el e2e, con su propia DB de test aislada de `dev.db`; los `*.spec.ts` mockean el LLM/proveedor de búsqueda directo, nunca llaman a nada real).

### 3.1 Límites de rate limiting (`LlmRateLimiterService`)

Opcionales, con default al valor real del free tier vigente hoy (ver `decision-log.md` entradas 8 y 13 — estos valores ya cambiaron una vez para Google y pueden volver a cambiar):

| Variable | Default | Provider |
|---|---|---|
| `GOOGLE_RPM_LIMIT` / `GOOGLE_RPD_LIMIT` | `15` / `500` | GOOGLE |
| `OPENROUTER_RPM_LIMIT` / `OPENROUTER_RPD_LIMIT` | `20` / `50` | OPENROUTER (`50` es el caso conservador — sube a `1000`/día si la cuenta compró $10+ de créditos alguna vez) |

OPENAI/ANTHROPIC/XAI no tienen límite proactivo configurado (`null` en `LlmRateLimiterService` — no hay uso real hoy, se agregan cuando haga falta).

### 3.2 Credencial del curador (auth, API-8)

Toda la API salvo `POST /auth/login`, `POST /auth/logout` y `GET /` exige la cookie de sesión (ADR 0001, `api-contract.md` §1.1). Para completar el `.env`:

```bash
# 1. Hash de la contraseña (la pide dos veces, sin eco; imprime la línea lista para el .env)
pnpm --filter api auth:hash-password

# En terminales donde stdin no es una TTY (Git Bash/mintty sin winpty, o un pipe),
# el script lee la primera línea de stdin. Ojo: así la contraseña queda en el historial del shell.
echo "mi-contraseña" | pnpm --filter api auth:hash-password

# 2. Secreto de sesión
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El formato del hash es `scrypt:<N>:<r>:<p>:<sal base64url>:<hash base64url>` (`src/shared/crypto/scrypt-password.ts`): lleva sal y parámetros, así que no hace falta configurar nada más. Usa `:` y no `$` como separador para no chocar con la expansión de variables de shells y de `docker-compose`. Si el valor no respeta el formato, el proceso no arranca.

Probar el login con curl (la API escucha en el puerto 3000):

```bash
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"<usuario>","password":"<contraseña>"}' http://localhost:3000/auth/login
curl -b cookies.txt http://localhost:3000/episodes
```

Los tests no usan tu credencial: el e2e fija una propia (`test/e2e-auth.fixture.ts`), que tiene prioridad sobre `.env`.

## 4. Correr el proyecto

```bash
npm run start:dev   # dev con watch
npm run test        # unit
npm run test:e2e    # e2e (bootstrapea AppModule completo)
npx tsc --noEmit    # type-check sin emitir
```

## 5. Scripts de validación manual (no automatizados, gastan créditos reales)

No son `*.spec.ts` — corren contra APIs/motores reales a propósito, para probar cosas que un mock no puede (ver `decision-log.md` entradas 6, 11, 12, 13, 21-22 para ejemplos de bugs/hallazgos reales que solo aparecieron corriendo estos scripts):

```bash
npm run smoke:argument   # research -> primer argumento OPENING (sin FactCheckModule ni EpisodesModule)
npm run smoke:episode    # pipeline completo de un Episode (research -> debate -> judging), rondas recortadas
npm run smoke:tts        # ídem + approve -> síntesis de audio real (TTS_PROVIDER=LOCAL por default, sin costo — descarga modelos de voz Piper la primera vez)
npx ts-node scripts/validate-openrouter-models.ts   # valida structured output contra modelos :free de OpenRouter
```

**Nota sobre `OPENROUTER_API_KEY` y smoke tests reales**: el free tier de OpenRouter tiene cupo diario — si un smoke test falla con un error de rate limit de OpenRouter, no es un bug: correr esa invocación puntual con `OPENROUTER_API_KEY=` vacío (sin tocar `.env`) alcanza para que la selección de participantes no lo sortee como candidato (`decision-log.md` entrada 22).
