import { MutationObserver, QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { ApiError } from "./api/errors";
import {
  createActionGuard,
  episodeActionMutationOptions,
  episodeActionsState,
  startEpisodeAction,
  type ActionGuard,
  type PerformEpisodeAction,
} from "./episode-action-mutation";
import { LLM_BUDGET_ERROR_MESSAGE, STATE_CHANGED_MESSAGE, type EpisodeActionRequest } from "./episode-actions";
import { queryKeys } from "./query-keys";

// QueryClient y MutationObserver reales (los re-exporta @tanstack/react-query
// desde query-core), con la llamada HTTP de la acción mockeada.

const EPISODE_ID = "00000000-0000-4000-8000-000000000001";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deja correr las promesas pendientes (los await internos de TanStack Query). */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function apiError(status: number, code: string) {
  return new ApiError({ status, code, message: "mensaje del backend" });
}

interface Harness {
  queryClient: QueryClient;
  observer: MutationObserver<void, Error, EpisodeActionRequest>;
  guard: ActionGuard;
  perform: Mock<PerformEpisodeAction>;
  invalidate: MockInstance<QueryClient["invalidateQueries"]>;
  /** El refetch del detalle en curso, para decidir cuándo termina. */
  detailFetches: Array<Deferred<{ status: string }>>;
  /** Como actions.run: la guarda y después mutate. */
  run: (request: EpisodeActionRequest) => { started: boolean; settled: Promise<void> };
  state: () => ReturnType<typeof episodeActionsState>;
  dispose: () => void;
}

async function setup(perform: PerformEpisodeAction): Promise<Harness> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const detailFetches: Array<Deferred<{ status: string }>> = [];
  // El detalle activo en pantalla: invalidateQueries lo vuelve a pedir y espera.
  const detail = new QueryObserver(queryClient, {
    queryKey: queryKeys.episodes.detail(EPISODE_ID),
    queryFn: () => {
      const fetch = deferred<{ status: string }>();
      detailFetches.push(fetch);
      return fetch.promise;
    },
  });
  const unsubscribeDetail = detail.subscribe(() => {});
  await flush();
  detailFetches.shift()?.resolve({ status: "PENDING_REVIEW" });
  await flush();

  const guard = createActionGuard();
  const performMock = vi.fn(perform);
  const observer = new MutationObserver(
    queryClient,
    episodeActionMutationOptions(queryClient, EPISODE_ID, { perform: performMock, guard }),
  );
  const unsubscribeMutation = observer.subscribe(() => {});
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  return {
    queryClient,
    observer,
    guard,
    perform: performMock,
    invalidate,
    detailFetches,
    run(request) {
      let settled: Promise<void> = Promise.resolve();
      const started = startEpisodeAction(
        guard,
        (current) => {
          settled = observer.mutate(current).then(
            () => undefined,
            () => undefined,
          );
        },
        request,
      );
      return { started, settled };
    },
    state: () => episodeActionsState(observer.getCurrentResult()),
    dispose() {
      unsubscribeMutation();
      unsubscribeDetail();
      queryClient.clear();
    },
  };
}

describe("episodeActionMutationOptions", () => {
  let harness: Harness | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
    vi.restoreAllMocks();
  });

  it("un segundo run() mientras hay uno en curso no hace nada (AC 3.49)", async () => {
    const call = deferred<void>();
    harness = await setup(() => call.promise);

    const first = harness.run({ action: "approve" });
    const second = harness.run({ action: "reject" });
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    await flush();
    expect(harness.perform).toHaveBeenCalledTimes(1);
    expect(harness.perform).toHaveBeenCalledWith(EPISODE_ID, { action: "approve" });

    call.resolve();
    await flush();
    harness.detailFetches.shift()?.resolve({ status: "APPROVED" });
    await first.settled;

    // Terminada la primera, la guarda queda libre.
    harness.perform.mockImplementation(() => Promise.resolve());
    expect(harness.run({ action: "reject" }).started).toBe(true);
  });

  it("la guarda también se libera tras un error", async () => {
    harness = await setup(() => Promise.reject(apiError(500, "INTERNAL_ERROR")));
    await harness.run({ action: "approve" }).settled;
    expect(harness.run({ action: "approve" }).started).toBe(true);
  });

  it("el estado pendiente dura hasta que termina el refetch del detalle (AC 3.45, AC 3.82)", async () => {
    harness = await setup(() => Promise.resolve());
    const { settled } = harness.run({ action: "regenerate-verdict" });
    await flush();

    // La acción respondió, pero el detalle nuevo todavía no llegó: sigue "Juzgando…".
    expect(harness.perform).toHaveBeenCalledTimes(1);
    expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.episodes.all });
    expect(harness.detailFetches).toHaveLength(1);
    expect(harness.state().pending).toEqual({ action: "regenerate-verdict" });

    harness.detailFetches.shift()?.resolve({ status: "PENDING_REVIEW" });
    await settled;
    expect(harness.observer.getCurrentResult().isSuccess).toBe(true);
    expect(harness.state()).toEqual({ pending: null, failure: null });
  });

  it.each([
    ["409 INVALID_STATE_TRANSITION", apiError(409, "INVALID_STATE_TRANSITION"), STATE_CHANGED_MESSAGE],
    ["404 NOT_FOUND", apiError(404, "NOT_FOUND"), "El argumento ya no está en el debate; se actualizó la vista."],
    ["409 USAGE_LIMIT_EXCEEDED de una acción con LLM", apiError(409, "USAGE_LIMIT_EXCEEDED"), LLM_BUDGET_ERROR_MESSAGE],
  ])("tras %s refresca el detalle y lo espera antes del estado de error", async (_label, error, message) => {
    harness = await setup(() => Promise.reject(error));
    const { settled } = harness.run({ action: "regenerate", argumentId: "arg-1" });
    await flush();

    expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.episodes.all });
    expect(harness.detailFetches).toHaveLength(1);
    // Mientras el refetch no termina, no hay error a la vista y sigue pendiente.
    expect(harness.observer.getCurrentResult().isError).toBe(false);
    expect(harness.state().pending).toEqual({ action: "regenerate", argumentId: "arg-1" });

    harness.detailFetches.shift()?.resolve({ status: "PENDING_REVIEW" });
    await settled;
    const state = harness.state();
    expect(state.pending).toBeNull();
    expect(state.failure?.view.message).toBe(message);
    expect(state.failure?.view.refetch).toBe(true);
  });

  it("tras un éxito también se refresca el detalle (D7)", async () => {
    harness = await setup(() => Promise.resolve());
    const { settled } = harness.run({ action: "approve" });
    await flush();
    harness.detailFetches.shift()?.resolve({ status: "APPROVED" });
    await settled;
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["503 PROVIDER_QUOTA_EXCEEDED", apiError(503, "PROVIDER_QUOTA_EXCEEDED")],
    ["500 genérico", apiError(500, "INTERNAL_ERROR")],
    ["sin respuesta del servidor", new TypeError("Failed to fetch")],
    ["400 VALIDATION_ERROR", apiError(400, "VALIDATION_ERROR")],
  ])("tras %s no hay refetch", async (_label, error) => {
    harness = await setup(() => Promise.reject(error));
    await harness.run({ action: "regenerate", argumentId: "arg-1" }).settled;
    expect(harness.invalidate).not.toHaveBeenCalled();
    expect(harness.detailFetches).toHaveLength(0);
    expect(harness.observer.getCurrentResult().isError).toBe(true);
  });

  it.each([
    ["409 INVALID_STATE_TRANSITION", apiError(409, "INVALID_STATE_TRANSITION")],
    ["404 NOT_FOUND", apiError(404, "NOT_FOUND")],
    ["409 USAGE_LIMIT_EXCEEDED", apiError(409, "USAGE_LIMIT_EXCEEDED")],
    ["503 PROVIDER_QUOTA_EXCEEDED", apiError(503, "PROVIDER_QUOTA_EXCEEDED")],
    ["500 genérico", apiError(500, "INTERNAL_ERROR")],
    ["sin respuesta del servidor", new TypeError("Failed to fetch")],
  ])("pending vuelve a null tras %s: no queda en Juzgando…", async (_label, error) => {
    harness = await setup(() => Promise.reject(error));
    const { settled } = harness.run({ action: "regenerate-verdict" });
    await flush();
    harness.detailFetches.shift()?.resolve({ status: "PENDING_REVIEW" });
    await settled;
    const state = harness.state();
    expect(state.pending).toBeNull();
    expect(state.failure?.request).toEqual({ action: "regenerate-verdict" });
  });

  describe("sin red (networkMode: always)", () => {
    beforeEach(() => {
      onlineManager.setOnline(false);
    });
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it("la mutación no queda en pausa: falla con 'No hubo respuesta del servidor…'", async () => {
      harness = await setup(() => Promise.reject(new TypeError("Failed to fetch")));
      const { settled } = harness.run({ action: "regenerate-verdict" });
      await flush();
      expect(harness.observer.getCurrentResult().isPaused).toBe(false);
      expect(harness.perform).toHaveBeenCalledTimes(1);
      await settled;
      const state = harness.state();
      expect(state.pending).toBeNull();
      expect(state.failure?.view.message).toMatch(/^No se pudo volver a juzgar\. No hubo respuesta del servidor/);
    });
  });
});

describe("episodeActionsState", () => {
  it("pendiente solo mientras la mutación está en curso", () => {
    expect(episodeActionsState({ status: "idle", variables: undefined, error: null })).toEqual({
      pending: null,
      failure: null,
    });
    expect(episodeActionsState({ status: "pending", variables: { action: "approve" }, error: null }).pending).toEqual({
      action: "approve",
    });
  });
});
