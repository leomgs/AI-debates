import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Hash de contraseña con scrypt de node:crypto (ADR 0001 punto 2), sin
// dependencias externas. Formato autocontenido, para que CURATOR_PASSWORD_HASH
// lleve todo lo necesario para verificar sin configuración aparte:
//
//   scrypt:<N>:<r>:<p>:<sal en base64url>:<hash en base64url>
//
// Separador ":" y no "$" (el formato típico de crypt/PHC) porque "$" dispara
// expansión de variables en shells, docker-compose y algunos parsers de .env.
// base64url no usa ":", así que el split es inequívoco. Los parámetros viajan
// con el hash: se pueden subir en el futuro sin invalidar hashes viejos.
//
// Se genera con `pnpm --filter @ai-trend-debates/api auth:hash-password`
// (scripts/hash-password.ts, ver setup.md).

const PREFIX = "scrypt";
const DEFAULT_PARAMS = { N: 16_384, r: 8, p: 1 } as const; // 2^14: ~16 MiB y decenas de ms por intento
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Techos defensivos al parsear: un hash con N o r absurdos haría que cada
// login reserve memoria sin límite. No es un input externo (sale del .env),
// pero un typo no debería tumbar el proceso en el primer login.
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;
const MIN_SALT_BYTES = 16;
const MIN_KEY_BYTES = 32;

export interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

// scrypt usa 128 * N * r bytes; el default de maxmem de Node (32 MiB) no
// alcanza para los N más altos que el parser acepta.
function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

function parsePositiveInt(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

// Devuelve undefined si el string no respeta el formato: lo usa EnvSchema
// para fallar al arrancar con un mensaje claro, en vez de en el primer login.
export function parsePasswordHash(encoded: string): ParsedPasswordHash | undefined {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== PREFIX) return undefined;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = parsePositiveInt(nRaw);
  const r = parsePositiveInt(rRaw);
  const p = parsePositiveInt(pRaw);
  if (N === undefined || r === undefined || p === undefined) return undefined;
  // N tiene que ser potencia de 2 mayor que 1 (requisito de scrypt).
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r > MAX_R || p > MAX_P) return undefined;

  const base64url = /^[A-Za-z0-9_-]+$/;
  if (!base64url.test(saltRaw) || !base64url.test(hashRaw)) return undefined;
  const salt = Buffer.from(saltRaw, "base64url");
  const hash = Buffer.from(hashRaw, "base64url");
  if (salt.length < MIN_SALT_BYTES || hash.length < MIN_KEY_BYTES) return undefined;

  return { N, r, p, salt, hash };
}

export function isValidPasswordHash(encoded: string): boolean {
  return parsePasswordHash(encoded) !== undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_BYTES, { N, r, p, maxmem: maxmemFor(N, r) });
  return [PREFIX, N, r, p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

// Comparación en tiempo constante (timingSafeEqual) contra el hash derivado
// con la misma sal y parámetros. Un hash almacenado con formato inválido es
// un error de configuración, no una contraseña incorrecta: lanza.
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) throw new Error("El hash de contraseña no tiene el formato scrypt:<N>:<r>:<p>:<sal>:<hash>.");

  const { N, r, p, salt, hash } = parsed;
  const derived = await scryptAsync(password, salt, hash.length, { N, r, p, maxmem: maxmemFor(N, r) });
  return timingSafeEqual(derived, hash);
}
