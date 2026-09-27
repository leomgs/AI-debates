import type { components } from "@/lib/api/schema";

// Idioma del debate (spec 004; spec 003, D15 y "Mapeo de estados a UI"). Es
// el idioma del contenido de cada episodio, no el de la interfaz (D8, D16).
// Los tipos salen de openapi.json (D5): `DebateLanguage` es el enum de
// entrada (CreateEpisodeDto) y `DebateLanguage_Output` el de las respuestas.
// El Record de etiquetas cubre los dos, así que si la API suma, quita o
// renombra un idioma en cualquiera de ellos, el build del dashboard falla.
export type DebateLanguage = components["schemas"]["DebateLanguage"];
type DebateLanguageOutput = components["schemas"]["DebateLanguage_Output"];
/** Cualquier idioma que la API pueda devolver o aceptar (distintivos, etiquetas). */
export type AnyDebateLanguage = DebateLanguage | DebateLanguageOutput;

export const DEBATE_LANGUAGE_LABELS: Readonly<Record<AnyDebateLanguage, string>> = {
  ES: "Español",
  EN: "English",
  PT: "Português",
};

/** Opciones del selector, en el orden de la spec (AC 3.22). */
export const DEBATE_LANGUAGES = Object.keys(DEBATE_LANGUAGE_LABELS) as DebateLanguage[];

/** Preseleccionado en "Crear episodio" (AC 3.22), igual que el default de la API. */
export const DEFAULT_DEBATE_LANGUAGE: DebateLanguage = "ES";

export function debateLanguageLabel(language: AnyDebateLanguage): string {
  return DEBATE_LANGUAGE_LABELS[language];
}

/** Estrecha el valor de un control del formulario (siempre string) al enum. */
export function parseDebateLanguage(value: string): DebateLanguage | null {
  return DEBATE_LANGUAGES.find((language) => language === value) ?? null;
}
