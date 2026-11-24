import { describe, expect, it } from 'vitest';
import { filterBlueskyFeed } from '@/lib/pulse/bluesky';
import { parseFeedXml } from '@/lib/pulse/rss';
import { generateProviderSnippets } from '@/lib/snippets/generator';

describe('Pulse Aggregator & Snippet Generator', () => {
  it('parses Atom and RSS feeds safely', () => {
    const atomXml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>OpenCode v0.9.1 &amp; Free Zen Routing &#8217;26 &#x2728;</title>
          <link rel="alternate" href="https://github.com/anomalyco/opencode/releases/tag/v0.9.1" />
          <updated>2026-11-24T01:00:00Z</updated>
          <summary><![CDATA[<p>Adds free model fallbacks.</p>]]></summary>
        </entry>
      </feed>`;

    const items = parseFeedXml(atomXml, {
      source_id: 'opencode-releases',
      source_name: 'OpenCode Releases',
      source_type: 'agent_release',
      tags: ['opencode'],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "OpenCode v0.9.1 & Free Zen Routing ’26 ✨",
      summary: 'Adds free model fallbacks.',
      url: 'https://github.com/anomalyco/opencode/releases/tag/v0.9.1',
    });
  });

  it('filters Bluesky feeds by keywords and builds canonical bsky.app URLs', () => {
    const raw = {
      feed: [
        {
          post: {
            uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz',
            record: {
              text: 'New free open model release on Groq today!',
              createdAt: '2026-11-24T02:00:00Z',
            },
            author: { handle: 'simonwillison.net', displayName: 'Simon Willison' },
          },
        },
        {
          post: {
            uri: 'at://did:plc:abc/app.bsky.feed.post/3kzzz',
            record: {
              text: 'Nice coffee weather in London.',
              createdAt: '2026-11-24T01:00:00Z',
            },
            author: { handle: 'simonwillison.net', displayName: 'Simon Willison' },
          },
        },
        {
          reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
          post: {
            uri: 'at://did:plc:other/app.bsky.feed.post/3repost',
            record: {
              text: 'Free model drop reposted from someone else!',
              createdAt: '2026-11-24T01:30:00Z',
            },
            author: { handle: 'someone-else.bsky.social', displayName: 'Other' },
          },
        },
      ],
    };

    const items = filterBlueskyFeed(raw, {
      source_id: 'bsky-simonw',
      source_name: 'Simon Willison',
      handle: 'simonwillison.net',
      tags: ['kol'],
      include_keywords: ['free', 'model'],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://bsky.app/profile/simonwillison.net/post/3kxyz');
  });

  it('generates protocol-accurate SDK & Agent snippets per provider', () => {
    const googleSnippets = generateProviderSnippets('google', 'gemini-2.5-flash');
    expect(googleSnippets.find((s) => s.id === 'curl')?.code).toContain(
      'generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );

    const cfSnippets = generateProviderSnippets('cloudflare', '@cf/openai/gpt-oss-120b');
    expect(cfSnippets.find((s) => s.id === 'curl')?.code).toContain(
      '/ai/run/@cf/openai/gpt-oss-120b'
    );

    const groqSnippets = generateProviderSnippets('groq', 'moonshotai/kimi-k2-instruct');
    expect(groqSnippets.find((s) => s.id === 'opencode')?.code).toContain(
      'https://api.groq.com/openai/v1'
    );
    expect(groqSnippets.find((s) => s.id === 'hermes')?.code).toContain(
      'moonshotai/kimi-k2-instruct'
    );
    expect(groqSnippets.find((s) => s.id === 'kilo-code')).toBeDefined();
    expect(groqSnippets.find((s) => s.id === 'litellm')?.code).toContain(
      'model: openai/moonshotai/kimi-k2-instruct'
    );

    for (const [provider, model] of [
      ['openrouter', 'deepseek/deepseek-r1:free'],
      ['google', 'gemini-2.5-flash'],
      ['groq', 'moonshotai/kimi-k2-instruct'],
      ['pollinations', 'openai'],
      ['cloudflare', '@cf/openai/gpt-oss-120b'],
    ] as const) {
      const opencodeCode = generateProviderSnippets(provider, model).find(
        (s) => s.id === 'opencode'
      )?.code;
      expect(opencodeCode).toBeDefined();
      expect(() => JSON.parse(opencodeCode!)).not.toThrow();
    }

    const pollinationsCurl = generateProviderSnippets('pollinations', 'openai').find(
      (s) => s.id === 'curl'
    )?.code;
    expect(pollinationsCurl).not.toContain('Authorization: Bearer');
    expect(cfSnippets.find((s) => s.id === 'opencode')?.code).toContain(
      '<YOUR_CLOUDFLARE_ACCOUNT_ID>'
    );
  });
});
