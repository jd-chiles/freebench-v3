# Provider Ingestion Spec

> **Important 2026 Update:** Drop **GitHub Models** (`models.github.ai`) from the v1 spec—GitHub permanently retired the GitHub Models product and catalog API on July 30, 2026. Replace it with **Cloudflare Workers AI**, **Mistral AI (Free Mode)**, and **SambaNova**, all of which have active free tiers and live model-discovery endpoints.

---

## 1. Shared Poller Contract (`lib/providers/types.ts`)

Every provider adapter must normalize its raw API response into this exact interface so the ingestion orchestrator stays provider-agnostic:

```ts
export interface DiscoveredFreeModel {
  provider_slug:
    | 'openrouter'
    | 'google'
    | 'groq'
    | 'cerebras'
    | 'nvidia'
    | 'cloudflare'
    | 'mistral'
    | 'sambanova';
  provider_model_id: string;        // Exact ID required to call that provider's API
  raw_display_name?: string;        // Optional human-readable name from provider
  context_window: number | null;    // Input/total context window in tokens
  supports_tools: boolean | null;   // Tool/function calling support if advertised
  supports_vision: boolean | null;  // Image input support if advertised
  rpm_limit: string;                // From config/providers.json
  rpd_limit: string;                // From config/providers.json
  trains_on_data: boolean;          // Privacy flag
  requires_credit_card: boolean;
  signup_url: string;
}

export interface ProviderPollResult {
  provider_slug: DiscoveredFreeModel['provider_slug'];
  ok: boolean;
  models: DiscoveredFreeModel[];
  error?: string;
  duration_ms: number;
}
```

### Mandatory Safety Rules for Every Poller

1. **15-second AbortController timeout** on every `fetch()`.
2. **Never wipe on failure:** Only mark previously seen models as `is_available = false` if `result.ok === true` AND `result.models.length > 0` (prevents wiping a provider's entire catalog on a transient 429/500 or bad key).
3. **Graceful missing-key skip:** If a provider's env var is unset (e.g., `CEREBRAS_API_KEY` isn't configured yet), return `{ ok: false, models: [], error: 'Missing env var' }` rather than throwing. Only **OpenRouter** runs with zero API keys.

---

## 2. Exact Per-Provider Setup & Retrieval Instructions

### A. OpenRouter (No API Key Required)

* **Key Setup:** None required to fetch the catalog.
* **Endpoint:** `GET https://openrouter.ai/api/v1/models`
  * By default, omitting `output_modalities` returns text-output models only—keep this default so embeddings, image generators, and TTS models are excluded automatically.
  * Optional secondary call: `GET https://openrouter.ai/api/v1/models?zdr=true` to tag which free models have a Zero Data Retention endpoint.
* **Response Shape:** `{ data: Array<{ id, canonical_slug, name, context_length, expiration_date, pricing: { prompt, completion }, architecture: { input_modalities }, supported_parameters: string[] }> }`
* **Exact Filter Logic:**
  * Keep ONLY entries where `pricing.prompt === "0"` AND `pricing.completion === "0"`.
  * **Gotchas to filter out:**
    * Exclude sentinel price `"-1"` (dynamic paid routers like `openrouter/auto`).
    * Exclude meta-router `id === "openrouter/free"` (it routes dynamically rather than representing a single benchmarkable model).
    * Prefer `:free` suffixed models or verified `$0` endpoints; note that non-`:free` `$0` models can still require a funded account.
    * Exclude entries where `expiration_date` is set and already in the past.
  * Extract `supports_tools = supported_parameters?.includes("tools") ?? null` and `supports_vision = architecture?.input_modalities?.includes("image") ?? null`.
* **Published Free Limits:** `20 RPM` / `50 RPD` (`1,000 RPD` if account has $10+ credits purchased). Data policies vary per upstream host; mark `trains_on_data: false` only if ZDR or user privacy toggles are enforced, otherwise label as configurable.

---

### B. Google AI Studio (Gemini API)

* **Key Setup:** Create a free project key at `aistudio.google.com` (no billing account linked) → set `GOOGLE_AI_API_KEY`.
* **Endpoint:** `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${GOOGLE_AI_API_KEY}`
  * Loop on `nextPageToken` if returned so no models are truncated.
* **Response Shape:** `{ models: Array<{ name, displayName, inputTokenLimit, outputTokenLimit, supportedGenerationMethods: string[] }>, nextPageToken?: string }`
* **Exact Filter Logic:**
  1. Strip the `"models/"` prefix from `name` (e.g., `models/gemini-3.8-flash` → `gemini-3.8-flash`).
  2. Require `supportedGenerationMethods.includes("generateContent")` (automatically strips embedding/AQA/imagen-only endpoints).
  3. **Critical Gotcha (Free vs. Paid Filtering):** The `/v1beta/models` endpoint lists *all* Gemini models, including paid-only models, without an `is_free` boolean. Cross-reference each live model ID against a `free_allowlist_patterns` array in `config/providers.json` (e.g., `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-4-hydrogen`, `gemma-*`). Exclude `-tts`, `-audio`, `-image`, and `-live` variants unless you add multimodal tabs later.
  4. Map `context_window = inputTokenLimit`.
* **Published Free Limits & Privacy:** Varies by model (e.g., ~5 RPM / 20 RPD on flagship Flash up to 500+ RPD on Flash-Lite; resets midnight Pacific per project). Set `trains_on_data: true` (Google's free tier may use prompts to improve models outside restricted regions).

---

### C. Groq

* **Key Setup:** Free account at `console.groq.com` (no card) → set `GROQ_API_KEY`.
* **Endpoint:** `GET https://api.groq.com/openai/v1/models`
* **Headers:** `Authorization: Bearer ${GROQ_API_KEY}`
* **Response Shape:** OpenAI list format: `{ data: Array<{ id, owned_by, active?: boolean, context_window?: number }> }`
* **Exact Filter Logic:**
  * Require `model.active !== false`.
  * Exclude non-chat models via regex blocklist: `/whisper|tts|playai|orpheus|guard|safeguard|embed|moderation/i`.
  * Keep all remaining LLMs (Llama, Qwen, GPT-OSS, Compound, etc.).
* **Published Free Limits & Privacy:** `30 RPM` / `1,000 RPD` (model-dependent). `trains_on_data: false`.

---

### D. Cerebras

* **Key Setup:** Free account at `cloud.cerebras.ai` → set `CEREBRAS_API_KEY`.
* **Endpoint:** `GET https://api.cerebras.ai/v1/models`
* **Headers:** `Authorization: Bearer ${CEREBRAS_API_KEY}`
* **Response Shape:** Standard OpenAI `{ data: Array<{ id, owned_by, created }> }`.
* **Exact Filter Logic:**
  * All active chat LLMs returned on a free key are accessible under the free tier. Exclude any ID matching `/embed|whisper|audio/i`.
  * Because `/v1/models` doesn't always include context window, pull fallback context lengths from `config/aliases.json` or the canonical `models` table.
* **Published Free Limits & Privacy:** `1M tokens/day per model` (with RPM caps; e.g., 5–30 RPM depending on model). `trains_on_data: false`.

---

### E. NVIDIA NIM (NVIDIA Build / Integrate)

* **Key Setup:** Free NVIDIA Developer account at `build.nvidia.com` → generate an Integrate API key (`nvapi-...`) → set `NVIDIA_API_KEY`.
* **Endpoint:** `GET https://integrate.api.nvidia.com/v1/models`
* **Headers:** `Authorization: Bearer ${NVIDIA_API_KEY}`
* **Response Shape:** Standard OpenAI `{ data: Array<{ id, owned_by }> }`.
* **Exact Filter Logic:**
  * **Critical Gotcha:** NVIDIA's `/v1/models` returns 100+ non-chat microservices (embeddings, rerankers, OCR, image/video gen, reward models, robotics).
  * Apply a strict blocklist regex: `/embed|rerank|bge|nvclip|stable-diffusion|flux|sdxl|cosmos|reward|parse|ocr|deplot|pdf|retriever|guard|shield|speech|riva|parakeet|canary|audio|diffusion|3d|trellis|genmol|evo2|alphafold/i`.
  * Keep chat/reasoning LLMs (Llama, DeepSeek, Qwen, Nemotron, Mistral, Gemma, Phi, GPT-OSS, Kimi, GLM). Always trust live `/v1/models` so retired `410 Gone` endpoints drop off automatically.
* **Published Free Limits & Privacy:** Free prototyping credits/rate-limited access via NVIDIA Developer Program. `trains_on_data: false`.

---

### F. Cloudflare Workers AI

* **Key Setup:** Free Cloudflare account (no card) → copy **Account ID** (`CLOUDFLARE_ACCOUNT_ID`) and create an API Token with `Workers AI: Read` permission (`CLOUDFLARE_API_TOKEN`).
* **Endpoint:** `GET https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/models/search?task=Text%20Generation&per_page=100`
  * **Critical Gotcha #1:** Do **NOT** call `/ai/v1/models`—Cloudflare returns `HTTP 405 Method Not Allowed` on that path. Always use `/ai/models/search`.
  * Paginate using `result_info.total_pages` if `total_count > 100`.
* **Headers:** `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`
* **Response Shape:** `{ success: boolean, result: Array<{ id, name, description, source, task: { name }, properties?: Array<{ property_id, value }> }> }`
* **Exact Filter Logic:**
  * **Critical Gotcha #2 (Hosted vs. Proxied):** Filter strictly to `model.source === "hosted"` (or `model.name.startsWith("@cf/")`). Cloudflare's proxied third-party models have **zero** free Neuron allocation.
  * Exclude deprecated/beta-retired entries if `properties` contains `{ property_id: "beta", value: "deprecated" }` or `{ property_id: "planned_deprecation_date" }` in the past.
  * Check `properties` for `context_window` and `function_calling`.
* **Published Free Limits & Privacy:** `10,000 Neurons/day` free on hosted models. `trains_on_data: false`.

---

### G. Mistral AI (Free Mode)

* **Key Setup:** Create account at `console.mistral.ai` → stay on default **Free mode** (no credit card required; phone verification may be required) → generate key → set `MISTRAL_API_KEY`.
* **Endpoint:** `GET https://api.mistral.ai/v1/models`
* **Headers:** `Authorization: Bearer ${MISTRAL_API_KEY}`
* **Response Shape:** `{ data: Array<{ id, name, max_context_length, capabilities: { completion_chat, function_calling, vision }, deprecation?: string | null, aliases?: string[] }> }`
* **Exact Filter Logic:**
  * Require `capabilities.completion_chat === true`.
  * Exclude entries where `deprecation` is non-null and in the past.
  * Deduplicate `-latest` aliases if the dated version it points to is already present (Mistral exposes `aliases` right on the dated model object, so skip rows whose `id` ends in `-latest` to avoid duplicate rows).
  * Map `context_window = max_context_length`, `supports_tools = capabilities.function_calling`, `supports_vision = capabilities.vision`.
* **Published Free Limits & Privacy:** Free mode has restrictive account-level RPS/TPM/monthly limits (exact caps live in Mistral Admin panel). **Must set `trains_on_data: true`**—Mistral explicitly states Free mode API requests may be used to train its models.

---

### H. SambaNova (Optional 8th Provider — Easy Drop-In)

* **Key Setup:** Free SambaCloud account at `cloud.sambanova.ai` → set `SAMBANOVA_API_KEY`.
* **Endpoint:** `GET https://api.sambanova.ai/v1/models`
* **Headers:** `Authorization: Bearer ${SAMBANOVA_API_KEY}`
* **Exact Filter Logic:** Standard OpenAI `{ data: [{ id, context_length? }] }`. Filter out `/whisper|audio|embed/i`.
* **Published Free Limits & Privacy:** Rate-limited free developer tier. `trains_on_data: false`.

---

## 3. Static Provider Metadata Overlay (`config/providers.json`)

Because live `/models` endpoints almost never return free-tier rate limits or data-training policies, check this file into the repo so pollers merge live availability with curated tier metadata:

```json
{
  "openrouter": {
    "display_name": "OpenRouter",
    "rpm_limit": "20 RPM",
    "rpd_limit": "50 RPD (1,000 w/ $10 credit)",
    "trains_on_data": false,
    "privacy_note": "Configurable in OpenRouter account settings; varies by upstream host",
    "requires_credit_card": false,
    "signup_url": "https://openrouter.ai/keys"
  },
  "google": {
    "display_name": "Google AI Studio",
    "rpm_limit": "5–15 RPM",
    "rpd_limit": "20–500+ RPD (per model)",
    "trains_on_data": true,
    "privacy_note": "Free tier prompts may be used to improve Google models",
    "requires_credit_card": false,
    "signup_url": "https://aistudio.google.com/apikey",
    "free_allowlist_prefixes": [
      "gemini-4-hydrogen",
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemma-"
    ],
    "blocklist_substrings": ["tts", "audio", "image", "live", "embedding", "robotics"]
  },
  "groq": {
    "display_name": "Groq",
    "rpm_limit": "30 RPM",
    "rpd_limit": "1,000 RPD",
    "trains_on_data": false,
    "requires_credit_card": false,
    "signup_url": "https://console.groq.com/keys"
  },
  "cerebras": {
    "display_name": "Cerebras",
    "rpm_limit": "5–30 RPM",
    "rpd_limit": "1M tokens/day per model",
    "trains_on_data": false,
    "requires_credit_card": false,
    "signup_url": "https://cloud.cerebras.ai/"
  },
  "nvidia": {
    "display_name": "NVIDIA NIM",
    "rpm_limit": "40 RPM",
    "rpd_limit": "Free dev quota",
    "trains_on_data": false,
    "requires_credit_card": false,
    "signup_url": "https://build.nvidia.com/"
  },
  "cloudflare": {
    "display_name": "Cloudflare Workers AI",
    "rpm_limit": "Account default",
    "rpd_limit": "10,000 Neurons/day (hosted only)",
    "trains_on_data": false,
    "requires_credit_card": false,
    "signup_url": "https://dash.cloudflare.com/"
  },
  "mistral": {
    "display_name": "Mistral AI (Free)",
    "rpm_limit": "1 RPS / Free cap",
    "rpd_limit": "Free monthly token cap",
    "trains_on_data": true,
    "privacy_note": "Free mode requests may be used for model training",
    "requires_credit_card": false,
    "signup_url": "https://console.mistral.ai/"
  },
  "sambanova": {
    "display_name": "SambaNova",
    "rpm_limit": "Free tier cap",
    "rpd_limit": "Free tier cap",
    "trains_on_data": false,
    "requires_credit_card": false,
    "signup_url": "https://cloud.sambanova.ai/"
  }
}
```

---

## 4. Database Upsert & Stale-Model Deactivation Flow (`scripts/sync.ts`)

Have the coding agent execute the provider sync in this exact sequence so live availability stays accurate without ever corrupting data during an API outage:

1. **Run all pollers in parallel** via `Promise.allSettled([pollOpenRouter(), pollGoogle(), pollGroq(), pollCerebras(), pollNvidia(), pollCloudflare(), pollMistral(), pollSambaNova()])`.
2. **For each provider where `result.ok === true && result.models.length > 0`:**
   * Resolve each `provider_model_id` through `normalizeModelId()` (`config/aliases.json` → sanitizer → fallback auto-slug).
   * If unresolved against `aliases.json`, upsert into `unmapped_entities` (`origin_type = 'provider'`).
   * Upsert parent rows into `public.models` (`onConflict: 'canonical_id'`, updating `context_window` using `GREATEST(existing, incoming)` so the largest verified context window wins).
   * Upsert all discovered models into `public.provider_availability` with `is_available = true` and `last_checked_at = now()` (`onConflict: 'provider_slug,provider_model_id'`).
   * **Soft-deactivate dropped models for THIS provider only:**
     ```sql
     update public.provider_availability
     set is_available = false, last_checked_at = now()
     where provider_slug = $1
       and provider_model_id != all($2::text[]);
     ```
3. **For each provider where `result.ok === false`:**
   * Do **not** touch its existing `provider_availability` rows (leave last known good state intact).
   * Append `{ provider: result.provider_slug, error: result.error }` to `sync_runs.error_log` and mark the run `status = 'partial'`.

---

## 5. Automated Scheduling Setup (GitHub Actions + Env Secrets)

Use **GitHub Actions** as the primary runner (avoids Vercel Hobby's 10–60s serverless timeout when fetching 8 provider APIs + Epoch's ZIP + LiveBench + BFCL).

Create `.github/workflows/sync.yml`:

```yaml
name: FreeBench 6-Hour Data Sync

on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch: # Allows manual 1-click refresh in GitHub UI

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Run FreeBench provider & benchmark sync
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GOOGLE_AI_API_KEY: ${{ secrets.GOOGLE_AI_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          CEREBRAS_API_KEY: ${{ secrets.CEREBRAS_API_KEY }}
          NVIDIA_API_KEY: ${{ secrets.NVIDIA_API_KEY }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
          SAMBANOVA_API_KEY: ${{ secrets.SAMBANOVA_API_KEY }}
        run: npx tsx scripts/sync.ts
```

### Verification Checklist for the Agent

* Run `npx tsx scripts/sync.ts --providers-only --dry-run` first to verify JSON parsing and print counts per provider without writing to Supabase.
* Confirm **OpenRouter** works immediately with zero keys set and returns `20+` free models (and does **not** include `openrouter/auto` or `openrouter/free`).
* Confirm **Cloudflare** hits `/ai/models/search` (not `/ai/v1/models`) and excludes any non-hosted proxied models.
* Confirm **Google AI Studio** and **Mistral** rows have `trains_on_data = true` so the UI privacy toggle filters them out cleanly.
