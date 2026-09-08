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
    const received: unknown[] = [];
    service.stream("ep-1").subscribe((event) => received.push(event));

    service.emit("ep-1", "argument.approved", { agentId: "a1", text: "x" });

    expect(received).toEqual([{ type: "argument.approved", data: { agentId: "a1", text: "x" } }]);
  });

  it("dos episodios distintos no comparten eventos", () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    service.stream("ep-a").subscribe((event) => receivedA.push(event));
    service.stream("ep-b").subscribe((event) => receivedB.push(event));

    service.emit("ep-a", "research.started");

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it("complete() cierra el observable y no vuelve a emitir después", () => {
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
});
