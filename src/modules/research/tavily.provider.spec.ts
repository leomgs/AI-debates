import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TavilyProvider } from './tavily.provider';

// fetch es el borde real con la API de Tavily — se mockea acá, nunca se hace
// un request real (jest-testing skill: "mock at the SDK call boundary").
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

describe('TavilyProvider', () => {
  let provider: TavilyProvider;
  let config: { get: jest.Mock };

  beforeEach(async () => {
    mockFetch.mockReset();
    config = { get: jest.fn().mockReturnValue('tvly-fake-key') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TavilyProvider, { provide: ConfigService, useValue: config }],
    }).compile();

    provider = module.get(TavilyProvider);
  });

  it('llama a POST /search con Bearer auth y search_depth basic, y mapea los resultados', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        results: [
          { title: 'A', url: 'https://a.com', content: 'contenido A', score: 0.9 },
          { title: 'B', url: 'https://b.com', content: 'contenido B', score: 0.8 },
        ],
      }),
    );

    const results = await provider.search('la IA reemplaza programadores');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tvly-fake-key');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ query: 'la IA reemplaza programadores', search_depth: 'basic', max_results: 8 });
    expect(results).toEqual([
      { title: 'A', url: 'https://a.com', content: 'contenido A' },
      { title: 'B', url: 'https://b.com', content: 'contenido B' },
    ]);
  });

  it('agota los reintentos y rechaza cuando Tavily responde con un status no-ok (coding-rules.md §4)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'rate limited' }, false, 429));

    await expect(provider.search('cualquier query')).rejects.toThrow('429');

    // maxAttempts: 3 en cockatiel = 1 intento inicial + 3 reintentos = 4 invocaciones.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  }, 10_000);
});
