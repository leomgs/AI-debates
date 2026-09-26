"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";

// Consulta GET /auth/session al entrar al panel y al volver el foco a la
// pestaña. No muestra nada: si la API responde 401 UNAUTHORIZED, el manejo
// global del QueryClient lleva a /login?next=<ruta actual> (AC 3.7).
export function SessionCheck() {
  useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => unwrap(await api.GET("/auth/session")),
    staleTime: 60_000,
  });
  return null;
}
