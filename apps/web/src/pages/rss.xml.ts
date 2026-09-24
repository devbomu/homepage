import type { APIRoute } from 'astro';

import { api } from '@lib/api';
import { collectRssSources } from '@lib/feeds';

/** XML 에 넣을 수 없는 문자를 이스케이프한다. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? 'https://www.namsu.kim';

  // 사이트 제목·소개가 잠깐 안 나오면 기본값으로 나간다. 글은 필수다.
  const sources = await collectRssSources(api);
  const posts = sources.posts.slice(0, 50);

  const title = (sources.settings['site.title'] as string | undefined) ?? 'namsu.kim';
  const description = (sources.settings['site.description'] as string | undefined) ?? '';

  const items = posts
    .map((post) => {
      const url = `${origin}/blog/${encodeURIComponent(post.slug)}`;
      const pubDate = post.publishedAt ? new Date(post.publishedAt * 1000).toUTCString() : '';
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${post.summary ? `<description>${escapeXml(post.summary)}</description>` : ''}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(description)}</description>
    <language>ko</language>
    <atom:link href="${escapeXml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600',
    },
  });
};
