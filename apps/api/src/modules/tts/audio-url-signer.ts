import { createHmac, timingSafeEqual } from "node:crypto";

// AC 6.1 (features.md Feature 6, etapa 3 de TTS — tasks.md sección 5): firma
// HMAC-SHA256 simple sobre storageKey+expiresAt. Bajo el criterio de
// seguridad ya documentado en api-contract.md §1 ("sin autenticación,
// herramienta de uso local/personal") alcanza con esto — no hace falta un
// esquema de firma de nivel productivo (ej. AWS SigV4). Usado por
// LocalDiskStorageProvider.getSignedUrl() (firma) y por el middleware de
// main.ts que sirve /audio-files (verifica) — funciones puras, sin estado,
// para no acoplar ninguno de los dos a una clase nueva.
export function signAudioUrl(secret: string, storageKey: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`${storageKey}:${expiresAt}`).digest("hex");
}

export function verifyAudioUrlSignature(secret: string, storageKey: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = Buffer.from(signAudioUrl(secret, storageKey, expiresAt), "hex");
  const actual = Buffer.from(signature, "hex");
  // Buffer.from con hex inválido no tira, devuelve bytes parciales — el
  // chequeo de longitud previo a timingSafeEqual cubre tanto una firma
  // truncada como una con caracteres no-hex (Buffer.from corta ahí).
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
