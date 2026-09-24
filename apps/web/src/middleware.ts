import { defineMiddleware } from 'astro:middleware';

/**
 * 응답 헤더는 여기서 붙인다.
 *
 * 원래 BaseLayout 의 프론트매터에서 Astro.response.headers 를 건드렸는데,
 * Astro 는 스트리밍으로 렌더하기 때문에 레이아웃이 실행될 시점에는
 * 이미 헤더가 나간 뒤였다. 그래서 운영에서 Cache-Control 이 하나도 붙지 않았다.
 * 미들웨어는 렌더 전에 돌고 응답 전체를 감싸므로 확실하게 적용된다.
 */

/**
 * 대표 호스트. 사이트맵·canonical·RSS 가 모두 이 주소를 쓴다(astro.config 의 site).
 * apex 로 들어온 요청을 여기로 넘겨야 검색엔진이 같은 글을 두 주소로 세지 않는다.
 */
const CANONICAL_HOST = 'www.namsu.kim';

/** 대표 호스트로 넘겨야 하는 호스트들. localhost 는 건드리지 않는다. */
const ALIAS_HOSTS = new Set(['namsu.kim']);

/** 경로별 엣지 캐시 시간(초). 위에서부터 먼저 맞는 규칙을 쓴다. */
const CACHE_RULES: [RegExp, number][] = [
  // 방문자마다 다르거나 색인할 이유가 없는 것은 캐시하지 않는다.
  [/^\/search/, 0],
  // 방명록은 방문자가 남기는 대로 바뀐다. 글 목록과 같은 정도로만 캐시한다.
  [/^\/guestbook$/, 60],
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
  // --- 대표 호스트로 통일 ---
  // 렌더보다 먼저 끝낸다. apex 로 들어온 요청까지 페이지를 그려줄 이유가 없다.
  if (ALIAS_HOSTS.has(context.url.hostname)) {
    const target = new URL(context.url);
    target.hostname = CANONICAL_HOST;
    // GET/HEAD 만 301 이다. 그 외 메서드에 301 을 주면 브라우저가 GET 으로
    // 바꿔 다시 보내면서 본문을 잃는다. 308 은 메서드와 본문을 유지한다.
    const isSafe = context.request.method === 'GET' || context.request.method === 'HEAD';
    return context.redirect(target.toString(), isSafe ? 301 : 308);
  }

  const response = await next();
  const { pathname } = context.url;
  const headers = response.headers;

  // --- 보안 헤더 ---
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 이 사이트를 iframe 에 넣을 이유가 없다.
  headers.set('X-Frame-Options', 'DENY');
  /*
   * CSP 본체는 Astro 가 만들어 이 헤더에 이미 넣어 두었다
   * (astro.config.mjs 의 security.csp). 인라인 스크립트 해시가 빌드마다 바뀌어서
   * 여기서는 만들 수 없다.
   *
   * 그래서 여기서는 절대 set 하지 않는다 — set 하면 Astro 가 만든 정책이
   * 통째로 날아간다. 실제로 한 번 그렇게 만들어 놓고 CSP 가 사라진 적이 있다.
   *
   * 페이지 렌더를 거치지 않는 응답(에러·리디렉션 등)에는 Astro 가 헤더를
   * 붙이지 않으므로, 그때만 최소한의 프레임 보호를 채워 넣는다.
   */
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  }
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
