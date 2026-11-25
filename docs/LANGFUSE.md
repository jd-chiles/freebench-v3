# Langfuse tracing for FB-Eval

The FB-Eval runner emits one Langfuse `generation` observation per benchmark model call. Observations include the exact synthetic system/user prompts, provider/model and benchmark dimensions (`canonicalId`, suite version, seed, prompt ID, pillar), model response, latency, and token usage when the provider returns it. Provider error bodies and API keys are not copied into traces.

Tracing is optional. Add a Langfuse **project** API key pair to `.env.local` (not the AI Gateway key):

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
```

Run `npm run eval -- --model=<canonical-model-id> --provider=<provider>` to produce traces. `npm run eval:dry` makes no model calls and produces no traces. The CLI flushes and shuts down the SDK when it exits. If the project credentials are absent, eval works as before with tracing disabled.

Langfuse API keys are found in the Langfuse project under **Settings → API Keys**. The gateway key is for proxying model requests; it cannot ingest application traces. See [Langfuse tracing best practices](https://langfuse.com/docs/observability/best-practices).
