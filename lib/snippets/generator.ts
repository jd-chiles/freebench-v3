import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export interface SnippetTab {
  id:
    | 'opencode'
    | 'kilo-code'
    | 'hermes'
    | 'aider'
    | 'cline'
    | 'litellm'
    | 'curl'
    | 'openai-ts'
    | 'openai-py'
    | 'vercel-ai';
  label: string;
  group: 'agent' | 'sdk';
  language: string;
  code: string;
}

/**
 * Generates copy-ready API SDK and Coding Agent integration snippets
 * tailored to the exact provider protocol and model identifier.
 */
export function generateProviderSnippets(
  providerSlug: ProviderSlug,
  providerModelId: string
): SnippetTab[] {
  const providerConfig = getProvidersConfig()[providerSlug];
  const envVar = providerConfig.env_var;
  const baseUrl = providerConfig.api_base_url;

  const agentSnippets = buildAgentSnippets(providerSlug, providerModelId, baseUrl, envVar);
  const sdkSnippets = buildSdkSnippets(providerSlug, providerModelId, baseUrl, envVar);

  return [...agentSnippets, ...sdkSnippets];
}

function buildSdkSnippets(
  providerSlug: ProviderSlug,
  modelId: string,
  baseUrl: string,
  envVar: string
): SnippetTab[] {
  if (providerSlug === 'google') {
    return [
      {
        id: 'curl',
        label: 'cURL',
        group: 'sdk',
        language: 'bash',
        code: `curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=\${${envVar}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{ "parts": [{ "text": "Write a TypeScript binary search function." }] }]
  }'`,
      },
      {
        id: 'openai-ts',
        label: 'OpenAI TS SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.${envVar},
});

const res = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "Explain this stack trace." }],
});`,
      },
      {
        id: 'openai-py',
        label: 'Python SDK',
        group: 'sdk',
        language: 'python',
        code: `import os
from openai import OpenAI

client = OpenAI(
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    api_key=os.environ["${envVar}"],
)

resp = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Review this SQL query."}],
)`,
      },
      {
        id: 'vercel-ai',
        label: 'Vercel AI SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

const google = createGoogleGenerativeAI({ apiKey: process.env.${envVar} });

const { text } = await generateText({
  model: google("${modelId}"),
  prompt: "Summarize these logs.",
});`,
      },
    ];
  }

  if (providerSlug === 'cloudflare') {
    return [
      {
        id: 'curl',
        label: 'cURL',
        group: 'sdk',
        language: 'bash',
        code: `curl -X POST "https://api.cloudflare.com/client/v4/accounts/\${CLOUDFLARE_ACCOUNT_ID}/ai/run/${modelId}" \\
  -H "Authorization: Bearer \${${envVar}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{ "role": "user", "content": "Write a SQL migration." }]
  }'`,
      },
      {
        id: 'openai-ts',
        label: 'OpenAI TS SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: \`https://api.cloudflare.com/client/v4/accounts/\${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1\`,
  apiKey: process.env.${envVar},
});

const res = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "Refactor this helper." }],
});`,
      },
      {
        id: 'openai-py',
        label: 'Python SDK',
        group: 'sdk',
        language: 'python',
        code: `import os
from openai import OpenAI

account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
client = OpenAI(
    base_url=f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    api_key=os.environ["${envVar}"],
)

resp = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Write unit tests."}],
)`,
      },
      {
        id: 'vercel-ai',
        label: 'Vercel AI SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const cf = createOpenAICompatible({
  name: "cloudflare",
  baseURL: \`https://api.cloudflare.com/client/v4/accounts/\${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1\`,
  apiKey: process.env.${envVar},
});

const { text } = await generateText({
  model: cf("${modelId}"),
  prompt: "Generate a regex for semantic versions.",
});`,
      },
    ];
  }

  if (providerSlug === 'pollinations') {
    return [
      {
        id: 'curl',
        label: 'cURL',
        group: 'sdk',
        language: 'bash',
        code: `curl -X POST "${baseUrl}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "messages": [{ "role": "user", "content": "Write a TypeScript binary search function." }]
  }'`,
      },
      {
        id: 'openai-ts',
        label: 'OpenAI TS SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "pollinations", // Anonymous zero-key access
});

const res = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "Explain this stack trace." }],
});`,
      },
      {
        id: 'openai-py',
        label: 'Python SDK',
        group: 'sdk',
        language: 'python',
        code: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="pollinations",  # Anonymous zero-key access
)

resp = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Review this pull request diff."}],
)`,
      },
      {
        id: 'vercel-ai',
        label: 'Vercel AI SDK',
        group: 'sdk',
        language: 'typescript',
        code: `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const pollinations = createOpenAICompatible({
  name: "pollinations",
  baseURL: "${baseUrl}",
  apiKey: "pollinations",
});

const { text } = await generateText({
  model: pollinations("${modelId}"),
  prompt: "Write a clean Vitest test suite.",
});`,
      },
    ];
  }

  const extraCurlHeaders =
    providerSlug === 'openrouter'
      ? ` \\\n  -H "HTTP-Referer: https://freebench.org" \\\n  -H "X-Title: FreeBench"`
      : '';

  const openRouterDefaultHeadersTs =
    providerSlug === 'openrouter'
      ? `,\n  defaultHeaders: {\n    "HTTP-Referer": "https://freebench.org",\n    "X-Title": "FreeBench",\n  }`
      : '';

  const openRouterDefaultHeadersPy =
    providerSlug === 'openrouter'
      ? `,\n    default_headers={"HTTP-Referer": "https://freebench.org", "X-Title": "FreeBench"}`
      : '';

  return [
    {
      id: 'curl',
      label: 'cURL',
      group: 'sdk',
      language: 'bash',
      code: `curl -X POST "${baseUrl}/chat/completions" \\
  -H "Authorization: Bearer \${${envVar}}" \\
  -H "Content-Type: application/json"${extraCurlHeaders} \\
  -d '{
    "model": "${modelId}",
    "messages": [{ "role": "user", "content": "Write a TypeScript binary search function." }]
  }'`,
    },
    {
      id: 'openai-ts',
      label: 'OpenAI TS SDK',
      group: 'sdk',
      language: 'typescript',
      code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.${envVar}${openRouterDefaultHeadersTs},
});

const res = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "Explain this stack trace." }],
});`,
    },
    {
      id: 'openai-py',
      label: 'Python SDK',
      group: 'sdk',
      language: 'python',
      code: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key=os.environ["${envVar}"]${openRouterDefaultHeadersPy},
)

resp = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Review this pull request diff."}],
)`,
    },
    {
      id: 'vercel-ai',
      label: 'Vercel AI SDK',
      group: 'sdk',
      language: 'typescript',
      code: `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const provider = createOpenAICompatible({
  name: "${providerSlug}",
  baseURL: "${baseUrl}",
  apiKey: process.env.${envVar},
});

const { text } = await generateText({
  model: provider("${modelId}"),
  prompt: "Write a clean Vitest test suite.",
});`,
    },
  ];
}

function getAiderCommand(
  providerSlug: ProviderSlug,
  modelId: string,
  baseUrl: string,
  envVar: string
): string {
  switch (providerSlug) {
    case 'openrouter':
      return `export OPENROUTER_API_KEY="\${OPENROUTER_API_KEY}"\naider --model "openrouter/${modelId}"`;
    case 'google':
      return `export GEMINI_API_KEY="\${${envVar}}"\naider --model "gemini/${modelId}"`;
    case 'groq':
      return `export GROQ_API_KEY="\${${envVar}}"\naider --model "groq/${modelId}"`;
    case 'mistral':
      return `export MISTRAL_API_KEY="\${${envVar}}"\naider --model "mistral/${modelId}"`;
    case 'pollinations':
      return `export OPENAI_API_BASE="${baseUrl}"\nexport OPENAI_API_KEY="pollinations"\naider --model "openai/${modelId}"`;
    default:
      return `export OPENAI_API_BASE="${baseUrl}"\nexport OPENAI_API_KEY="\${${envVar}}"\naider --model "openai/${modelId}"`;
  }
}

function buildAgentSnippets(
  providerSlug: ProviderSlug,
  modelId: string,
  baseUrl: string,
  envVar: string
): SnippetTab[] {
  const effectiveBaseUrl =
    providerSlug === 'google'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai/'
      : providerSlug === 'cloudflare'
        ? 'https://api.cloudflare.com/client/v4/accounts/<YOUR_CLOUDFLARE_ACCOUNT_ID>/ai/v1'
        : baseUrl;

  const openCodeConfig =
    providerSlug === 'google'
      ? {
          $schema: 'https://opencode.ai/config.json',
          provider: {
            google: {
              options: {
                apiKey: `{env:${envVar}}`,
              },
            },
          },
          model: `google/${modelId}`,
        }
      : {
          $schema: 'https://opencode.ai/config.json',
          provider: {
            [providerSlug]: {
              npm: '@ai-sdk/openai-compatible',
              options: {
                baseURL: effectiveBaseUrl,
                ...(providerSlug === 'pollinations'
                  ? { apiKey: 'pollinations' }
                  : { apiKey: `{env:${envVar}}` }),
              },
              models: {
                [modelId]: {},
              },
            },
          },
          model: `${providerSlug}/${modelId}`,
        };

  const apiKeyLine =
    providerSlug === 'pollinations' ? 'pollinations (no key required)' : `\${${envVar}}`;

  return [
    {
      id: 'opencode',
      label: 'OpenCode',
      group: 'agent',
      language: 'json',
      code: JSON.stringify(openCodeConfig, null, 2),
    },
    {
      id: 'kilo-code',
      label: 'Kilo Code',
      group: 'agent',
      language: 'text',
      code:
        providerSlug === 'kilo'
          ? `Provider:  Kilo Gateway (Built-in)\nModel ID:  ${modelId}\nAPI Key:   Optional for anonymous free tier`
          : `Provider:  OpenAI Compatible\nBase URL:  ${effectiveBaseUrl}\nAPI Key:   ${apiKeyLine}\nModel ID:  ${modelId}`,
    },
    {
      id: 'hermes',
      label: 'Hermes Agent',
      group: 'agent',
      language: 'yaml',
      code: `# ~/.hermes/config.yaml
model:
  default: "${modelId}"
  provider: "${providerSlug}"
  base_url: "${effectiveBaseUrl}"${
        providerSlug === 'pollinations'
          ? '\n  api_key: "pollinations"'
          : `\n  api_key_env: "${envVar}"`
      }`,
    },
    {
      id: 'aider',
      label: 'Aider CLI',
      group: 'agent',
      language: 'bash',
      code: getAiderCommand(providerSlug, modelId, effectiveBaseUrl, envVar),
    },
    {
      id: 'cline',
      label: 'Cline / Roo',
      group: 'agent',
      language: 'text',
      code: `API Provider: OpenAI Compatible
Base URL:     ${effectiveBaseUrl}
API Key:      ${apiKeyLine}
Model ID:     ${modelId}`,
    },
    {
      id: 'litellm',
      label: 'LiteLLM',
      group: 'agent',
      language: 'yaml',
      code: `model_list:
  - model_name: free-${providerSlug}
    litellm_params:
      model: openai/${modelId}
      api_base: ${effectiveBaseUrl}
      api_key: ${providerSlug === 'pollinations' ? 'pollinations' : `os.environ/${envVar}`}`,
    },
  ];
}
