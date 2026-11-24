import { z } from 'zod';
import aliasesRaw from '@/config/aliases.json';

export const AliasEntrySchema = z.object({
  display_name: z.string(),
  family: z.string(),
  parameter_count: z.string(),
  is_open_weights: z.boolean(),
  fallback_context_window: z.number().int().positive().nullable(),
  aliases: z.array(z.string()),
});

export const AliasesMapSchema = z.record(z.string(), AliasEntrySchema);

export type AliasEntry = z.infer<typeof AliasEntrySchema>;
export type AliasesMap = z.infer<typeof AliasesMapSchema>;

export interface NormalizedModelResult {
  canonicalId: string;
  matched: boolean;
  displayName: string;
  family: string | null;
  parameterCount: string | null;
  isOpenWeights: boolean | null;
  fallbackContextWindow: number | null;
}

const KNOWN_PROVIDER_PREFIXES = [
  'models/',
  'meta-llama/',
  'meta/',
  'deepseek-ai/',
  'deepseek/',
  'mistralai/',
  'mistral/',
  'google/',
  'qwen/',
  'openai/',
  'moonshotai/',
  'z-ai/',
  'zai-org/',
  'zai/',
  'minimaxai/',
  'nvidia/',
  'cohere/',
];

const SUFFIX_PATTERNS = [
  /\s*\((?:fc|prompt)\)$/i,
  /:free$/i,
  /:beta$/i,
  /-free$/i,
  /-fp8-fast$/i,
  /-fp8$/i,
  /-bf16$/i,
  /-awq$/i,
  /-int8$/i,
  /-int4$/i,
];

let cachedAliases: AliasesMap | null = null;
let cachedIndex: Map<string, { canonicalId: string; entry: AliasEntry }> | null = null;

/**
 * Returns the Zod-validated canonical model alias dictionary.
 */
export function getAliasesMap(): AliasesMap {
  if (!cachedAliases) {
    cachedAliases = AliasesMapSchema.parse(aliasesRaw);
  }
  return cachedAliases;
}

function getLookupIndex(): Map<string, { canonicalId: string; entry: AliasEntry }> {
  if (cachedIndex) {
    return cachedIndex;
  }

  const aliasesMap = getAliasesMap();
  const index = new Map<string, { canonicalId: string; entry: AliasEntry }>();

  for (const [canonicalId, entry] of Object.entries(aliasesMap)) {
    index.set(canonicalId.toLowerCase().trim(), { canonicalId, entry });
    index.set(entry.display_name.toLowerCase().trim(), { canonicalId, entry });
    for (const alias of entry.aliases) {
      index.set(alias.toLowerCase().trim(), { canonicalId, entry });
    }
  }

  for (const [canonicalId, entry] of Object.entries(aliasesMap)) {
    const candidates = [canonicalId, entry.display_name, ...entry.aliases];
    for (const candidate of candidates) {
      const sanitizedKey = sanitizeModelIdentifier(candidate);
      if (sanitizedKey && !index.has(sanitizedKey)) {
        index.set(sanitizedKey, { canonicalId, entry });
      }
    }
  }

  cachedIndex = index;
  return index;
}

/**
 * Strips provider namespaces, quantization tags, and formatting differences
 * to produce a clean slug candidate.
 */
export function sanitizeModelIdentifier(rawId: string): string {
  let cleaned = rawId.trim().toLowerCase();

  if (cleaned.startsWith('@cf/')) {
    cleaned = cleaned.slice('@cf/'.length);
  }

  for (const prefix of KNOWN_PROVIDER_PREFIXES) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }

  for (const suffixPattern of SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(suffixPattern, '');
  }

  cleaned = cleaned
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned;
}

function inferFamily(canonicalId: string): string | null {
  if (canonicalId.includes('gemini')) return 'Gemini';
  if (canonicalId.includes('gemma')) return 'Gemma';
  if (canonicalId.includes('llama')) return 'Llama';
  if (canonicalId.includes('deepseek')) return 'DeepSeek';
  if (canonicalId.includes('qwen') || canonicalId.includes('qwq')) return 'Qwen';
  if (
    canonicalId.includes('mistral') ||
    canonicalId.includes('codestral') ||
    canonicalId.includes('devstral') ||
    canonicalId.includes('mixtral')
  ) {
    return 'Mistral';
  }
  if (canonicalId.includes('gpt-oss')) return 'OpenAI OSS';
  if (canonicalId.includes('kimi')) return 'Kimi';
  if (canonicalId.includes('glm')) return 'GLM';
  if (canonicalId.includes('nemotron')) return 'Nemotron';
  if (canonicalId.includes('phi')) return 'Phi';
  return null;
}

function toHumanDisplayName(rawId: string, sanitized: string): string {
  const withoutNamespace = rawId.includes('/') ? (rawId.split('/').pop() ?? rawId) : rawId;
  const cleanLabel = withoutNamespace.replace(/^models\//i, '').replace(/:free$/i, '').trim();
  if (cleanLabel.length > 0 && /[A-Z]/.test(cleanLabel)) {
    return cleanLabel;
  }
  return sanitized
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)?[bm]$/i.test(part)) return part.toUpperCase();
      if (part === 'oss' || part === 'it' || part === 'r1' || part === 'v3') {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * Resolves a raw provider model ID or benchmark model name to a canonical ID.
 * Falls back to a deterministic slug and marks `matched: false` for review queuing.
 */
export function normalizeModelId(rawId: string, rawDisplayName?: string): NormalizedModelResult {
  const index = getLookupIndex();
  const directKey = rawId.toLowerCase().trim();

  const directHit = index.get(directKey);
  if (directHit) {
    return {
      canonicalId: directHit.canonicalId,
      matched: true,
      displayName: directHit.entry.display_name,
      family: directHit.entry.family,
      parameterCount: directHit.entry.parameter_count,
      isOpenWeights: directHit.entry.is_open_weights,
      fallbackContextWindow: directHit.entry.fallback_context_window,
    };
  }

  const sanitized = sanitizeModelIdentifier(rawId);
  const sanitizedHit = index.get(sanitized);
  if (sanitizedHit) {
    return {
      canonicalId: sanitizedHit.canonicalId,
      matched: true,
      displayName: sanitizedHit.entry.display_name,
      family: sanitizedHit.entry.family,
      parameterCount: sanitizedHit.entry.parameter_count,
      isOpenWeights: sanitizedHit.entry.is_open_weights,
      fallbackContextWindow: sanitizedHit.entry.fallback_context_window,
    };
  }

  // Also try stripping any arbitrary `org/` prefix before matching known aliases
  if (rawId.includes('/')) {
    const bare = sanitizeModelIdentifier(rawId.split('/').slice(1).join('/'));
    const bareHit = index.get(bare);
    if (bareHit) {
      return {
        canonicalId: bareHit.canonicalId,
        matched: true,
        displayName: bareHit.entry.display_name,
        family: bareHit.entry.family,
        parameterCount: bareHit.entry.parameter_count,
        isOpenWeights: bareHit.entry.is_open_weights,
        fallbackContextWindow: bareHit.entry.fallback_context_window,
      };
    }
  }

  if (rawDisplayName) {
    const displayHit = index.get(rawDisplayName.toLowerCase().trim());
    if (displayHit) {
      return {
        canonicalId: displayHit.canonicalId,
        matched: true,
        displayName: displayHit.entry.display_name,
        family: displayHit.entry.family,
        parameterCount: displayHit.entry.parameter_count,
        isOpenWeights: displayHit.entry.is_open_weights,
        fallbackContextWindow: displayHit.entry.fallback_context_window,
      };
    }
  }

  const fallbackId = sanitized || 'unknown-model';
  return {
    canonicalId: fallbackId,
    matched: false,
    displayName: rawDisplayName?.trim() || toHumanDisplayName(rawId, fallbackId),
    family: inferFamily(fallbackId),
    parameterCount: null,
    isOpenWeights: null,
    fallbackContextWindow: null,
  };
}
