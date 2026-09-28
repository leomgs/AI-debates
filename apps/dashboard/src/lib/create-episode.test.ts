import { describe, expect, it } from "vitest";
import { ApiError } from "./api/errors";
import { TOPIC_MAX_LENGTH, createEpisodeErrorView, parseValidationError, topicState } from "./create-episode";

describe("topicState (AC 3.22)", () => {
  it("vacío o solo espacios no es válido", () => {
    expect(topicState("").valid).toBe(false);
    expect(topicState("   \n\t ").valid).toBe(false);
    expect(topicState("   \n\t ").length).toBe(0);
  });

  it("recorta los espacios del principio y del final para enviar y contar", () => {
    const state = topicState("  ¿IA en la escuela?  ");
    expect(state.value).toBe("¿IA en la escuela?");
    expect(state.length).toBe("¿IA en la escuela?".length);
    expect(state.valid).toBe(true);
  });

  it("300 caracteres es válido; 301 no", () => {
    expect(TOPIC_MAX_LENGTH).toBe(300);
    expect(topicState("a".repeat(300))).toMatchObject({ valid: true, tooLong: false, length: 300 });
    expect(topicState("a".repeat(301))).toMatchObject({ valid: false, tooLong: true, length: 301 });
  });

  it("los espacios de los bordes no cuentan contra el máximo", () => {
    expect(topicState(`  ${"a".repeat(300)}  `).valid).toBe(true);
  });

  it("cuenta como la API (unidades UTF-16 de String.length)", () => {
    // Un emoji fuera del BMP ocupa 2 unidades, igual que en el max(300) de Zod.
    expect(topicState("🙂").length).toBe(2);
    expect(topicState("🙂".repeat(150)).valid).toBe(true);
    expect(topicState(`${"🙂".repeat(150)}a`).valid).toBe(false);
  });
});

function apiError(status: number, code: string, message: string) {
  return new ApiError({ status, code, message });
}

describe("createEpisodeErrorView", () => {
  it("409 VOICE_NOT_CONFIGURED va junto al selector, con el idioma enviado y el detalle del backend (AC 3.78)", () => {
    const view = createEpisodeErrorView(
      apiError(409, "VOICE_NOT_CONFIGURED", 'No hay voz configurada en idioma EN para el proveedor de TTS "piper".'),
      "EN",
    );
    expect(view.field).toBe("language");
    expect(view.message).toBe(
      "No hay voces configuradas para English en el proveedor de audio activo. Configuralas en el seed de la API o elegí otro idioma.",
    );
    expect(view.detail).toBe('No hay voz configurada en idioma EN para el proveedor de TTS "piper".');
  });

  it("usa la etiqueta del idioma para PT y omite el detalle si viene vacío", () => {
    const view = createEpisodeErrorView(apiError(409, "VOICE_NOT_CONFIGURED", "  "), "PT");
    expect(view.message).toContain("para Português en");
    expect(view.detail).toBeNull();
  });

  it("400 VALIDATION_ERROR de topic va junto al campo con el mensaje del backend (AC 3.25)", () => {
    const view = createEpisodeErrorView(apiError(400, "VALIDATION_ERROR", "topic: Too big: expected string to have <=300 characters"), "ES");
    // Sin el prefijo "topic: " (el mensaje ya se muestra junto al campo).
    expect(view).toEqual({ field: "topic", message: "Too big: expected string to have <=300 characters", detail: null });
  });

  it("400 VALIDATION_ERROR de language va junto al selector, sin el prefijo", () => {
    const view = createEpisodeErrorView(apiError(400, "VALIDATION_ERROR", 'language: Invalid option: expected one of "ES"|"EN"|"PT"'), "ES");
    expect(view.field).toBe("language");
    expect(view.message).toBe('Invalid option: expected one of "ES"|"EN"|"PT"');
  });

  it("400 VALIDATION_ERROR sin campo reconocible va entero al error general", () => {
    expect(createEpisodeErrorView(apiError(400, "VALIDATION_ERROR", "Payload inválido."), "ES")).toEqual({
      field: "form",
      message: "Payload inválido.",
      detail: null,
    });
    expect(createEpisodeErrorView(apiError(400, "VALIDATION_ERROR", ": sin path"), "ES").field).toBe("form");
    expect(createEpisodeErrorView(apiError(400, "VALIDATION_ERROR", "otro: algo"), "ES").message).toBe("otro: algo");
  });
});

describe("parseValidationError (N2)", () => {
  it("separa en el primer ':' y conserva los ':' del mensaje", () => {
    expect(parseValidationError("topic: a: b")).toEqual({ field: "topic", message: "a: b" });
  });

  it("un campo conocido sin mensaje queda entero en el error general", () => {
    expect(parseValidationError("topic:")).toEqual({ field: "form", message: "topic:" });
    expect(parseValidationError("topic:   ")).toEqual({ field: "form", message: "topic:   " });
  });

  it("un issue sin path (\": …\", clave de más en .strict()) va al error general sin el prefijo vacío", () => {
    expect(parseValidationError(': Unrecognized key: "extra"')).toEqual({ field: "form", message: 'Unrecognized key: "extra"' });
    expect(parseValidationError("  :  algo")).toEqual({ field: "form", message: "algo" });
    // Solo ":" sin mensaje: se deja como vino, no queda vacío.
    expect(parseValidationError(":")).toEqual({ field: "form", message: ":" });
  });

  it("un path anidado o desconocido no se recorta", () => {
    expect(parseValidationError("topic.x: algo")).toEqual({ field: "form", message: "topic.x: algo" });
  });

  it("un 409 con otro código no se confunde con VOICE_NOT_CONFIGURED", () => {
    const view = createEpisodeErrorView(apiError(409, "INVALID_STATE_TRANSITION", "No se puede."), "EN");
    expect(view.field).toBe("form");
    expect(view.message).toBe("No se pudo crear el episodio. No se puede.");
  });

  it("cualquier otro error: genérico con el mensaje del envelope (AC 3.25)", () => {
    const view = createEpisodeErrorView(apiError(500, "INTERNAL_ERROR", "Error interno del servidor."), "ES");
    expect(view).toEqual({ field: "form", message: "No se pudo crear el episodio. Error interno del servidor.", detail: null });
  });

  it("una falla de red (sin respuesta) da un mensaje legible, no el error crudo", () => {
    const view = createEpisodeErrorView(new TypeError("Failed to fetch"), "ES");
    expect(view.field).toBe("form");
    expect(view.message).not.toContain("Failed to fetch");
    expect(view.message).toContain("No se pudo crear el episodio.");
  });
});
