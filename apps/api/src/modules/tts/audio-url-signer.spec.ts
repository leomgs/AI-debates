import { signAudioUrl, verifyAudioUrlSignature } from './audio-url-signer';

const SECRET = 'test-secret';
const STORAGE_KEY = 'episode-1/asset-1.wav';

describe('audio-url-signer', () => {
  it('una firma recién generada, sin expirar, verifica correctamente', () => {
    const expiresAt = Date.now() + 60_000;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, sig)).toBe(true);
  });

  it('rechaza una URL ya expirada aunque la firma sea válida', () => {
    const expiresAt = Date.now() - 1;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, sig)).toBe(false);
  });

  it('rechaza si el storageKey fue alterado (no se puede reusar la firma para otro archivo)', () => {
    const expiresAt = Date.now() + 60_000;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature(SECRET, 'episode-1/otro.wav', expiresAt, sig)).toBe(false);
  });

  it('rechaza si expiresAt fue alterado (extender la vigencia invalida la firma)', () => {
    const expiresAt = Date.now() + 60_000;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt + 3_600_000, sig)).toBe(false);
  });

  it('rechaza con el secreto equivocado', () => {
    const expiresAt = Date.now() + 60_000;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature('otro-secret', STORAGE_KEY, expiresAt, sig)).toBe(false);
  });

  it('rechaza una firma no-hex o truncada sin lanzar', () => {
    const expiresAt = Date.now() + 60_000;
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, 'no-es-hex')).toBe(false);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, 'ab')).toBe(false);
  });

  it('rechaza la firma con un sufijo no hex o en mayúsculas (Buffer.from(hex) lo toleraba)', () => {
    const expiresAt = Date.now() + 60_000;
    const sig = signAudioUrl(SECRET, STORAGE_KEY, expiresAt);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, `${sig}zz`)).toBe(false);
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, expiresAt, sig.toUpperCase())).toBe(false);
  });

  it('rechaza expiresAt no numérico (NaN) sin lanzar', () => {
    expect(verifyAudioUrlSignature(SECRET, STORAGE_KEY, NaN, 'cualquier-cosa')).toBe(false);
  });
});
