import { COMMENT_STATUSES, createDb } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { noContent, ok, paged } from '../../lib/response';
import {
  countPendingComments,
  listCommentsForModeration,
  setCommentStatus,
  softDeleteComment,
} from '../../queries/comments';

export const adminComments = new Hono<AppEnv>();

/** GET /v1/admin/comments?status=pending — 모더레이션 큐. */
adminComments.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const limit = parseLimit(c.req.query('limit'));
  const statusParam = c.req.query('status');
  const status = COMMENT_STATUSES.find((s) => s === statusParam);

  const page = await listCommentsForModeration(db, {
    limit,
    cursor: decodeCursor(c.req.query('cursor')),
    status,
  });

  return paged(c, page.items, { limit, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

/** GET /v1/admin/comments/pending-count — 관리자 화면 배지용. */
adminComments.get('/pending-count', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, { count: await countPendingComments(db) });
});

/**
 * PATCH /v1/admin/comments/:id — 승인 / 스팸 처리.
 * posts.comment_count 는 직접 건드리지 않는다. 트리거가 상태 전이를 보고 맞춘다.
 */
adminComments.patch(
  '/:id{[0-9]+}',
  zValidator('json', z.object({ status: z.enum(COMMENT_STATUSES) })),
  async (c) => {
    const db = createDb(c.env.DB);
    const id = Number(c.req.param('id'));
    const { status } = c.req.valid('json');

    const updated = await setCommentStatus(db, id, status);
    await audit(db, c.get('identity'), 'comment.moderate', 'comment', id, { status });
    return ok(c, updated);
  },
);

/** DELETE /v1/admin/comments/:id — 소프트 삭제 (대댓글이 같이 사라지지 않게). */
adminComments.delete('/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  await softDeleteComment(db, id);
  await audit(db, c.get('identity'), 'comment.delete', 'comment', id);
  return noContent(c);
});
