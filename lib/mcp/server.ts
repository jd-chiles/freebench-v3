import { selectBestRoute } from '@/lib/api/router';
import { buildFallbackStack } from '@/lib/snippets/stack-generator';
import type { LeaderboardModel, ProviderSlug } from '@/lib/supabase/types';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const MCP_TOOLS = [
  {
    name: 'get_best_free_model',
    description:
      'Returns the highest-ranked free LLM API model and distinct-provider fallbacks for a task (agentic-coding, coding, reasoning, math, tool-calling, always-free, privacy, long-context).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', default: 'agentic-coding' },
        always_free: { type: 'boolean', default: true },
        zero_training: { type: 'boolean', default: false },
        min_context: { type: 'number', default: 0 },
        provider: { type: 'string' },
      },
    },
  },
  {
    name: 'get_free_fallback_stack',
    description:
      'Builds a multi-provider free failover stack (LiteLLM YAML, OpenCode JSON, TypeScript failover) filtered to specified providers and constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['overall', 'agentic', 'coding', 'reasoning', 'math', 'tools'],
          default: 'agentic',
        },
        providers: { type: 'array', items: { type: 'string' } },
        always_free_only: { type: 'boolean', default: true },
        zero_training_only: { type: 'boolean', default: false },
        min_context: { type: 'number', default: 32768 },
      },
    },
  },
] as const;

function okResponse(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Pure JSON-RPC 2.0 MCP request handler exposing FreeBench routing and stack tools.
 */
export function handleMcpRequest(rawRequest: unknown, models: LeaderboardModel[]): unknown {
  if (!rawRequest || typeof rawRequest !== 'object') {
    return errorResponse(null, -32600, 'Invalid Request');
  }

  const req = rawRequest as JsonRpcRequest;
  const method = req.method;

  if (method === 'initialize') {
    return okResponse(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'freebench-mcp', version: '0.0.1' },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return okResponse(req.id, { tools: MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const params = req.params ?? {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (toolName === 'get_best_free_model') {
      const search = new URLSearchParams();
      if (typeof args.task === 'string' && args.task) search.set('task', args.task);
      if (args.always_free !== false) search.set('always_free', '1');
      if (args.zero_training === true) search.set('zero_training', '1');
      if (typeof args.min_context === 'number' && args.min_context > 0) {
        search.set('min_context', String(args.min_context));
      }
      if (typeof args.provider === 'string' && args.provider) {
        search.set('provider', args.provider);
      }

      const routeResult = selectBestRoute(models, search);
      return okResponse(req.id, {
        content: [{ type: 'text', text: JSON.stringify(routeResult, null, 2) }],
      });
    }

    if (toolName === 'get_free_fallback_stack') {
      const taskArg =
        typeof args.task === 'string' &&
        ['overall', 'agentic', 'coding', 'reasoning', 'math', 'tools'].includes(args.task)
          ? (args.task as 'overall' | 'agentic' | 'coding' | 'reasoning' | 'math' | 'tools')
          : 'agentic';
      const providers = Array.isArray(args.providers)
        ? (args.providers.filter((p): p is ProviderSlug => typeof p === 'string') as ProviderSlug[])
        : [];

      const stack = buildFallbackStack(models, {
        ownedProviders: providers,
        task: taskArg,
        alwaysFreeOnly: args.always_free_only !== false,
        zeroTrainingOnly: args.zero_training_only === true,
        minContext: typeof args.min_context === 'number' ? args.min_context : 32_768,
      });

      return okResponse(req.id, {
        content: [{ type: 'text', text: JSON.stringify(stack, null, 2) }],
      });
    }

    return errorResponse(req.id, -32601, `Unknown tool: ${toolName}`);
  }

  return errorResponse(req.id, -32601, `Method not found: ${String(method)}`);
}
