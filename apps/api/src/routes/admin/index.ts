import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { renderMarkdown } from '../../lib/markdown';
import { ok } from '../../lib/response';
import { requireAdmin } from '../../middleware/admin';
import { adminComments } from './comments';
import { adminContent } from './content';
import { adminGuestbook } from './guestbook';
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

/**
 * POST /v1/admin/preview — 저장하지 않고 마크다운 렌더 결과만 본다.
 *
 * 예전에는 /posts/:id/preview 로 글에 붙어 있었다. 아직 저장 전인 새 글이나
 * 페이지·프로젝트에서는 쓸 수 없어서, id 없이 부르도록 옮겼다.
 */
adminRoutes.post(
  '/preview',
  zValidator('json', z.object({ content: z.string().max(200_000) })),
  (c) => ok(c, { contentHtml: renderMarkdown(c.req.valid('json').content) }),
);

adminRoutes.route('/posts', adminPosts);
adminRoutes.route('/comments', adminComments);
adminRoutes.route('/guestbook', adminGuestbook);
adminRoutes.route('/media', adminMedia);
adminRoutes.route('/stats', adminStats);
adminRoutes.route('/', adminTaxonomy);
adminRoutes.route('/', adminContent);
