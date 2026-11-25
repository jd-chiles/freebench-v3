import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const MISTRAL_NON_CHAT_REGEX = /voxtral|embed|moderation|ocr|^mistral-vibe-cli/i;

const MistralModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  max_context_length: z.number().int().positive().optional(),
  capabilities: z
    .object({
      completion_chat: z.boolean().optional(),
      function_calling: z.boolean().optional(),
      vision: z.boolean().optional(),
    })
    .optional(),
  deprecation: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
});

const MistralResponseSchema = z.object({
  data: z.array(MistralModelSchema),
});

type MistralModelItem = z.infer<typeof MistralModelSchema>;

function isDeprecated(deprecation: string | null | undefined, nowMs: number): boolean {
  if (!deprecation) return false;
  const parsed = Date.parse(deprecation);
  if (Number.isNaN(parsed)) return false;
  return parsed <= nowMs;
}

function getMistralIdRank(id: string): [number, number, number] {
  const isWrapperAlias = /^(magistral-|mistral-code-)/i.test(id) ? 1 : 0;
  const isLatest = /-latest$/i.test(id) ? 1 : 0;
  let versionSpecificity = 2;
  if (/-\d{4}$/.test(id)) {
    versionSpecificity = 0;
  } else if (/-\d+(?:\.\d+)?$/.test(id) || /-\d+-\d+$/.test(id)) {
    versionSpecificity = 1;
  }
  return [isWrapperAlias, isLatest, versionSpecificity];
}

function compareMistralItems(a: MistralModelItem, b: MistralModelItem): number {
  const ra = getMistralIdRank(a.id);
  const rb = getMistralIdRank(b.id);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i]! !== rb[i]!) return ra[i]! - rb[i]!;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Polls Mistral `/v1/models`, requires `completion_chat`, groups symmetric alias
 * equivalence classes via Union-Find, picks one canonical model ID per class,
 * and enforces `trains_on_data: true` for Free mode.
 */
export async function pollMistral(): Promise<ProviderPollResult> {
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('mistral', 'MISTRAL_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().mistral;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = MistralResponseSchema.parse(raw);

    const nowMs = Date.now();
    const candidates = parsed.data.filter(
      (item) =>
        item.capabilities?.completion_chat === true &&
        !MISTRAL_NON_CHAT_REGEX.test(item.id) &&
        !isDeprecated(item.deprecation, nowMs)
    );

    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let cur = parent.get(x) ?? x;
      if (!parent.has(x)) parent.set(x, x);
      while (cur !== (parent.get(cur) ?? cur)) {
        cur = parent.get(cur) ?? cur;
      }
      let node = x;
      while (node !== cur) {
        const next = parent.get(node) ?? node;
        parent.set(node, cur);
        node = next;
      }
      return cur;
    };
    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    for (const item of candidates) {
      find(item.id);
      for (const alias of item.aliases ?? []) {
        if (alias !== item.id) {
          union(item.id, alias);
        }
      }
    }

    const groups = new Map<string, MistralModelItem[]>();
    for (const item of candidates) {
      const root = find(item.id);
      const bucket = groups.get(root);
      if (bucket) {
        bucket.push(item);
      } else {
        groups.set(root, [item]);
      }
    }

    const models: DiscoveredFreeModel[] = [];
    for (const group of groups.values()) {
      const sorted = [...group].sort(compareMistralItems);
      const winner = sorted[0]!;

      let contextWindow: number | null = winner.max_context_length ?? null;
      let supportsTools: boolean | null = winner.capabilities?.function_calling ?? null;
      let supportsVision: boolean | null = winner.capabilities?.vision ?? null;

      for (const member of group) {
        if (member.max_context_length && (contextWindow === null || member.max_context_length > contextWindow)) {
          contextWindow = member.max_context_length;
        }
        if (member.capabilities?.function_calling === true) {
          supportsTools = true;
        }
        if (member.capabilities?.vision === true) {
          supportsVision = true;
        }
      }

      models.push({
        provider_slug: 'mistral',
        provider_model_id: winner.id,
        raw_display_name: winner.name ?? winner.id,
        context_window: contextWindow,
        supports_tools: supportsTools,
        supports_vision: supportsVision,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: true,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'mistral',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'mistral',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
