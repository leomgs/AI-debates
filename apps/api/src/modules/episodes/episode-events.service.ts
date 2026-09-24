import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

// SSE (api-contract.md §4) — Subject en memoria por episodio, no
// @nestjs/event-emitter (no instalado, innecesario: un Map<string, Subject>
// singleton resuelve exactamente lo mismo). Sin replay/backfill a propósito:
// si el proceso reinicia o un cliente se conecta tarde, no hay eventos
// históricos — es el trade-off aceptado (SSE = efímero, Notification = lo
// que sí persiste, decision-log.md 2026-09-08 #9).
@Injectable()
export class EpisodeEventsService {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  stream(episodeId: string): Observable<MessageEvent> {
    return this.getOrCreate(episodeId).asObservable();
  }

  emit(episodeId: string, type: string, data?: unknown): void {
    this.subjects.get(episodeId)?.next({ type, data } as unknown as MessageEvent);
  }

  // Llamado por EpisodeOrchestratorService al terminar runPipeline() (éxito
  // o error) — libera el Subject de memoria una vez que esa "sesión" de
  // ejecución terminó. Si el proceso cae antes de esto, el Subject queda
  // huérfano hasta el próximo restart — aceptable a este volumen (single-user).
  complete(episodeId: string): void {
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
