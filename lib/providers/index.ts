import { pollCerebras } from './cerebras';
import { pollChutes } from './chutes';
import { pollCloudflare } from './cloudflare';
import { pollCohere } from './cohere';
import { pollGoogle } from './google';
import { pollGroq } from './groq';
import { formatErrorMessage } from './http';
import { pollKilo } from './kilo';
import { pollMistral } from './mistral';
import { pollNvidia } from './nvidia';
import { pollOpenCode } from './opencode';
import { pollOpenRouter } from './openrouter';
import { pollPollinations } from './pollinations';
import { pollSambaNova } from './sambanova';
import { pollSiliconFlow } from './siliconflow';
import { pollZai } from './zai';
import type { ProviderPollResult, ProviderSlug } from './types';

export {
  pollOpenRouter,
  pollKilo,
  pollOpenCode,
  pollPollinations,
  pollGoogle,
  pollGroq,
  pollCerebras,
  pollNvidia,
  pollCloudflare,
  pollMistral,
  pollSambaNova,
  pollCohere,
  pollChutes,
  pollSiliconFlow,
  pollZai,
};

const POLLER_ENTRIES: ReadonlyArray<{
  slug: ProviderSlug;
  run: () => Promise<ProviderPollResult>;
}> = [
  { slug: 'openrouter', run: pollOpenRouter },
  { slug: 'kilo', run: pollKilo },
  { slug: 'opencode', run: pollOpenCode },
  { slug: 'pollinations', run: pollPollinations },
  { slug: 'google', run: pollGoogle },
  { slug: 'groq', run: pollGroq },
  { slug: 'cerebras', run: pollCerebras },
  { slug: 'nvidia', run: pollNvidia },
  { slug: 'cloudflare', run: pollCloudflare },
  { slug: 'mistral', run: pollMistral },
  { slug: 'sambanova', run: pollSambaNova },
  { slug: 'cohere', run: pollCohere },
  { slug: 'chutes', run: pollChutes },
  { slug: 'siliconflow', run: pollSiliconFlow },
  { slug: 'zai', run: pollZai },
];

/**
 * Executes all 15 provider pollers concurrently via `Promise.allSettled`.
 */
export async function pollAllProviders(): Promise<ProviderPollResult[]> {
  const settled = await Promise.allSettled(POLLER_ENTRIES.map((entry) => entry.run()));

  return settled.map((outcome, idx) => {
    const slug = POLLER_ENTRIES[idx]?.slug ?? 'openrouter';
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    return {
      provider_slug: slug,
      ok: false,
      models: [],
      error: formatErrorMessage(outcome.reason),
      duration_ms: 0,
    };
  });
}

/**
 * Executes a single provider poller by slug with standardized error handling.
 */
export async function pollProviderBySlug(slug: ProviderSlug): Promise<ProviderPollResult> {
  const entry = POLLER_ENTRIES.find((item) => item.slug === slug);
  if (!entry) {
    return {
      provider_slug: slug,
      ok: false,
      models: [],
      error: `Unknown provider slug: ${slug}`,
      duration_ms: 0,
    };
  }

  try {
    return await entry.run();
  } catch (error) {
    return {
      provider_slug: slug,
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: 0,
    };
  }
}
