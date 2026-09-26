"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createLoginRedirect } from "@/lib/auth/login-redirect";
import { createPanelQueryClient } from "@/lib/query-client";

// Se crea al primer 401, que solo ocurre en el navegador: en el render de
// servidor del provider no hay `window`.
let redirect: (() => void) | null = null;

function redirectToLogin() {
  redirect ??= createLoginRedirect(window);
  redirect();
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createPanelQueryClient({ onUnauthorized: redirectToLogin }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
