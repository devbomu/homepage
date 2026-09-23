import { createDb, pages, POST_STATUSES, projects, siteSettings } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { ApiError } from '../../lib/errors';
import { renderMarkdown } from '../../lib/markdown';
import { created, noContent, ok } from '../../lib/response';
import { slugify } from '../../lib/slug';

export const adminContent = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// 단독 페이지 (/about, /now, /uses ...)
// ---------------------------------------------------------------------------

const pageInput = z.object({
  slug: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(200),
  content: z.string().max(200_000).default(''),
  status: z.enum(POST_STATUSES).optional(),
  showInNav: z.boolean().optional(),
  navLabel: z.string().trim().max(50).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  metaDescription: z.string().trim().max(500).nullish(),
});

adminContent.get('/pages', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await db.select().from(pages).orderBy(asc(pages.sortOrder), asc(pages.id)));
});

adminContent.get('/pages/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const [row] = await db.select().from(pages).where(eq(pages.id, Number(c.req.param('id')))).limit(1);
  if (!row) throw ApiError.notFound('페이지를 찾을 수 없습니다.');
  return ok(c, row);
});

adminContent.post('/pages', zValidator('json', pageInput), async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');
  const status = input.status ?? 'draft';

  const [row] = await db
    .insert(pages)
    .values({
      slug: slugify(input.slug || input.title),
      title: input.title,
      content: input.content,
      contentHtml: renderMarkdown(input.content),
      status,
      // 스키마 CHECK 가 발행/예약 상태에 시각을 요구한다.
      publishedAt: status === 'published' || status === 'scheduled' ? Math.floor(Date.now() / 1000) : null,
      showInNav: input.showInNav ?? false,
      navLabel: input.navLabel ?? null,
      sortOrder: input.sortOrder ?? 0,
      metaDescription: input.metaDescription ?? null,
    })
    .returning();

  await audit(db, c.get('identity'), 'page.create', 'page', row!.id, { slug: row!.slug });
  return created(c, row);
});

adminContent.patch('/pages/:id{[0-9]+}', zValidator('json', pageInput.partial()), async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');

  const [current] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  if (!current) throw ApiError.notFound('페이지를 찾을 수 없습니다.');

  const content = input.content ?? current.content;
  const status = input.status ?? current.status;
  const needsPublishedAt = status === 'published' || status === 'scheduled';

  const [row] = await db
    .update(pages)
    .set({
      ...(input.slug ? { slug: slugify(input.slug) } : {}),
      title: input.title ?? current.title,
      content,
      ...(input.content !== undefined ? { contentHtml: renderMarkdown(content) } : {}),
      status,
      publishedAt: needsPublishedAt
        ? (current.publishedAt ?? Math.floor(Date.now() / 1000))
        : current.publishedAt,
      showInNav: input.showInNav ?? current.showInNav,
      navLabel: input.navLabel === undefined ? current.navLabel : input.navLabel,
      sortOrder: input.sortOrder ?? current.sortOrder,
      metaDescription:
        input.metaDescription === undefined ? current.metaDescription : input.metaDescription,
    })
    .where(eq(pages.id, id))
    .returning();

  await audit(db, c.get('identity'), 'page.update', 'page', id);
  return ok(c, row);
});

adminContent.delete('/pages/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const result = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
  if (result.length === 0) throw ApiError.notFound('페이지를 찾을 수 없습니다.');

  await audit(db, c.get('identity'), 'page.delete', 'page', id);
  return noContent(c);
});

// ---------------------------------------------------------------------------
// 프로젝트 (포트폴리오)
// ---------------------------------------------------------------------------

const projectInput = z.object({
  slug: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(200),
  summary: z.string().trim().max(500).nullish(),
  description: z.string().max(100_000).default(''),
  thumbnailUrl: z.string().trim().max(2000).nullish(),
  repoUrl: z.string().trim().max(2000).nullish(),
  demoUrl: z.string().trim().max(2000).nullish(),
  techStack: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  role: z.string().trim().max(100).nullish(),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.').nullish(),
  endedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.').nullish(),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

adminContent.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  return ok(c, await db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.id)));
});

adminContent.post('/projects', zValidator('json', projectInput), async (c) => {
  const db = createDb(c.env.DB);
  const input = c.req.valid('json');

  const [row] = await db
    .insert(projects)
    .values({
      slug: slugify(input.slug || input.title),
      title: input.title,
      summary: input.summary ?? null,
      description: input.description,
      descriptionHtml: renderMarkdown(input.description),
      thumbnailUrl: input.thumbnailUrl ?? null,
      repoUrl: input.repoUrl ?? null,
      demoUrl: input.demoUrl ?? null,
      techStack: input.techStack ?? [],
      role: input.role ?? null,
      startedOn: input.startedOn ?? null,
      endedOn: input.endedOn ?? null,
      isFeatured: input.isFeatured ?? false,
      isPublished: input.isPublished ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  await audit(db, c.get('identity'), 'project.create', 'project', row!.id, { slug: row!.slug });
  return created(c, row);
});

adminContent.patch('/projects/:id{[0-9]+}', zValidator('json', projectInput.partial()), async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');

  const [current] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!current) throw ApiError.notFound('프로젝트를 찾을 수 없습니다.');

  const description = input.description ?? current.description;

  const [row] = await db
    .update(projects)
    .set({
      ...(input.slug ? { slug: slugify(input.slug) } : {}),
      title: input.title ?? current.title,
      summary: input.summary === undefined ? current.summary : input.summary,
      description,
      ...(input.description !== undefined ? { descriptionHtml: renderMarkdown(description) } : {}),
      thumbnailUrl: input.thumbnailUrl === undefined ? current.thumbnailUrl : input.thumbnailUrl,
      repoUrl: input.repoUrl === undefined ? current.repoUrl : input.repoUrl,
      demoUrl: input.demoUrl === undefined ? current.demoUrl : input.demoUrl,
      techStack: input.techStack ?? current.techStack,
      role: input.role === undefined ? current.role : input.role,
      startedOn: input.startedOn === undefined ? current.startedOn : input.startedOn,
      endedOn: input.endedOn === undefined ? current.endedOn : input.endedOn,
      isFeatured: input.isFeatured ?? current.isFeatured,
      isPublished: input.isPublished ?? current.isPublished,
      sortOrder: input.sortOrder ?? current.sortOrder,
    })
    .where(eq(projects.id, id))
    .returning();

  await audit(db, c.get('identity'), 'project.update', 'project', id);
  return ok(c, row);
});

adminContent.delete('/projects/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const result = await db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  if (result.length === 0) throw ApiError.notFound('프로젝트를 찾을 수 없습니다.');

  await audit(db, c.get('identity'), 'project.delete', 'project', id);
  return noContent(c);
});

// ---------------------------------------------------------------------------
// 사이트 설정
// ---------------------------------------------------------------------------

adminContent.get('/settings', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(siteSettings);

  const settings: Record<string, unknown> = {};
  for (const row of rows) settings[row.key] = row.value;
  return ok(c, settings);
});

/** PUT /v1/admin/settings — 보낸 키만 갱신한다 (전체 교체가 아니다). */
adminContent.put(
  '/settings',
  zValidator('json', z.record(z.string().max(100), z.unknown())),
  async (c) => {
    const db = createDb(c.env.DB);
    const input = c.req.valid('json');
    const entries = Object.entries(input);

    if (entries.length === 0) throw ApiError.badRequest('변경할 설정이 없습니다.');
    if (entries.length > 50) throw ApiError.badRequest('한 번에 50개까지만 변경할 수 있습니다.');

    const statements = entries.map(([key, value]) =>
      db
        .insert(siteSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value } }),
    );

    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    await audit(db, c.get('identity'), 'settings.update', 'settings', null, {
      keys: entries.map(([k]) => k),
    });

    return ok(c, input);
  },
);
