import { ImageResponse } from 'next/og';
import { getLeaderboardData } from '@/lib/data/queries';
import { getProvidersConfig } from '@/lib/providers/types';

export const alt = 'FreeBench v0.0.1 — Best Free LLMs Right Now';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const { models } = await getLeaderboardData();
  const topThree = models.slice(0, 3);
  const providerCount = Object.keys(getProvidersConfig()).length;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#09090b',
          color: '#f4f4f5',
          padding: '56px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '10px',
                backgroundColor: '#064e3b',
                border: '2px solid #10b981',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '20px',
              }}
            >
              FB
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700 }}>FreeBench v0.0.1</div>
          </div>
          <div style={{ fontSize: '18px', color: '#34d399' }}>
            {`${providerCount} Free Providers · Epoch ECI · LiveBench · BFCL`}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '48px', fontWeight: 800, lineHeight: 1.1 }}>
            Best Free LLMs You Can Use Right Now
          </div>
          <div style={{ fontSize: '22px', color: '#a1a1aa' }}>
            Verified live every 6 hours with zero-data-training filters and agentic coding scores.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          {topThree.map((model, idx) => (
            <div
              key={model.canonical_id}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '20px',
                borderRadius: '12px',
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
              }}
            >
              <div style={{ fontSize: '15px', color: '#34d399' }}>{`#${idx + 1} Free`}</div>
              <div style={{ fontSize: '22px', fontWeight: 700 }}>{model.display_name}</div>
              <div style={{ fontSize: '16px', color: '#a1a1aa' }}>
                {`Composite ${model.freebench_score?.toFixed(1) ?? '—'} · ${model.providers.length} providers`}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
