import { Injectable } from "@nestjs/common";
import { AudioProvider, AudioSynthesisResult } from "./audio-provider.interface";

// STUB de la etapa 1 (esqueleto de TtsModule) — implementación real en la
// etapa 2 (tasks.md sección 5): dynamic import("echogarden") (el paquete es
// ESM, este proyecto es CJS/nodenext, ver tsconfig.json), modelos Piper
// ONNX, Cockatiel propio para reintentos ante fallas locales transitorias
// (no 429 de red, sino carreras de descarga de modelo/errores de FS).
// Registrado ya en TtsModule para que el módulo bootstrapee de punta a punta
// (DI, config, storage) antes de tener el motor real — synthesize() solo
// lanza si alguien intenta usarlo, el arranque del proceso no se ve afectado.
@Injectable()
export class EchogardenAudioProvider implements AudioProvider {
  async synthesize(text: string, voiceId: string): Promise<AudioSynthesisResult> {
    throw new Error(
      `EchogardenAudioProvider.synthesize(voiceId=${voiceId}, len=${text.length}): todavía no implementado (etapa 2 de TTS).`
    );
  }
}
