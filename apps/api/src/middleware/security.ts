import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../env';

/**
 * API 응답 보안 헤더.
 * HTML 을 서빙하지 않으므로 CSP 는 프런트엔드 쪽에서 설정한다.
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  // 이 API 에는 브라우저 기능이 필요 없다.
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
});
