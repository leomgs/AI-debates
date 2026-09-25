import { hashPassword, isValidPasswordHash, parsePasswordHash, verifyPassword } from "./scrypt-password";

describe("scrypt-password", () => {
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword("contraseña-correcta");
  });

  it("genera un hash autocontenido con parámetros, sal y hash", () => {
    expect(hash).toMatch(/^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const parsed = parsePasswordHash(hash);
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.hash.length).toBe(64);
  });

  it("usa una sal distinta en cada hash de la misma contraseña", async () => {
    expect(await hashPassword("contraseña-correcta")).not.toBe(hash);
  });

  it("verifica la contraseña correcta y rechaza una incorrecta", async () => {
    await expect(verifyPassword("contraseña-correcta", hash)).resolves.toBe(true);
    await expect(verifyPassword("contraseña-incorrecta", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("rechaza formatos inválidos al parsear", () => {
    const [, , , , salt, key] = hash.split(":");
    expect(isValidPasswordHash("")).toBe(false);
    expect(isValidPasswordHash("texto-plano")).toBe(false);
    expect(isValidPasswordHash(`bcrypt:16384:8:1:${salt}:${key}`)).toBe(false);
    expect(isValidPasswordHash(`scrypt:1000:8:1:${salt}:${key}`)).toBe(false); // N no es potencia de 2
    expect(isValidPasswordHash(`scrypt:${2 ** 21}:8:1:${salt}:${key}`)).toBe(false); // N fuera de techo
    expect(isValidPasswordHash(`scrypt:16384:8:1:${salt}`)).toBe(false); // falta el hash
    expect(isValidPasswordHash(`scrypt:16384:8:1:abc:${key}`)).toBe(false); // sal corta
    expect(isValidPasswordHash(`scrypt:16384:8:1:${salt}:${key}$`)).toBe(false); // caracter fuera de base64url
    expect(isValidPasswordHash(hash)).toBe(true);
  });

  it("lanza si el hash almacenado es inválido (error de configuración, no credencial incorrecta)", async () => {
    await expect(verifyPassword("x", "no-es-un-hash")).rejects.toThrow(/formato/);
  });
});
