import { signHmacSha256, verifyHmacSha256 } from "../../shared/crypto/hmac-signature";

// AC 6.1 (features.md Feature 6, etapa 3 de TTS — tasks.md sección 5): firma
// HMAC-SHA256 simple sobre storageKey+expiresAt. /audio-files queda fuera del
// SessionGuard (es middleware de Express, y el showcase público lo necesita —
// ADR 0001 punto 5), así que esta firma es su única protección; por eso en
// producción EnvSchema no acepta el AUDIO_SIGNING_SECRET por defecto. Usado
// por LocalDiskStorageProvider.getSignedUrl() (firma) y por el middleware de
// main.ts que sirve /audio-files (verifica) — funciones puras, sin estado,
// para no acoplar ninguno de los dos a una clase nueva. La primitiva HMAC
// vive en shared/crypto/ (compartida con el token de sesión de auth/).
export function signAudioUrl(secret: string, storageKey: string, expiresAt: number): string {
  return signHmacSha256(secret, `${storageKey}:${expiresAt}`);
}

export function verifyAudioUrlSignature(secret: string, storageKey: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return verifyHmacSha256(secret, `${storageKey}:${expiresAt}`, signature);
}
