import { describe, expect, it, vi } from "vitest";
import { AGENT_A } from "@/test/episode-detail-fixture";
import {
  EpisodeEventStream,
  episodeEventsUrl,
  type EventSourceLike,
  type StreamConnectionState,
} from "./episode-event-stream";
import type { BusinessEvent, BusinessEventType } from "./episode-events";

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

class FakeTimers {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();

  setTimeout = (callback: () => void, ms: number): unknown => {
    const handle = this.next++;
    this.pending.set(handle, { callback, ms });
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.ms);
  }

  runAll(): void {
    const timers = [...this.pending.entries()];
    this.pending.clear();
    for (const [, timer] of timers) timer.callback();
  }
}

function setup(decisions: boolean[] = []) {
  const sources: FakeEventSource[] = [];
  const states: StreamConnectionState[] = [];
  const events: Array<{ event: BusinessEvent | null; type: BusinessEventType }> = [];
  const timers = new FakeTimers();
  const refetchAndDecide = vi.fn(async () => decisions.shift() ?? false);
  const stream = new EpisodeEventStream({
    url: "/api/episodes/ep-1/events",
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    onEvent: (event, type) => events.push({ event, type }),
    onStateChange: (state) => states.push(state),
    refetchAndDecide,
    timers,
  });
  const current = () => sources[sources.length - 1];
  return { stream, sources, states, events, timers, refetchAndDecide, current };
}

/** Deja correr las promesas pendientes (el refetch de la reconexión). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("episodeEventsUrl", () => {
  it("usa el mismo origen (/api) y codifica el id", () => {
    expect(episodeEventsUrl("ep-1")).toBe("/api/episodes/ep-1/events");
    expect(episodeEventsUrl("a/b")).toBe("/api/episodes/a%2Fb/events");
  });
});

describe("EpisodeEventStream (AC 3.32-3.38)", () => {
  it("escucha cada tipo de evento de negocio con addEventListener, no el heartbeat", () => {
    const { stream, current } = setup();
    stream.start();
    const types = [...current().listeners.keys()];
    expect(types).toEqual(
      expect.arrayContaining(["open", "error", "research.started", "agent.thinking", "argument.approved"]),
    );
    expect(types).not.toContain("heartbeat");
    expect(types).not.toContain("message");
  });

  it("pasa de conectando a en vivo al abrirse, y entrega los eventos parseados", () => {
    const { stream, current, states, events } = setup();
    stream.start();
    expect(states).toEqual(["connecting"]);
    current().emit("open");
    expect(states).toEqual(["connecting", "live"]);

    current().emit("agent.thinking", JSON.stringify({ agentId: AGENT_A, round: 1 }));
    expect(events).toEqual([
      { type: "agent.thinking", event: { type: "agent.thinking", data: { agentId: AGENT_A, round: 1 } } },
    ]);
  });

  it("un evento que llega antes del open también cuenta como en vivo", () => {
    const { stream, current, states } = setup();
    stream.start();
    current().emit("research.started", "{}");
    expect(states).toEqual(["connecting", "live"]);
  });

  it("un payload ilegible igual avisa (para refrescar el detalle), con el evento en null", () => {
    const { stream, current, events } = setup();
    stream.start();
    current().emit("argument.approved", "no es json");
    expect(events).toEqual([{ type: "argument.approved", event: null }]);
  });

  it("ante un error cierra la conexión (sin reconexión automática), refresca y no reconecta si el estado ya no es SSE (AC 3.36)", async () => {
    const { stream, current, sources, states, refetchAndDecide, timers } = setup([false]);
    stream.start();
    current().emit("open");
    current().emit("error");
    expect(sources[0].closed).toBe(true);
    expect(states.at(-1)).toBe("disconnected");
    await flush();
    expect(refetchAndDecide).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("closed");
    expect(timers.pending.size).toBe(0);
    expect(sources).toHaveLength(1);
  });

  it("reconecta tras el refresco si el estado sigue siendo SSE con pipeline activo (AC 3.38)", async () => {
    const { stream, current, sources, states, timers } = setup([true]);
    stream.start();
    current().emit("open");
    current().emit("error");
    await flush();
    expect(timers.delays()).toEqual([1_000]);
    expect(states.at(-1)).toBe("disconnected");
    timers.runAll();
    expect(sources).toHaveLength(2);
    expect(sources[1].url).toBe("/api/episodes/ep-1/events");
    expect(states.at(-1)).toBe("connecting");
    current().emit("open");
    expect(states.at(-1)).toBe("live");
  });

  it("espera cada vez más si la conexión no llega a abrirse, y vuelve a 1 s tras abrirse", async () => {
    const { stream, current, timers } = setup([true, true, true, true]);
    stream.start();

    current().emit("error");
    await flush();
    expect(timers.delays()).toEqual([1_000]);
    timers.runAll();

    current().emit("error");
    await flush();
    expect(timers.delays()).toEqual([2_000]);
    timers.runAll();

    current().emit("open");
    current().emit("error");
    await flush();
    expect(timers.delays()).toEqual([1_000]);
  });

  it("ignora los eventos y errores de una conexión ya cerrada", async () => {
    const { stream, sources, events, refetchAndDecide, timers } = setup([true]);
    stream.start();
    sources[0].emit("error");
    await flush();
    timers.runAll();
    sources[0].emit("research.started", "{}");
    sources[0].emit("error");
    await flush();
    expect(events).toEqual([]);
    expect(refetchAndDecide).toHaveBeenCalledTimes(1);
  });

  it("stop cierra la conexión y cancela una reconexión pendiente", async () => {
    const { stream, current, sources, timers } = setup([true]);
    stream.start();
    current().emit("error");
    await flush();
    expect(timers.pending.size).toBe(1);
    stream.stop();
    expect(timers.pending.size).toBe(0);
    expect(sources).toHaveLength(1);

    const second = setup();
    second.stream.start();
    second.stream.stop();
    expect(second.sources[0].closed).toBe(true);
  });

  it("si se detiene mientras refresca, no reconecta ni cambia de estado", async () => {
    const { stream, current, states, timers } = setup([true]);
    stream.start();
    current().emit("error");
    stream.stop();
    await flush();
    expect(timers.pending.size).toBe(0);
    expect(states.at(-1)).toBe("disconnected");
  });

  it("si el refresco lanza, reintenta con la espera creciente", async () => {
    const { stream, current, timers, refetchAndDecide } = setup();
    refetchAndDecide.mockRejectedValueOnce(new Error("inesperado"));
    stream.start();
    current().emit("error");
    await flush();
    expect(timers.delays()).toEqual([1_000]);
  });
});
