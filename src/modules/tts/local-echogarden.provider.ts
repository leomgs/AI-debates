import { Injectable, Logger } from "@nestjs/common";
import { AudioProvider, AudioSynthesisResult } from "./audio-provider.interface";
import { TtsProviderUnavailableError } from "./tts.errors";

// Shape real de SynthesisResult.audio para el engine "vits" (confirmado
// corriendo echogarden.synthesize() a mano) — echogarden no exporta
// RawAudio como valor en su entrypoint público, solo como tipo.
interface EchogardenRawAudio {
  audioChannels: Float32Array[];
  sampleRate: number;
}

// Motor Local (decision-log.md 2026-09-09, #19/#20). `echogarden` corre
// modelos Piper en el mismo proceso Node vía ONNX — en su propia
// terminología el motor se llama "vits" (VITS es la arquitectura en la que
// se basan los modelos de Piper; confirmado en node_modules/echogarden/docs
// /Engines.md, no hay un engine "piper" separado). El primer synth de cada
// voz descarga su modelo ONNX (~15-100MB según el tier) a un cache local —
// "sin dependencia externa" es cierto en steady-state, no la primera vez en
// una máquina limpia (decision-log.md #20, punto 5).
//
// require() perezoso dentro del método (no un import estático arriba del
// archivo) a propósito: `echogarden` es un toolkit grande (transcripción,
// traducción, alineación, separación de fuentes, VAD...) — cargarlo entero
// cuesta ~250-300ms medidos a mano, pagado en cada arranque del proceso
// (incluidos tests) aunque TTS nunca se llame. Se probó primero con
// `await import("echogarden")` dinámico — funciona en runtime real (Node
// 22.12+ soporta require(esm), mismo mecanismo), pero Jest lo rechaza
// (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`, necesita
// --experimental-vm-modules) al compilar el `import()` nativo con
// `module: nodenext`. `require()` evita ese problema — Jest lo intercepta
// igual que cualquier otro require (jest.mock funciona sin cambios) y en
// runtime real Node 22.12+ resuelve el paquete ESM de la misma forma que ya
// resuelve `@nestjs/config`/`cockatiel` (tasks.md sección 0).
//
// Duración/WAV se calculan a mano desde el RawAudio devuelto
// (audioChannels + sampleRate) en vez de usar encodeRawAudioToWave/
// getRawAudioDuration del propio paquete — esas funciones viven en un
// submódulo interno (audio/AudioUtilities) que el entrypoint público NO
// exporta (confirmado listando `Object.keys(require("echogarden"))`), así
// que depender de esa ruta interna arriesgaría romperse entre versiones sin
// aviso en un changelog.
@Injectable()
export class EchogardenAudioProvider implements AudioProvider {
  private readonly logger = new Logger(EchogardenAudioProvider.name);

  async synthesize(text: string, voiceId: string): Promise<AudioSynthesisResult> {
    try {
      const echogarden: typeof import("echogarden") = require("echogarden");
      const result = await echogarden.synthesize(text, { engine: "vits", voice: voiceId });
      const raw = result.audio as unknown as EchogardenRawAudio;

      const durationMs = Math.round((raw.audioChannels[0].length / raw.sampleRate) * 1000);
      const audioBuffer = encodePcmToWav(raw.audioChannels, raw.sampleRate);

      return { audioBuffer, durationMs, mimeType: "audio/wav" };
    } catch (err) {
      this.logger.error(`EchogardenAudioProvider falló para voiceId=${voiceId}`, err instanceof Error ? err.stack : err);
      throw new TtsProviderUnavailableError("LOCAL", err);
    }
  }
}

// WAV PCM de 16 bits, sin dependencia nueva — el shape de RawAudio
// (Float32Array por canal, rango [-1, 1]) es simple de codificar a mano.
function encodePcmToWav(audioChannels: Float32Array[], sampleRate: number): Buffer {
  const channelCount = audioChannels.length;
  const sampleCount = audioChannels[0].length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // tamaño del sub-chunk fmt
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34); // bits por muestra
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const clamped = Math.max(-1, Math.min(1, audioChannels[ch][i]));
      buffer.writeInt16LE(Math.round(clamped * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}
