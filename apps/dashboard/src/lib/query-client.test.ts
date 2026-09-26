import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/errors";
import { createPanelQueryClient, shouldRetryQuery } from "./query-client";

const unauthorized = () => new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Sin sesión" });

describe("createPanelQueryClient: manejo global del 401 (AC 3.7)", () => {
  it("una consulta con 401 UNAUTHORIZED dispara onUnauthorized", async () => {
    const onUnauthorized = vi.fn();
    const client = createPanelQueryClient({ onUnauthorized });

    await expect(
      client.fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(unauthorized()),
      }),
    ).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("una acción con 401 UNAUTHORIZED dispara onUnauthorized", async () => {
    const onUnauthorized = vi.fn();
    const client = createPanelQueryClient({ onUnauthorized });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(unauthorized()),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("el 401 INVALID_CREDENTIALS del login no redirige", async () => {
    const onUnauthorized = vi.fn();
    const client = createPanelQueryClient({ onUnauthorized });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "" })),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("shouldRetryQuery", () => {
  it("no reintenta errores 4xx", () => {
    expect(shouldRetryQuery(0, unauthorized())).toBe(false);
    expect(shouldRetryQuery(0, new ApiError({ status: 404, code: "NOT_FOUND", message: "" }))).toBe(false);
  });

  it("reintenta 5xx y fallas de red hasta 2 veces", () => {
    const serverError = new ApiError({ status: 503, code: "PROVIDER_QUOTA_EXCEEDED", message: "" });
    expect(shouldRetryQuery(0, serverError)).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(2, serverError)).toBe(false);
  });
});
