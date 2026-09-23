import { createMiddleware } from 'hono/factory';

import type { AppEnv, RateLimiter } from '../env';
import { ApiError } from '../lib/errors';

/**
 * Workers 네이티브 레이트리밋.
 *
 * 엣지에서 카운트하므로 D1 쓰기가 전혀 발생하지 않는다.
 * (D1 의 무료 한도는 하루 10만 write 라, 남용 방어를 DB 로 하면
 *  공격자가 그 한도를 태워버릴 수 있다.)
 *
 * 키는 방문자 해시다. withVisitor 미들웨어가 먼저 돌아야 한다.
 */
export function rateLimit(pick: (env: AppEnv['Bindings']) => RateLimiter, scope: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = pick(c.env);

    // 로컬 개발에서는 바인딩이 없을 수 있다.
    if (!limiter?.limit) {
      await next();
      return;
    }

    const { success } = await limiter.limit({ key: `${scope}:${c.get('visitorHash')}` });
    if (!success) throw ApiError.tooManyRequests();

    await next();
  });
}
