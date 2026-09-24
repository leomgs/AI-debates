// Feature 7 (Remotion Manifest) — timing por palabra para subtítulos.
// Opcional: no todo AudioProvider lo expone nativamente (Google/OpenRouter,
// en backlog, decision-log.md #26/#27) — solo LOCAL (echogarden) lo llena hoy.
export interface AudioSubtitleCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface AudioSynthesisResult {
  audioBuffer: Buffer;
  durationMs: number;
  mimeType: string;
  subtitles?: AudioSubtitleCue[];
}

// Cada AudioProvider (Local/Google/OpenRouter) implementa esto — una sola
// operación real, "convertir texto a audio". Cuál implementación está activa
// es responsabilidad de TtsModule (token AUDIO_PROVIDER, resuelto una vez a
// nivel de deployment vía TTS_PROVIDER, no por llamada — decision-log.md
// 2026-09-09, #20), no de este contrato.
export interface AudioProvider {
  synthesize(text: string, voiceId: string): Promise<AudioSynthesisResult>;
}
