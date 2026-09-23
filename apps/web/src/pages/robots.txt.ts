import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'https://www.namsu.kim';

  // 검색 결과 페이지는 색인할 가치가 없고 크롤 예산만 쓴다.
  const body = `User-agent: *
Allow: /
Disallow: /search

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
