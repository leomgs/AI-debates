"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { loginErrorMessage } from "@/lib/auth/login-error-message";

type Credentials = components["schemas"]["LoginDto"];

async function login(credentials: Credentials) {
  return unwrap(await api.POST("/auth/login", { body: credentials }));
}

export function LoginForm({ nextPath, sessionExpired }: { nextPath: string; sessionExpired: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: login,
    // nextPath ya viene saneado del servidor (solo /studio/...; AC 3.1).
    onSuccess: () => router.replace(nextPath),
    // La contraseña no se conserva tras un intento fallido.
    onError: () => setPassword(""),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.mutate({ username, password });
  }

  const errorMessage = mutation.isError ? loginErrorMessage(mutation.error) : null;
  // Mientras se navega después de un login exitoso, el formulario sigue
  // deshabilitado para no mandar un segundo intento.
  const busy = mutation.isPending || mutation.isSuccess;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {sessionExpired && !mutation.isError && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tu sesión venció. Si estabas haciendo una acción, no se ejecutó: iniciá sesión y repetila.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="login-username">Usuario</Label>
        <Input
          id="login-username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password">Contraseña</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>

      {/* Un solo mensaje para el formulario: no dice qué campo falló (AC 3.2). */}
      {errorMessage && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
