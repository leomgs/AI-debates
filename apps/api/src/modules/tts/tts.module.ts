import { Module } from "@nestjs/common";
import { LocalDiskStorageProvider } from "./local-disk-storage.provider";
import { EchogardenAudioProvider } from "./local-echogarden.provider";
import { TtsService } from "./tts.service";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "./tts.tokens";

// Sin controller propio — mismo criterio que agents/research/debate/
// fact-check (coding-rules.md §1): lo orquesta EpisodesModule. Los 2
// endpoints HTTP de negocio de la etapa 3 (AC 6.1 GET .../audio/:id/url, AC
// 6.2 POST .../actions/regenerate-audio) viven en EpisodesController — el
// único endpoint que sí es de este módulo, la ruta /audio-files que sirve
// los bytes firmados, no es un controller sino un middleware + static
// assets registrado en main.ts (no tiene lógica de negocio, es infra pura).
//
// AUDIO_PROVIDER está atado directo a EchogardenAudioProvider (único motor
// real implementado — etapa 2 de TTS) — el switch por TTS_PROVIDER entre
// los 3 motores recién tiene sentido cuando existe una segunda
// implementación real que elegir (etapa 4, Google). Antes de eso sería una
// rama muerta apuntando a símbolos que no existen todavía.
@Module({
  providers: [
    LocalDiskStorageProvider,
    EchogardenAudioProvider,
    { provide: AUDIO_PROVIDER, useExisting: EchogardenAudioProvider },
    { provide: AUDIO_STORAGE, useExisting: LocalDiskStorageProvider },
    TtsService,
  ],
  exports: [TtsService],
})
export class TtsModule {}
