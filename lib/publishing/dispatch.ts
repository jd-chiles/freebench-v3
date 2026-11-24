import { z } from 'zod';
import { fetchJsonWithTimeout } from '@/lib/providers/http';
import type { AvailabilityEventRecord, ProviderSlug } from '@/lib/supabase/types';

export type PendingAvailabilityEvent = Omit<AvailabilityEventRecord, 'id' | 'detected_at'>;

export interface KeyExpiredAlert {
  provider: ProviderSlug;
  envVar: string;
  error: string;
}

const BlueskySessionSchema = z.object({
  did: z.string(),
  accessJwt: z.string(),
});

const SEVERITY_PRIORITY: Record<AvailabilityEventRecord['event_type'], number> = {
  model_dropped: 0,
  quota_changed: 1,
  new_leader: 2,
  model_added: 3,
};

const SEVERITY_TAG: Record<AvailabilityEventRecord['event_type'], string> = {
  model_dropped: '[DROPPED]',
  quota_changed: '[QUOTA]',
  new_leader: '[#1 LEADER]',
  model_added: '[ADDED]',
};

function prioritizeEvents(events: PendingAvailabilityEvent[]): PendingAvailabilityEvent[] {
  return [...events].sort(
    (a, b) => SEVERITY_PRIORITY[a.event_type] - SEVERITY_PRIORITY[b.event_type]
  );
}

function formatEventBatchMessage(events: PendingAvailabilityEvent[]): string {
  const siteUrl = process.env.SITE_URL?.trim() || 'https://freebench.dev';
  const prioritized = prioritizeEvents(events);
  const top = prioritized.slice(0, 5);
  const lines = top.map((evt) => `- ${SEVERITY_TAG[evt.event_type]} ${evt.headline}`);
  if (prioritized.length > 5) {
    lines.push(`- ...and ${prioritized.length - 5} more updates`);
  }
  return `FreeBench Radar Alert:\n${lines.join('\n')}\n\nChangelog & RSS: ${siteUrl}/changelog`;
}

async function postWebhookJson(url: string, body: unknown): Promise<boolean> {
  try {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(handle);
    }
  } catch {
    return false;
  }
}

async function postToDiscord(webhookUrl: string, events: PendingAvailabilityEvent[]): Promise<boolean> {
  return postWebhookJson(webhookUrl, { content: formatEventBatchMessage(events) });
}

async function postToSlack(webhookUrl: string, events: PendingAvailabilityEvent[]): Promise<boolean> {
  return postWebhookJson(webhookUrl, { text: formatEventBatchMessage(events) });
}

async function postToBluesky(
  handle: string,
  appPassword: string,
  events: PendingAvailabilityEvent[]
): Promise<boolean> {
  try {
    const sessionRaw = await fetchJsonWithTimeout<unknown>(
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
      },
      10_000
    );
    const session = BlueskySessionSchema.parse(sessionRaw);
    const text = formatEventBatchMessage(events).slice(0, 295);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record: {
            $type: 'app.bsky.feed.post',
            text,
            createdAt: new Date().toISOString(),
          },
        }),
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/**
 * Publishes prioritized model availability & drop events to optional outbound
 * channels (Discord, Slack, Bluesky AT Protocol). Never throws on network errors.
 */
export async function dispatchAvailabilityEvents(
  events: PendingAvailabilityEvent[]
): Promise<string[]> {
  if (events.length === 0) return [];

  const deliveredChannels: string[] = [];
  const discordUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const bskyHandle = process.env.BLUESKY_HANDLE?.trim();
  const bskyPassword = process.env.BLUESKY_APP_PASSWORD?.trim();

  if (discordUrl) {
    const ok = await postToDiscord(discordUrl, events);
    if (ok) deliveredChannels.push('discord');
  }

  if (slackUrl) {
    const ok = await postToSlack(slackUrl, events);
    if (ok) deliveredChannels.push('slack');
  }

  if (bskyHandle && bskyPassword) {
    const ok = await postToBluesky(bskyHandle, bskyPassword, events);
    if (ok) deliveredChannels.push('bluesky');
  }

  return deliveredChannels;
}

/**
 * Sends private ops alerts to configured Discord/Slack webhooks when a provider poller fails
 * with HTTP 401/403 so expired or revoked API keys can be rotated quickly.
 */
export async function dispatchKeyExpiredAlerts(alerts: KeyExpiredAlert[]): Promise<string[]> {
  if (alerts.length === 0) return [];

  const siteUrl = (process.env.SITE_URL?.trim() || 'https://freebench.dev').replace(/\/$/, '');
  const lines = alerts.map(
    (item) => `- [KEY EXPIRED] **${item.provider}** (\`${item.envVar}\`): ${item.error}`
  );
  const message = `FreeBench Ops Alert (Key Rotation Needed):\n${lines.join('\n')}\n\nStatus: ${siteUrl}/status`;

  const deliveredChannels: string[] = [];
  const discordUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();

  if (discordUrl) {
    const ok = await postWebhookJson(discordUrl, { content: message });
    if (ok) deliveredChannels.push('discord');
  }

  if (slackUrl) {
    const ok = await postWebhookJson(slackUrl, { text: message });
    if (ok) deliveredChannels.push('slack');
  }

  return deliveredChannels;
}
