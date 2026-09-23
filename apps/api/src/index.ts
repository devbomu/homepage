import { Hono } from 'hono';

import type { AppEnv } from './env';
import { isDevelopment, parseList } from './env';
import { handleError, handleNotFound } from './middleware/error';
import { securityHeaders } from './middleware/security';
import { publishDueContent } from './queries/schedule';
import { adminRoutes } from './routes/admin';
import { publicEngagement } from './routes/public/engagement';
import { publicPosts } from './routes/public/posts';
import { publicSite } from './routes/public/site';
import { publicTaxonomy } from './routes/public/taxonomy';

const app = new Hono<AppEnv>();

app.onError(handleError);
app.notFound(handleNotFound);

app.use('*', securityHeaders);

/**
 * CORS.
 *
 * 좋아요·댓글은 브라우저가 이 API 를 직접 호출하므로 교차 출처 허용이 필요하다.
 * 허용 목록은 www / admin 두 오리진뿐이고, 와일드카드는 쓰지 않는다.
 */
app.use('*', async (c, next) => {
  const allowed = [c.env.SITE_URL, c.env.ADMIN_URL, ...parseList(c.env.ALLOWED_ORIGINS)].filter(
    Boolean,
  );
  const origin = c.req.header('Origin');
  const isAllowed = origin != null && allowed.includes(origin);

  if (isAllowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin', { append: true });
  }

  if (c.req.method === 'OPTIONS') {
    if (!isAllowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Cf-Access-Jwt-Assertion, X-Turnstile-Token',
    );
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  }

  await next();
});

/** 헬스체크. 외부 모니터링이 찌를 수 있도록 인증 없이 연다. */
app.get('/health', (c) => c.json({ status: 'ok', environment: c.env.ENVIRONMENT }));

// --- 공개 API ---
app.route('/v1/posts', publicPosts);
// 좋아요/댓글/조회수도 /v1/posts/:slug/... 아래에 붙는다.
app.route('/v1/posts', publicEngagement);
app.route('/v1', publicTaxonomy);
app.route('/v1', publicSite);

// --- 관리자 API (Cloudflare Access 뒤에 있어야 한다) ---
app.route('/v1/admin', adminRoutes);

export default {
  fetch(request: Request, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    // 운영에서 필수 비밀값이 비어 있으면 요청을 받지 않는다.
    // 조용히 기본값으로 넘어가면 Access 검증이나 봇 차단이 꺼진 채로 돌 수 있다.
    if (!isDevelopment(env)) {
      const missing = (
        [
          ['VISITOR_HASH_SALT', env.VISITOR_HASH_SALT],
          ['TURNSTILE_SECRET_KEY', env.TURNSTILE_SECRET_KEY],
          ['ADMIN_EMAILS', env.ADMIN_EMAILS],
          ['CF_ACCESS_TEAM_DOMAIN', env.CF_ACCESS_TEAM_DOMAIN],
          ['CF_ACCESS_AUD', env.CF_ACCESS_AUD],
        ] as const
      )
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name);

      if (missing.length > 0) {
        console.error('missing required configuration', { missing });
        return Response.json(
          { error: { code: 'internal_error', message: '서버 설정이 완료되지 않았습니다.' } },
          { status: 503 },
        );
      }
    }

    return app.fetch(request, env, ctx);
  },

  /**
   * 예약 발행 정리 (5분마다).
   *
   * 실패해도 공개 여부에는 영향이 없다 — visibility.ts 의 조건이 상태와 시각을
   * 함께 보기 때문이다. 그래서 여기서 예외를 삼키고 로그만 남긴다.
   */
  async scheduled(_event: ScheduledController, env: AppEnv['Bindings']) {
    try {
      const result = await publishDueContent(env.DB);
      if (result.posts > 0 || result.pages > 0) {
        console.log('published due content', result);
      }
    } catch (error) {
      console.error('scheduled publish failed', { error: String(error) });
    }
  },
};
