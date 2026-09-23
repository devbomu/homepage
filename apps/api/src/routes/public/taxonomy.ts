import { createDb } from '@namsu/db';
import { Hono } from 'hono';

import type { AppEnv } from '../../env';
import { ApiError } from '../../lib/errors';
import { ok } from '../../lib/response';
import {
  getCategoryAncestors,
  getCategoryByPath,
  getCategoryTree,
  listSeries,
  listTagsWithCounts,
} from '../../queries/taxonomy';

export const publicTaxonomy = new Hono<AppEnv>();

/** GET /v1/categories — 다중 뎁스 트리 전체. 글 수는 하위 트리까지 합산된다. */
publicTaxonomy.get('/categories', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await getCategoryTree(db));
});

/**
 * GET /v1/categories/:path{.+}
 * path 는 'dev/backend/go' 처럼 슬래시를 포함하므로 와일드카드로 받는다.
 */
publicTaxonomy.get('/categories/:path{.+}', async (c) => {
  const db = createDb(c.env.DB);
  const path = c.req.param('path');

  const category = await getCategoryByPath(db, path);
  if (!category) throw ApiError.notFound('카테고리를 찾을 수 없습니다.');

  return ok(c, { ...category, breadcrumb: await getCategoryAncestors(db, path) });
});

/** GET /v1/tags — 글 수 많은 순. */
publicTaxonomy.get('/tags', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await listTagsWithCounts(db));
});

/** GET /v1/series */
publicTaxonomy.get('/series', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await listSeries(db));
});
