import type { Metadata } from "next";
import { LoginForm } from "@/components/panel/login-form";
import { SESSION_EXPIRED_PARAM, sanitizeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  // `next` se valida acá, en el servidor, antes de llegar al formulario
  // (AC 3.1): el formulario solo recibe una ruta /studio/... ya saneada.
  const nextPath = sanitizeNextPath(params.next);
  const sessionExpired = params[SESSION_EXPIRED_PARAM] === "1";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
          <p className="text-sm text-muted-foreground">Panel de curación de AI Trend Debates.</p>
        </div>
        <LoginForm nextPath={nextPath} sessionExpired={sessionExpired} />
      </div>
    </main>
  );
}
