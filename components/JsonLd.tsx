interface JsonLdProps {
  data: Record<string, unknown>;
}

/**
 * Safely embeds Schema.org JSON-LD structured data for SEO and AI search engines.
 */
export function JsonLd({ data }: JsonLdProps) {
  const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}
