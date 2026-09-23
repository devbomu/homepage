import { defineMiddleware } from 'astro:middleware';

/**
 * 응답 헤더는 여기서 붙인다.
 *
 * 원래 BaseLayout 의 프론트매터에서 Astro.response.headers 를 건드렸는데,
 * Astro 는 스트리밍으로 렌더하기 때문에 레이아웃이 실행될 시점에는
 * 이미 헤더가 나간 뒤였다. 그래서 운영에서 Cache-Control 이 하나도 붙지 않았다.
 * 미들웨어는 렌더 전에 돌고 응답 전체를 감싸므로 확실하게 적용된다.
 */

/** 경로별 엣지 캐시 시간(초). 위에서부터 먼저 맞는 규칙을 쓴다. */
const CACHE_RULES: [RegExp, number][] = [
  // 방문자마다 다르거나 색인할 이유가 없는 것은 캐시하지 않는다.
  [/^\/search/, 0],
  // 분류 체계는 거의 안 바뀐다.
  [/^\/(categories|tags|projects)$/, 300],
  [/^\/(sitemap\.xml|robots\.txt)$/, 3600],
  [/^\/rss\.xml$/, 1800],
  // 글과 목록은 관리자가 고치면 빨리 반영되어야 한다.
  [/^\/(blog|category|tag)(\/|$)/, 60],
  [/^\/$/, 60],
];

function cacheSecondsFor(pathname: string): number {
  for (const [pattern, seconds] of CACHE_RULES) {
    if (pattern.test(pathname)) return seconds;
  }
  // 관리자가 만든 단독 페이지(/about, /now ...)
  return 300;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const { pathname } = context.url;
  const headers = response.headers;

  // --- 보안 헤더 ---
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 이 사이트를 iframe 에 넣을 이유가 없다.
  headers.set('X-Frame-Options', 'DENY');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );

  // --- 엣지 캐시 ---
  // 정적 자산은 어댑터가 _headers 로 이미 불변 캐시를 걸어두므로 건드리지 않는다.
  if (!pathname.startsWith('/_astro/') && !headers.has('Cache-Control')) {
    const seconds = cacheSecondsFor(pathname);
    headers.set(
      'Cache-Control',
      seconds > 0
        ? `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=600`
        : 'private, no-store',
    );
  }

  return response;
});
