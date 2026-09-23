import { createDb, posts, type Db } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { commentsRequireApproval, ownerEmail, type AppEnv } from '../../env';
import { newCommentMail, replyMail, sendMail } from '../../lib/email';
import { ApiError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/visitor';
import { rateLimit } from '../../middleware/ratelimit';
import { withVisitor } from '../../middleware/visitor';
import {
  createComment,
  getCommentForNotify,
  isDuplicateComment,
  listApprovedComments,
} from '../../queries/comments';
import { visiblePost } from '../../queries/visibility';
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
    .where(and(eq(posts.slug, c.req.param('slug')), visiblePost))
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
  /**
   * 비밀 댓글. 공개 화면에는 잠금 표시만 나가고 본문은 관리자만 본다.
   * 비밀 댓글에 다는 답글은 서버가 강제로 비밀로 만든다 (queries/comments.ts).
   */
  isSecret: z.boolean().default(false),
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
      .select({ id: posts.id, slug: posts.slug, title: posts.title })
      .from(posts)
      .where(and(eq(posts.slug, c.req.param('slug')), visiblePost))
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
      isSecret: input.isSecret,
      autoApprove: !commentsRequireApproval(c.env),
    });

    const published = comment.status === 'approved';

    // 알림은 응답을 막지 않는다. 메일 서버가 느리다고 댓글 등록이 늦어질 이유가 없다.
    c.executionCtx.waitUntil(
      notifyOnComment(c.env, db, {
        postTitle: post.title,
        postUrl: `${c.env.SITE_URL}/blog/${encodeURIComponent(post.slug)}#comments`,
        parentId: input.parentId ?? null,
        authorName: input.authorName,
        authorEmail: input.authorEmail ?? null,
        body: input.body,
        isSecret: comment.isSecret,
      }),
    );

    return c.json(
      {
        data: {
          id: comment.id,
          status: comment.status,
          isSecret: comment.isSecret,
          parentId: input.parentId ?? null,
          // 바로 공개되는 경우 화면이 새로고침 없이 그릴 수 있게 값을 돌려준다.
          // 비밀 댓글은 목록 조회와 같은 규칙으로 여기서도 비운다.
          authorName: comment.isSecret ? '' : input.authorName,
          body: comment.isSecret ? '' : input.body,
          isOwner: false,
          createdAt: comment.createdAt,
          message: comment.isSecret
            ? '비밀 댓글이 등록되었습니다. 블로그 주인만 볼 수 있습니다.'
            : published
              ? '댓글이 등록되었습니다.'
              : '댓글이 등록되었습니다. 확인 후 공개됩니다.',
        },
      },
      201,
    );
  },
);

interface CommentNotice {
  postTitle: string;
  postUrl: string;
  parentId: number | null;
  authorName: string;
  authorEmail: string | null;
  body: string;
  isSecret: boolean;
}

/**
 * 새 댓글 알림.
 *
 * 주인에게는 늘 보내고, 답글이면 원댓글 작성자에게도 보낸다.
 * 같은 주소로 두 번 가지 않게 한 번 걸러낸다 — 주인이 자기 글에
 * 자문자답하면 똑같은 메일이 두 통 온다.
 */
async function notifyOnComment(env: AppEnv['Bindings'], db: Db, notice: CommentNotice) {
  const sent = new Set<string>();
  const owner = ownerEmail(env);

  if (owner) {
    sent.add(owner);
    await sendMail(
      env,
      newCommentMail({
        to: owner,
        postTitle: notice.postTitle,
        postUrl: notice.postUrl,
        adminUrl: `${env.ADMIN_URL}/comments`,
        authorName: notice.authorName,
        body: notice.body,
        isSecret: notice.isSecret,
        isReply: notice.parentId != null,
      }),
    );
  }

  if (notice.parentId == null) return;

  const parent = await getCommentForNotify(db, notice.parentId);
  if (!parent?.authorEmail) return;
  // 자기 댓글에 자기가 단 답글로 자기에게 메일이 가지 않게 한다.
  if (parent.authorEmail === notice.authorEmail) return;
  if (sent.has(parent.authorEmail)) return;

  await sendMail(
    env,
    replyMail({
      to: parent.authorEmail,
      postTitle: notice.postTitle,
      postUrl: notice.postUrl,
      originalBody: parent.body,
      replyAuthor: notice.authorName,
      replyBody: notice.body,
      isSecret: notice.isSecret,
    }),
  );
}
