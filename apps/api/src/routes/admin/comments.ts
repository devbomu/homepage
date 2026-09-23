import { COMMENT_STATUSES, comments, createDb } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { ApiError } from '../../lib/errors';
import { noContent, ok, paged } from '../../lib/response';
import { and, eq, isNull } from 'drizzle-orm';

import {
  countPendingComments,
  createComment,
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

/**
 * POST /v1/admin/comments/:id/reply — 주인 자격으로 답글을 단다.
 *
 * 관리자 답글은 승인 절차를 거치지 않고 바로 공개된다 (본인이 쓴 것이므로).
 * 비밀 댓글에 다는 답글은 queries/comments.ts 가 강제로 비밀로 만든다.
 * 그래야 답글만 보고 원래 질문을 짐작하는 일이 없다.
 */
adminComments.post(
  '/:id{[0-9]+}/reply',
  zValidator('json', z.object({ body: z.string().trim().min(1).max(5000) })),
  async (c) => {
    const db = createDb(c.env.DB);
    const parentId = Number(c.req.param('id'));
    const { body } = c.req.valid('json');

    const [parent] = await db
      .select({ postId: comments.postId })
      .from(comments)
      .where(and(eq(comments.id, parentId), isNull(comments.deletedAt)))
      .limit(1);
    if (!parent) throw ApiError.notFound('댓글을 찾을 수 없습니다.');

    const identity = c.get('identity');
    const created = await createComment(db, {
      postId: parent.postId,
      parentId,
      authorName: c.env.OWNER_DISPLAY_NAME || '작성자',
      authorEmail: null,
      authorWebsite: null,
      body,
      // 관리자 답글은 방문자 추적 대상이 아니다.
      visitorHash: 'admin',
      userAgent: null,
      isSecret: false,
      isOwner: true,
      autoApprove: true,
    });

    await audit(db, identity, 'comment.reply', 'comment', created.id, { parentId });
    return c.json({ data: created }, 201);
  },
);
