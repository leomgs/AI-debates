import { EpisodeEventsService } from "./episode-events.service";

describe("EpisodeEventsService", () => {
  let service: EpisodeEventsService;

  beforeEach(() => {
    service = new EpisodeEventsService();
  });

  it("emitir sin suscriptor no rompe", () => {
    expect(() => service.emit("ep-1", "research.started")).not.toThrow();
  });

  it("un suscriptor recibe los eventos emitidos después de suscribirse", () => {
    service.begin("ep-1");
    const received: unknown[] = [];
    service.stream("ep-1").subscribe((event) => received.push(event));

    service.emit("ep-1", "argument.approved", { agentId: "a1", text: "x" });

    expect(received).toEqual([{ type: "argument.approved", data: { agentId: "a1", text: "x" } }]);
  });

  it("dos episodios distintos no comparten eventos", () => {
    service.begin("ep-a");
    service.begin("ep-b");
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    service.stream("ep-a").subscribe((event) => receivedA.push(event));
    service.stream("ep-b").subscribe((event) => receivedB.push(event));

    service.emit("ep-a", "research.started");

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it("complete() cierra el observable y no vuelve a emitir después", () => {
    service.begin("ep-1");
    let completed = false;
    const received: unknown[] = [];
    service.stream("ep-1").subscribe({
      next: (event) => received.push(event),
      complete: () => (completed = true),
    });

    service.complete("ep-1");
    service.emit("ep-1", "research.started"); // post-complete: no-op (Map ya no tiene el Subject)

    expect(completed).toBe(true);
    expect(received).toHaveLength(0);
  });

  describe("pipeline activo (API-12)", () => {
    it("sin begin(), el stream completa enseguida sin emitir nada", () => {
      let completed = false;
      const received: unknown[] = [];
      service.stream("ep-1").subscribe({ next: (e) => received.push(e), complete: () => (completed = true) });

      expect(completed).toBe(true);
      expect(received).toHaveLength(0);
      expect(service.isPipelineActive("ep-1")).toBe(false);
    });

    it("pedir el stream de un episodio sin pipeline no deja un Subject colgado", () => {
      service.stream("ep-1").subscribe();

      // Antes de API-12, getOrCreate dejaba acá un Subject que nadie iba a
      // completar. Se mira el Map interno porque desde afuera no se ve.
      const subjects = (service as unknown as { subjects: Map<string, unknown> }).subjects;
      expect(subjects.has("ep-1")).toBe(false);
    });

    it("begin() lo marca activo y complete() lo marca inactivo", () => {
      service.begin("ep-1");
      expect(service.isPipelineActive("ep-1")).toBe(true);

      service.complete("ep-1");
      expect(service.isPipelineActive("ep-1")).toBe(false);
    });

    it("con dos corridas superpuestas, terminar la primera no apaga la segunda ni le cierra el stream", () => {
      service.begin("ep-1");
      service.begin("ep-1");
      let completed = false;
      const received: unknown[] = [];
      service.stream("ep-1").subscribe({ next: (e) => received.push(e), complete: () => (completed = true) });

      service.complete("ep-1");
      service.emit("ep-1", "research.started");

      expect(service.isPipelineActive("ep-1")).toBe(true);
      expect(completed).toBe(false);
      expect(received).toHaveLength(1);

      service.complete("ep-1");
      expect(service.isPipelineActive("ep-1")).toBe(false);
      expect(completed).toBe(true);
    });

    it("complete() sin begin() previo no deja un contador negativo", () => {
      service.complete("ep-1");
      service.begin("ep-1");

      expect(service.isPipelineActive("ep-1")).toBe(true);
    });
  });
});
