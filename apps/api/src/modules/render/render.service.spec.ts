import { RenderService, BuildManifestInput } from './render.service';
import { ManifestNotReadyError } from './render.errors';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';

function baseInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    episodeId: EPISODE_ID,
    topic: '¿La IA reemplazará a los programadores?',
    participants: [
      { agentId: AGENT_A, name: 'Analyst', avatarUrl: 'https://cdn/analyst.png', voiceId: 'es_ES-davefx-medium' },
      { agentId: AGENT_B, name: 'Contrarian', avatarUrl: null, voiceId: 'es_MX-ald-medium' },
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
    expect(manifest.meta).toEqual({ topic: baseInput().topic, durationEstimatedSec: 7 }); // (4000+3000)/1000
    expect(manifest.agents).toEqual([
      { id: AGENT_A, name: 'Analyst', avatarUrl: 'https://cdn/analyst.png', voiceId: 'es_ES-davefx-medium' },
      { id: AGENT_B, name: 'Contrarian', avatarUrl: null, voiceId: 'es_MX-ald-medium' },
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

  it('verdict.winnerAgentId es null si el debate no tuvo ganador (Verdict.winnerId opcional)', () => {
    const manifest = service.buildManifest(baseInput({ verdict: { winnerId: null, content: 'Empate técnico.' } }));
    expect(manifest.verdict.winnerAgentId).toBeNull();
  });
});
