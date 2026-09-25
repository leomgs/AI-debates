import { signHmacSha256, verifyHmacSha256 } from "../../shared/crypto/hmac-signature";

// Token de sesión sin estado (ADR 0001 punto 2): "<exp>.<firma>", con exp en
// ms epoch y la firma HMAC-SHA256 (hex) de "session:<exp>" con
// SESSION_SECRET. Mismo patrón que las URLs de audio (tts/audio-url-signer.ts):
// nada se guarda del lado del servidor, así que un reinicio del backend no
// desloguea, y cerrar sesión no revoca una cookie ya copiada antes de su
// vencimiento (rotar SESSION_SECRET las revoca todas). El prefijo "session:"
// separa el dominio de esta firma del de cualquier otro payload firmado.
//
// Funciones puras con `now` inyectable: el reloj lo decide el llamador.

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // AC 3.3: 7 días desde el login

export type SessionTokenCheck = { valid: true; expiresAt: number } | { valid: false };

function payloadFor(expiresAt: number): string {
  return `session:${expiresAt}`;
}

export function issueSessionToken(secret: string, now: number): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS;
  return { token: `${expiresAt}.${signHmacSha256(secret, payloadFor(expiresAt))}`, expiresAt };
}

export function checkSessionToken(secret: string, token: string, now: number): SessionTokenCheck {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false };

  const [expRaw, signature] = parts;
  // Entero decimal positivo, sin ceros a la izquierda ni signos: una sola
  // representación por valor (el payload firmado usa Number(expRaw)).
  if (!/^[1-9]\d{0,15}$/.test(expRaw)) return { valid: false };
  const expiresAt = Number(expRaw);

  // La firma se verifica siempre, antes de mirar el vencimiento: el
  // resultado de un token alterado no depende de si "ya venció".
  if (!verifyHmacSha256(secret, payloadFor(expiresAt), signature)) return { valid: false };
  if (now >= expiresAt) return { valid: false };

  return { valid: true, expiresAt };
}
