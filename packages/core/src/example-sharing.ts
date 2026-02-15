// ============================================================================
// Types
// ============================================================================

export type SharePlatform = 'twitter' | 'linkedin' | 'facebook' | 'reddit' | 'hackernews';

export type EmbedFormat = 'html' | 'markdown' | 'react';

export interface ShareableExample {
  id: string;
  title: string;
  description: string;
  code: string;
  language: string;
  author?: string;
  tags?: string[];
}

export interface ShareUrlResult {
  platform: SharePlatform;
  url: string;
}

export interface OpenGraphMeta {
  'og:title': string;
  'og:description': string;
  'og:url': string;
  'og:type': string;
  'og:image': string;
  'og:site_name': string;
}

export interface TwitterCardMeta {
  'twitter:card': string;
  'twitter:title': string;
  'twitter:description': string;
  'twitter:image': string;
  'twitter:site'?: string;
  'twitter:creator'?: string;
}

export interface EmbedSnippet {
  format: EmbedFormat;
  code: string;
}

export interface ShareAnalyticsEntry {
  exampleId: string;
  platform: SharePlatform;
  timestamp: string;
  count: number;
}

export interface ShareAnalyticsSummary {
  exampleId: string;
  totalShares: number;
  byPlatform: Record<string, number>;
}

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = 'https://docsynth.dev/examples';
const OG_IMAGE_BASE = 'https://docsynth.dev/og';
const SITE_NAME = 'DocSynth';

// ============================================================================
// Public Functions
// ============================================================================

/** Generate a shareable URL for a code example. */
export function generateShareUrl(example: ShareableExample): string {
  return `${BASE_URL}/${encodeURIComponent(example.id)}`;
}

/** Generate share URLs for all supported social platforms. */
export function generatePlatformShareUrls(example: ShareableExample): ShareUrlResult[] {
  const shareUrl = generateShareUrl(example);
  const text = encodeURIComponent(`${example.title} - ${example.description}`);
  const encodedUrl = encodeURIComponent(shareUrl);

  return [
    { platform: 'twitter', url: `https://twitter.com/intent/tweet?text=${text}&url=${encodedUrl}` },
    {
      platform: 'linkedin',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    { platform: 'facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { platform: 'reddit', url: `https://www.reddit.com/submit?url=${encodedUrl}&title=${text}` },
    {
      platform: 'hackernews',
      url: `https://news.ycombinator.com/submitlink?u=${encodedUrl}&t=${text}`,
    },
  ];
}

/** Generate Open Graph meta tags for social media previews. */
export function generateOpenGraphMeta(example: ShareableExample): OpenGraphMeta {
  return {
    'og:title': example.title,
    'og:description': truncate(example.description, 200),
    'og:url': generateShareUrl(example),
    'og:type': 'article',
    'og:image': `${OG_IMAGE_BASE}/${encodeURIComponent(example.id)}.png`,
    'og:site_name': SITE_NAME,
  };
}

/** Generate Twitter Card meta tags. */
export function generateTwitterCardMeta(example: ShareableExample, site?: string): TwitterCardMeta {
  const meta: TwitterCardMeta = {
    'twitter:card': 'summary_large_image',
    'twitter:title': example.title,
    'twitter:description': truncate(example.description, 200),
    'twitter:image': `${OG_IMAGE_BASE}/${encodeURIComponent(example.id)}.png`,
  };
  if (site) meta['twitter:site'] = site;
  if (example.author) meta['twitter:creator'] = example.author;
  return meta;
}

/** Generate HTML meta tag string from Open Graph + Twitter Card data. */
export function generateMetaTagsHtml(example: ShareableExample, twitterSite?: string): string {
  const og = generateOpenGraphMeta(example);
  const tc = generateTwitterCardMeta(example, twitterSite);

  const ogTags = Object.entries(og)
    .map(([prop, content]) => `<meta property="${prop}" content="${escapeAttr(content)}" />`)
    .join('\n');

  const tcTags = Object.entries(tc)
    .map(([name, content]) => `<meta name="${name}" content="${escapeAttr(content)}" />`)
    .join('\n');

  return `${ogTags}\n${tcTags}`;
}

/** Generate an embed code snippet in the requested format. */
export function generateEmbedSnippet(example: ShareableExample, format: EmbedFormat): EmbedSnippet {
  const url = generateShareUrl(example);
  let code: string;

  switch (format) {
    case 'html':
      code = `<iframe src="${url}/embed" width="100%" height="500" style="border:0;border-radius:4px;overflow:hidden;" title="${escapeAttr(example.title)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
      break;
    case 'markdown':
      code = `[![${example.title}](${OG_IMAGE_BASE}/${encodeURIComponent(example.id)}.png)](${url})\n\n> ${example.description}`;
      break;
    case 'react':
      code = `import { DocSynthEmbed } from '@docsynth/react';\n\nexport function Example() {\n  return <DocSynthEmbed exampleId="${example.id}" height={500} />;\n}`;
      break;
  }

  return { format, code };
}

/** Record a share event and return updated analytics entry. */
export function recordShareEvent(
  entries: ShareAnalyticsEntry[],
  exampleId: string,
  platform: SharePlatform
): ShareAnalyticsEntry[] {
  const existing = entries.find((e) => e.exampleId === exampleId && e.platform === platform);

  if (existing) {
    return entries.map((e) =>
      e === existing ? { ...e, count: e.count + 1, timestamp: new Date().toISOString() } : e
    );
  }

  return [...entries, { exampleId, platform, timestamp: new Date().toISOString(), count: 1 }];
}

/** Summarize share analytics for a given example. */
export function summarizeShareAnalytics(
  entries: ShareAnalyticsEntry[],
  exampleId: string
): ShareAnalyticsSummary {
  const relevant = entries.filter((e) => e.exampleId === exampleId);
  const byPlatform: Record<string, number> = {};
  let totalShares = 0;

  for (const entry of relevant) {
    byPlatform[entry.platform] = (byPlatform[entry.platform] ?? 0) + entry.count;
    totalShares += entry.count;
  }

  return { exampleId, totalShares, byPlatform };
}

// ============================================================================
// Internal Helpers
// ============================================================================

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
