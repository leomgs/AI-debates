import { RenderService, BuildManifestInput } from './render.service';
import { ManifestNotReadyError } from './render.errors';
import { RemotionManifestSchema } from '@ai-trend-debates/contracts';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';
const JUDGE = 'agent-judge';

function baseInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    episodeId: EPISODE_ID,
    topic: '¿La IA reemplazará a los programadores?',
    language: 'ES',
    // Ids de voz visiblemente ficticios (spec 004, D14). El juez no tiene
    // segmentos, así que no tiene voz guardada: null (D17 revisado).
    participants: [
      { agentId: AGENT_A, name: 'Analyst', avatarUrl: 'https://cdn/analyst.png', voiceId: 'test-es-analyst' },
      { agentId: AGENT_B, name: 'Contrarian', avatarUrl: null, voiceId: 'test-es-contrarian' },
      { agentId: JUDGE, name: 'Judge', avatarUrl: null, voiceId: null },
    ],
    officialArguments: [
      {
        agentId: AGENT_A,
        content: 'Primer argumento.',
        audioAssetId: 'audio-1',
        durationMs: 4000,
        subtitles: [{ text: 'Primer', startMs: 0, endMs: 500 }],
      },
      {
        agentId: AGENT_B,
        content: 'Segundo argumento.',
        audioAssetId: 'audio-2',
        durationMs: 3000,
        subtitles: null,
      },
    ],
    verdict: { winnerId: AGENT_A, content: 'Analyst ganó por mejor evidencia.' },
    ...overrides,
  };
}

describe('RenderService.buildManifest (Feature 7)', () => {
  let service: RenderService;

  beforeEach(() => {
    service = new RenderService();
  });

  it('arma el RemotionManifest completo con sequenceIndex derivado de la posición (1-based)', () => {
    const manifest = service.buildManifest(baseInput());

    expect(manifest.episodeId).toBe(EPISODE_ID);
    expect(manifest.meta).toEqual({ topic: baseInput().topic, language: 'ES', durationEstimatedSec: 7 }); // (4000+3000)/1000
    expect(manifest.agents).toEqual([
      { id: AGENT_A, name: 'Analyst', avatarUrl: 'https://cdn/analyst.png', voiceId: 'test-es-analyst' },
      { id: AGENT_B, name: 'Contrarian', avatarUrl: null, voiceId: 'test-es-contrarian' },
      { id: JUDGE, name: 'Judge', avatarUrl: null, voiceId: null },
    ]);
    expect(manifest.timeline).toEqual([
      {
        sequenceIndex: 1,
        agentId: AGENT_A,
        text: 'Primer argumento.',
        audioAssetId: 'audio-1',
        durationMs: 4000,
        subtitles: [{ text: 'Primer', startMs: 0, endMs: 500 }],
      },
      {
        sequenceIndex: 2,
        agentId: AGENT_B,
        text: 'Segundo argumento.',
        audioAssetId: 'audio-2',
        durationMs: 3000,
        subtitles: [], // null -> [] (provider sin timing por palabra, ej. futuro Google/OpenRouter)
      },
    ]);
    expect(manifest.verdict).toEqual({ winnerAgentId: AGENT_A, summary: 'Analyst ganó por mejor evidencia.' });
  });

  it('no incluye audioUrl (lo resuelve EpisodesService después, no este método puro)', () => {
    const manifest = service.buildManifest(baseInput());
    expect(manifest.timeline[0].audioUrl).toBeUndefined();
  });

  it('tira ManifestNotReadyError si falta el Verdict', () => {
    expect(() => service.buildManifest(baseInput({ verdict: null }))).toThrow(ManifestNotReadyError);
  });

  it('tira ManifestNotReadyError si algún Argument OFFICIAL todavía no tiene AudioAsset', () => {
    const input = baseInput();
    input.officialArguments[1].audioAssetId = null;
    input.officialArguments[1].durationMs = null;

    expect(() => service.buildManifest(input)).toThrow(ManifestNotReadyError);
  });

  // Review de 13.6 (M1): EpisodesService la llama antes de resolver voces.
  describe('assertManifestReady', () => {
    it('no tira con veredicto y audio en todos los segmentos', () => {
      expect(() => service.assertManifestReady(baseInput())).not.toThrow();
    });

    it('tira ManifestNotReadyError sin veredicto', () => {
      expect(() => service.assertManifestReady(baseInput({ verdict: null }))).toThrow(ManifestNotReadyError);
    });

    it('tira ManifestNotReadyError si algún segmento no tiene audio o duración', () => {
      const input = baseInput();
      input.officialArguments[0].durationMs = null;
      expect(() => service.assertManifestReady(input)).toThrow(ManifestNotReadyError);
    });
  });

  it('verdict.winnerAgentId es null si el debate no tuvo ganador (Verdict.winnerId opcional)', () => {
    const manifest = service.buildManifest(baseInput({ verdict: { winnerId: null, content: 'Empate técnico.' } }));
    expect(manifest.verdict.winnerAgentId).toBeNull();
  });

  // Spec 004, AC 4.18: meta.language sale del idioma del episodio que recibe,
  // no de un valor fijo.
  it('meta.language es el language del input', () => {
    expect(service.buildManifest(baseInput({ language: 'EN' })).meta.language).toBe('EN');
    expect(service.buildManifest(baseInput({ language: 'PT' })).meta.language).toBe('PT');
  });

  // Spec 004 (D17 revisado, AC 4.16): voiceId nullable en el contrato.
  it('un agente sin voz guardada (voiceId null) cumple el contrato; omitir voiceId no', () => {
    const manifest = service.buildManifest(baseInput());
    // Solo la voz: los ids de este spec no son uuid, así que se valida el
    // campo en sí y no el agente completo.
    const VoiceIdSchema = RemotionManifestSchema.shape.agents.element.shape.voiceId;
    expect(manifest.agents.map((a) => VoiceIdSchema.safeParse(a.voiceId).success)).toEqual([true, true, true]);
    expect(VoiceIdSchema.safeParse(undefined).success).toBe(false);
  });

  // Spec 004, AC 4.18/4.19: meta.language es obligatorio en el contrato.
  it('meta cumple el contrato, que exige language (un meta sin language no valida)', () => {
    const manifest = service.buildManifest(baseInput());
    const MetaSchema = RemotionManifestSchema.shape.meta;

    expect(MetaSchema.safeParse(manifest.meta).success).toBe(true);
    const { language: _language, ...withoutLanguage } = manifest.meta;
    expect(MetaSchema.safeParse(withoutLanguage).success).toBe(false);
    expect(MetaSchema.safeParse({ ...manifest.meta, language: 'FR' }).success).toBe(false);
  });
});
