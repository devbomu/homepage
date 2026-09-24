/**
 * 관리자 Worker.
 *
 * 하는 일은 두 가지다.
 *   1. 빌드된 SPA 정적 파일 서빙
 *   2. /api/* 를 API Worker 로 프록시
 *
 * 2번이 중요한 이유:
 * admin.namsu.kim 과 api.namsu.kim 은 서로 다른 오리진이라
 * Cloudflare Access 쿠키가 공유되지 않는다. 브라우저에서 API 로 직접 호출하면
 * 인증 정보를 실어 보낼 방법이 없다 (쿠키는 HttpOnly 라 JS 가 읽지도 못한다).
 *
 * 대신 브라우저가 같은 오리진(/api/...)으로 요청하면, 그 요청은 이미
 * Access 정책을 통과한 상태이고 Access 가 Cf-Access-Jwt-Assertion 헤더를
 * 주입해 준다. 여기서 그 헤더를 그대로 API 로 넘기면 끝이다.
 *
 * 전제: admin.namsu.kim 전체가 Access 정책 뒤에 있어야 한다.
 * 그렇지 않으면 이 프록시가 인증 없는 요청을 그대로 흘려보낸다.
 */
interface Env {
  ASSETS: Fetcher;
  API_ORIGIN: string;
}

/**
 * 보안 헤더.
 *
 * 공개 사이트(apps/web/src/middleware.ts)와 같은 값을 쓴다. 관리자만 쓰는
 * 화면이라 생략해도 된다고 보기 쉬운데, 오히려 여기가 뚫리면 글·설정·미디어가
 * 통째로 넘어간다. Access 가 1차 방어선이고 이건 그 뒤의 한 겹이다.
 *
 * CSP 를 공개 사이트보다 더 좁게 잡을 수 있다. 빌드 산출물에 인라인 스크립트도
 * 인라인 스타일도 없고(Vite 가 전부 외부 파일로 뽑는다), 외부 출처를 하나도
 * 쓰지 않는다. API 호출마저 같은 오리진(/api/*)이라 connect-src 가 'self' 로 끝난다.
 *
 * 예외는 두 가지뿐이다.
 *   - img-src 의 data: → daisyUI 의 로딩 스피너와 파비콘이 data URI 다.
 *   - img-src 의 https: → 미디어 목록과 본문 미리보기에 이미지가 뜬다.
 *     공개 사이트와 같은 이유로 여기를 좁히면 미리보기만 조용히 깨진다.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

/** 응답에 보안 헤더를 얹는다. 캐시 정책은 건드리지 않는다(자산 해시 캐시를 깨뜨린다). */
function harden(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set('Content-Security-Policy', CSP);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  result.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  return result;
}

/** 프록시가 API 로 넘길 헤더. 나머지는 버린다. */
const FORWARD_HEADERS = [
  'cf-access-jwt-assertion',
  'cf-access-authenticated-user-email',
  'content-type',
  'accept',
  'cf-connecting-ip',
  'user-agent',
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return harden(await env.ASSETS.fetch(request));
    }

    const target = new URL(env.API_ORIGIN);
    target.pathname = url.pathname.replace(/^\/api/, '');
    target.search = url.search;

    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // API 의 CORS 검사를 통과시키기 위해 관리자 오리진을 밝힌다.
    headers.set('Origin', url.origin);

    const response = await fetch(
      new Request(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      }),
    );

    /*
     * Access 세션이 만료되면 API 가 로그인 페이지로 3xx 를 준다.
     * 그대로 넘기면 SPA 의 fetch 가 교차 출처 로그인 페이지를 따라가려다
     * CORS 로 실패하고, 화면에는 정체불명의 네트워크 오류만 남는다.
     * (CSP 의 connect-src 'self' 도 같은 요청을 막는다 — 어느 쪽이든 못 따라간다.
     *  CSP 를 붙이면서 콘솔에 드러났을 뿐, 전부터 있던 문제다.)
     *
     * API 는 정상 동작에서 리디렉션을 내지 않으므로, 3xx 는 곧 로그인 만료다.
     * XHR 에는 무엇을 해야 하는지 말해 주는 401 을 준다.
     */
    if (response.status >= 300 && response.status < 400) {
      return harden(
        Response.json(
          {
            error: { code: 'unauthorized', message: '로그인이 만료되었습니다. 새로고침해 주세요.' },
          },
          { status: 401, headers: { 'Cache-Control': 'no-store' } },
        ),
      );
    }

    // 관리자 화면은 어떤 경우에도 캐시하지 않는다.
    const result = harden(response);
    result.headers.set('Cache-Control', 'no-store');
    return result;
  },
} satisfies ExportedHandler<Env>;
