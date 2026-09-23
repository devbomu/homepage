import { Hono } from 'hono';

import type { AppEnv } from '../../env';
import { ok } from '../../lib/response';
import { requireAdmin } from '../../middleware/admin';
import { adminComments } from './comments';
import { adminContent } from './content';
import { adminMedia } from './media';
import { adminPosts } from './posts';
import { adminStats } from './stats';
import { adminTaxonomy } from './taxonomy';

export const adminRoutes = new Hono<AppEnv>();

/**
 * 모든 관리자 경로는 Cloudflare Access JWT 검증을 통과해야 한다.
 *
 * 이 미들웨어는 2차 방어선이다. api.namsu.kim/v1/admin/* 경로 자체를
 * Cloudflare Access 정책으로 감싸야 1차 방어선이 생긴다.
 * 둘 중 하나라도 빠지면 관리자 API 가 열린다.
 */
adminRoutes.use('*', requireAdmin);

/** 현재 로그인한 관리자. 관리자 화면 헤더에 쓴다. */
adminRoutes.get('/me', (c) => {
  const identity = c.get('identity');
  return ok(c, { email: identity.email, commonName: identity.commonName });
});

adminRoutes.route('/posts', adminPosts);
adminRoutes.route('/comments', adminComments);
adminRoutes.route('/media', adminMedia);
adminRoutes.route('/stats', adminStats);
adminRoutes.route('/', adminTaxonomy);
adminRoutes.route('/', adminContent);
