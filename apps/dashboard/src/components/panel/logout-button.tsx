"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import { LOGIN_PATH } from "@/lib/auth/next-path";

// "Cerrar sesión" (AC 3.4): POST /auth/logout borra la cookie; después se
// navega a /login con recarga completa para descartar el caché del panel.
export function LogoutButton() {
  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.POST("/auth/logout")),
    onSuccess: () => window.location.assign(LOGIN_PATH),
  });

  const busy = mutation.isPending || mutation.isSuccess;

  return (
    <div className="flex items-center gap-3">
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cerrar sesión. Reintentá.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={() => mutation.mutate()} disabled={busy}>
        {busy ? "Cerrando sesión…" : "Cerrar sesión"}
      </Button>
    </div>
  );
}
