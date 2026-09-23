import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../env';
import { clientIp, computeVisitorHash } from '../lib/visitor';

/**
 * 방문자 해시를 컨텍스트에 심는다.
 *
 * 좋아요 중복 차단과 레이트리밋 키로 쓴다.
 * 원본 IP 는 여기서만 잠깐 읽고 어디에도 저장하지 않는다.
 */
export const withVisitor = createMiddleware<AppEnv>(async (c, next) => {
  const hash = await computeVisitorHash(
    clientIp(c.req.raw.headers),
    c.req.header('User-Agent') ?? '',
    c.env.VISITOR_HASH_SALT,
  );
  c.set('visitorHash', hash);
  await next();
});
