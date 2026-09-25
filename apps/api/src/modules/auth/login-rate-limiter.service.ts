import { Injectable } from "@nestjs/common";
import { LoginBusyError, TooManyLoginAttemptsError } from "./auth.errors";

// Rate-limit simple de POST /auth/login (spec 003 API-8, AC 3.8), en memoria
// y sin dependencias.
//
// Cada intento se registra como fallo PROVISORIO en el mismo tick síncrono en
// que se chequea el límite (beginAttempt), antes del `await` de scrypt. Si
// el chequeo y el registro quedaran separados por ese await, N logins
// concurrentes pasarían todos el chequeo antes de que el primero registre
// su fallo (la revisión de API-8 lo reprodujo: 200 logins concurrentes
// incorrectos dieron 199 401 y ningún 429). Si el login acierta,
// recordSuccess deshace ese registro; si falla, el registro ya es el fallo.
//
// Tres límites, todos tienen que tener lugar:
// - por cliente (req.ip): 5 intentos fallidos o en curso por ventana.
// - global: 20 por ventana. La clave por cliente NO es confiable detrás del
//   rewrite de Next (no agrega X-Forwarded-For; ver setup.md, "Despliegue"),
//   así que el techo global acota la fuerza bruta aunque se rote la clave. El
//   costo: un ataque sostenido también le bloquea el login al curador hasta
//   que la ventana se vacíe (las cookies ya emitidas siguen valiendo).
// - verificaciones scrypt en curso: 2. scrypt corre en el threadpool de
//   libuv (4 hilos por defecto, compartido con fs, dns y zlib); sin tope,
//   una ráfaga de logins lo satura y frena al resto del proceso. Al
//   superarlo: LoginBusyError (429 LOGIN_BUSY), sin contar como fallo.
//
// Estado en memoria del proceso: un reinicio lo vacía (igual que el resto de
// la sesión es sin estado, ADR 0001). No sirve con varias réplicas de la API,
// que hoy no existen.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 5;
const MAX_FAILURES_GLOBAL = 20;
const MAX_CONCURRENT_VERIFICATIONS = 2;
// Retry-After cuando lo que falta es un lugar en las verificaciones en curso:
// se libera en decenas de ms, no hace falta esperar a la ventana.
const CONCURRENCY_RETRY_AFTER_SECONDS = 1;
// Techo de claves distintas en memoria: si alguien rota la clave de cliente
// a propósito, el Map no crece sin límite.
const MAX_TRACKED_CLIENTS = 10_000;

// Intento en curso: lo devuelve beginAttempt y lo consume recordSuccess (el
// lugar de verificación se libera con release()). `at` identifica el registro
// provisorio a deshacer si el login acierta.
export interface LoginAttempt {
  readonly clientKey: string;
  readonly at: number;
}

// Las cubetas nunca superan su máximo (solo se registra un intento cuando hay
// lugar), así que purgar desde el frente y buscar un timestamp son O(máximo),
// sin copiar el array en cada intento.
function pruneInPlace(timestamps: number[], now: number): void {
  const cutoff = now - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
}

function removeOne(timestamps: number[], at: number): void {
  const index = timestamps.lastIndexOf(at);
  if (index !== -1) timestamps.splice(index, 1);
}

@Injectable()
export class LoginRateLimiterService {
  private readonly failuresByClient = new Map<string, number[]>();
  private readonly globalFailures: number[] = [];
  private inFlight = 0;

  // Síncrono a propósito (ver arriba). Lanza TooManyLoginAttemptsError si no
  // hay lugar; si lo hay, registra el intento como fallo provisorio en las
  // dos cubetas y ocupa un lugar de verificación que hay que liberar con
  // release(). Mientras dure un bloqueo ni siquiera una contraseña correcta
  // entra (si no, el bloqueo le avisaría al atacante cuándo acertó).
  beginAttempt(clientKey: string, now: number = Date.now()): LoginAttempt {
    pruneInPlace(this.globalFailures, now);
    const clientFailures = this.failuresByClient.get(clientKey) ?? [];
    pruneInPlace(clientFailures, now);

    const blockedUntil = Math.max(
      clientFailures.length >= MAX_FAILURES_PER_CLIENT ? clientFailures[0] + WINDOW_MS : 0,
      this.globalFailures.length >= MAX_FAILURES_GLOBAL ? this.globalFailures[0] + WINDOW_MS : 0
    );
    if (blockedUntil > now) {
      this.store(clientKey, clientFailures);
      throw new TooManyLoginAttemptsError(Math.ceil((blockedUntil - now) / 1000));
    }
    if (this.inFlight >= MAX_CONCURRENT_VERIFICATIONS) {
      this.store(clientKey, clientFailures);
      throw new LoginBusyError(CONCURRENCY_RETRY_AFTER_SECONDS);
    }

    clientFailures.push(now);
    this.globalFailures.push(now);
    this.store(clientKey, clientFailures);
    this.enforceCapacity(now);
    this.inFlight++;
    return { clientKey, at: now };
  }

  // Login correcto: borra la cubeta del cliente (sus fallos previos quedan
  // perdonados) y saca de la global solo el registro provisorio de este
  // intento; los fallos globales de otros siguen contando.
  recordSuccess(attempt: LoginAttempt): void {
    this.failuresByClient.delete(attempt.clientKey);
    removeOne(this.globalFailures, attempt.at);
  }

  // Libera el lugar de verificación. Se llama siempre (finally), acierte,
  // falle o lance.
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  private store(clientKey: string, failures: number[]): void {
    if (failures.length === 0) this.failuresByClient.delete(clientKey);
    else this.failuresByClient.set(clientKey, failures);
  }

  private enforceCapacity(now: number): void {
    if (this.failuresByClient.size <= MAX_TRACKED_CLIENTS) return;

    for (const [key, failures] of this.failuresByClient) {
      pruneInPlace(failures, now);
      this.store(key, failures);
    }
    // Si sigue excedido, se descartan las claves más viejas (orden de
    // inserción del Map). El techo global sigue protegiendo igual.
    for (const key of this.failuresByClient.keys()) {
      if (this.failuresByClient.size <= MAX_TRACKED_CLIENTS) break;
      this.failuresByClient.delete(key);
    }
  }
}

export const LOGIN_RATE_LIMIT = {
  windowMs: WINDOW_MS,
  maxFailuresPerClient: MAX_FAILURES_PER_CLIENT,
  maxFailuresGlobal: MAX_FAILURES_GLOBAL,
  maxConcurrentVerifications: MAX_CONCURRENT_VERIFICATIONS,
} as const;
