import { DEFAULT_AUDIO_SIGNING_SECRET, validateEnv } from "./env.schema";

// Hash scrypt válido (formato de shared/crypto/scrypt-password.ts).
const VALID_HASH =
  "scrypt:16384:8:1:_9YJqs4PlFzDq1FBH0ZrMw:YU4EDvCZx4gNmnpcMxmlvdEbIz694zQ7qmQcgAYqQtCl4ndZ8h6_X67Yb_1s6kxIjr8FGM9HvDxyTMUGz4_mGA";

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "file:./test.db",
    GOOGLE_API_KEY: "k",
    TAVILY_API_KEY: "k",
    CURATOR_USERNAME: "curador",
    CURATOR_PASSWORD_HASH: VALID_HASH,
    SESSION_SECRET: "s".repeat(32),
    ...overrides,
  };
}

describe("validateEnv (API-8)", () => {
  it("acepta un entorno completo", () => {
    const env = validateEnv(baseEnv());
    expect(env.NODE_ENV).toBe("development");
    expect(env.CURATOR_USERNAME).toBe("curador");
  });

  it.each(["NODE_ENV", "CURATOR_USERNAME", "CURATOR_PASSWORD_HASH", "SESSION_SECRET"])("falla si falta %s (sin default)", (key) => {
    expect(() => validateEnv(baseEnv({ [key]: undefined }))).toThrow(key);
  });

  it("falla si NODE_ENV no es uno de los tres valores", () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: "prod" }))).toThrow(/NODE_ENV/);
  });

  it("falla si CURATOR_PASSWORD_HASH no tiene el formato scrypt", () => {
    expect(() => validateEnv(baseEnv({ CURATOR_PASSWORD_HASH: "contraseña-en-texto-plano" }))).toThrow(/CURATOR_PASSWORD_HASH.*scrypt/);
  });

  it("falla si SESSION_SECRET es demasiado corto", () => {
    expect(() => validateEnv(baseEnv({ SESSION_SECRET: "corto" }))).toThrow(/SESSION_SECRET/);
  });

  it("en producción falla si AUDIO_SIGNING_SECRET conserva el default (explícito u omitido)", () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: "production" }))).toThrow(/AUDIO_SIGNING_SECRET/);
    expect(() => validateEnv(baseEnv({ NODE_ENV: "production", AUDIO_SIGNING_SECRET: DEFAULT_AUDIO_SIGNING_SECRET }))).toThrow(
      /AUDIO_SIGNING_SECRET/
    );
  });

  // Spec 004, AC 4.24 (D16): mientras Echogarden sea el único motor, el
  // proceso no arranca con otro TTS_PROVIDER, y el mensaje dice por qué.
  it("acepta TTS_PROVIDER LOCAL, explícito u omitido (default)", () => {
    expect(validateEnv(baseEnv()).TTS_PROVIDER).toBe("LOCAL");
    expect(validateEnv(baseEnv({ TTS_PROVIDER: "LOCAL" })).TTS_PROVIDER).toBe("LOCAL");
  });

  it.each(["GOOGLE_TTS", "OPENROUTER"])("falla con TTS_PROVIDER=%s y explica que solo hay motor LOCAL (AC 4.24)", (provider) => {
    expect(() => validateEnv(baseEnv({ TTS_PROVIDER: provider }))).toThrow(
      new RegExp(`TTS_PROVIDER: "${provider}" no está soportado: el único motor de TTS implementado es el local \\(Echogarden\\)`)
    );
  });

  it("falla con un TTS_PROVIDER fuera del enum", () => {
    expect(() => validateEnv(baseEnv({ TTS_PROVIDER: "CHATTERBOX" }))).toThrow(/TTS_PROVIDER/);
  });

  it("en producción acepta un AUDIO_SIGNING_SECRET propio, y fuera de producción acepta el default", () => {
    expect(validateEnv(baseEnv({ NODE_ENV: "production", AUDIO_SIGNING_SECRET: "secreto-propio" })).NODE_ENV).toBe("production");
    expect(validateEnv(baseEnv({ NODE_ENV: "development" })).AUDIO_SIGNING_SECRET).toBe(DEFAULT_AUDIO_SIGNING_SECRET);
  });
});
