import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../env';
import { isAllowedAdmin, tokenFromRequest, verifyAccessToken } from '../lib/access';
import { ApiError } from '../lib/errors';

/**
 * 관리자 경로 보호.
 *
 * Cloudflare Access 가 1차 방어선이고 이건 2차다.
 * Access 정책이 실수로 넓게 열렸을 때를 대비해 허용 이메일까지 확인한다.
 *
 * 주의: 이 미들웨어만으로는 부족하다.
 * api.namsu.kim/v1/admin/* 경로 자체가 Cloudflare Access 정책 뒤에 있어야 한다.
 * 그렇지 않으면 JWT 를 못 가진 요청이 애초에 여기까지 도달한다.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await verifyAccessToken(c.env, tokenFromRequest(c.req.raw.headers));

  if (!isAllowedAdmin(c.env, identity)) {
    // 어떤 이메일이 거부됐는지는 응답에 넣지 않는다 (계정 존재 여부 탐색 방지).
    console.warn('admin access denied', { subject: identity.subject, path: c.req.path });
    throw ApiError.forbidden('관리자 권한이 없습니다.');
  }

  c.set('identity', identity);
  await next();
});
