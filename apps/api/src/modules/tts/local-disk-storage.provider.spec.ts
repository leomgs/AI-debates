import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { verifyAudioUrlSignature } from './audio-url-signer';

const SIGNING_SECRET = 'test-secret';
const CONFIG_VALUES: Record<string, unknown> = {
  AUDIO_STORAGE_DIR: '', // seteado en beforeEach con el baseDir real
  AUDIO_SIGNING_SECRET: SIGNING_SECRET,
  AUDIO_URL_TTL_SECONDS: 300,
};

// Operaciones de FS reales sobre un directorio temporal único por corrida —
// más simple y confiable que mockear node:fs/promises a mano para un
// provider que es, en esencia, un wrapper fino sobre 3 llamadas de FS
// (mismo criterio que episodes.integration.spec.ts usa una sqlite real en
// vez de mockear Prisma para ese caso).
describe('LocalDiskStorageProvider', () => {
  const baseDir = join(tmpdir(), `tts-storage-test-${randomUUID()}`);
  let provider: LocalDiskStorageProvider;

  beforeEach(() => {
    CONFIG_VALUES.AUDIO_STORAGE_DIR = baseDir;
    const config = { get: jest.fn((key: string) => CONFIG_VALUES[key]) };
    provider = new LocalDiskStorageProvider(config as never);
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('save() crea los subdirectorios que hagan falta y escribe el buffer bajo AUDIO_STORAGE_DIR', async () => {
    const storageKey = 'episode-1/asset-1.wav';
    await provider.save(storageKey, Buffer.from('contenido de audio'));

    const written = await readFile(join(baseDir, storageKey));
    expect(written.toString()).toBe('contenido de audio');
  });

  it('delete() borra el archivo si existe', async () => {
    const storageKey = 'episode-2/asset-2.wav';
    await provider.save(storageKey, Buffer.from('a borrar'));

    await provider.delete(storageKey);

    await expect(readFile(join(baseDir, storageKey))).rejects.toThrow();
  });

  it('delete() no lanza si el archivo no existe (no bloquea regenerateSegment por un cleanup best-effort)', async () => {
    await expect(provider.delete('nunca-existio/asset.wav')).resolves.toBeUndefined();
  });

  describe('getSignedUrl()', () => {
    it('devuelve una URL bajo /audio-files con storageKey, expires y una firma que verifica correctamente', async () => {
      const before = Date.now();
      const url = await provider.getSignedUrl('episode-1/asset-1.wav');
      const parsed = new URL(url, 'http://localhost');

      expect(parsed.pathname).toBe('/audio-files/episode-1/asset-1.wav');
      const expiresAt = Number(parsed.searchParams.get('expires'));
      const sig = parsed.searchParams.get('sig')!;
      expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000);
      expect(verifyAudioUrlSignature(SIGNING_SECRET, 'episode-1/asset-1.wav', expiresAt, sig)).toBe(true);
    });

    it('usa expiresInSeconds explícito en vez del default de AUDIO_URL_TTL_SECONDS', async () => {
      const before = Date.now();
      const url = await provider.getSignedUrl('episode-1/asset-1.wav', 10);
      const parsed = new URL(url, 'http://localhost');
      const expiresAt = Number(parsed.searchParams.get('expires'));

      expect(expiresAt).toBeLessThan(before + 300_000);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 10_000);
    });

    it('una firma para OTRO storageKey no verifica (no se puede reusar la URL de un audio para otro)', async () => {
      const url = await provider.getSignedUrl('episode-1/asset-1.wav');
      const parsed = new URL(url, 'http://localhost');
      const expiresAt = Number(parsed.searchParams.get('expires'));
      const sig = parsed.searchParams.get('sig')!;

      expect(verifyAudioUrlSignature(SIGNING_SECRET, 'episode-1/asset-OTRO.wav', expiresAt, sig)).toBe(false);
    });
  });
});
