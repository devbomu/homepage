import type { APIRoute } from 'astro';

import { api } from '@lib/api';

/**
 * 사이트맵.
 *
 * 글이 DB 에 있어 빌드 시점에 알 수 없으므로 요청 때 만든다.
 * (@astrojs/sitemap 은 정적 경로만 다룬다.)
 */
export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? 'https://www.namsu.kim';

  const [feed, categories, tags, nav] = await Promise.all([
    api.posts.feed().then((r) => r.data ?? []),
    api.categories.tree().then((r) => r.data ?? []),
    api.tags.list().then((r) => r.data ?? []),
    api.site.nav().then((r) => r.data ?? []),
  ]);

  const entries: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: '/', priority: '1.0' },
    { loc: '/blog', priority: '0.9' },
    { loc: '/categories', priority: '0.6' },
    { loc: '/tags', priority: '0.6' },
    { loc: '/projects', priority: '0.7' },
  ];

  for (const post of feed) {
    entries.push({
      loc: `/blog/${encodeURIComponent(post.slug)}`,
      lastmod: new Date(post.updatedAt * 1000).toISOString(),
      priority: '0.8',
    });
  }

  const walk = (nodes: typeof categories) => {
    for (const node of nodes) {
      entries.push({
        loc: `/category/${node.path.split('/').map(encodeURIComponent).join('/')}`,
        priority: '0.5',
      });
      walk(node.children);
    }
  };
  walk(categories);

  for (const tag of tags)
    entries.push({ loc: `/tag/${encodeURIComponent(tag.slug)}`, priority: '0.4' });
  for (const page of nav)
    entries.push({ loc: `/${encodeURIComponent(page.slug)}`, priority: '0.7' });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${origin}${entry.loc}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
