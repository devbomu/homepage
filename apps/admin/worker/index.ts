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
      return env.ASSETS.fetch(request);
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

    // 관리자 화면은 어떤 경우에도 캐시하지 않는다.
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', 'no-store');
    return result;
  },
} satisfies ExportedHandler<Env>;
