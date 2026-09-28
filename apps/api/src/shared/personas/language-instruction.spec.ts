import { RoundType } from "../contracts/agents.contracts";
import { DEBATER_PERSONAS, JUDGE, buildDebaterSystemPrompt, buildJudgeSystemPrompt } from "./agents.personas";
import { buildLanguageInstruction, describeLanguage, editorialViolationFallback } from "./language-instruction";
import { VOSEO } from "./voseo.test-helper";

const LANGUAGES = ["ES", "EN", "PT"] as const;
const ROUNDS = RoundType.options;

describe("buildLanguageInstruction (spec 004, D11)", () => {
  it("ES nombra la variante: neutro latinoamericano, tuteo y sin regionalismos (AC 4.27)", () => {
    const es = buildLanguageInstruction("ES");
    expect(es).toContain("español neutro latinoamericano");
    expect(es).toContain("tuteo");
    expect(es).toContain("sin regionalismos");
  });

  it("cada idioma tiene una sola línea, distinta, redactada en el idioma de destino", () => {
    expect(buildLanguageInstruction("EN")).toBe("Write all of your text in American English (en-US).");
    expect(buildLanguageInstruction("PT")).toBe("Escreva todo o seu texto em português do Brasil (pt-BR).");
    const lines = LANGUAGES.map(buildLanguageInstruction);
    expect(new Set(lines).size).toBe(LANGUAGES.length);
    for (const line of lines) expect(line).not.toContain("\n");
  });

  it("describeLanguage da el nombre en español con la variante de D5", () => {
    expect(describeLanguage("ES")).toBe("español neutro latinoamericano");
    expect(describeLanguage("EN")).toContain("en-US");
    expect(describeLanguage("PT")).toContain("pt-BR");
  });
});

describe("system prompts de debatientes y juez (spec 004)", () => {
  it.each(LANGUAGES)("en %s terminan con la instrucción de idioma como regla (AC 4.6)", (language) => {
    for (const persona of Object.values(DEBATER_PERSONAS)) {
      for (const round of ROUNDS) {
        const system = buildDebaterSystemPrompt(persona, round, language, DEBATER_PERSONAS.CONTRARIAN);
        expect(system.split("\n\n").at(-1)).toBe(buildLanguageInstruction(language));
      }
    }
    expect(buildJudgeSystemPrompt(JUDGE, language).split("\n\n").at(-1)).toBe(buildLanguageInstruction(language));
  });

  it("no tienen voseo en ninguna persona, ronda ni idioma (AC 4.26)", () => {
    for (const language of LANGUAGES) {
      for (const persona of Object.values(DEBATER_PERSONAS)) {
        for (const round of ROUNDS) {
          expect(buildDebaterSystemPrompt(persona, round, language, DEBATER_PERSONAS.PROVOCATEUR)).not.toMatch(VOSEO);
        }
      }
      expect(buildJudgeSystemPrompt(JUDGE, language)).not.toMatch(VOSEO);
    }
  });

  it("el patrón de voseo sí detecta las formas viejas (control del test anterior)", () => {
    expect("Sos Analyst.").toMatch(VOSEO);
    expect("Reglas que no podés romper").toMatch(VOSEO);
    expect("presentá tu posición").toMatch(VOSEO);
    expect("Asegurate de citar la fuente y mantené el tono.").toMatch(VOSEO);
    expect("Eres Analyst. Presenta tu posición.").not.toMatch(VOSEO);
  });

  // AC 4.9: ningún texto de persona inyectado en los prompts trae frases
  // literales entre comillas o preguntas en español que el modelo pueda
  // copiar tal cual a una salida en otro idioma.
  // Incluye al juez (review de 13.5, N1): sus criterios y reglas también se
  // inyectan en el system prompt.
  it("ningún texto de persona, ni del juez, contiene frases literales citadas (AC 4.9)", () => {
    const texts = [
      ...Object.values(DEBATER_PERSONAS).flatMap((persona) => [
        persona.coreStance,
        persona.argumentStyle,
        persona.crossExaminationStyle,
        persona.voice,
        ...persona.editorialRules.forbidden,
        ...persona.editorialRules.required,
      ]),
      ...JUDGE.evaluationCriteria,
      ...JUDGE.editorialRules.forbidden,
      ...JUDGE.editorialRules.required,
    ];
    for (const text of texts) expect(text).not.toMatch(/['"“”‘’«»¿]/);
  });
});

describe("editorialViolationFallback (spec 004, D7)", () => {
  it("devuelve el respaldo del filtro editorial en el idioma del episodio", () => {
    expect(editorialViolationFallback("ES")).toBe("Violación de reglas editoriales.");
    expect(editorialViolationFallback("EN")).toBe("Editorial rules violation.");
    expect(editorialViolationFallback("PT")).toBe("Violação das regras editoriais.");
  });
});
