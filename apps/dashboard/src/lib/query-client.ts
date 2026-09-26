import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, isUnauthorizedError } from "./api/errors";

const MAX_QUERY_RETRIES = 2;

// Solo se reintentan fallas de red y 5xx: un 4xx (401 incluido) no cambia
// reintentando.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_QUERY_RETRIES;
}

// QueryClient del panel. Manejo global del 401 (AC 3.7): cualquier consulta
// o acción que reciba UNAUTHORIZED dispara onUnauthorized, que lleva a
// /login?next=<ruta actual> con el aviso de que la acción no se ejecutó.
export function createPanelQueryClient(options: { onUnauthorized: () => void }): QueryClient {
  const handleError = (error: unknown) => {
    if (isUnauthorizedError(error)) options.onUnauthorized();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
}
