import { signHmacSha256, verifyHmacSha256 } from "./hmac-signature";

describe("hmac-signature", () => {
  it("verifica una firma recién generada con el mismo secreto y payload", () => {
    const sig = signHmacSha256("secreto", "payload");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyHmacSha256("secreto", "payload", sig)).toBe(true);
  });

  it("rechaza si cambia el payload o el secreto", () => {
    const sig = signHmacSha256("secreto", "payload");
    expect(verifyHmacSha256("secreto", "payload-alterado", sig)).toBe(false);
    expect(verifyHmacSha256("otro-secreto", "payload", sig)).toBe(false);
  });

  it("rechaza una firma no-hex, truncada o vacía sin lanzar", () => {
    const sig = signHmacSha256("secreto", "payload");
    expect(verifyHmacSha256("secreto", "payload", "no-es-hex")).toBe(false);
    expect(verifyHmacSha256("secreto", "payload", sig.slice(0, 10))).toBe(false);
    expect(verifyHmacSha256("secreto", "payload", "")).toBe(false);
  });
});
