import { API_ERROR_CODES } from "@/lib/api/error-codes";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { debateLanguageLabel, type DebateLanguage } from "@/lib/debate-language";

// Lógica del formulario "Crear episodio" (spec 003, sección 4), sin React.

/** Largo máximo de `topic` (CreateEpisodeDto: 1-300 caracteres). */
export const TOPIC_MAX_LENGTH = 300;

export interface TopicState {
  /** Lo que se envía: el texto sin espacios al principio ni al final. */
  value: string;
  /** Caracteres que cuentan contra el máximo (los del texto recortado). */
  length: number;
  tooLong: boolean;
  /** Se puede enviar: no vacío tras recortar y dentro del máximo (AC 3.22). */
  valid: boolean;
}

// Se cuenta como `String.length` (unidades UTF-16), igual que el `max(300)`
// de Zod en la API, para que el contador y el backend coincidan también con
// emojis.
export function topicState(raw: string): TopicState {
  const value = raw.trim();
  const tooLong = value.length > TOPIC_MAX_LENGTH;
  return { value, length: value.length, tooLong, valid: value.length > 0 && !tooLong };
}

/** Dónde se muestra un error del create: junto a un campo o arriba del botón. */
export type CreateEpisodeErrorField = "topic" | "language" | "form";

export interface CreateEpisodeErrorView {
  field: CreateEpisodeErrorField;
  message: string;
  /** `error.message` del backend como detalle adicional (AC 3.78). */
  detail: string | null;
}

// El 400 VALIDATION_ERROR de la API trae el primer issue de Zod como
// "<path>: <mensaje>" (HttpErrorFilter.formatZodIssue), así que el campo sale
// del prefijo. Si matchea un campo del formulario, el mensaje se muestra
// junto a ese campo sin el prefijo (el campo ya lo dice); si no, va entero
// al error general.
export function parseValidationError(message: string): { field: CreateEpisodeErrorField; message: string } {
  const separator = message.indexOf(":");
  const path = separator >= 0 ? message.slice(0, separator).trim() : "";
  const rest = separator >= 0 ? message.slice(separator + 1).trim() : "";
  if ((path === "topic" || path === "language") && rest) return { field: path, message: rest };
  // Issue sin path (por ejemplo, una clave de más que rechaza `.strict()`):
  // el mensaje llega como ": <mensaje>". Va al error general sin el ": ".
  if (separator >= 0 && path === "" && rest) return { field: "form", message: rest };
  return { field: "form", message };
}

/**
 * Traduce el error de `createEpisode` a lo que muestra el formulario. En
 * todos los casos el formulario conserva el texto y el idioma elegidos
 * (AC 3.25, AC 3.78).
 *
 * - `409 VOICE_NOT_CONFIGURED` → junto al selector de idioma, con el nombre
 *   del idioma elegido y el mensaje del backend como detalle (AC 3.78).
 * - `400 VALIDATION_ERROR` → junto al campo, con el mensaje del backend (AC 3.25).
 * - Cualquier otro → error genérico con el mensaje del envelope (AC 3.25).
 */
export function createEpisodeErrorView(error: unknown, language: DebateLanguage): CreateEpisodeErrorView {
  if (error instanceof ApiError && error.status === 409 && error.code === API_ERROR_CODES.VOICE_NOT_CONFIGURED) {
    return {
      field: "language",
      message: `No hay voces configuradas para ${debateLanguageLabel(language)} en el proveedor de audio activo. Configuralas en el seed de la API o elegí otro idioma.`,
      detail: error.message.trim() || null,
    };
  }
  if (error instanceof ApiError && error.status === 400 && error.code === API_ERROR_CODES.VALIDATION_ERROR) {
    return { ...parseValidationError(error.message), detail: null };
  }
  return { field: "form", message: `No se pudo crear el episodio. ${errorMessage(error)}`, detail: null };
}
