import type { MetadataRoute } from 'next';
import { getLeaderboardData, TASK_DEFINITIONS } from '@/lib/data/queries';
import { getProvidersConfig } from '@/lib/providers/types';

export const revalidate = 21600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = (process.env.SITE_URL?.trim() || 'https://freebench.dev').replace(/\/$/, '');
  const { models, latestSync } = await getLeaderboardData();
  const lastMod = new Date(latestSync?.completed_at ?? latestSync?.started_at ?? Date.now());
  const providerSlugs = Object.keys(getProvidersConfig());

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: lastMod, changeFrequency: 'hourly', priority: 1.0 },
    { url: `${siteUrl}/pulse`, lastModified: lastMod, changeFrequency: 'hourly', priority: 0.9 },
    {
      url: `${siteUrl}/changelog`,
      lastModified: lastMod,
      changeFrequency: 'hourly',
      priority: 0.85,
    },
    { url: `${siteUrl}/compare`, lastModified: lastMod, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/status`, lastModified: lastMod, changeFrequency: 'hourly', priority: 0.6 },
  ];

  const taskRoutes: MetadataRoute.Sitemap = TASK_DEFINITIONS.map((task) => ({
    url: `${siteUrl}/best/${task.slug}`,
    lastModified: lastMod,
    changeFrequency: 'hourly',
    priority: 0.95,
  }));

  const providerRoutes: MetadataRoute.Sitemap = providerSlugs.map((slug) => ({
    url: `${siteUrl}/providers/${slug}`,
    lastModified: lastMod,
    changeFrequency: 'hourly',
    priority: 0.85,
  }));

  const modelRoutes: MetadataRoute.Sitemap = models.map((model) => ({
    url: `${siteUrl}/models/${encodeURIComponent(model.canonical_id)}`,
    lastModified: new Date(model.updated_at || lastMod),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...staticRoutes, ...taskRoutes, ...providerRoutes, ...modelRoutes];
}
