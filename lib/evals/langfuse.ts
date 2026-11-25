import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  startObservation,
  type LangfuseGeneration,
} from '@langfuse/tracing';

let sdk: NodeSDK | null = null;

/**
 * Starts Langfuse tracing for short-lived FB-Eval CLI runs when project API
 * credentials are configured. The AI Gateway key is not a project ingest key.
 */
export function initLangfuseTracing(
  env: Record<string, string | undefined> = process.env
): NodeSDK | null {
  if (sdk) return sdk;

  const hasCredentials = Boolean(
    env.LANGFUSE_PUBLIC_KEY?.trim() &&
      env.LANGFUSE_SECRET_KEY?.trim() &&
      env.LANGFUSE_BASE_URL?.trim()
  );
  if (!hasCredentials) return null;

  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
  return sdk;
}

export function startEvalGeneration(input: {
  model: string;
  systemPrompt?: string;
  userPrompt?: string;
  messages?: ReadonlyArray<{ role: string; content: string }>;
  metadata: Record<string, string | number>;
}): LangfuseGeneration | null {
  if (!sdk) return null;

  const formattedInput = input.messages
    ? input.messages.map((m) => ({ role: m.role, content: m.content }))
    : [
        { role: 'system', content: input.systemPrompt ?? '' },
        { role: 'user', content: input.userPrompt ?? '' },
      ];

  return startObservation(
    'freebench-eval-generation',
    {
      model: input.model,
      input: formattedInput,
      metadata: input.metadata,
    },
    { asType: 'generation' }
  );
}

export async function shutdownLangfuseTracing(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = null;
  await current.shutdown();
}

export function endEvalGeneration(
  generation: LangfuseGeneration | null,
  result:
    | { output: string; inputTokens?: number; outputTokens?: number }
    | { error: string }
): void {
  if (!generation) return;

  if ('error' in result) {
    generation.update({
      level: 'ERROR',
      statusMessage: result.error,
    });
  } else {
    const usageDetails: Record<string, number> = {};
    if (result.inputTokens !== undefined) usageDetails.input = result.inputTokens;
    if (result.outputTokens !== undefined) usageDetails.output = result.outputTokens;
    generation.update({
      output: result.output,
      ...(Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
    });
  }

  generation.end();
}
