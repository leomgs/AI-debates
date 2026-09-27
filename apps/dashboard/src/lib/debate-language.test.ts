import { describe, expect, it } from "vitest";
import {
  DEBATE_LANGUAGES,
  DEBATE_LANGUAGE_LABELS,
  DEFAULT_DEBATE_LANGUAGE,
  debateLanguageLabel,
  parseDebateLanguage,
} from "./debate-language";

describe("idioma del debate (spec 003, Mapeo de estados a UI)", () => {
  it("etiquetas de la spec", () => {
    expect(DEBATE_LANGUAGE_LABELS).toEqual({ ES: "Español", EN: "English", PT: "Português" });
    expect(debateLanguageLabel("PT")).toBe("Português");
  });

  it("opciones del selector en el orden de la spec, con Español por defecto (AC 3.22)", () => {
    expect(DEBATE_LANGUAGES).toEqual(["ES", "EN", "PT"]);
    expect(DEFAULT_DEBATE_LANGUAGE).toBe("ES");
  });

  it("parseDebateLanguage solo acepta valores del enum", () => {
    expect(parseDebateLanguage("EN")).toBe("EN");
    expect(parseDebateLanguage("en")).toBeNull();
    expect(parseDebateLanguage("FR")).toBeNull();
    expect(parseDebateLanguage("")).toBeNull();
  });
});
