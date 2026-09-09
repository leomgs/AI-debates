import { Module } from "@nestjs/common";
import { LocalDiskStorageProvider } from "./local-disk-storage.provider";
import { EchogardenAudioProvider } from "./local-echogarden.provider";
import { TtsService } from "./tts.service";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "./tts.tokens";

// Sin controller propio — mismo criterio que agents/research/debate/
// fact-check (coding-rules.md §1): lo orquesta EpisodesModule (a partir de
// la etapa 2 de TTS), y los 2 endpoints HTTP de la etapa 3 (AC 6.1/6.2) se
// agregan a EpisodesController existente, no a uno nuevo acá.
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
