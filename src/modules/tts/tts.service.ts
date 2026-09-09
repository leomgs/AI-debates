import { Inject, Injectable } from "@nestjs/common";
import type { AudioProvider } from "./audio-provider.interface";
import type { AudioStorageProvider } from "./audio-storage.interface";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "./tts.tokens";

// Esqueleto (etapa 1 de TTS, tasks.md sección 5) — solo prueba que el motor
// activo y el storage resuelven por DI. synthesizeSegment/regenerateSegment/
// getOrderedOfficialArguments se agregan en las etapas 2/3, mismo criterio
// que EpisodesModule (decision-log.md #10): construir en fases verificables,
// no todo junto.
@Injectable()
export class TtsService {
  constructor(
    @Inject(AUDIO_PROVIDER) private readonly provider: AudioProvider,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStorageProvider
  ) {}
}
