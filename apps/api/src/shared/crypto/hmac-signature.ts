import { createHmac, timingSafeEqual } from "node:crypto";

// Firma HMAC-SHA256 en hex y su verificación en tiempo constante. Primitiva
// genérica (sin conocer qué se firma) compartida por dos usuarios con
// semántica distinta: las URLs temporales de audio (tts/audio-url-signer.ts)
// y el token de sesión del curador (auth/session-token.ts, ADR 0001). Cada
// uno arma su propio payload y decide qué hacer con el vencimiento; esto solo
// firma y compara.

// Forma canónica exacta de lo que emite signHmacSha256: 32 bytes en hex
// minúscula. Se exige ANTES de decodificar porque Buffer.from(s, "hex") corta
// en el primer carácter no hexadecimal y acepta mayúsculas: sin este chequeo,
// "<firma>zz" o la firma en mayúsculas pasaban como válidas (encontrado en la
// revisión de API-8; el problema ya estaba en el firmador de audio).
const CANONICAL_SIGNATURE = /^[0-9a-f]{64}$/;

export function signHmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyHmacSha256(secret: string, payload: string, signature: string): boolean {
  if (!CANONICAL_SIGNATURE.test(signature)) return false;

  const expected = Buffer.from(signHmacSha256(secret, payload), "hex");
  const actual = Buffer.from(signature, "hex");
  return timingSafeEqual(expected, actual);
}
