export interface AudioSynthesisResult {
  audioBuffer: Buffer;
  durationMs: number;
  mimeType: string;
}

// Cada AudioProvider (Local/Google/OpenRouter) implementa esto — una sola
// operación real, "convertir texto a audio". Cuál implementación está activa
// es responsabilidad de TtsModule (token AUDIO_PROVIDER, resuelto una vez a
// nivel de deployment vía TTS_PROVIDER, no por llamada — decision-log.md
// 2026-09-09, #20), no de este contrato.
export interface AudioProvider {
  synthesize(text: string, voiceId: string): Promise<AudioSynthesisResult>;
}
