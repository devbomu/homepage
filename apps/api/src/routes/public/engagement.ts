import { createDb, posts } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { commentsRequireApproval, type AppEnv } from '../../env';
import { ApiError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/visitor';
import { rateLimit } from '../../middleware/ratelimit';
import { withVisitor } from '../../middleware/visitor';
import { createComment, isDuplicateComment, listApprovedComments } from '../../queries/comments';
import { getLikeState, recordView, toggleLike } from '../../queries/engagement';

export const publicEngagement = new Hono<AppEnv>();

// 좋아요/댓글/조회는 전부 방문자 해시가 필요하다.
publicEngagement.use('*', withVisitor);

// ---------------------------------------------------------------------------
// 좋아요
// ---------------------------------------------------------------------------

/** GET /v1/posts/:slug/like — 내가 눌렀는지와 총 개수. */
publicEngagement.get('/:slug/like', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await getLikeState(db, c.req.param('slug'), c.get('visitorHash')));
});

/** POST /v1/posts/:slug/like — 토글. */
publicEngagement.post(
  '/:slug/like',
  rateLimit((env) => env.RATE_LIMIT_WRITE, 'like'),
  async (c) => {
    const db = createDb(c.env.DB);
    return ok(c, await toggleLike(db, c.req.param('slug'), c.get('visitorHash')));
  },
);

// ---------------------------------------------------------------------------
// 조회수
// ---------------------------------------------------------------------------

/**
 * POST /v1/posts/:slug/view
 *
 * 레이트리밋이 같은 방문자의 연타를 걸러주므로 여기서 중복을 따로 검사하지 않는다.
 * 한도를 넘으면 조용히 성공 처리한다 — 조회수 때문에 화면에 에러를 띄울 이유가 없다.
 */
publicEngagement.post('/:slug/view', async (c) => {
  const limiter = c.env.RATE_LIMIT_WRITE;
  if (limiter?.limit) {
    const { success } = await limiter.limit({
      key: `view:${c.get('visitorHash')}:${c.req.param('slug')}`,
    });
    if (!success) return ok(c, { recorded: false });
  }

  const db = createDb(c.env.DB);
  await recordView(db, c.req.param('slug'));
  return ok(c, { recorded: true });
});

// ---------------------------------------------------------------------------
// 댓글
// ---------------------------------------------------------------------------

/** GET /v1/posts/:slug/comments — 승인된 것만, 트리로. */
publicEngagement.get('/:slug/comments', async (c) => {
  const db = createDb(c.env.DB);
  const [post] = await db
    .select({ id: posts.id, allowComments: posts.allowComments })
    .from(posts)
    .where(
      and(
        eq(posts.slug, c.req.param('slug')),
        eq(posts.status, 'published'),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);

  if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');

  return ok(c, {
    allowComments: post.allowComments,
    comments: await listApprovedComments(db, post.id),
  });
});

const createCommentSchema = z.object({
  authorName: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  // 이메일은 선택이다. 답글 알림과 아바타에만 쓰고 공개 응답에는 넣지 않는다.
  authorEmail: z.string().trim().email('이메일 형식이 올바르지 않습니다.').max(200).nullish(),
  authorWebsite: z.string().trim().url('주소 형식이 올바르지 않습니다.').max(500).nullish(),
  body: z.string().trim().min(1, '내용을 입력해 주세요.').max(5000),
  parentId: z.number().int().positive().nullish(),
  turnstileToken: z.string().nullish(),
});

/** POST /v1/posts/:slug/comments */
publicEngagement.post(
  '/:slug/comments',
  rateLimit((env) => env.RATE_LIMIT_COMMENT, 'comment'),
  zValidator('json', createCommentSchema, (result, c) => {
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.');
        if (key) fields[key] = issue.message;
      }
      throw ApiError.badRequest('입력값을 확인해 주세요.', fields);
    }
  }),
  async (c) => {
    const db = createDb(c.env.DB);
    const input = c.req.valid('json');
    const visitorHash = c.get('visitorHash');

    const passed = await verifyTurnstile(
      c.env.TURNSTILE_SECRET_KEY,
      input.turnstileToken ?? undefined,
      clientIp(c.req.raw.headers),
    );
    if (!passed)
      throw ApiError.forbidden('봇 검증에 실패했습니다. 새로고침 후 다시 시도해 주세요.');

    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.slug, c.req.param('slug')),
          eq(posts.status, 'published'),
          isNull(posts.deletedAt),
        ),
      )
      .limit(1);
    if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');

    if (await isDuplicateComment(db, visitorHash, post.id, input.body)) {
      throw ApiError.conflict('방금 같은 내용을 등록하셨습니다.');
    }

    const comment = await createComment(db, {
      postId: post.id,
      parentId: input.parentId ?? null,
      authorName: input.authorName,
      authorEmail: input.authorEmail ?? null,
      authorWebsite: input.authorWebsite ?? null,
      body: input.body,
      visitorHash,
      userAgent: c.req.header('User-Agent') ?? null,
      autoApprove: !commentsRequireApproval(c.env),
    });

    return c.json(
      {
        data: {
          id: comment.id,
          status: comment.status,
          // 승인 대기면 화면에 바로 안 보이므로 그 사실을 알려준다.
          message:
            comment.status === 'approved'
              ? '댓글이 등록되었습니다.'
              : '댓글이 등록되었습니다. 확인 후 공개됩니다.',
        },
      },
      201,
    );
  },
);
