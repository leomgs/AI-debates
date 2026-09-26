"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { buildLoginUrl } from "@/lib/auth/next-path";
import { createPanelQueryClient } from "@/lib/query-client";

let redirectingToLogin = false;

// Navegación completa (no router.replace): descarta el caché de consultas de
// la sesión vencida. El flag evita que varias consultas con 401 en paralelo
// disparen varias redirecciones.
function redirectToLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const current = `${window.location.pathname}${window.location.search}`;
  window.location.assign(buildLoginUrl(current, { sessionExpired: true }));
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createPanelQueryClient({ onUnauthorized: redirectToLogin }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
