# FreeBench v0.0.1 — 3-Wave Improvement Roadmap

Saved persistent roadmap generated from the 3-specialist audit (**UI/UX Design Expert**, **AI & Data Systems Engineer**, and **End-User Developer Advocate**).
Goal: Maximize real developer value for answering *"What is the best free LLM model I can use right now for my task?"* while staying **\$0/month** on free tiers.

---

## Wave 1 (P0 — Critical Bugs & High-ROI Quick Wins)

- [x] **#1 — Fix Sync Pipeline Integrity & Batch SQL RPCs** (`Impact: 10/10 · Difficulty: 4/10`)
  - *Files:* `scripts/sync.ts`, `supabase/migrations/0001_initial_schema.sql`
  - Deduplicate `scoreRows` before upsert (prevents Postgres `21000` duplicate-key crash); inspect `{ error }` on all Supabase calls; batch N+1 loops via `upsert_models_batch`, `upsert_unmapped_entities_batch` (atomically incrementing `seen_count` and resolving newly matched rows), and `bulk_update_model_scores`; persist benchmark scores for all alias-matched canonical models; compute staleness per benchmark source; use deterministic Pulse event URLs; separate skipped optional keys from real API failures.
- [x] **#2 — Fix Privacy Mislabeling & Paid-Model Leakage** (`Impact: 9/10 · Difficulty: 3/10`)
  - *Files:* `lib/providers/openrouter.ts`, `lib/providers/siliconflow.ts`, `lib/providers/chutes.ts`, `lib/providers/pollinations.ts`, `lib/providers/google.ts`, `lib/providers/http.ts`, `lib/providers/types.ts`, `config/providers.json`
  - Require `:free` suffix and set `trains_on_data: !hasZdr` on OpenRouter; add `free_allowlist_prefixes` to SiliconFlow; filter out non-zero `price` models on Chutes; restrict Pollinations strictly to anonymous tier; fix Gemma 3 vision detection on Google; mark `skipped: true` on missing-env skips.
- [x] **#3 — Fix Broken Agent Snippets, `SnippetPanel` Bugs & Copy Utilities** (`Impact: 9/10 · Difficulty: 3/10`)
  - *Files:* `lib/snippets/generator.ts`, `components/SnippetPanel.tsx`, `components/CopyButton.tsx`, `components/leaderboard/ModelDetailDrawer.tsx`, `app/models/[canonicalId]/page.tsx`, `app/providers/[providerSlug]/page.tsx`
  - Emit strict valid JSON for OpenCode (`@ai-sdk/openai-compatible` + `models` block, native Google provider config); fix anonymous Pollinations curl, OpenRouter attribution headers, Cloudflare placeholder, and native Aider prefixes; add `Kilo Code` & `LiteLLM` snippet tabs; fix `selectedIdx` reset bug on model switch; default-select Always-Free + Zero-Training; persist preferred tab in `localStorage`; add `<CopyButton />` on `provider_model_id` and `<SnippetPanel />` on `/providers/[providerSlug]`.
- [x] **#4 — Reclaim Above-the-Fold Hierarchy (<10s Answer)** (`Impact: 9/10 · Difficulty: 3/10`)
  - *Files:* `app/page.tsx`
  - Tighten hero copy, surface top Always-Free provider + limit on `#1 Overall` and `#1 Agentic Code` instant-answer cards, and move the 4-card Pulse grid below the leaderboard (keeping a slim 1-line live radar strip above) so `FilterBar` + top rows sit cleanly above the fold.
- [x] **#5 — Fix Corrupted Aliases, Normalizer & Seed Snapshot** (`Impact: 9/10 · Difficulty: 3/10`)
  - *Files:* `config/aliases.json`, `lib/normalization/normalize.ts`, `data/seed-snapshot.json`, `tests/normalization.test.ts`
  - Split `gemma-3-12b-it` out of `27b`, `deepseek-r1-distill-qwen-32b` out of `llama-70b`, `glm-4.5-air` / `glm-4.5-flash` out of `glm-4.5`, and distinct dated revisions (`r1-0528`, `v3-0324`); upgrade `sanitizeModelIdentifier()` for `-free`, `(fc)`, `(prompt)`, and generic namespaces; fix misplaced entries in `seed-snapshot.json`; add CI alias-collision invariant test.
- [x] **#6 — Transparency, Trust Signals & Dynamic Provider Copy** (`Impact: 8/10 · Difficulty: 3/10`)
  - *Files:* `components/MethodologyModal.tsx`, `components/Navbar.tsx`, `components/leaderboard/LeaderboardTable.tsx`, `app/layout.tsx`, `app/best/[task]/page.tsx`, `app/changelog/page.tsx`, `app/llms.txt/route.ts`, `app/opengraph-image.tsx`, `app/status/page.tsx`, `lib/data/queries.ts`
  - Add accessible Scoring Methodology modal (`Composite` + `Agentic Coding` weights + coverage explanation), named-pillar `CoverageDots` labels, truthful `Navbar` sync badge (`Seed Snapshot` vs `Live`), and dynamic provider count everywhere instead of hardcoded `"8"`.

---

## Wave 2 (P1 — High-Impact Product Differentiators)

- [x] **#7 — Eliminate Partial-Coverage Ranking Bias & Add Real Coding Benchmarks** (`Impact: 9/10 · Difficulty: 5/10`)
  - *Files:* `lib/scoring/composite.ts`, `config/benchmarks.json`, `lib/benchmarks/`, `supabase/migrations/`
  - Cross-pillar z-score/percentile standardization + Bayesian shrinkage (`λ = 0.25`) so 1-pillar or missing-ECI models cannot game `#1`; require `benchmark_coverage >= 2` for `#1`/`new_leader`; dynamic ECI scaling; ingest **Aider Polyglot** & **SWE-bench Verified**.
- [x] **#8 — URL-Synced Filters/Compare, "My Free Keys" Profile & Compact Provider Picker** (`Impact: 9/10 · Difficulty: 4/10`)
  - *Files:* `components/leaderboard/LeaderboardClient.tsx`, `components/leaderboard/FilterBar.tsx`, `components/compare/CompareClient.tsx`
  - Sync all leaderboard filters/sort & `/compare?models=...` to URL search params; add `localStorage` **"My Free Keys"** filter toggle; collapse 15 provider chips into a searchable grouped multi-select dropdown; add `/` search shortcut & empty-state Reset button.
- [x] **#9 — Structured Rate Limits (TPM / TPD / Reset Clock) & "Agent Session Viability" Rating** (`Impact: 9/10 · Difficulty: 4/10`)
  - *Files:* `config/providers.json`, `supabase/migrations/`, `lib/providers/types.ts`, `components/leaderboard/`
  - Add `rpm_int`, `rpd_int`, `tpm_int`, `tpd_int`, `quota_reset_tz`, and per-model overrides (Groq TPM caps, Google per-model RPD, Cloudflare Neuron math); display **Session Viability Badge** (`Full Agent Loop` / `Short Tasks` / `1-Shot Chat`) + live daily reset countdown.
- [x] **#10 — Multi-Provider "Free Fallback Stack" Builder** (`Impact: 9/10 · Difficulty: 5/10`)
  - *Files:* New `app/stack/page.tsx`, `lib/snippets/generator.ts`, `components/SnippetPanel.tsx`
  - Let developers check owned free keys + constraints and generate a self-healing multi-provider failover config (`litellm_config.yaml` with 429 cooldowns, OpenRouter fallback array, `opencode.json` primary + `small_model`).
- [x] **#11 — Disambiguate Trial Credit vs. Trains-on-Data Badges + Touch Popovers** (`Impact: 8/10 · Difficulty: 4/10`)
  - *Files:* `components/ProviderBadge.tsx`, `components/leaderboard/LeaderboardTable.tsx`
  - Separate semantic colors (Amber Dashed = `Credit`, Rose = `Trains on Data`, Solid Emerald/Zinc = `Always Free + Zero Training`), sort provider badges deterministically before slicing, and replace native `title` tooltips with accessible tap/hover/focus popovers.
- [x] **#12 — Drawer/Table Accessibility & Mobile Card Layout** (`Impact: 8/10 · Difficulty: 5/10`)
  - *Files:* `components/leaderboard/ModelDetailDrawer.tsx`, `components/leaderboard/LeaderboardTable.tsx`, `components/ScoreBar.tsx`, `app/globals.css`
  - Add `Escape` close, focus trap, focus restoration, and body scroll lock to `ModelDetailDrawer`; add keyboard-accessible row `Inspect` button & `aria-sort`; add responsive `md:hidden` mobile cards; upgrade muted contrast (`zinc-500/600` → `zinc-400`).
- [x] **#13 — Upgrade `/best/[task]` Columns & `/compare` Matrix** (`Impact: 8/10 · Difficulty: 5/10`)
  - *Files:* `app/best/[task]/page.tsx`, `components/compare/CompareClient.tsx`
  - Render dynamic task-specific metric columns (`Math`, `Reasoning`, etc.) and reuse `LeaderboardClient` on `/best/[task]`; add per-row winner highlights, best Always-Free rate limit row, and `"Use This Model"` snippet drawer to `/compare`.

---

## Wave 3 (P2 — Category-Defining Moat, Telemetry & Monetization)

- [x] **#14 — Zero-Cost Rotating Canary Probes (Live Uptime, TTFT / tok-s & Header Discovery) + Crowdsourced 429 Signal** (`Impact: 10/10 · Difficulty: 7/10`)
  - *Files:* New `lib/probes/canary.ts`, `scripts/sync.ts`, `supabase/migrations/`, `components/SnippetPanel.tsx`
  - Probe 15–20 stalest endpoints per sync with an 8-token stream (`$0`/mo) to measure live TTFT, tokens/sec, 7d uptime, and parse `x-ratelimit-limit-*` headers; add crowdsourced `"Hit 429?"` signal and optional browser-side BYOK ping test.
- [x] **#15 — Filterable Agent Router API (`/api/v1/route`), Self-Configuring `/llms.txt`, `npx freebench` CLI & `freebench-mcp`** (`Impact: 8/10 · Difficulty: 5/10`)
  - *Files:* `app/api/v1/models/route.ts`, new `app/api/v1/route/route.ts`, `app/llms.txt/route.ts`, `.github/workflows/sync.yml`, `app/api/revalidate/route.ts`
  - Add query filtering + CORS to `/api/v1/models`; add `/api/v1/route?task=agentic-coding`; enrich `/llms.txt` with base URLs & env vars; split GitHub Actions into hourly `--providers-only` + 12h benchmarks; switch ISR invalidation to `revalidateTag('leaderboard')`.
- [x] **#16 — Retention & Ethical Monetization Loops ("My Stack" Pins, Instant Drop/Quota Alerts & Paid Escape-Hatch Pricing)** (`Impact: 8/10 · Difficulty: 6/10`)
  - *Files:* `components/pulse/PulseClient.tsx`, `app/changelog/page.tsx`, `lib/pulse/bluesky.ts`, `lib/pulse/rss.ts`, `app/feed.xml/route.ts`
  - `localStorage` pinned stack highlighting dropped/overtaken models; `quota_changed` events; filtered RSS + instant Discord/Slack drop alerts; Bluesky repost filtering & numeric entity decoding; honest cheapest paid fallback $/1M comparison.
