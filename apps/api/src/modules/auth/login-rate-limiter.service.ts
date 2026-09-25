import { Injectable } from "@nestjs/common";
import { TooManyLoginAttemptsError } from "./auth.errors";

// Rate-limit simple de POST /auth/login (spec 003 API-8, AC 3.8), en memoria
// y sin dependencias. Cuenta solo intentos FALLIDOS en una ventana deslizante:
// el curador que acierta no gasta cupo, y un login exitoso limpia el contador
// de su cliente.
//
// Dos cubetas, las dos tienen que tener lugar:
// - por cliente (req.ip): frena a un atacante puntual sin bloquear al resto.
// - global: la clave por cliente NO es confiable detrás del rewrite de Next.
//   El proxy de rewrites de Next 16 (router-server -> proxy-request.js) no
//   agrega X-Forwarded-For, así que según el despliegue req.ip es la IP de
//   Next para todos, o un X-Forwarded-For que mandó el propio cliente (y que
//   puede rotar a gusto). El techo global acota la fuerza bruta aunque el
//   atacante rote esa clave; el costo es que un ataque sostenido también le
//   bloquea el login al curador hasta que la ventana se vacíe (aceptable para
//   una herramienta de un solo usuario; no hay sesión que se pierda: las
//   cookies ya emitidas siguen valiendo).
//
// Estado en memoria del proceso: un reinicio lo vacía (igual que el resto de
// la sesión es sin estado, ADR 0001). No sirve con varias réplicas de la API,
// que hoy no existen.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 5;
const MAX_FAILURES_GLOBAL = 20;
// Techo de claves distintas en memoria: si alguien rota la clave de cliente
// a propósito, el Map no crece sin límite.
const MAX_TRACKED_CLIENTS = 10_000;

@Injectable()
export class LoginRateLimiterService {
  private readonly failuresByClient = new Map<string, number[]>();
  private globalFailures: number[] = [];

  // Lanza TooManyLoginAttemptsError si el cliente o el total ya agotaron el
  // cupo de la ventana. Se llama ANTES de verificar la credencial: mientras
  // dure el bloqueo, ni siquiera una contraseña correcta entra (si no, el
  // bloqueo le seguiría confirmando al atacante cuándo acertó).
  assertAllowed(clientKey: string, now: number = Date.now()): void {
    this.globalFailures = this.prune(this.globalFailures, now);
    const clientFailures = this.prune(this.failuresByClient.get(clientKey) ?? [], now);
    this.store(clientKey, clientFailures);

    const blockedUntil = Math.max(
      clientFailures.length >= MAX_FAILURES_PER_CLIENT ? clientFailures[0] + WINDOW_MS : 0,
      this.globalFailures.length >= MAX_FAILURES_GLOBAL ? this.globalFailures[0] + WINDOW_MS : 0
    );
    if (blockedUntil > now) {
      throw new TooManyLoginAttemptsError(Math.ceil((blockedUntil - now) / 1000));
    }
  }

  recordFailure(clientKey: string, now: number = Date.now()): void {
    this.globalFailures = [...this.prune(this.globalFailures, now), now];
    this.store(clientKey, [...this.prune(this.failuresByClient.get(clientKey) ?? [], now), now]);
    this.enforceCapacity(now);
  }

  // Solo limpia la cubeta del cliente: los fallos globales siguen contando
  // hasta salir de la ventana (un acierto no "perdona" un ataque en curso).
  recordSuccess(clientKey: string): void {
    this.failuresByClient.delete(clientKey);
  }

  private prune(timestamps: number[], now: number): number[] {
    const cutoff = now - WINDOW_MS;
    return timestamps.filter((t) => t > cutoff);
  }

  private store(clientKey: string, failures: number[]): void {
    if (failures.length === 0) this.failuresByClient.delete(clientKey);
    else this.failuresByClient.set(clientKey, failures);
  }

  private enforceCapacity(now: number): void {
    if (this.failuresByClient.size <= MAX_TRACKED_CLIENTS) return;

    for (const [key, failures] of this.failuresByClient) this.store(key, this.prune(failures, now));
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
} as const;
