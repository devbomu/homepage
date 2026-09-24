import { createDb, series, tags } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { ApiError } from '../../lib/errors';
import { created, noContent, ok } from '../../lib/response';
import { resolveSlug, uniqueSlug } from '../../lib/slug';
import {
  createCategory,
  deleteCategory,
  getCategoryTree,
  updateCategory,
} from '../../queries/taxonomy';

export const adminTaxonomy = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// 카테고리
// ---------------------------------------------------------------------------

const categoryInput = z.object({
  parentId: z.number().int().positive().nullish(),
  // 생략=유지, null/빈 문자열=새로 만들기, 값=그대로.
  slug: z.string().trim().max(200).nullish(),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100),
  description: z.string().trim().max(1000).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

adminTaxonomy.get('/categories', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await getCategoryTree(db));
});

adminTaxonomy.post('/categories', zValidator('json', categoryInput), async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');

  const row = await createCategory(db, {
    parentId: input.parentId ?? null,
    slug: resolveSlug(input.slug),
    name: input.name,
    description: input.description ?? null,
    sortOrder: input.sortOrder,
  });

  await audit(db, c.get('identity'), 'category.create', 'category', row.id, { path: row.path });
  return created(c, row);
});

adminTaxonomy.patch(
  '/categories/:id{[0-9]+}',
  zValidator('json', categoryInput.partial()),
  async (c) => {
    const db = createDb(c.env.DB);
    const id = Number(c.req.param('id'));
    const input = c.req.valid('json');

    const row = await updateCategory(db, id, {
      parentId: input.parentId,
      // 비우고 저장하면 새 주소를 만든다. 안 보냈으면 그대로 둔다.
      slug: input.slug === undefined ? undefined : resolveSlug(input.slug),
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
    });

    await audit(db, c.get('identity'), 'category.update', 'category', id, { path: row.path });
    return ok(c, row);
  },
);

adminTaxonomy.delete('/categories/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  await deleteCategory(db, id);
  await audit(db, c.get('identity'), 'category.delete', 'category', id);
  return noContent(c);
});

// ---------------------------------------------------------------------------
// 태그
// ---------------------------------------------------------------------------

const tagInput = z.object({
  // 생략=유지, null/빈 문자열=새로 만들기, 값=그대로.
  slug: z.string().trim().max(200).nullish(),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  description: z.string().trim().max(500).nullish(),
});

adminTaxonomy.get('/tags', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await db.select().from(tags).orderBy(asc(tags.name)));
});

adminTaxonomy.post('/tags', zValidator('json', tagInput), async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');

  const slug = await uniqueSlug(resolveSlug(input.slug), async (candidate) => {
    const [row] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.slug, candidate))
      .limit(1);
    return row != null;
  });

  const [row] = await db
    .insert(tags)
    .values({ slug, name: input.name, description: input.description ?? null })
    .returning();

  await audit(db, c.get('identity'), 'tag.create', 'tag', row!.id, { slug });
  return created(c, row);
});

adminTaxonomy.patch('/tags/:id{[0-9]+}', zValidator('json', tagInput.partial()), async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');

  const result = await db
    .update(tags)
    .set({
      ...(input.slug !== undefined ? { slug: resolveSlug(input.slug) } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .where(eq(tags.id, id))
    .returning();

  if (result.length === 0) throw ApiError.notFound('태그를 찾을 수 없습니다.');
  await audit(db, c.get('identity'), 'tag.update', 'tag', id);
  return ok(c, result[0]);
});

adminTaxonomy.delete('/tags/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  // post_tags 는 ON DELETE CASCADE 라 연결만 끊기고 글은 남는다.
  const result = await db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
  if (result.length === 0) throw ApiError.notFound('태그를 찾을 수 없습니다.');

  await audit(db, c.get('identity'), 'tag.delete', 'tag', id);
  return noContent(c);
});

// ---------------------------------------------------------------------------
// 시리즈
// ---------------------------------------------------------------------------

const seriesInput = z.object({
  // 생략=유지, null/빈 문자열=새로 만들기, 값=그대로.
  slug: z.string().trim().max(200).nullish(),
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(200),
  description: z.string().trim().max(1000).nullish(),
  coverImageUrl: z.string().trim().max(2000).nullish(),
});

adminTaxonomy.get('/series', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await db.select().from(series).orderBy(asc(series.title)));
});

adminTaxonomy.post('/series', zValidator('json', seriesInput), async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');

  const slug = await uniqueSlug(resolveSlug(input.slug), async (candidate) => {
    const [row] = await db
      .select({ id: series.id })
      .from(series)
      .where(eq(series.slug, candidate))
      .limit(1);
    return row != null;
  });

  const [row] = await db
    .insert(series)
    .values({
      slug,
      title: input.title,
      description: input.description ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
    })
    .returning();

  await audit(db, c.get('identity'), 'series.create', 'series', row!.id, { slug });
  return created(c, row);
});

adminTaxonomy.patch('/series/:id{[0-9]+}', zValidator('json', seriesInput.partial()), async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');

  const result = await db
    .update(series)
    .set({
      ...(input.slug !== undefined ? { slug: resolveSlug(input.slug) } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
    })
    .where(eq(series.id, id))
    .returning();

  if (result.length === 0) throw ApiError.notFound('시리즈를 찾을 수 없습니다.');
  await audit(db, c.get('identity'), 'series.update', 'series', id);
  return ok(c, result[0]);
});

adminTaxonomy.delete('/series/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  // 글의 series_id 는 ON DELETE SET NULL 이라 글은 남는다.
  const result = await db.delete(series).where(eq(series.id, id)).returning({ id: series.id });
  if (result.length === 0) throw ApiError.notFound('시리즈를 찾을 수 없습니다.');

  await audit(db, c.get('identity'), 'series.delete', 'series', id);
  return noContent(c);
});
