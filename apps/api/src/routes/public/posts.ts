import { createDb } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { ApiError } from '../../lib/errors';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { issueUnlockToken, verifyPassword, verifyUnlockToken } from '../../lib/password';
import { rateLimit } from '../../middleware/ratelimit';
import { ok, paged } from '../../lib/response';
import {
  getAdjacentPosts,
  getPostSecret,
  getProtectedPostContent,
  getPublishedPostBySlug,
  getRelatedPosts,
  listPinnedPosts,
  listPublishedPosts,
  searchPosts,
} from '../../queries/posts';
import {
  getCategoryAncestors,
  getDescendantCategoryIds,
  getSeriesBySlug,
  getTagBySlug,
} from '../../queries/taxonomy';

export const publicPosts = new Hono<AppEnv>();

/**
 * GET /v1/posts
 *   ?category=dev/backend  하위 카테고리 글까지 포함한다
 *   ?tag=cloudflare
 *   ?series=astro-blog
 *   ?cursor=...&limit=20
 */
publicPosts.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const limit = parseLimit(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'));

  const categoryParam = c.req.query('category');
  const tagParam = c.req.query('tag');
  const seriesParam = c.req.query('series');

  let categoryIds: number[] | undefined;
  if (categoryParam) {
    // 'dev' 를 고르면 'dev/backend/go' 의 글까지 나와야 한다.
    categoryIds = await getDescendantCategoryIds(db, categoryParam);
    if (categoryIds.length === 0) throw ApiError.notFound('카테고리를 찾을 수 없습니다.');
  }

  let tagId: number | undefined;
  if (tagParam) {
    const tag = await getTagBySlug(db, tagParam);
    if (!tag) throw ApiError.notFound('태그를 찾을 수 없습니다.');
    tagId = tag.id;
  }

  let seriesId: number | undefined;
  if (seriesParam) {
    const found = await getSeriesBySlug(db, seriesParam);
    if (!found) throw ApiError.notFound('시리즈를 찾을 수 없습니다.');
    seriesId = found.id;
  }

  const result = await listPublishedPosts(db, { limit, cursor, categoryIds, tagId, seriesId });

  return paged(c, result.items, {
    limit,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  });
});

/** GET /v1/posts/pinned — 첫 화면 상단에 고정할 글. */
publicPosts.get('/pinned', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await listPinnedPosts(db));
});

/**
 * GET /v1/posts/search?q=...
 * 3글자 이상은 FTS5, 그 미만은 LIKE 폴백 (queries/posts.ts 참고).
 */
publicPosts.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  if (!query) return ok(c, []);
  if (query.length > 100) throw ApiError.badRequest('검색어가 너무 깁니다.');

  const db = createDb(c.env.DB);
  return ok(c, await searchPosts(db, query, parseLimit(c.req.query('limit'), 20)));
});

/** GET /v1/posts/:slug */
publicPosts.get('/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const post = await getPublishedPostBySlug(db, c.req.param('slug'));
  if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');

  // 비밀글에는 관련 글도 이전/다음 글도 붙이지 않는다.
  // 같은 카테고리·태그의 글이 줄줄이 나오면 잠근 글의 주제가 그대로 드러난다.
  if (post.isProtected) {
    return ok(c, { ...post, breadcrumb: [], related: [], previous: null, next: null });
  }

  const [adjacent, related, breadcrumb] = await Promise.all([
    getAdjacentPosts(db, post.publishedAt ?? 0, post.id),
    getRelatedPosts(db, post.id),
    post.category ? getCategoryAncestors(db, post.category.path) : Promise.resolve([]),
  ]);

  return ok(c, { ...post, breadcrumb, related, ...adjacent });
});

/**
 * POST /v1/posts/:slug/unlock — 비밀글 본문.
 *
 * 비밀번호를 맞히면 본문을 내려주고, 다음 방문에 다시 묻지 않도록 서명 토큰을 준다.
 * 응답은 절대 캐시하지 않는다 — 한 사람이 푼 본문이 캐시에 실리면
 * 그다음 방문자에게 그대로 나간다.
 *
 * 무차별 대입은 레이트리밋으로 막는다. 맞았는지 틀렸는지 외에는 아무것도 알려주지 않는다.
 */
publicPosts.post(
  '/:slug/unlock',
  rateLimit((env) => env.RATE_LIMIT_UNLOCK, 'unlock'),
  zValidator(
    'json',
    z.object({
      password: z.string().min(1).max(200).optional(),
      token: z.string().min(1).max(500).optional(),
    }),
  ),
  async (c) => {
    const db = createDb(c.env.DB);
    const slug = c.req.param('slug');
    const { password, token } = c.req.valid('json');

    const post = await getPostSecret(db, slug);
    if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');
    if (!post.passwordHash) throw ApiError.badRequest('비밀글이 아닙니다.');

    const secret = c.env.VISITOR_HASH_SALT;
    const passed = token
      ? await verifyUnlockToken(secret, post.id, token)
      : password != null && (await verifyPassword(password, post.passwordHash));

    if (!passed) {
      // 토큰이 만료된 경우와 비밀번호가 틀린 경우를 구분해 알려줄 이유가 없다.
      throw ApiError.forbidden('비밀번호가 맞지 않습니다.');
    }

    const content = await getProtectedPostContent(db, slug);
    if (!content) throw ApiError.notFound('글을 찾을 수 없습니다.');

    const issued = await issueUnlockToken(secret, post.id);
    c.header('Cache-Control', 'private, no-store');
    return ok(c, { ...content, token: issued.token, expiresAt: issued.expiresAt });
  },
);
