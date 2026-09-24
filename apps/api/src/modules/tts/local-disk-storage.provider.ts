import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Env } from "../../shared/config/env.schema";
import { AudioStorageProvider } from "./audio-storage.interface";
import { signAudioUrl } from "./audio-url-signer";

// Implementación de AC 6.1 (features.md Feature 6) — disco local, bajo
// AUDIO_STORAGE_DIR (gitignoreado, ver .gitignore). getSignedUrl() devuelve
// una URL relativa bajo /audio-files (servida + verificada por el middleware
// de main.ts, no por un controller de este módulo — coding-rules.md §1: los
// módulos de dominio no exponen HTTP propio).
@Injectable()
export class LocalDiskStorageProvider implements AudioStorageProvider {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async save(storageKey: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolve(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
  }

  async getSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<string> {
    const ttl = expiresInSeconds ?? this.config.get("AUDIO_URL_TTL_SECONDS", { infer: true });
    const expiresAt = Date.now() + ttl * 1000;
    const secret = this.config.get("AUDIO_SIGNING_SECRET", { infer: true });
    const sig = signAudioUrl(secret, storageKey, expiresAt);
    return `/audio-files/${storageKey}?expires=${expiresAt}&sig=${sig}`;
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolve(storageKey)).catch(() => undefined);
  }

  private resolve(storageKey: string): string {
    return join(this.config.get("AUDIO_STORAGE_DIR", { infer: true }), storageKey);
  }
}
