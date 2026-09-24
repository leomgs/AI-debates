// Eje separado del motor de TTS (AC 6.1 vs. "quién generó el audio" — no
// confundir: AudioAsset.provider en el schema es el motor, esto es dónde
// viven los bytes). Implementación inicial: disco local
// (LocalDiskStorageProvider); la misma interfaz sirve para S3/R2/GCS después
// sin tocar callers.
export interface AudioStorageProvider {
  save(storageKey: string, buffer: Buffer): Promise<void>;
  getSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;
  delete(storageKey: string): Promise<void>;
}
