import { createDb } from '@namsu/db';
import { Hono } from 'hono';

import type { AppEnv } from '../../env';
import { ApiError } from '../../lib/errors';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { ok, paged } from '../../lib/response';
import {
  getAdjacentPosts,
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

  const [adjacent, related, breadcrumb] = await Promise.all([
    getAdjacentPosts(db, post.publishedAt ?? 0, post.id),
    getRelatedPosts(db, post.id),
    post.category ? getCategoryAncestors(db, post.category.path) : Promise.resolve([]),
  ]);

  return ok(c, { ...post, breadcrumb, related, ...adjacent });
});
