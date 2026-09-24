// Tokens de DI para las interfaces AudioProvider/AudioStorageProvider — no
// hay una clase concreta única a inyectar (hay 3/1 implementaciones
// respectivamente), así que Nest necesita un token explícito en vez de
// inferirlo de una clase (mismo motivo que cualquier "interface binding" de
// Nest). Resueltos en tts.module.ts.
export const AUDIO_PROVIDER = Symbol("AUDIO_PROVIDER");
export const AUDIO_STORAGE = Symbol("AUDIO_STORAGE");
