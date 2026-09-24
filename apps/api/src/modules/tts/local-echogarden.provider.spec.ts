// echogarden es el borde real con el motor de síntesis — se mockea acá,
// nunca se corre una síntesis real en tests (jest-testing skill: "mock at
// the SDK call boundary"). EchogardenAudioProvider lo carga con un import
// dinámico dentro de synthesize(), pero jest.mock intercepta igual —
// Jest hookea la resolución del módulo, no la sintaxis de import usada.
const mockSynthesize = jest.fn();
jest.mock('echogarden', () => ({
  synthesize: (...args: unknown[]) => mockSynthesize(...args),
}));

import { EchogardenAudioProvider } from './local-echogarden.provider';
import { TtsProviderUnavailableError } from './tts.errors';

describe('EchogardenAudioProvider', () => {
  let provider: EchogardenAudioProvider;

  beforeEach(() => {
    mockSynthesize.mockReset();
    provider = new EchogardenAudioProvider();
  });

  it('llama al engine "vits" con el voiceId dado y codifica el RawAudio devuelto a WAV con duración real', async () => {
    const sampleRate = 22050;
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    mockSynthesize.mockResolvedValue({
      audio: { audioChannels: [samples], sampleRate },
      timeline: [],
      language: 'es-ES',
      voice: 'es_ES-davefx-medium',
    });

    const result = await provider.synthesize('Hola, esto es una prueba.', 'es_ES-davefx-medium');

    expect(mockSynthesize).toHaveBeenCalledWith('Hola, esto es una prueba.', {
      engine: 'vits',
      voice: 'es_ES-davefx-medium',
    });
    expect(result.mimeType).toBe('audio/wav');
    // duración exacta derivada de sampleCount/sampleRate, no estimada
    // (Feature 7 exige duración real — decision-log.md #20).
    expect(result.durationMs).toBe(Math.round((samples.length / sampleRate) * 1000));
    expect(result.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.audioBuffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
    // 44 bytes de header WAV + 5 muestras mono de 16 bits (2 bytes c/u).
    expect(result.audioBuffer.length).toBe(44 + samples.length * 2);
    expect(result.subtitles).toEqual([]);
  });

  it('extrae subtitles a partir del timeline jerárquico real (segment > sentence > word > token > phone), Feature 7', async () => {
    mockSynthesize.mockResolvedValue({
      audio: { audioChannels: [new Float32Array([0, 0])], sampleRate: 22050 },
      // Shape real confirmado corriendo echogarden.synthesize() a mano
      // (ver comentario de extractWordSubtitles) — tiempos en segundos,
      // anidado, con niveles intermedios (token/phone) que no son 'word'.
      timeline: [
        {
          type: 'segment',
          text: 'Hola mundo',
          startTime: 0,
          endTime: 1,
          timeline: [
            {
              type: 'sentence',
              text: 'Hola mundo',
              startTime: 0,
              endTime: 1,
              timeline: [
                {
                  type: 'word',
                  text: 'Hola',
                  startTime: 0,
                  endTime: 0.4,
                  timeline: [{ type: 'token', text: 'ola', startTime: 0, endTime: 0.4 }],
                },
                { type: 'word', text: 'mundo', startTime: 0.45, endTime: 1 },
              ],
            },
          ],
        },
      ],
      language: 'es-ES',
      voice: 'es_ES-davefx-medium',
    });

    const result = await provider.synthesize('Hola mundo', 'es_ES-davefx-medium');

    expect(result.subtitles).toEqual([
      { text: 'Hola', startMs: 0, endMs: 400 },
      { text: 'mundo', startMs: 450, endMs: 1000 },
    ]);
  });

  it('envuelve cualquier falla del motor en TtsProviderUnavailableError (coding-rules.md §5)', async () => {
    mockSynthesize.mockRejectedValue(new Error('modelo de voz no encontrado'));

    await expect(provider.synthesize('Hola', 'voz-inexistente')).rejects.toThrow(TtsProviderUnavailableError);
  });
});
