import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollCerebras } from '@/lib/providers/cerebras';
import { pollChutes } from '@/lib/providers/chutes';
import { pollCloudflare } from '@/lib/providers/cloudflare';
import { pollCohere } from '@/lib/providers/cohere';
import { pollGoogle } from '@/lib/providers/google';
import { pollGroq } from '@/lib/providers/groq';
import { fetchJsonWithTimeout, shouldApplyDeactivation } from '@/lib/providers/http';
import { pollKilo } from '@/lib/providers/kilo';
import { pollMistral } from '@/lib/providers/mistral';
import { pollNvidia } from '@/lib/providers/nvidia';
import { pollOpenCode } from '@/lib/providers/opencode';
import { pollOpenRouter } from '@/lib/providers/openrouter';
import { pollPollinations } from '@/lib/providers/pollinations';
import { pollSambaNova } from '@/lib/providers/sambanova';
import { pollSiliconFlow } from '@/lib/providers/siliconflow';
import { pollZai } from '@/lib/providers/zai';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Provider Pollers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pollOpenRouter filters to $0 models, excludes routers/expired, and tags ZDR', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('?zdr=true')) {
        return jsonResponse({
          data: [{ id: 'deepseek/deepseek-r1:free' }],
        });
      }
      return jsonResponse({
        data: [
          {
            id: 'deepseek/deepseek-r1:free',
            name: 'DeepSeek R1 (free)',
            context_length: 163840,
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'] },
            supported_parameters: ['tools'],
          },
          {
            id: 'meta-llama/llama-3.3-70b-instruct:free',
            name: 'Llama 3.3 70B (free)',
            context_length: 131072,
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'] },
            supported_parameters: ['tools'],
          },
          {
            id: 'some/non-free-zero',
            pricing: { prompt: '0', completion: '0' },
          },
          {
            id: 'openrouter/free',
            pricing: { prompt: '0', completion: '0' },
          },
          {
            id: 'openrouter/auto',
            pricing: { prompt: '-1', completion: '-1' },
          },
          {
            id: 'expired/model:free',
            expiration_date: '2020-01-01T00:00:00Z',
            pricing: { prompt: '0', completion: '0' },
          },
          {
            id: 'paid/model',
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollOpenRouter();
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      provider_slug: 'openrouter',
      provider_model_id: 'deepseek/deepseek-r1:free',
      context_window: 163840,
      supports_tools: true,
      supports_vision: false,
      zdr_available: true,
      trains_on_data: false,
      tier_type: 'always_free',
    });
    expect(result.models[1]).toMatchObject({
      provider_model_id: 'meta-llama/llama-3.3-70b-instruct:free',
      zdr_available: false,
      trains_on_data: true,
    });
  });

  it('pollGoogle skips gracefully without key and paginates/filters with key', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const missing = await pollGoogle();
    expect(missing.ok).toBe(false);
    expect(missing.skipped).toBe(true);
    expect(missing.error).toContain('GOOGLE_AI_API_KEY');

    process.env.GOOGLE_AI_API_KEY = 'test-google-key';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('pageToken=')) {
        return jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              inputTokenLimit: 1048576,
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-tts',
              inputTokenLimit: 16000,
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
          nextPageToken: 'page2',
        });
      }
      return jsonResponse({
        models: [
          {
            name: 'models/gemma-3-27b-it',
            displayName: 'Gemma 3 27B IT',
            inputTokenLimit: 131072,
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/paid-only-enterprise-model',
            inputTokenLimit: 32000,
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollGoogle();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual([
      'gemini-2.5-flash',
      'gemma-3-27b-it',
    ]);
    expect(result.models[0]?.trains_on_data).toBe(true);
    expect(result.models[0]?.context_window).toBe(1048576);
    expect(result.models[1]?.supports_vision).toBe(true);
  });

  it('pollGroq filters inactive and non-chat models', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'llama-3.3-70b-versatile', active: true, context_window: 131072 },
            { id: 'whisper-large-v3', active: true },
            { id: 'playai-tts', active: true },
            { id: 'retired-model', active: false },
          ],
        })
      )
    );

    const result = await pollGroq();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual(['llama-3.3-70b-versatile']);
    expect(result.models[0]?.tier_type).toBe('always_free');
  });

  it('pollCerebras excludes audio/embed models and applies alias fallback context', async () => {
    process.env.CEREBRAS_API_KEY = 'test-cerebras-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'llama-3.3-70b' },
            { id: 'whisper-1' },
          ],
        })
      )
    );

    const result = await pollCerebras();
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.context_window).toBe(131072);
    expect(result.models[0]?.tier_type).toBe('trial_credit');
    expect(result.models[0]?.rpd_limit).toBe('One-time $5 credit');
  });

  it('pollNvidia strips non-chat microservices', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'deepseek-ai/deepseek-r1' },
            { id: 'nvidia/nv-embedqa-e5-v5' },
            { id: 'stabilityai/sdxl-turbo' },
            { id: 'nvidia/parakeet-ctc-1.1b' },
          ],
        })
      )
    );

    const result = await pollNvidia();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual(['deepseek-ai/deepseek-r1']);
    expect(result.models[0]?.tier_type).toBe('trial_credit');
  });

  it('pollCloudflare uses /ai/models/search, keeps hosted models only, and drops deprecated entries', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    process.env.CLOUDFLARE_API_TOKEN = 'tok123';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/ai/models/search');
      expect(url).not.toContain('/ai/v1/models');
      return jsonResponse({
        success: true,
        result_info: { total_pages: 1 },
        result: [
          {
            name: '@cf/openai/gpt-oss-120b',
            source: 'hosted',
            properties: [
              { property_id: 'context_window', value: '128000' },
              { property_id: 'function_calling', value: 'true' },
            ],
          },
          {
            name: 'partner/proxied-model',
            source: 'proxied',
          },
          {
            name: '@cf/legacy/deprecated-model',
            source: 'hosted',
            properties: [{ property_id: 'beta', value: 'deprecated' }],
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollCloudflare();
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      provider_model_id: '@cf/openai/gpt-oss-120b',
      context_window: 128000,
      supports_tools: true,
      trains_on_data: false,
      tier_type: 'always_free',
    });
  });

  it('pollMistral filters completion_chat, deduplicates -latest, and marks trains_on_data=true', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'mistral-small-2503',
              max_context_length: 128000,
              capabilities: { completion_chat: true, function_calling: true, vision: true },
              aliases: ['mistral-small-latest'],
            },
            {
              id: 'mistral-small-latest',
              max_context_length: 128000,
              capabilities: { completion_chat: true },
            },
            {
              id: 'mistral-embed',
              capabilities: { completion_chat: false },
            },
            {
              id: 'old-deprecated',
              deprecation: '2022-01-01T00:00:00Z',
              capabilities: { completion_chat: true },
            },
          ],
        })
      )
    );

    const result = await pollMistral();
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      provider_model_id: 'mistral-small-2503',
      trains_on_data: true,
      supports_tools: true,
      supports_vision: true,
    });
  });

  it('pollSambaNova filters audio/embed models', async () => {
    process.env.SAMBANOVA_API_KEY = 'samba-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'DeepSeek-R1', context_length: 131072 },
            { id: 'Whisper-Large-v3' },
          ],
        })
      )
    );

    const result = await pollSambaNova();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual(['DeepSeek-R1']);
  });

  it('pollKilo keeps $0 models and excludes kilo-auto routers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'kilo-auto/free',
              pricing: { prompt: '0', completion: '0' },
            },
            {
              id: 'kilo-auto/efficient',
              pricing: { prompt: '-1', completion: '-1' },
            },
            {
              id: 'openrouter/free',
              pricing: { prompt: '0', completion: '0' },
            },
            {
              id: 'google/lyria-3-pro-preview',
              pricing: { prompt: '0', completion: '0' },
            },
            {
              id: 'deepseek/deepseek-r1:free',
              name: 'DeepSeek R1 (free)',
              top_provider: { context_length: 163840 },
              pricing: { prompt: '0', completion: '0' },
              supported_parameters: ['tools'],
              architecture: { input_modalities: ['text'] },
            },
          ],
        })
      )
    );

    const result = await pollKilo();
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      provider_slug: 'kilo',
      provider_model_id: 'deepseek/deepseek-r1:free',
      context_window: 163840,
      tier_type: 'always_free',
    });
  });

  it('pollOpenCode keeps zero-price chat models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'deepseek-v4.1-flash-free',
              name: 'DeepSeek Flash Free',
              type: 'chat',
              limit: { context: 131072 },
              capabilities: { tools: { supported: true } },
              modalities: { input: ['text'], output: ['text'] },
              cost: { text: { input: { price: 0 }, output: { price: 0 } } },
            },
            {
              id: 'paid-coder',
              type: 'chat',
              cost: { text: { input: { price: 1.5 }, output: { price: 3 } } },
            },
          ],
        })
      )
    );

    const result = await pollOpenCode();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual(['deepseek-v4.1-flash-free']);
    expect(result.models[0]?.tier_type).toBe('always_free');
  });

  it('pollPollinations keeps anonymous/free text models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          {
            name: 'openai-fast',
            description: 'GPT-OSS 20B',
            tier: 'anonymous',
            input_modalities: ['text'],
            tools: true,
            vision: false,
          },
          {
            name: 'seed-only',
            tier: 'seed',
          },
          {
            name: 'paid-tier-only',
            tier: 'nectar',
          },
        ])
      )
    );

    const result = await pollPollinations();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.provider_model_id)).toEqual(['openai-fast']);
  });

  it('pollCohere, pollChutes, pollSiliconFlow, and pollZai filter appropriately', async () => {
    process.env.COHERE_API_KEY = 'cohere-key';
    process.env.CHUTES_API_KEY = 'chutes-key';
    process.env.SILICONFLOW_API_KEY = 'sf-key';
    process.env.ZAI_API_KEY = 'zai-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.cohere.com')) {
          return jsonResponse({
            models: [
              { name: 'command-a-03-2025', endpoints: ['chat'], context_length: 256000 },
              { name: 'embed-v4.0', endpoints: ['embed'] },
            ],
          });
        }
        if (url.includes('llm.chutes.ai')) {
          return jsonResponse({
            data: [
              { id: 'Qwen/Qwen3-235B-A22B', context_length: 131072 },
              { id: 'Paid/Model', price: { input: { usd: 0.5 }, output: { usd: 1.0 } } },
              { id: 'whisper-large' },
            ],
          });
        }
        if (url.includes('api.siliconflow.com')) {
          return jsonResponse({
            data: [
              { id: 'Qwen/Qwen3-8B' },
              { id: 'deepseek-ai/DeepSeek-R1' },
              { id: 'Pro/deepseek-ai/DeepSeek-R1' },
            ],
          });
        }
        return jsonResponse({
          data: [{ id: 'glm-4.5-flash' }, { id: 'glm-4.6-pro' }],
        });
      })
    );

    const [cohere, chutes, siliconflow, zai] = await Promise.all([
      pollCohere(),
      pollChutes(),
      pollSiliconFlow(),
      pollZai(),
    ]);

    expect(cohere.models.map((m) => m.provider_model_id)).toEqual(['command-a-03-2025']);
    expect(chutes.models.map((m) => m.provider_model_id)).toEqual(['Qwen/Qwen3-235B-A22B']);
    expect(siliconflow.models.map((m) => m.provider_model_id)).toEqual(['Qwen/Qwen3-8B']);
    expect(zai.models.map((m) => m.provider_model_id)).toEqual(['glm-4.5-flash']);
  });

  it('enforces AbortController timeout and never-wipe safety predicate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      })
    );

    await expect(fetchJsonWithTimeout('https://example.com', {}, 25)).rejects.toThrow(
      /timed out after 25ms/
    );

    expect(
      shouldApplyDeactivation({
        provider_slug: 'groq',
        ok: false,
        models: [],
        error: 'HTTP 500',
        duration_ms: 10,
      })
    ).toBe(false);

    expect(
      shouldApplyDeactivation({
        provider_slug: 'groq',
        ok: true,
        models: [],
        duration_ms: 10,
      })
    ).toBe(false);
  });
});
