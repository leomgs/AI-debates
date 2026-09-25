import { SESSION_TTL_MS, checkSessionToken, issueSessionToken } from "./session-token";

const SECRET = "test-session-secret-0123456789abcdef";
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

describe("session-token", () => {
  it("emite un token <exp>.<firma> que vence a los 7 días", () => {
    const { token, expiresAt } = issueSessionToken(SECRET, NOW);
    expect(expiresAt).toBe(NOW + SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(token).toMatch(new RegExp(`^${expiresAt}\\.[0-9a-f]{64}$`));
  });

  it("un token recién emitido es válido hasta un instante antes del vencimiento", () => {
    const { token, expiresAt } = issueSessionToken(SECRET, NOW);
    expect(checkSessionToken(SECRET, token, NOW)).toEqual({ valid: true, expiresAt });
    expect(checkSessionToken(SECRET, token, expiresAt - 1)).toEqual({ valid: true, expiresAt });
  });

  it("rechaza un token vencido aunque la firma sea válida", () => {
    const { token, expiresAt } = issueSessionToken(SECRET, NOW);
    expect(checkSessionToken(SECRET, token, expiresAt)).toEqual({ valid: false });
    expect(checkSessionToken(SECRET, token, expiresAt + 1)).toEqual({ valid: false });
  });

  it("rechaza un token con el vencimiento alterado (extender la sesión invalida la firma)", () => {
    const { token } = issueSessionToken(SECRET, NOW);
    const [, signature] = token.split(".");
    const extended = `${NOW + 10 * SESSION_TTL_MS}.${signature}`;
    expect(checkSessionToken(SECRET, extended, NOW)).toEqual({ valid: false });
  });

  it("rechaza un token con la firma alterada o firmado con otro secreto", () => {
    const { token } = issueSessionToken(SECRET, NOW);
    const [exp, signature] = token.split(".");
    const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
    expect(checkSessionToken(SECRET, `${exp}.${flipped}`, NOW)).toEqual({ valid: false });
    expect(checkSessionToken("otro-secreto-0123456789abcdef0123", token, NOW)).toEqual({ valid: false });
  });

  it.each(["", "sin-punto", "1.2.3", "abc.def", `${NOW}.`, `.${"a".repeat(64)}`, `-1.${"a".repeat(64)}`])(
    "rechaza un token mal formado sin lanzar: %p",
    (malformed) => {
      expect(checkSessionToken(SECRET, malformed, NOW)).toEqual({ valid: false });
    }
  );
});
