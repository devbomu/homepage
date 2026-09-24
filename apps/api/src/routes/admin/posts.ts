import { createDb, POST_STATUSES, posts, PROTECTED_LISTINGS, tags, type Db } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { ApiError } from '../../lib/errors';
import { analyzeContent, autoSummary, renderMarkdown } from '../../lib/markdown';
import { hashPassword } from '../../lib/password';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { created, noContent, ok, paged } from '../../lib/response';
import { resolveSlug, uniqueSlug } from '../../lib/slug';
import { getAdminPost, listAdminPosts, replacePostTags, softDeletePost } from '../../queries/posts';

export const adminPosts = new Hono<AppEnv>();

const postInput = z.object({
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(200),
  /**
   * 주소. 생략하면 지금 값을 그대로 두고, null 이나 빈 문자열이면 새로 만든다.
   * 이 셋을 구분해야 "비우고 저장하면 다시 자동 생성" 이 성립한다.
   */
  slug: z.string().trim().max(200).nullish(),
  summary: z.string().trim().max(500).nullish(),
  /*
   * default('') 를 쓰면 안 된다. PATCH 로 제목만 고쳐 보내도 zod 가 빈 문자열을
   * 채워 넣어 본문이 통째로 지워진다. 기본값은 생성 시점에만 적용한다.
   */
  content: z.string().max(200_000).optional(),
  categoryId: z.number().int().positive().nullish(),
  seriesId: z.number().int().positive().nullish(),
  seriesOrder: z.number().int().min(0).nullish(),
  tagIds: z.array(z.number().int().positive()).max(20).optional(),
  status: z.enum(POST_STATUSES).optional(),
  /** unix epoch 초. 예약 발행에 쓴다. */
  publishedAt: z.number().int().nullish(),
  coverImageUrl: z.string().trim().max(2000).nullish(),
  allowComments: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  metaTitle: z.string().trim().max(200).nullish(),
  metaDescription: z.string().trim().max(500).nullish(),
  ogImageUrl: z.string().trim().max(2000).nullish(),

  /**
   * 비밀글 비밀번호. 평문으로 받아 해시만 저장한다.
   *  - 생략하면 지금 설정을 그대로 둔다
   *  - null 이나 빈 문자열이면 잠금을 푼다
   */
  password: z.string().max(200).nullish(),
  protectedListing: z.enum(PROTECTED_LISTINGS).optional(),
});

const validate = zValidator('json', postInput.partial({ title: true }), (result) => {
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.');
      if (key) fields[key] = issue.message;
    }
    throw ApiError.badRequest('입력값을 확인해 주세요.', fields);
  }
});

/**
 * 비밀번호 입력을 저장할 해시로 바꾼다.
 *
 * 생략(undefined)과 해제(null / 빈 문자열)를 구분해야 한다. 둘을 같게 다루면
 * 제목만 고치려고 PATCH 를 보낼 때마다 비밀글이 풀린다.
 */
async function resolvePasswordHash(
  input: string | null | undefined,
  current: string | null,
): Promise<string | null> {
  if (input === undefined) return current;
  if (!input) return null;
  return hashPassword(input);
}

async function slugTaken(db: Db, slug: string, excludeId?: number): Promise<boolean> {
  const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
  return row != null && row.id !== excludeId;
}

/** 태그 id 가 전부 실제로 존재하는지 확인한다. */
async function assertTagsExist(db: Db, tagIds: number[]): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
  if (rows.length !== tagIds.length)
    throw ApiError.badRequest('존재하지 않는 태그가 포함되어 있습니다.');
}

/**
 * 본문에서 파생되는 값들을 한곳에서 계산한다.
 *
 * HTML 렌더는 저장 시점에 한 번만 한다 — 읽기는 쓰기보다 훨씬 잦고,
 * 요청마다 마크다운을 파싱하면 Workers CPU 시간을 그냥 태우는 셈이다.
 */
function derive(content: string, summary: string | null | undefined) {
  const { wordCount, readingMinutes } = analyzeContent(content);
  return {
    contentHtml: renderMarkdown(content),
    wordCount,
    readingMinutes,
    summary: summary?.trim() || (content ? autoSummary(content) : null),
  };
}

/** 발행/예약 상태인데 시각이 없으면 지금으로 채운다 (스키마 CHECK 가 이를 요구한다). */
function resolvePublishedAt(
  status: (typeof POST_STATUSES)[number] | undefined,
  publishedAt: number | null | undefined,
  current: number | null,
): number | null {
  if (publishedAt !== undefined && publishedAt !== null) return publishedAt;
  if (status === 'published' || status === 'scheduled')
    return current ?? Math.floor(Date.now() / 1000);
  return publishedAt === null ? null : current;
}

/** GET /v1/admin/posts?status=draft&cursor=&limit= */
adminPosts.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const limit = parseLimit(c.req.query('limit'));
  const statusParam = c.req.query('status');
  const status = POST_STATUSES.find((s) => s === statusParam);

  const page = await listAdminPosts(db, {
    limit,
    cursor: decodeCursor(c.req.query('cursor')),
    status,
  });

  return paged(c, page.items, { limit, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

/** GET /v1/admin/posts/:id — 마크다운 원문까지 돌려준다. */
adminPosts.get('/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const post = await getAdminPost(db, Number(c.req.param('id')));
  if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');
  return ok(c, post);
});

/** POST /v1/admin/posts */
adminPosts.post('/', validate, async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');
  if (!input.title) throw ApiError.badRequest('제목을 입력해 주세요.');

  const content = input.content ?? '';
  const slug = await uniqueSlug(resolveSlug(input.slug), (s) => slugTaken(db, s));
  const tagIds = input.tagIds ?? [];
  await assertTagsExist(db, tagIds);

  const status = input.status ?? 'draft';
  const [row] = await db
    .insert(posts)
    .values({
      slug,
      title: input.title,
      content,
      ...derive(content, input.summary),
      categoryId: input.categoryId ?? null,
      seriesId: input.seriesId ?? null,
      seriesOrder: input.seriesId ? (input.seriesOrder ?? null) : null,
      status,
      publishedAt: resolvePublishedAt(status, input.publishedAt, null),
      coverImageUrl: input.coverImageUrl ?? null,
      allowComments: input.allowComments ?? true,
      isPinned: input.isPinned ?? false,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      protectedListing: input.protectedListing ?? 'title',
    })
    .returning({ id: posts.id, slug: posts.slug, status: posts.status });

  const post = row!;
  if (tagIds.length > 0) await replacePostTags(db, post.id, tagIds);

  await audit(db, c.get('identity'), 'post.create', 'post', post.id, { slug: post.slug });
  return created(c, post);
});

/** PATCH /v1/admin/posts/:id */
adminPosts.patch('/:id{[0-9]+}', validate, async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');

  const [current] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!current || current.deletedAt != null) throw ApiError.notFound('글을 찾을 수 없습니다.');

  if (input.tagIds) await assertTagsExist(db, input.tagIds);

  /*
   * 주소 칸을 비우고 저장하면 새로 만든다.
   * 값을 아예 안 보냈으면(undefined) 지금 것을 그대로 둔다 — 제목만 고치려고
   * 보낸 PATCH 가 주소를 바꿔 버리면 기존 링크가 전부 깨진다.
   */
  let slug = current.slug;
  if (input.slug !== undefined) {
    const next = resolveSlug(input.slug);
    if (next !== current.slug) slug = await uniqueSlug(next, (s) => slugTaken(db, s, id));
  }

  const content = input.content ?? current.content;
  const contentChanged = input.content !== undefined || input.summary !== undefined;
  /*
   * 요약도 같은 규칙이다. null 이면 본문에서 다시 만들고(derive 가 처리한다),
   * 안 보냈으면 지금 것을 그대로 둔다. `??` 로 합치면 "비웠다" 가 "안 보냈다" 와
   * 같아져서 비워도 옛 요약이 그대로 남는다.
   */
  const summary = input.summary === undefined ? current.summary : input.summary;
  const status = input.status ?? current.status;
  const seriesId = input.seriesId === undefined ? current.seriesId : input.seriesId;

  await db
    .update(posts)
    .set({
      slug,
      title: input.title ?? current.title,
      content,
      // 본문이나 요약이 안 바뀌었으면 다시 렌더하지 않는다.
      ...(contentChanged ? derive(content, summary) : {}),
      categoryId: input.categoryId === undefined ? current.categoryId : input.categoryId,
      seriesId,
      seriesOrder: seriesId ? (input.seriesOrder ?? current.seriesOrder) : null,
      status,
      publishedAt: resolvePublishedAt(status, input.publishedAt, current.publishedAt),
      coverImageUrl:
        input.coverImageUrl === undefined ? current.coverImageUrl : input.coverImageUrl,
      allowComments: input.allowComments ?? current.allowComments,
      isPinned: input.isPinned ?? current.isPinned,
      metaTitle: input.metaTitle === undefined ? current.metaTitle : input.metaTitle,
      metaDescription:
        input.metaDescription === undefined ? current.metaDescription : input.metaDescription,
      ogImageUrl: input.ogImageUrl === undefined ? current.ogImageUrl : input.ogImageUrl,
      passwordHash: await resolvePasswordHash(input.password, current.passwordHash),
      protectedListing: input.protectedListing ?? current.protectedListing,
    })
    .where(eq(posts.id, id));

  if (input.tagIds) await replacePostTags(db, id, input.tagIds);

  await audit(db, c.get('identity'), 'post.update', 'post', id, {
    slug,
    statusFrom: current.status,
    statusTo: status,
  });

  const updated = await getAdminPost(db, id);
  return ok(c, updated);
});

/** DELETE /v1/admin/posts/:id — 소프트 삭제. 댓글과 좋아요는 남는다. */
adminPosts.delete('/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  if (!(await softDeletePost(db, id))) throw ApiError.notFound('글을 찾을 수 없습니다.');

  await audit(db, c.get('identity'), 'post.delete', 'post', id);
  return noContent(c);
});
