import { ImageResponse } from 'next/og';
import { getModelById } from '@/lib/data/queries';
import { formatContextWindow, formatScore } from '@/lib/format';
import { sortProviderOfferings } from '@/lib/providers/limits';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function ModelOgImage({
  params,
}: {
  params: Promise<{ canonicalId: string }>;
}) {
  const { canonicalId } = await params;
  const { model } = await getModelById(canonicalId);

  const title = model?.display_name ?? safeDecode(canonicalId);
  const composite = formatScore(model?.freebench_score);
  const agentic = formatScore(model?.agentic_coding_score);
  const context = formatContextWindow(model?.context_window);
  const providerList =
    (model ? sortProviderOfferings(model.providers).map((p) => p.provider_slug).join(' · ') : '') ||
    'Free API providers';

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
        <div style={{ fontSize: '24px', color: '#34d399', fontWeight: 700 }}>
          FreeBench v0.0.1 · Live Free LLM Report
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '56px', fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: '24px', color: '#a1a1aa' }}>{`Free on: ${providerList}`}</div>
        </div>

        <div style={{ display: 'flex', gap: '20px' }}>
          <div
            style={{
              flex: 1,
              padding: '22px',
              borderRadius: '12px',
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ fontSize: '16px', color: '#a1a1aa' }}>Composite Score</span>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#34d399' }}>
              {composite}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              padding: '22px',
              borderRadius: '12px',
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ fontSize: '16px', color: '#a1a1aa' }}>Agentic Coding</span>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#22d3ee' }}>{agentic}</span>
          </div>
          <div
            style={{
              flex: 1,
              padding: '22px',
              borderRadius: '12px',
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ fontSize: '16px', color: '#a1a1aa' }}>Context Window</span>
            <span style={{ fontSize: '36px', fontWeight: 700 }}>{context}</span>
          </div>
        </div>
      </div>
    ),
    size
  );
}
