// Cada AudioProvider tiene un catálogo de voces incompatible con los otros
// (nombre de modelo Piper vs. código de idioma de Google vs. parámetro
// `voice` de fish-audio, este último aún sin confirmar contra la API real de
// OpenRouter) — Agent.voiceId guarda un ID por proveedor soportado, no un
// string único. decision-log.md 2026-09-09, #20.
export type TtsProviderName = "LOCAL" | "GOOGLE_TTS" | "OPENROUTER";

export type VoiceIdMap = Record<TtsProviderName, string>;
