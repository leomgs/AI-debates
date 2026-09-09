import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Env } from "../../shared/config/env.schema";
import { AudioStorageProvider } from "./audio-storage.interface";

// Implementación inicial de AC 6.1 (features.md Feature 6) — disco local,
// bajo AUDIO_STORAGE_DIR (gitignoreado, ver .gitignore). getSignedUrl() real
// (HMAC + expiración + ruta de entrega) se agrega en la etapa 3 de TTS
// (tasks.md sección 5) — todavía no hace falta, nada la llama en esta etapa.
@Injectable()
export class LocalDiskStorageProvider implements AudioStorageProvider {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async save(storageKey: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolve(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
  }

  async getSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<string> {
    throw new Error(
      `LocalDiskStorageProvider.getSignedUrl(${storageKey}, ${expiresInSeconds}): todavía no implementado (etapa 3 de TTS).`
    );
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolve(storageKey)).catch(() => undefined);
  }

  private resolve(storageKey: string): string {
    return join(this.config.get("AUDIO_STORAGE_DIR", { infer: true }), storageKey);
  }
}
