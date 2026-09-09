import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';

// Operaciones de FS reales sobre un directorio temporal único por corrida —
// más simple y confiable que mockear node:fs/promises a mano para un
// provider que es, en esencia, un wrapper fino sobre 3 llamadas de FS
// (mismo criterio que episodes.integration.spec.ts usa una sqlite real en
// vez de mockear Prisma para ese caso).
describe('LocalDiskStorageProvider', () => {
  const baseDir = join(tmpdir(), `tts-storage-test-${randomUUID()}`);
  let provider: LocalDiskStorageProvider;

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue(baseDir) };
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

  it('getSignedUrl() todavía no está implementado (etapa 3 de TTS)', async () => {
    await expect(provider.getSignedUrl('episode-1/asset-1.wav')).rejects.toThrow('todavía no implementado');
  });
});
