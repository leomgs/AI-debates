import { createHmac, timingSafeEqual } from "node:crypto";

// Firma HMAC-SHA256 en hex y su verificación en tiempo constante. Primitiva
// genérica (sin conocer qué se firma) compartida por dos usuarios con
// semántica distinta: las URLs temporales de audio (tts/audio-url-signer.ts)
// y el token de sesión del curador (auth/session-token.ts, ADR 0001). Cada
// uno arma su propio payload y decide qué hacer con el vencimiento; esto solo
// firma y compara.
export function signHmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyHmacSha256(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(signHmacSha256(secret, payload), "hex");
  const actual = Buffer.from(signature, "hex");
  // Buffer.from con hex inválido no tira, devuelve bytes parciales — el
  // chequeo de longitud previo a timingSafeEqual cubre tanto una firma
  // truncada como una con caracteres no-hex (Buffer.from corta ahí).
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
