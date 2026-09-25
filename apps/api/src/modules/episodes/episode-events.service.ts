import { Injectable, MessageEvent } from "@nestjs/common";
import { EMPTY, Observable, Subject } from "rxjs";

// SSE (api-contract.md §4) — Subject en memoria por episodio, no
// @nestjs/event-emitter (no instalado, innecesario: un Map<string, Subject>
// singleton resuelve exactamente lo mismo). Sin replay/backfill a propósito:
// si el proceso reinicia o un cliente se conecta tarde, no hay eventos
// históricos — es el trade-off aceptado (SSE = efímero, Notification = lo
// que sí persiste, decision-log.md 2026-09-08 #9).
//
// API-12 (spec 003): este servicio también sabe si hay una ejecución del
// pipeline en curso para cada episodio. EpisodeOrchestratorService la marca
// con begin() de forma síncrona al entrar a runPipeline/runAudioPipeline, y
// la cierra con complete() en su `finally`. La "sesión" de ejecución y la
// vida del Subject son la misma cosa: un stream solo se abre mientras hay
// pipeline activo, así que getOrCreate nunca deja un Subject colgado para un
// episodio que no va a emitir nada (antes, cualquier GET al SSE de un
// episodio frenado creaba un Subject que nadie completaba).
@Injectable()
export class EpisodeEventsService {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();
  // Contador por episodio y no un Set: si una corrida nueva arranca antes de
  // que termine el `finally` de la anterior (p. ej. un approve inmediato
  // después de PENDING_REVIEW, mientras la corrida anterior todavía está
  // notificando), el complete() de la vieja no puede marcar como inactiva a
  // la nueva ni cerrarle el stream a sus clientes.
  private readonly activeRuns = new Map<string, number>();

  begin(episodeId: string): void {
    this.activeRuns.set(episodeId, (this.activeRuns.get(episodeId) ?? 0) + 1);
  }

  isPipelineActive(episodeId: string): boolean {
    return this.activeRuns.has(episodeId);
  }

  // Sin pipeline activo el stream completa enseguida (API-12, AC 3.38/3.39):
  // no hay nadie que vaya a emitir, y dejarlo abierto era una conexión
  // colgada sin fin.
  stream(episodeId: string): Observable<MessageEvent> {
    if (!this.isPipelineActive(episodeId)) return EMPTY;
    return this.getOrCreate(episodeId).asObservable();
  }

  emit(episodeId: string, type: string, data?: unknown): void {
    this.subjects.get(episodeId)?.next({ type, data } as unknown as MessageEvent);
  }

  // Llamado por EpisodeOrchestratorService en el `finally` de
  // runPipeline()/runAudioPipeline() (éxito o error). Cuando termina la
  // última corrida en curso del episodio, lo marca inactivo, completa los
  // streams abiertos y libera el Subject. Si el proceso cae antes, el Map
  // se pierde con él: al reiniciar no hay ninguna corrida activa hasta que
  // EpisodeRecoveryService vuelva a llamar a runPipeline().
  complete(episodeId: string): void {
    const remaining = (this.activeRuns.get(episodeId) ?? 0) - 1;
    if (remaining > 0) {
      this.activeRuns.set(episodeId, remaining);
      return;
    }
    this.activeRuns.delete(episodeId);
    this.subjects.get(episodeId)?.complete();
    this.subjects.delete(episodeId);
  }

  private getOrCreate(episodeId: string): Subject<MessageEvent> {
    let subject = this.subjects.get(episodeId);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.subjects.set(episodeId, subject);
    }
    return subject;
  }
}
