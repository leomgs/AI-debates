import type { DebateLanguage } from "@ai-trend-debates/contracts";

// ============================================================
// Spec 004, D11 (AC 4.6, 4.7, 4.27): los prompts siguen en español neutro
// y el idioma de salida se fija con UNA línea por idioma, redactada en el
// idioma de destino. No hay un juego de prompts por idioma: una instrucción
// corta en el idioma de destino alcanza para fijar la salida, y evita
// triplicar el mantenimiento de personas y reglas editoriales.
//
// Variantes fijas de D5: ES = neutro latinoamericano con tuteo y sin
// regionalismos (la línea la nombra, AC 4.27); EN = en-US; PT = pt-BR.
// Agregar un idioma al enum DebateLanguage obliga a sumar su línea acá
// (el Record es exhaustivo y no compila sin ella).
// ============================================================

const LANGUAGE_INSTRUCTIONS: Record<DebateLanguage, string> = {
  ES: "Escribe todo tu texto en español neutro latinoamericano, con tuteo y sin regionalismos.",
  EN: "Write all of your text in American English (en-US).",
  PT: "Escreva todo o seu texto em português do Brasil (pt-BR).",
};

// Nombre del idioma en español, para las frases de los prompts que tienen
// que decir en qué idioma está un texto (las evaluadoras y la extracción de
// hechos, AC 4.7): esas frases son parte del prompt, que sigue en español.
const LANGUAGE_NAMES: Record<DebateLanguage, string> = {
  ES: "español neutro latinoamericano",
  EN: "inglés de Estados Unidos (en-US)",
  PT: "portugués de Brasil (pt-BR)",
};

export function buildLanguageInstruction(language: DebateLanguage): string {
  return LANGUAGE_INSTRUCTIONS[language];
}

export function describeLanguage(language: DebateLanguage): string {
  return LANGUAGE_NAMES[language];
}

// Spec 004, D7: respaldo de feedback.details cuando el filtro editorial
// rechaza sin reason ni violatedRule (el .refine de EditorialReviewOutputSchema
// lo impide, pero el tipo los deja opcionales). Vuelve al debatiente en el
// prompt de amend, así que sale en el idioma del episodio: en otro idioma
// aumentaría el riesgo de que la enmienda cambie de idioma. Vive acá para
// que cada texto por idioma esté en un solo lugar (review de 13.5, N3).
const EDITORIAL_VIOLATION_FALLBACKS: Record<DebateLanguage, string> = {
  ES: "Violación de reglas editoriales.",
  EN: "Editorial rules violation.",
  PT: "Violação das regras editoriais.",
};

export function editorialViolationFallback(language: DebateLanguage): string {
  return EDITORIAL_VIOLATION_FALLBACKS[language];
}
