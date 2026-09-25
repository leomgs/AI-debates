import { hashPassword, isValidPasswordHash, parsePasswordHash, verifyPassword } from "./scrypt-password";

describe("scrypt-password", () => {
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword("contraseña-correcta");
  });

  it("genera un hash autocontenido con parámetros, sal y hash", () => {
    expect(hash).toMatch(/^scrypt:65536:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
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
    expect(isValidPasswordHash(`scrypt:${2 ** 21}:8:1:${salt}:${key}`)).toBe(false); // 128·N·r = 2 GiB
    expect(isValidPasswordHash(`scrypt:${2 ** 17}:32:1:${salt}:${key}`)).toBe(false); // 512 MiB: N y r juntos
    expect(isValidPasswordHash(`scrypt:${2 ** 20}:4096:1:${salt}:${key}`)).toBe(false); // lo que antes llegaba a 4 GiB
    expect(isValidPasswordHash(`scrypt:16384:8:17:${salt}:${key}`)).toBe(false); // p fuera de techo
    expect(isValidPasswordHash(`scrypt:${2 ** 18}:8:1:${salt}:${key}`)).toBe(true); // exactamente 256 MiB
    expect(isValidPasswordHash(`scrypt:16384:8:1:${salt}`)).toBe(false); // falta el hash
    expect(isValidPasswordHash(`scrypt:16384:8:1:abc:${key}`)).toBe(false); // sal corta
    expect(isValidPasswordHash(`scrypt:16384:8:1:${salt}:${key}$`)).toBe(false); // caracter fuera de base64url
    expect(isValidPasswordHash(hash)).toBe(true);
  });

  it("un hash viejo con N=2^14 sigue verificando (los parámetros viajan en el hash)", async () => {
    // Hash de "test-password" generado con el default anterior (N=2^14).
    const legacy =
      "scrypt:16384:8:1:_9YJqs4PlFzDq1FBH0ZrMw:YU4EDvCZx4gNmnpcMxmlvdEbIz694zQ7qmQcgAYqQtCl4ndZ8h6_X67Yb_1s6kxIjr8FGM9HvDxyTMUGz4_mGA";
    await expect(verifyPassword("test-password", legacy)).resolves.toBe(true);
    await expect(verifyPassword("otra", legacy)).resolves.toBe(false);
  });

  it("lanza si el hash almacenado es inválido (error de configuración, no credencial incorrecta)", async () => {
    await expect(verifyPassword("x", "no-es-un-hash")).rejects.toThrow(/formato/);
  });
});
