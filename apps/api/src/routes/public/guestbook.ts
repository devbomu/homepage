import { createDb } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { commentsRequireApproval, ownerEmail, type AppEnv } from '../../env';
import { newCommentMail, sendMail } from '../../lib/email';
import { ApiError } from '../../lib/errors';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { paged } from '../../lib/response';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/visitor';
import { rateLimit } from '../../middleware/ratelimit';
import { withVisitor } from '../../middleware/visitor';
import {
  countGuestbook,
  createGuestbookEntry,
  isDuplicateGuestbookEntry,
  listGuestbook,
} from '../../queries/guestbook';

export const publicGuestbook = new Hono<AppEnv>();

// 작성과 도배 방지에 방문자 해시가 필요하다.
publicGuestbook.use('*', withVisitor);

/** GET /v1/guestbook — 최신순. */
publicGuestbook.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const limit = parseLimit(c.req.query('limit'), 30);

  const [page, total] = await Promise.all([
    listGuestbook(db, { limit, cursor: decodeCursor(c.req.query('cursor')) }),
    countGuestbook(db),
  ]);

  return paged(c, page.items, {
    limit,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    total,
  });
});

const createSchema = z.object({
  authorName: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  // 이메일은 선택이다. 공개 응답에는 넣지 않는다.
  authorEmail: z.string().trim().email('이메일 형식이 올바르지 않습니다.').max(200).nullish(),
  authorWebsite: z.string().trim().url('주소 형식이 올바르지 않습니다.').max(500).nullish(),
  body: z.string().trim().min(1, '내용을 입력해 주세요.').max(2000),
  turnstileToken: z.string().nullish(),
});

/** POST /v1/guestbook */
publicGuestbook.post(
  '/',
  rateLimit((env) => env.RATE_LIMIT_COMMENT, 'guestbook'),
  zValidator('json', createSchema, (result) => {
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

    if (await isDuplicateGuestbookEntry(db, visitorHash, input.body)) {
      throw ApiError.conflict('방금 같은 내용을 남기셨습니다.');
    }

    const entry = await createGuestbookEntry(db, {
      authorName: input.authorName,
      authorEmail: input.authorEmail ?? null,
      authorWebsite: input.authorWebsite ?? null,
      body: input.body,
      visitorHash,
      userAgent: c.req.header('User-Agent') ?? null,
      autoApprove: !commentsRequireApproval(c.env),
    });

    // 알림은 응답을 막지 않는다.
    const owner = ownerEmail(c.env);
    if (owner) {
      c.executionCtx.waitUntil(
        sendMail(
          c.env,
          newCommentMail({
            to: owner,
            postTitle: '방명록',
            postUrl: `${c.env.SITE_URL}/guestbook`,
            adminUrl: `${c.env.ADMIN_URL}/guestbook`,
            authorName: input.authorName,
            body: input.body,
            isSecret: false,
            isReply: false,
          }),
        ),
      );
    }

    const published = entry.status === 'approved';
    return c.json(
      {
        data: {
          id: entry.id,
          status: entry.status,
          // 바로 공개되는 경우 화면이 새로고침 없이 그릴 수 있게 값을 돌려준다.
          authorName: input.authorName,
          authorWebsite: input.authorWebsite ?? null,
          body: input.body,
          createdAt: entry.createdAt,
          message: published
            ? '방명록에 남겼습니다. 고맙습니다!'
            : '남기셨습니다. 확인 후 공개됩니다.',
        },
      },
      201,
    );
  },
);
